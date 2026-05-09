# AI Surfaces Unification v1 — Design

**Status:** Brainstormed 2026-05-09; spec authored same day; user-review pending.

**Goal:** Collapse the parallel implementations of Chat and Scene transcripts into one shared layer at three levels — streaming, transcript container, per-message rows — and fix the latent retry-prompt-construction quirk in the backend along the way.

**Issues folded:**
- `story-editor-a0s` (P1) — Extract `useStreamingAI` primitive.
- `story-editor-y5v` (P3) — Extract shared transcript-container component.
- `story-editor-a9v` (P3) — Align per-message UX furniture.
- `story-editor-458` (P2) — Chat Regenerate not wired (falls out of the shared `<RegenerateAction>` + linear retry).
- `story-editor-7at` (P3) — Remove ContextChip from ChatMessages (no chip in shared row).

**Issues filed as follow-ups (out of scope here):**
- `story-editor-p75` — Unify Venice rate-limit indicator across Chat + inline AI.
- `story-editor-2bz` — AI-error reporting policy: bubble-only vs global toast.

**Out of scope:**
- The Inline AI surface (`useAICompletion`) keeps its own state machine. It only changes in two places: (1) it consumes `runStreamingAI` instead of inlining the SSE loop, (2) its existing rate-limit harvesting becomes one of `runStreamingAI`'s callbacks. No UX change.
- The composer (already aligned in PR #87/`feature/chat-composer-bw2`).
- The chat session picker / soft-delete / undo toast / auto-title (all already shared).

---

## Why one PR

The trio touches the same surface (Chat ⇆ Scene) at three layers (streaming engine, transcript container, message rows). The shape choices interact: row-component design depends on whether messages all flow through one data store, which depends on whether streaming is consolidated. Splitting into three sequential PRs would mean designing the same boundary three times. One PR + a single shared spec keeps the boundaries coherent.

The PR is large by review standards but each of its phases is self-contained and individually reviewable in the diff.

---

## Architecture

### Three layers, one set of decisions

| Layer | Today | After |
|---|---|---|
| **Streaming engine** | 3 implementations: `streamMessage()` (Scene, callbacks), `useSendChatMessageMutation` mutationFn (Chat, TanStack), `useAICompletion.run` (inline AI, hook-state) | One stateless utility `runStreamingAI(opts): Promise<void>`; consumers wrap it with their own state |
| **Transcript container** | Inline in `SceneTab.tsx:270-294` (autoscroll, session-reset); `ChatTab.tsx:177-183` is a bare `<div>` (no autoscroll) | One `<TranscriptView>` component with render-prop children. Owns scroll element, autoscroll, session-reset, data fetch (TanStack), draft store read, loading/error/empty states. |
| **Persisted message data** | Chat: TanStack Query; Scene: hand-rolled `useSceneTranscriptStore` (Zustand) | Both: TanStack Query (`useChatMessagesQuery`). `useSceneTranscriptStore` deletes. |
| **Optimistic in-flight** | Chat: `useChatDraftStore`; Scene: appends pseudo-message into transcript store | Both: `useChatDraftStore`. |
| **Per-message rows** | `ChatMessages.tsx` (assistant: serif body + meta + chip; user: bubble + attachment); `SceneCandidateCard.tsx` (article wrapper + isLatest semantics + Insert-at-end) | Shared `<UserMessageRow>` / `<AssistantMessageRow>` composed of primitives, `actions` slot for tab-specific buttons. |
| **Retry semantics** | Both backends append; Chat regenerate not wired; Scene shows old + new as parallel candidates | Linear in both: backend deletes trailing-after-lastUser on `retry: true`, then regenerates. `<RegenerateAction>` in shared row drives it. |

### What stays divergent (and why)

- **Re-entrancy**: Chat queues serially via TanStack mutation; inline AI is single-slot abort-on-new. Different UX semantics, load-bearing.
- **Lifecycle/unmount**: TanStack handles chat; inline AI uses explicit `mountedRef` + `useEffect` cleanup. Mechanical consequence of state location.
- **Citations**: Chat consumes the SSE event but renders from refetched `citationsJson`; inline AI ignores (its decoration overlay has no citations slot).
- **Tab-specific affordances**: Scene has Insert-at-end, optional article-card wrapper. Chat has the per-user-message attachment preview.
- **Empty state copy**: each tab passes its own element to the container. Chat: "Start a conversation"; Scene: "Describe what happens next…".

### Data flow after unification

```
   POST /chats/:chatId/messages       ←── chat.routes.ts (now deletes-trailing on retry)
                ↑
   useSendChatMessageMutation         ←── shared by Chat + Scene tabs
        │ uses
        ▼
   runStreamingAI(opts)               ←── stateless utility, ~30-40 lines
        │ used by
        ▼
   useAICompletion (inline AI only)   ←── separate consumer, separate UX surface

   GET /chats/:chatId/messages
                ↑
   useChatMessagesQuery               ←── shared TanStack hook (already exists)

   useChatDraftStore                  ←── single source of truth for in-flight pair
        ↑
   read by <TranscriptView>           ←── merges with persisted messages → render-prop
```

---

## Components

### Backend

**`backend/src/repos/message.repo.ts`** — add one method:
```ts
deleteManyAfter(chatId: string, createdAt: Date): Promise<{ count: number }>
```
Enforces ownership through chat → chapter → story → userId chain (matching the existing `findManyForChat` pattern). Used by retry handler. `repo-boundary-reviewer` scope at close-reviewed time.

**`backend/src/routes/chat.routes.ts`** — modify retry branch:
- Before generating, `deleteManyAfter(chatId, lastUserMsg.createdAt)` to remove any trailing assistant(s) (and any other rows after the last user — covers interrupted-prior-retry corner cases).
- Continue with existing flow. The prompt construction (`messages = [systemMsg, ...history]`) becomes correct as a side effect: history now ends at `lastUserMsg`, Venice gets a clean "respond to the last user turn" prompt instead of the current "continue from this assistant" quirk.
- Existing `retry_invalid_state` validation unchanged.

**Tests:**
- New: retry deletes prior trailing assistant + creates new one (single message).
- New: retry deletes multiple trailing rows if a prior retry was interrupted (defensive).
- Updated: existing tests asserting "after retry, both old and new assistants persist" rewrite to assert "after retry, only the new assistant persists." These were exercising the candidate semantics we're removing.

### Frontend — streaming

**`frontend/src/lib/streamingAI.ts`** — new file:
```ts
export interface StreamingAIOptions {
  endpoint: string;
  body: Record<string, unknown>;
  signal: AbortSignal;
  onChunk: (delta: string) => void;
  onCitations?: (citations: Citation[]) => void;
  onResponseHeaders?: (res: Response) => void;
}

export async function runStreamingAI(opts: StreamingAIOptions): Promise<void>;
```

Owns: the `apiStream` open, response-body check, `parseAiSseStream` loop, chunk-delta extraction, citations-event forwarding, error-event mapping to `ApiError(502, message, code)`, stream-exhausted-without-`[DONE]` handling.

Does NOT own: AbortController construction (caller's responsibility), state machine, error publication, re-entrancy.

**Consumers updated:**
- `useSendChatMessageMutation.mutationFn`: replaces inline SSE loop with `runStreamingAI` call. `onChunk` → `useChatDraftStore.appendDelta`. Mutation owns AbortController via `abortRef.current`.
- `useAICompletion.run`: replaces inline SSE loop with `runStreamingAI` call. `onChunk` → `safeSetState`. `onResponseHeaders` → existing rate-limit harvest.

**Deleted:**
- `streamMessage()` in `frontend/src/lib/api.ts` (lines 428-479).
- `useSceneTranscript.ts` hook (entire file).
- `useSceneTranscriptStore` and the file `frontend/src/store/sceneTranscript.ts`.

### Frontend — transcript container

**`frontend/src/components/messageRow/TranscriptView.tsx`** — new component:
```tsx
export interface TranscriptViewProps {
  chatId: string | null;
  emptyState: ReactNode;          // tab-specific: each tab passes its own element
  sendError?: Error | null;       // optional; renders InlineErrorBanner at end
  onRetrySend?: () => void;
  children: (rows: TranscriptRow[]) => ReactNode;
}

interface TranscriptRow {
  // Either a persisted message or a synthetic draft pair.
  // Discriminated union with `kind: 'persisted' | 'draft-user' | 'draft-assistant'`.
  // Container handles the merge; consumer just renders.
}
```

Owns:
- `useChatMessagesQuery(chatId)` — persisted messages.
- `useChatDraftStore` read — optimistic in-flight pair.
- Merge: persisted messages + draft pair (when `draft.chatId === chatId`).
- Scroll element + ref.
- Autoscroll effect: pin-to-bottom while user is within 50px of bottom (matching current Scene behavior at `SceneTab.tsx:282-294`).
- Session-reset effect: `stickToBottomRef = true` whenever `chatId` changes.
- Loading state (`query.isLoading`).
- Error state (`query.isError`).
- Empty state (when `messages.length === 0 && !draft`): renders `emptyState` prop.
- `null` chatId: renders `emptyState`.
- `sendError` banner: renders `<InlineErrorBanner>` at the end of the rows when set.

Does NOT own:
- Per-row markup (consumer's responsibility via render-prop).
- Tab-specific actions (consumer wires per row).

### Frontend — per-message rows

**`frontend/src/components/messageRow/UserMessageRow.tsx`** — shared:
```tsx
<UserMessageRow message={m} chapterTitle={chapterTitle} />
```
Renders the right-aligned accent-soft bubble + optional attachment preview (above the bubble) when `message.attachmentJson?.selectionText` is set. Identical for Chat and Scene; Scene messages won't have attachments today (no Scene attachment UI), so the preview slot stays empty for them — but the component handles both shapes uniformly.

**`frontend/src/components/messageRow/AssistantMessageRow.tsx`** — shared:
```tsx
<AssistantMessageRow
  message={m}
  actions={<>{/* tab-specific buttons */}</>}
/>
```
Renders:
- `<AssistantBubble>` (the serif body with `border-l-2 border-[var(--ai)]`).
- `<MessageMeta>` (model · tokens · latency line — `<MessageMeta>` resolves model ID → display name internally via `useModelsQuery`).
- The `actions` slot (consumer-supplied — typically `<CopyAction>` + `<RegenerateAction>` for both tabs, plus `<InsertAtEndAction>` for Scene).
- `<CitationsSlot>` (wraps existing `<MessageCitations>` from `frontend/src/components/MessageCitations.tsx`).

When `message` is in a draft-streaming state with empty content, renders `<ThinkingBubble label?>` (label optional; Scene passes "Generating scene…", Chat passes nothing → default dots-only).

**`frontend/src/components/messageRow/primitives.tsx`** — small primitives, one file (each is 5-30 lines):
- `<AssistantBubble>` — left-bordered prose container.
- `<MessageMeta>` — model name + tokens·latency line. Internally calls `useModelsQuery` to resolve model ID.
- `<MessageActions>` — flex container for action buttons.
- `<CopyAction>` — Copy icon + clipboard write.
- `<RegenerateAction>` — Regenerate icon + click handler.
- `<InsertAtEndAction>` — Scene-only insert button.
- `<CitationsSlot>` — wraps `<MessageCitations>` with stable mount-point semantics (per F50 contract).
- `<ThinkingBubble>` — empty bubble + `<ThinkingDots label?>`.

**Storybook coverage:**
- Each primitive: own story.
- Each row component: own story with multiple variants (with/without attachment, with/without citations, with/without model, streaming vs done).
- `<TranscriptView>`: own story showing scroll-pinning + session-reset behavior with mock messages.

### Frontend — tab integrations

**`ChatTab.tsx`** — orchestrator:
```tsx
<TranscriptView
  chatId={activeChatId}
  emptyState={<ChatEmptyState />}
  sendError={sendChatMessage.error}
  onRetrySend={onRetry}
>
  {(rows) => rows.map((r) =>
    r.kind === 'persisted' && r.message.role === 'user'
      ? <UserMessageRow key={r.message.id} message={r.message} chapterTitle={chapterTitle} />
      : r.kind === 'persisted'
        ? <AssistantMessageRow
            key={r.message.id}
            message={r.message}
            actions={
              <>
                <CopyAction onClick={() => onCopy(r.message)} />
                <RegenerateAction onClick={() => onRegenerate(r.message.id)} />
              </>
            }
          />
        : /* draft pair rendering */ ...
  )}
</TranscriptView>
```

`onRegenerate` is wired (closes `story-editor-458`): calls `sendChatMessage.mutateAsync({ chatId, modelId, retry: true })`.

**`SceneTab.tsx`** — orchestrator:
- Replaces inline scroll/autoscroll/session-reset with `<TranscriptView>` consumption.
- Replaces `useSceneTranscript` hook with `useSendChatMessageMutation` (the same hook Chat uses).
- Replaces `renderTranscript` walker with the same render-prop pattern as Chat, plus Scene-specific actions (`<InsertAtEndAction>`).
- The `direction` de-duplication logic, `lastAssistantIdx` walk, `isLatest` flag, "superseded" marker — all gone (linear retry semantics).

**Deleted entirely:**
- `frontend/src/components/ChatMessages.tsx` (replaced by `TranscriptView` + row components in ChatTab).
- `frontend/src/components/SceneCandidateCard.tsx` (replaced by `<AssistantMessageRow>`).
- `frontend/src/hooks/useSceneTranscript.ts`.
- `frontend/src/store/sceneTranscript.ts`.
- `streamMessage()` from `frontend/src/lib/api.ts`.

---

## Error handling

This PR keeps the existing per-surface error semantics:
- Chat: bubble-scoped via `useChatDraftStore`'s `error` field; renders `<InlineErrorBanner>` at the end of `<TranscriptView>` via the `sendError` prop.
- Scene: same (because Scene now uses the same mutation as Chat).
- Inline AI: bubble + global `useErrorStore` (unchanged from today).

Unifying these is `story-editor-2bz`'s scope — explicitly out of this PR.

The shape divergences between consumers fix in `runStreamingAI`:
- Empty response body: one `ApiError(502, 'Empty response body')` shape.
- `[DONE]`-not-received: utility returns successfully when stream exhausts; consumer's `await` resolves uniformly.

---

## Testing

**Backend:**
- New repo test: `MessageRepo.deleteManyAfter` deletes only rows owned by the chat's chain, respects the `createdAt` boundary.
- New retry test: deletes trailing assistant before regenerating; new assistant is the only assistant after the last user.
- Updated retry tests: drop assertions about parallel candidates persisting.
- Encryption leak test ([E12]) re-runs (deletes are touching narrative columns).

**Frontend:**
- New: `runStreamingAI` unit tests with mocked fetch + canned SSE chunks. Cover: chunk delivery, citations forwarding, error mapping, stream-exhausted-without-DONE, abort propagation.
- New: each primitive renders correctly (snapshot-style).
- New: `<TranscriptView>` autoscroll pins to bottom while within 50px; releases on scroll-up; resets on session change.
- New: `<TranscriptView>` correctly merges persisted + draft.
- New: row components render with all variants (attachment, citations, model, streaming, done, error).
- Updated: ChatMessages tests migrate to row + TranscriptView tests (or delete if redundant).
- Updated: scene transcript tests rewrite to exercise `useSendChatMessageMutation` + `useChatDraftStore`.

**E2E:**
- Existing chat send + scene generate flows pass with new components.
- New: retry-replaces-trailing-assistant flow on both tabs.
- New: autoscroll behavior on Chat (regression — Chat didn't have it before).

---

## Build sequence (rough phasing within the single PR)

The unified PR will be one branch with logical commits. Suggested order:

1. **Backend retry change** (deleteManyAfter + route update + tests). Self-contained; ships independently if needed.
2. **`runStreamingAI` utility + consumer migration** (closes a0s). Both `useSendChatMessageMutation` and `useAICompletion` start using it; tests pass with no UX change.
3. **Row primitives + row components** (Storybook stories first; then wire into ChatMessages by composition without removing it yet).
4. **`<TranscriptView>` container** (Storybook first; then drop-in for Chat).
5. **Scene migration**: replace `useSceneTranscript` + `useSceneTranscriptStore` + `SceneCandidateCard` with the shared layer. Delete dead code. Tests update.
6. **Cleanup**: remove `ChatMessages.tsx`, `SceneCandidateCard.tsx`, `streamMessage()`, the scene store/hook files. Final test sweep.

The plan that follows this spec will break each phase into bite-sized tasks per `superpowers:writing-plans`.

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Backend retry deletion affects existing scene chats with parallel candidates (loses the older candidate display) | Per `CLAUDE.md` "no data migration": there are no real users, no migration branch needed. Existing test scenes get rewritten. |
| Scene tests are heavy on `useSceneTranscriptStore` mocks | Replace store-level mocks with TanStack Query's `QueryClientProvider` test harness (matches the existing chat test pattern). |
| `<TranscriptView>` autoscroll edge cases (very long chapter context loading mid-stream, etc.) | Same algorithm as Scene's existing implementation — already battle-tested. New regression tests cover the merge with draft pair. |
| Larger PR diff than typical | Each phase is self-contained in its commits; reviewer can read commit-by-commit. |
| Storybook story count grows | Each new primitive gets a tiny focused story (consistent with primitives/Tokens convention). Stories make future divergence visible at a glance. |

---

## Acceptance

- One streaming utility (`runStreamingAI`) used by both `useSendChatMessageMutation` and `useAICompletion`. `streamMessage` deleted.
- One transcript container (`<TranscriptView>`) used by both tabs. ChatTab and SceneTab no longer have inline scroll containers. Chat gains autoscroll.
- One set of row components (`<UserMessageRow>`, `<AssistantMessageRow>`) consumed by both tabs.
- Scene reads from TanStack Query + the shared draft store. `useSceneTranscriptStore` deleted.
- Backend retry: `retry: true` deletes trailing-after-lastUser before regenerating.
- Chat Regenerate is wired (closes 458). Context chip removed (closes 7at).
- Storybook coverage for each new primitive and row component.
- All existing tests pass (after updates for new shapes); leak test ([E12]) green.
- `lint:design` green (token-only Tailwind + composition).
