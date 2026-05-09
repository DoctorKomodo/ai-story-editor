# AI Surfaces Unification v1 — Design

**Status:** Brainstormed 2026-05-09; spec authored same day; revised same day after external review (folded changes covering cross-tab concurrency, error UX unification, several invariants); revised again after second review caught a destructive corner case in the previously-spec'd lenient retry — backend rolled back to strict semantics and the retry-routing moved to the frontend where it can use cache state to disambiguate. Revised a third time after a follow-up review: dropped the `lastIdBefore` ref (had a stale-cache hole under rapid-fire send-after-success); banner-retry now dispatches on the cache's trailing-message role after an unconditional refetch — strictly simpler and closes the rapid-fire edge.

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
| **Optimistic in-flight** | Chat: `useChatDraftStore` single-slot (`draft: ChatDraft \| null`); Scene: appends pseudo-message into transcript store | Both: `useChatDraftStore`, **keyed by chatId** (`drafts: Record<string, ChatDraft>`). Cross-tab concurrent streaming supported. |
| **Per-message rows** | `ChatMessages.tsx` (assistant: serif body + meta + chip; user: bubble + attachment); `SceneCandidateCard.tsx` (article wrapper + isLatest semantics + Insert-at-end) | Shared `<UserMessageRow>` / `<AssistantMessageRow>` composed of primitives, `actions` slot for tab-specific buttons. |
| **Retry semantics** | Both backends append; Chat regenerate not wired; Scene shows old + new as parallel candidates; banner-retry on Chat replays as fresh send regardless of whether user persisted (case-B duplicate-user bug) | Linear in both. Backend `retry: true` stays strict (today's validation: requires `lastUserMsg`, rejects `content`) and gains `deleteAllAfter(chatId, lastUserMsg.id)` before regenerating. Frontend banner-retry refetches the messages query, reads the cache's trailing-message role, and dispatches `{retry: true}` if trailing is a user message (case B — user persisted before failure, no following assistant) or fresh send otherwise (cases A/D/E + rapid-fire). Per-message Regenerate is always `{retry: true}`. One user-level retry intent ("click retry") with the wire-format dispatch hidden inside the mutation hook. |

### What stays divergent (and why)

- **Re-entrancy**: Chat queues serially via TanStack mutation; inline AI is single-slot abort-on-new. Different UX semantics, load-bearing.
- **Lifecycle/unmount**: TanStack handles chat; inline AI uses explicit `mountedRef` + `useEffect` cleanup. Mechanical consequence of state location.
- **Citations**: Chat consumes the SSE event but renders from refetched `citationsJson`; inline AI ignores (its decoration overlay has no citations slot).
- **Tab-specific affordances**: Scene has Insert-at-end, optional article-card wrapper. Chat has the per-user-message attachment preview.
- **Empty state copy**: each tab passes its own element to the container. Chat: "Start a conversation"; Scene: "Describe what happens next…".

### Data flow after unification

```
   POST /chats/:chatId/messages       ←── chat.routes.ts (strict retry: true + deleteAllAfter; fresh send unchanged)
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

   useChatDraftStore                  ←── drafts: Record<chatId, ChatDraft>
        ↑                                  per-chat slot — Chat + Scene can stream concurrently
   read by <TranscriptView>           ←── merges drafts[chatId] with persisted messages → render-prop
```

### Retry routing (banner-retry vs per-message Regenerate)

The user-visible model is **one** "Retry" intent across two surfaces. Wire-format dispatch happens inside a small `useBannerRetry` hook — invisible to the user.

**Why dispatch is needed:** pre-stream errors (network failure, validation, models-cache fetch failure) leave the DB unchanged. Mid-stream errors persist the user message but no assistant. The frontend can't reliably tell which happened from the error alone — the route persists the user *before* writing SSE headers, so `apiStream()` rejecting tells the frontend "non-200 response" without disclosing whether the user persisted (e.g. a Venice-key-missing error fires post-persistence-pre-stream-headers from the route's perspective and looks identical to a validation error from the frontend's). The cache, after a refetch, is the authoritative signal.

**The four cases + the rapid-fire edge:**

| Case | Setup | Cache trailing role (after refetch) | Right call |
|---|---|---|---|
| A | Pre-stream error; no prior turn | undefined | Fresh send X |
| B | Mid-stream error; X just persisted | user (= user-X) | `{retry: true}` regenerates from user-X |
| C | Per-message Regenerate (no banner; trailing assistant exists) | n/a (separate handler) | Always `{retry: true}` |
| D | Pre-stream error; prior turn `[user-1, assistant-1]` exists; X failed pre-persist | assistant (= assistant-1) | Fresh send X (DO NOT delete assistant-1) |
| E | Content collision: user re-sends "hello" matching prior turn; failed pre-persist | assistant (= assistant-N) | Fresh send X (id-irrelevant — trailing role is the signal) |
| Rapid-fire | X1 succeeded; X2 sent + failed pre-persist before X1's post-success refetch lands | assistant (= X1-assistant, after refetch) | Fresh send X2 (DO NOT regenerate from X1) |

**Banner-retry dispatch (`useBannerRetry` hook):**
```ts
const onBannerRetry = useCallback(async (): Promise<void> => {
  const last = lastSendArgsRef.current;
  if (!last || chatId === null || selectedModelId === null) return;
  setIsDispatching(true);
  try {
    // Refetch unconditionally — the cache is stale on the error path
    // (invalidateQueries fires from onSuccess, not onError). After
    // refetch, the trailing-message role is the authoritative signal.
    await qc.refetchQueries({ queryKey: chatMessagesQueryKey(chatId) });
    const after = qc.getQueryData<ChatMessage[]>(chatMessagesQueryKey(chatId)) ?? [];
    const trailing = after[after.length - 1];

    if (trailing?.role === 'user') {
      // Case B: user persisted with no following assistant; regenerate.
      await mutation.mutateAsync({ chatId, modelId: selectedModelId, retry: true });
    } else {
      // Cases A / D / E / rapid-fire: trailing is assistant or undefined.
      await onSend(last);
    }
  } finally {
    setIsDispatching(false);
  }
}, [chatId, selectedModelId, mutation, qc, onSend, lastSendArgsRef]);
```

**Why trailing-role beats lastIdBefore:** an earlier draft of this spec captured `lastIdBefore` in `onMutate` and inspected for new user messages relative to that checkpoint. That had a stale-cache hole under rapid-fire send-after-success: if X1 succeeded and the user immediately sent X2 before X1's post-success refetch landed, X2's `lastIdBefore` pointed at the trailing message from BEFORE X1, not from after. After X2 failed and the refetch landed, the inspect would find X1-user appearing "after lastIdBefore" → false-positive `retry: true` → backend deletes X1's good assistant. Trailing-role doesn't have this problem: the cache's trailing message after refetch encodes "what does the DB look like right now," and a mid-stream error always leaves a user trailing while every other case leaves an assistant or empty.

**Per-message Regenerate** is unconditional:
```ts
const onRegenerate = useCallback(() => {
  if (activeChatId === null) return;
  void sendChatMessage.mutateAsync({ chatId: activeChatId, modelId, retry: true });
}, [activeChatId, modelId, sendChatMessage]);
```

(Per-message Regenerate appears only on the trailing assistant — same isLatest constraint as Scene's existing implementation. By construction, the trailing user is the message we want to regenerate from, so no explicit id parameter is needed.)

**UX detail worth pinning:** while the banner-retry dispatch decision runs (refetch + role check), there's a small "click registered, nothing yet" window. The banner's Retry button must disable itself during this window in addition to gating on `mutation.isPending` once the actual mutation fires. The hook exposes `isDispatching` for this.

### Cross-tab streaming concurrency

A user can send a Chat message, switch to Scene, and start a Scene generation while Chat is still streaming. Both tabs use independent mutation instances (each with its own AbortController) and TanStack does not serialize across instances. Today's `useChatDraftStore` is a single `draft: ChatDraft | null` slot — used only by Chat — so this concurrency case never arose. After unification it does, and the single slot would let one tab's writes mutate the other tab's draft (and one tab's `clear()` in `onSuccess` would wipe the other tab's draft).

The store therefore changes shape: `drafts: Record<string, ChatDraft>` keyed by `chatId`. Every method takes a `chatId` argument and operates on that slot only:

```ts
interface ChatDraftState {
  drafts: Record<string, ChatDraft>;
  start(args: { chatId: string; userContent: string; attachment: ChatDraftAttachment | null }): void;
  appendDelta(chatId: string, delta: string): void;
  markStreaming(chatId: string): void;
  markDone(chatId: string): void;
  markError(chatId: string, error: ChatDraftError): void;
  clear(chatId: string): void;
}
```

`<TranscriptView>` reads only its own slot (`useChatDraftStore((s) => s.drafts[chatId])`), so it ignores activity in other tabs' chats. Both tabs can stream concurrently without clobbering. Backwards compat: there's no existing user state to migrate (per `CLAUDE.md` no-data-migration rule).

---

## Components

### Backend

**`backend/src/repos/message.repo.ts`** — add one method:
```ts
deleteAllAfter(chatId: string, afterMessageId: string): Promise<{ count: number }>
```
Deletes every message owned by `chatId` whose ordering is "after" the reference message — strict `createdAt > ref.createdAt`, OR `(createdAt = ref.createdAt AND id != ref.id)` for the same-millisecond tiebreaker (rare but possible if a prior retry persisted assistant in the same ms as the user). Reference message itself is preserved. Enforces ownership through chat → chapter → story → userId chain (matching the existing `findManyForChat` pattern). Used by the retry handler. `repo-boundary-reviewer` scope at close-reviewed time.

**`backend/src/routes/chat.routes.ts`** — modify retry branch only:

*Validation: unchanged from today's strict semantics.*
- `if (!body.retry && !body.content)` → reject 400 "content is required" (today; unchanged).
- `if (body.retry && body.content !== undefined)` → reject 400 "content must be omitted when retry is true" (today; unchanged).
- `if (body.retry && !lastUserMsg)` → reject 400 `retry_invalid_state` (today; unchanged).

(Earlier spec revision proposed loosening these to make `retry: true` accept optional `content` and fall through to fresh-send when no `lastUserMsg`. That introduced a destructive corner case — Case D — where a banner-retry of a pre-stream-failed send would silently destroy a prior good assistant and lose the new input. The frontend doesn't have enough information to know whether the user persisted before failure, but the *cache* does. Routing moves to the frontend instead. Backend stays strict.)

*Branch behavior:*
- `retry: true` (with `lastUserMsg` guaranteed by validation): `deleteAllAfter(chatId, lastUserMsg.id)` to remove any trailing assistant(s) from a prior retry attempt. Continue with existing retry flow (prompt = `[systemMsg, ...history]`; history naturally ends at `lastUserMsg` after deletion). Covers cases B + C uniformly.
- `retry: false` (or omitted): existing fresh-send flow, unchanged.

The prompt construction (`messages = [systemMsg, ...history]` on retry) becomes correct as a side effect: history ends at `lastUserMsg` after `deleteAllAfter`, Venice gets a clean "respond to the last user turn" prompt instead of the current "continue from this assistant" quirk.

**Tests:**
- New: `MessageRepo.deleteAllAfter` deletes only rows owned by the chat's chain; preserves reference message; deletes same-millisecond sibling with different id; ownership-gated through chat→chapter→story→userId.
- New: retry deletes prior trailing assistant + creates new one (case C).
- New: retry deletes multiple trailing rows if a prior retry was interrupted (defensive).
- New: retry with no trailing assistant (case B — user just persisted but no assistant yet) generates assistant cleanly with no deletions.
- Existing `retry_invalid_state` rejection tests stay green (no `lastUserMsg` → 400). `body.content with retry: true` rejection test stays green (validation unchanged).
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

**Error-event code propagation invariant:** when the SSE stream emits an `event.type === 'error'` frame, `runStreamingAI` throws `new ApiError(502, event.error.error, event.error.code ?? 'stream_error')`. Consumers extract the `code` from their `catch` block via `(err as ApiError).code` and forward it to their state sink (e.g. `useChatDraftStore.markError({code: ..., message: ...})`). Today the chat path branches on `event.error.code` directly inside the loop; after unification the code surfaces via the thrown ApiError's `.code` property. The implementer must preserve this — losing the code would degrade error-banner specificity and the prior `markError` invariant.

**Consumers updated:**
- `useSendChatMessageMutation.mutationFn`: replaces inline SSE loop with `runStreamingAI` call. `onChunk` → `useChatDraftStore.appendDelta(chatId, delta)` (note: keyed). Mutation owns AbortController via `abortRef.current`. `catch` clause maps `(err as ApiError).code` into `markError`.
- `useAICompletion.run`: replaces inline SSE loop with `runStreamingAI` call. `onChunk` → `safeSetState`. `onResponseHeaders` → existing rate-limit harvest. `catch` clause maps `(err as ApiError).code` into the published error.

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

type TranscriptRow =
  | { kind: 'persisted'; message: ChatMessage }
  | { kind: 'draft-user'; userContent: string; attachment: ChatDraftAttachment | null }
  | { kind: 'draft-assistant'; assistantText: string; status: ChatDraftStatus; error: ChatDraftError | null };
```

Owns:
- `useChatMessagesQuery(chatId)` — persisted messages.
- `useChatDraftStore((s) => s.drafts[chatId ?? ''])` — per-chat draft slot.
- Merge: persisted messages + draft pair when present. The draft-user row is suppressed when EITHER (a) `draft.userContent === ''` — retry path, since `mutateAsync({retry: true})` calls `start` with empty userContent and the user message is already persisted; OR (b) the trailing persisted user message's content matches `draft.userContent` — mid-stream-error-then-banner-retry path, where the user persisted before the error and the post-refetch cache catches up while the error draft is still in the store. Either rule on its own leaves a duplicate-user flicker in the other case.
- Scroll element + ref.
- Autoscroll effect: pin-to-bottom while user is within 50px of bottom (matching current Scene behavior at `SceneTab.tsx:282-294`).
- Session-reset effect: `stickToBottomRef = true` whenever `chatId` changes.
- Loading state (`query.isLoading`).
- **Error state (unified):** when `query.isError`, renders one error UX — single line + Retry button calling `query.refetch()`. Same UX both tabs (replaces today's Scene-specific "Couldn't load transcript. Try switching sessions." copy and Chat's button-less "Could not load messages." line). Chat gains a Retry button it doesn't have today.
- Empty state (when `messages.length === 0 && !draft`): renders `emptyState` prop. Each tab passes its own copy ("Start a conversation" / "Describe what happens next…").
- `null` chatId: renders `emptyState`.
- `sendError` banner: renders `<InlineErrorBanner>` at the end of the rows when set, with `onRetrySend` wired to its retry button.

Does NOT own:
- Per-row markup (consumer's responsibility via render-prop).
- Tab-specific actions (consumer wires per row).
- A per-tab `errorState` prop — the unified error UX is the only one. (No precedent for per-tab divergence here, and the reviewer flagged that today's Chat lacking a Retry is a regression worth fixing in this PR.)

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
- `<RegenerateAction>` — Regenerate icon + click handler. Accepts `disabled?: boolean`. Used in two places: per-message (on `<AssistantMessageRow>`) and inside `<InlineErrorBanner>` for banner-retry. Both surfaces gate `disabled` on `sendChatMessage.isPending` so a mutation in flight blocks both.
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
  onRetrySend={onBannerRetry}
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
                <RegenerateAction
                  onClick={() => onRegenerate()}
                  disabled={sendChatMessage.isPending}
                />
              </>
            }
          />
        : /* draft pair rendering */
  )}
</TranscriptView>
```

**Retry call shapes** (one user-level semantic; two surfaces; backend stays strict — frontend dispatches based on cache state. Full mechanism in the "Retry routing" section above):

- **Banner-retry** (`onBannerRetry`, fires from `<InlineErrorBanner>` retry button): refetches the messages query, reads the trailing-message role from the refreshed cache, dispatches either `mutateAsync({chatId, modelId, retry: true})` (trailing is user — case B) or `onSend(lastSendArgsRef.current)` (trailing is assistant or undefined — cases A/D/E + rapid-fire). Closes the case-D regression and the lastIdBefore-stale rapid-fire edge.

- **Per-message Regenerate** (`onRegenerate`, fires from `<RegenerateAction>` on the trailing assistant): unconditional `mutateAsync({chatId, modelId, retry: true})`. Backend uses `lastUserMsg` from DB. Closes `story-editor-458`. Per-message button appears only on the trailing assistant (matches Scene's existing isLatest gating).

**Disabled-state gating** for both Retry surfaces:
- Per-message `<RegenerateAction>`: `disabled={sendChatMessage.isPending}`.
- Banner Retry: `disabled={sendChatMessage.isPending || isDispatching}` where `isDispatching` is true during the brief refetch+inspect window (before the mutation actually fires). One small local state in the banner-retry handler.

**`SceneTab.tsx`** — orchestrator:
- Replaces inline scroll/autoscroll/session-reset/hydration-error UX with `<TranscriptView>` consumption.
- Replaces `useSceneTranscript` hook with `useSendChatMessageMutation` (the same hook Chat uses).
- Replaces `renderTranscript` walker with the same render-prop pattern as Chat, plus Scene-specific actions (`<InsertAtEndAction>`).
- The `direction` de-duplication logic, `lastAssistantIdx` walk, `isLatest` flag, "superseded" marker — all gone (linear retry semantics).
- Per-message `<RegenerateAction>` gates `disabled` on `sendChatMessage.isPending` (same as Chat). `<InsertAtEndAction>` does not — Insert doesn't fire a mutation, just inserts editor text.
- Mirrors Chat's `lastChatSendArgsRef` with `lastSceneSendArgsRef` for banner-retry. Same dispatch logic via the shared `useBannerRetry({chatId, selectedModelId, mutation, lastSendArgsRef, onSend})` hook.
- Reads `sendError` from the same source Chat does — `sendChatMessage.error` (TanStack mutation error). Replaces today's `transcript.errorMessage` Zustand read.

**Deleted entirely:**
- `frontend/src/components/ChatMessages.tsx` (replaced by `TranscriptView` + row components in ChatTab).
- `frontend/src/components/SceneCandidateCard.tsx` (replaced by `<AssistantMessageRow>`).
- `frontend/src/hooks/useSceneTranscript.ts`.
- `frontend/src/store/sceneTranscript.ts`.
- `streamMessage()` from `frontend/src/lib/api.ts`.

---

## Error handling

**Send-time errors (per-tab, bubble-scoped):**
- Chat: via `useChatDraftStore`'s `error` field on the keyed draft slot; renders `<InlineErrorBanner>` at the end of `<TranscriptView>` via the `sendError` prop. Banner's Retry button calls `onBannerRetry` (see ChatTab integration above).
- Scene: same (because Scene now uses the same mutation as Chat).
- Inline AI: bubble + global `useErrorStore` (unchanged from today; cross-surface unification is `story-editor-2bz`).

**Hydration errors (unified inside `<TranscriptView>`):**
- One UX, both tabs: single line + Retry button calling `query.refetch()`. Replaces today's per-tab divergence (Scene custom-copy + retry; Chat one-line no-retry). The previously-considered per-tab `errorState` prop is dropped — there's no scenario where Chat and Scene benefit from different hydration error UX, and Chat gains a Retry button it lacks today.

**Shape divergences fixed by `runStreamingAI`:**
- Empty response body: one `ApiError(502, 'Empty response body')` shape (today: chat throws plain `Error`; inline AI throws `ApiError`).
- `[DONE]`-not-received: utility returns successfully when stream exhausts; consumer's `await` resolves uniformly (today: three different impls).
- Error-event code propagation: `event.error.code` survives through the thrown `ApiError.code` and is read by consumers in their `catch` clauses (see Streaming section's invariant).

**Out of this PR (filed as `story-editor-2bz`):** the policy question of whether AI errors should hit a global toast vs stay bubble-scoped. Today the inline-AI path publishes globally and the chat path doesn't; this PR preserves that asymmetry rather than adding scope.

---

## Testing

**Backend:** (full enumeration in the Backend Components section above; summary here)
- `MessageRepo.deleteAllAfter` repo tests (id-based; same-millisecond tiebreaker; ownership-gated).
- Retry route tests: deletes trailing-after-lastUser before regenerating; case-B (no trailing assistant) generates cleanly with no deletions.
- Existing strict-validation tests (`retry_invalid_state` when no `lastUserMsg`; reject `content with retry: true`) stay green — validation unchanged.
- Updated existing tests: drop assertions about parallel candidates persisting.
- Encryption leak test ([E12]) re-runs (deletes touch narrative columns).

**Frontend — new tests:**
- `runStreamingAI` unit tests with mocked fetch + canned SSE chunks. Cover: chunk delivery, citations forwarding, error mapping (asserting `ApiError.code` survives through throw), stream-exhausted-without-DONE, abort propagation.
- `useChatDraftStore` keyed-slot tests: concurrent `start()` for two different chatIds keeps both drafts isolated; `clear(chatId)` only clears that slot; `appendDelta(chatId, ...)` doesn't leak to other slots.
- `useBannerRetry` hook: cache-trailing-role dispatch. Six unit tests covering cases A / B / D / E / rapid-fire-edge + isDispatching window.
- Each primitive renders correctly (snapshot-style).
- `<TranscriptView>` autoscroll pins to bottom while within 50px; releases on scroll-up; resets on session change.
- `<TranscriptView>` correctly merges persisted + draft from the keyed slot for `chatId`; ignores other slots.
- `<TranscriptView>` hydration error renders single-line + Retry button; Retry calls `query.refetch()`.
- `<TranscriptView>` clear-before-invalidate ordering preserved on mutation success — no flicker frame showing both draft and persisted.
- Row components render with all variants (attachment, citations, model, streaming, done, error).
- **Banner-retry dispatch table** (six cases; tested as deterministic unit tests against `useBannerRetry` with seeded QueryClient fixtures):
  - Case A (no prior turn; X failed pre-persist; cache empty after refetch — trailing undefined) → fresh send X.
  - Case B (X persisted then mid-stream error; cache trailing is user-X after refetch) → `{retry: true}`, no fresh send.
  - Case D (`[user-1, assistant-1]` exists; X failed pre-persist; cache trailing is assistant-1 after refetch) → fresh send X; assistant-1 untouched.
  - Case E (content collision: X = "hello" submitted while `[…, user-N: "hello", assistant-N]` exists; X failed pre-persist; cache trailing is assistant-N) → fresh send X (trailing-role detection is content-irrelevant).
  - Rapid-fire edge (X1 succeeded; X2 sent + failed pre-persist before X1's post-success refetch landed; cache trailing is X1-assistant after refetch) → fresh send X2; X1's assistant untouched.
  - `isDispatching` is true synchronously after click and stays true through the refetch + dispatch decision; disables the banner button during this window.
- Per-message Regenerate (only on trailing assistant) calls `mutateAsync({retry: true})` unconditionally.

**Frontend — deleted/rewritten tests:**
- `frontend/tests/store/sceneTranscript.test.ts` (or equivalent): deletes entirely with the store.
- `frontend/tests/hooks/useSceneTranscript.test.ts` (or equivalent): deletes entirely with the hook.
- `frontend/src/components/ChatMessages.test.tsx` (or equivalent): migrate assertions to the new row + TranscriptView tests; delete if redundant.
- `SceneCandidateCard.test.tsx`-style tests asserting "superseded" marker rendering, isLatest semantics, retry-only-on-latest behavior: deletes entirely with the component.
- Any frontend test asserting "two assistant candidates render after retry" on Scene: rewrites to assert one assistant after retry (linear semantics).
- `useSendChatMessageMutation` tests using single-slot draft assumptions: rewrite to use keyed-slot reads (`s.drafts[chatId]`).
- Any test that previously exercised "banner-retry sends fresh `{content: X}`" as the always-correct shape: rewrites to the four-case dispatch table above.

**E2E:**
- Existing chat send + scene generate flows pass with new components.
- New: retry-replaces-trailing-assistant flow on both tabs.
- New: autoscroll behavior on Chat (regression — Chat didn't have it before).

---

## Invariants

These are properties the implementation must preserve. Each has been a real bug source in prior refactors of this surface or was flagged in spec review.

1. **`clear()` before `invalidateQueries()` in `onSuccess`.** Clearing the draft AFTER invalidating would produce a frame where `<TranscriptView>` renders the persisted assistant + the draft assistant simultaneously (duplicate flicker). The order at `useChat.ts:317-318` today is correct; preserve it through the keyed-store refactor.
2. **`runStreamingAI` ApiError code propagation.** Error-event frames produce `ApiError(502, message, code)`; consumers extract `code` from the thrown error in their catch block, NOT from the original event. Losing the code degrades error-banner specificity.
3. **Per-message Regenerate gates `disabled` on mutation `isPending`.** Both Chat and Scene. Banner-retry button (inside `<InlineErrorBanner>`) gates the same way. Prevents double-fire while a mutation is in flight.
4. **Backend retry stays strict; frontend dispatches via cache trailing-message role.** `retry: true` requires `lastUserMsg` and rejects `content` (today's validation, unchanged). What changes is the addition of `deleteAllAfter(chatId, lastUserMsg.id)` before regeneration. Banner-retry dispatch (cases A / B / D / E + rapid-fire) lives in the frontend's `useBannerRetry` hook: refetch the messages query unconditionally, then read the cache's trailing-message role. Trailing-user → `{retry: true}`. Trailing-assistant or empty → fresh send. Two earlier approaches were considered and rejected: (i) lenient backend that accepts content with `retry: true` introduced Case D (destructive deletion of prior good assistant + lost new input); (ii) `lastIdBefore` ref captured at `onMutate` had a stale-cache hole under rapid-fire send-after-success. The trailing-role approach has neither failure mode and removes one ref from the API surface.
5. **`deleteAllAfter` is reference-id-based, not createdAt-based.** Same-millisecond sibling case is real; id tiebreaker prevents incorrect preservation. Reference message itself is always preserved.
6. **Keyed draft store isolation.** Methods take `chatId`; reads scope to `s.drafts[chatId]`. No method accidentally writes to or clears another slot. Concurrent streams across tabs are independently progressable.

## Build sequence (rough phasing within the single PR)

The unified PR will be one branch with logical commits. Suggested order:

1. **Backend retry change** (`deleteAllAfter` repo method + route's retry branch gains the deletion call before regeneration; validation unchanged + tests). Self-contained; ships independently if needed.
2. **`runStreamingAI` utility + consumer migration** (closes a0s). Both `useSendChatMessageMutation` and `useAICompletion` start using it; tests pass with no UX change. Includes ApiError code-propagation invariant (#2 above).
3. **Keyed draft store refactor** (`useChatDraftStore` from `draft: ChatDraft | null` → `drafts: Record<string, ChatDraft>`). All call sites updated. Tests for slot isolation. Pure refactor — no UX change because Chat is still the only consumer.
4. **Row primitives + row components** (Storybook stories first; then wire into ChatMessages by composition without removing it yet).
5. **`<TranscriptView>` container** (Storybook first; then drop-in for Chat). Includes unified hydration error UX with Retry.
6. **Scene migration**: replace `useSceneTranscript` + `useSceneTranscriptStore` + `SceneCandidateCard` with the shared layer. Delete dead code. Tests update.
7. **Cleanup**: remove `ChatMessages.tsx`, `SceneCandidateCard.tsx`, `streamMessage()`, the scene store/hook files. Drop dead `attachedCharacterCount`/`attachedTokenCount` props (already unused; just deletion). Drop the `<ContextChip>` block (closes 7at). Final test sweep.

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
| **Stop during in-flight retry leaves a transient `[…, user]` state** (no trailing assistant). The route's `deleteAllAfter` ran before Venice was called; abort cancels the replacement assistant before it can be persisted. | Recoverable by clicking Regenerate on the trailing user (or by sending a new message — the existing user becomes part of conversation history). Worth a one-line implementer note + a manual E2E check. Not a data-loss bug: only the partial/replacement assistant is lost; the user message survives. |
| **Banner-retry refetch latency** introduces a small "click registered, nothing yet" window before the dispatch decision fires. | The hook gates the banner button on `isDispatching` (true synchronously after click; cleared after the dispatch decision). Sub-100ms in practice for fast backends. The refetch is unconditional — under the trailing-role approach, the cache is stale on the error path (invalidateQueries fires from onSuccess, not onError), so a "skip the refetch" fast-path can't reliably distinguish stale from fresh. |

---

## Acceptance

- One streaming utility (`runStreamingAI`) used by both `useSendChatMessageMutation` and `useAICompletion`. `streamMessage` deleted. ApiError code propagates through throws.
- One transcript container (`<TranscriptView>`) used by both tabs. ChatTab and SceneTab no longer have inline scroll containers. Chat gains autoscroll. Hydration-error UX is unified (one rendering, both tabs, with Retry).
- One set of row components (`<UserMessageRow>`, `<AssistantMessageRow>`) consumed by both tabs.
- Scene reads from TanStack Query + the keyed shared draft store. `useSceneTranscriptStore` deleted.
- `useChatDraftStore` is keyed by chatId. Cross-tab concurrent streaming works without clobbering.
- Backend `retry: true` stays strict (today's validation: requires `lastUserMsg`, rejects `content`) and gains `deleteAllAfter(chatId, lastUserMsg.id)` (id-based tiebreaker) before regeneration.
- One retry semantic at the user level. Frontend dispatches per-call-site: per-message Regenerate is unconditional `mutateAsync({retry: true})`; banner-retry refetches the messages query and reads the trailing-message role to choose between `mutateAsync({retry: true})` (trailing is user — case B) and a fresh `onSend(lastSendArgs)` (trailing is assistant or undefined — cases A/D/E + rapid-fire). Closes the case-D destructive-rewrite hole AND the lastIdBefore-stale rapid-fire edge.
- Both Retry surfaces gate `disabled` on `mutation.isPending`. Banner adds local `isDispatching` gating during the inspect-and-decide window.
- Chat Regenerate is wired (closes 458). Context chip + dead props removed (closes 7at).
- Storybook coverage for each new primitive and row component.
- All existing tests pass (after updates for new shapes); the keyed-store, banner-retry dispatch table (cases A/B/D/E), and hydration-error tests are green; leak test ([E12]) green.
- `lint:design` green (token-only Tailwind + composition).
