# AI "Thinking" Indicators — Design Spec

**Date:** 2026-05-03
**Branch:** `brainstorm/ai-interaction-tweaks`
**Goal:** Give every AI request a visible in-flight indicator so the UI never sits silently between user action and first token.

---

## Problem

Two AI surfaces today have a silent gap between request-send and first-token arrival:

1. **Inline AI card** (Rewrite / Describe / Expand → `<InlineAIResult />` beneath the document).
   The card has a three-dot "thinking" animation wired to `inlineAIResult.status === 'thinking'`, but a state race clobbers it.
   - `EditorPage.handleInlineAction` seeds the store with `status: 'thinking'` ([EditorPage.tsx:444](frontend/src/pages/EditorPage.tsx#L444)), then calls `completion.run(args)`.
   - `useAICompletion.run` synchronously sets the hook to `status: 'streaming'` ([useAICompletion.ts:120-125](frontend/src/hooks/useAICompletion.ts#L120-L125)) **before any token arrives**.
   - The store-sync effect ([EditorPage.tsx:476-495](frontend/src/pages/EditorPage.tsx#L476-L495)) then overwrites the seeded `'thinking'` with `'streaming'` on the next render.
   - `<InlineAIResult />` only renders streamed text when `output.length > 0` ([InlineAIResult.tsx:100](frontend/src/components/InlineAIResult.tsx#L100)), so during the gap the card shows the user's selected blockquote and nothing else.

2. **Chat panel** (`<ChatPanel />` / `<ChatMessages />` / `<ChatComposer />`).
   `useSendChatMessageMutation` ([useChat.ts:171-197](frontend/src/hooks/useChat.ts#L171-L197)) drains the SSE stream silently and only invalidates the messages query when the stream completes. Until that happens, the only feedback is a disabled Send button — the user message isn't even shown until the refetch lands.

Backend route shape is fine: `POST /api/chats/:chatId/messages` already streams per-chunk SSE ([chat.routes.ts:451-490](backend/src/routes/chat.routes.ts#L451-L490)) and persists the assistant message right before `[DONE]` ([chat.routes.ts:496-510](backend/src/routes/chat.routes.ts#L496-L510)). All work is on the frontend.

---

## Architecture

Three pieces, each with one responsibility:

1. **`<ThinkingDots />` primitive** (`frontend/src/design/ThinkingDots.tsx`). Three-dot bouncing indicator extracted from `<InlineAIResult />`. Owns the markup, ARIA labelling, and `prefers-reduced-motion` fallback. No state.

2. **`useAICompletion` gains a real `'thinking'` status.** Run-start sets `'thinking'`; the first SSE chunk flips to `'streaming'`. The existing store-sync effect in `EditorPage` mirrors statuses 1:1, so inline-AI dots become visible naturally.

3. **`useChatDraftStore` Zustand slice** (`frontend/src/store/chatDraft.ts`). Holds the in-flight chat turn — `{ chatId, userContent, assistantText, status, error }`. `useSendChatMessageMutation` writes to it on send/chunk/done/error. `<ChatMessages />` reads cached messages plus the draft; renders the optimistic user bubble + assistant bubble (dots until first chunk, live text after). On `'done'`, the existing `invalidateQueries()` triggers a refetch; the draft clears once the matching pair is in the refetched list, or unconditionally on `onSettled` — whichever is simpler to test.

Ephemeral state stays in Zustand, persistent state stays in TanStack Query. The draft slice never feeds the cache directly.

### Component data flow

```
ChatComposer.onSend
  → useSendChatMessageMutation.mutate
    → chatDraftStore.start({ chatId, userContent })
    → POST /api/chats/:chatId/messages (SSE)
    → for each chunk: chatDraftStore.appendDelta(text)
    → on first chunk: chatDraftStore.markStreaming()
    → on done: chatDraftStore.markDone() + invalidateQueries
    → on error: chatDraftStore.markError(err) + (no invalidate)

ChatMessages renders:
  cachedMessages (from useChatMessagesQuery)
  + (draft && draft.chatId === activeChatId ? renderDraftPair(draft) : null)
```

---

## Components

### 1. `<ThinkingDots />` (new — `frontend/src/design/ThinkingDots.tsx`)

```tsx
import type { JSX } from 'react';

export interface ThinkingDotsProps {
  /** Accessible label announced to screen readers. Defaults to "Thinking". */
  label?: string;
  /** Optional class for layout (margin, gap with surrounding text). */
  className?: string;
}

const DELAYS_MS: readonly number[] = [0, 150, 300];

export function ThinkingDots({
  label = 'Thinking',
  className,
}: ThinkingDotsProps): JSX.Element {
  return (
    <span
      role="status"
      aria-label={label}
      data-testid="thinking-dots"
      className={['inline-flex items-center', className].filter(Boolean).join(' ')}
    >
      {DELAYS_MS.map((delay) => (
        <span
          key={delay}
          aria-hidden="true"
          className="think-dot inline-block w-2 h-2 mx-0.5 rounded-full bg-[var(--ink-4)]"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}
```

`<InlineAIResult />` replaces its inline three-`<span>` block with `<ThinkingDots />`. A Storybook story shows the default + reduced-motion preview.

### 2. `useAICompletion` status union change

```ts
export type AICompletionStatus = 'idle' | 'thinking' | 'streaming' | 'done' | 'error';
```

- `run()` sets `status: 'thinking'` instead of `'streaming'` at line 120.
- Inside the SSE loop, the first non-empty content delta also sets `status: 'streaming'` (using the same `safeSetState` updater that appends text). One additional render per request.
- `cancel()` and the abort path return to `'idle'` as before.
- `error` and `done` paths unchanged.

`EditorPage.handleInlineAction` keeps seeding the store with `status: 'thinking'`. The store-sync effect mirrors `completion.status` directly — no special-case for the new `'thinking'` value because it maps 1:1.

`<InlineAIResult />`:
- Render `<ThinkingDots />` when `status === 'thinking' || (status === 'streaming' && output.length === 0)`. The second clause is a belt-and-braces guard against any future race; in practice the new hook status makes the first clause sufficient.
- Render the streamed text block when `status === 'streaming' || status === 'done'` AND `output.length > 0` (unchanged).

### 3. `useChatDraftStore` (new — `frontend/src/store/chatDraft.ts`)

```ts
import { create } from 'zustand';

export type ChatDraftStatus = 'thinking' | 'streaming' | 'done' | 'error';

export interface ChatDraftError {
  code: string | null;
  message: string;
  httpStatus?: number;
}

export interface ChatDraft {
  chatId: string;
  userContent: string;
  /** Raw selection-attachment payload, if any, so the optimistic user
   *  bubble can render the same context chip a persisted message would. */
  attachment: { selectionText: string; chapterId: string } | null;
  assistantText: string;
  status: ChatDraftStatus;
  error: ChatDraftError | null;
}

interface ChatDraftState {
  draft: ChatDraft | null;
  start: (args: {
    chatId: string;
    userContent: string;
    attachment: ChatDraft['attachment'];
  }) => void;
  appendDelta: (delta: string) => void;
  markStreaming: () => void;
  markDone: () => void;
  markError: (error: ChatDraftError) => void;
  clear: () => void;
}

export const useChatDraftStore = create<ChatDraftState>((set) => ({
  draft: null,
  start: ({ chatId, userContent, attachment }) =>
    set({
      draft: {
        chatId,
        userContent,
        attachment,
        assistantText: '',
        status: 'thinking',
        error: null,
      },
    }),
  appendDelta: (delta) =>
    set((s) =>
      s.draft
        ? { draft: { ...s.draft, assistantText: s.draft.assistantText + delta } }
        : s,
    ),
  markStreaming: () =>
    set((s) => (s.draft ? { draft: { ...s.draft, status: 'streaming' } } : s)),
  markDone: () =>
    set((s) => (s.draft ? { draft: { ...s.draft, status: 'done' } } : s)),
  markError: (error) =>
    set((s) => (s.draft ? { draft: { ...s.draft, status: 'error', error } } : s)),
  clear: () => set({ draft: null }),
}));
```

### 4. `useSendChatMessageMutation` rewrite

The mutation switches from drain-and-discard to draft-and-stream:

```ts
export function useSendChatMessageMutation(): UseMutationResult<void, Error, SendChatMessageArgs> {
  const qc = useQueryClient();
  return useMutation<void, Error, SendChatMessageArgs>({
    mutationFn: async ({ chatId, content, modelId, attachment, enableWebSearch }) => {
      const draftStore = useChatDraftStore.getState();
      draftStore.start({
        chatId,
        userContent: content,
        attachment: attachment ?? null,
      });

      const body: Record<string, unknown> = { content, modelId };
      if (attachment) body.attachment = attachment;
      if (enableWebSearch === true) body.enableWebSearch = true;

      let res: Response;
      try {
        res = await apiStream(`/chats/${encodeURIComponent(chatId)}/messages`, {
          method: 'POST',
          body,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Chat send failed';
        useChatDraftStore.getState().markError({ code: null, message });
        throw err;
      }

      if (!res.body) {
        useChatDraftStore.getState().markError({ code: null, message: 'Empty response body' });
        throw new Error('Empty response body');
      }

      let firstChunkSeen = false;
      try {
        for await (const event of parseAiSseStream(res.body)) {
          if (event.type === 'chunk') {
            const delta = event.chunk.choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta.length > 0) {
              if (!firstChunkSeen) {
                firstChunkSeen = true;
                useChatDraftStore.getState().markStreaming();
              }
              useChatDraftStore.getState().appendDelta(delta);
            }
          } else if (event.type === 'error') {
            const message = event.error.error || 'Chat send failed';
            useChatDraftStore.getState().markError({
              code: event.error.code ?? null,
              message,
            });
            throw new Error(message);
          } else if (event.type === 'done') {
            useChatDraftStore.getState().markDone();
            break;
          }
          // citations frame: ignore here — refetched message carries citationsJson
        }
      } catch (err) {
        if (useChatDraftStore.getState().draft?.status !== 'error') {
          const message = err instanceof Error ? err.message : 'Chat stream failed';
          useChatDraftStore.getState().markError({ code: null, message });
        }
        throw err;
      }
    },
    onSuccess: (_void, vars) => {
      void qc.invalidateQueries({ queryKey: chatMessagesQueryKey(vars.chatId) });
    },
    onSettled: () => {
      // The draft has served its purpose. Clear it; the refetched messages
      // are now (or imminently) the source of truth.
      useChatDraftStore.getState().clear();
    },
  });
}
```

Notes:
- `onSettled` clears the draft on both success and error paths. On error, the existing `useErrorStore` path (via the global error boundary or a follow-up if the chat doesn't already wire one) handles user-visible failure; the optimistic bubbles disappear.
- Citations frames from `[V26]` are ignored in the draft path. Live citation rendering during stream is out of scope; the refetched assistant message carries `citationsJson` and `<MessageCitations />` continues to render it after the draft clears.

### 5. `<ChatMessages />` integration

Read the draft via `useChatDraftStore((s) => s.draft)`. When the draft is non-null and `draft.chatId` matches the active chat, render after the cached messages:

- Optimistic user bubble: same shape as a real user message, derived from `draft.userContent` and `draft.attachment`.
- Optimistic assistant bubble: shows `<ThinkingDots />` when `draft.status === 'thinking'`; shows `draft.assistantText` once `status === 'streaming'` or `'done'`. Replace the live preview with the persisted row once the draft clears (the refetch will already have populated `cachedMessages`).
- On `draft.status === 'error'`, render an `<InlineErrorBanner>` in place of the assistant bubble (matches the existing pattern in `<InlineAIResult />`); discard on the next user action or chat switch.

Concrete behaviour for the autoscroll already implemented in `<ChatMessages />`: the draft pair is part of the rendered message list, so the existing scroll-to-bottom effect picks it up unchanged.

### 6. Reduced-motion CSS

Add a single block in `frontend/src/index.css` next to the existing `@keyframes think`:

```css
@media (prefers-reduced-motion: reduce) {
  .think-dot {
    animation: none;
    opacity: 0.55;
  }
}
```

The dots remain visible (still communicate "in flight") but don't bounce. No JS changes; applies to every `.think-dot` site (inline AI today, chat tomorrow, anywhere new).

---

## Behaviour matrix

| Surface | Before send | After send, before first chunk | First chunk → done | Error | Cancel |
|---|---|---|---|---|---|
| **Inline AI card** | Card hidden (no `inlineAIResult`) | Blockquote + `<ThinkingDots />` | Blockquote + streamed serif text | `<InlineErrorBanner>` + Discard | `clear()` removes card |
| **Chat panel** | Cached messages + composer | Cached + optimistic user bubble + assistant bubble with `<ThinkingDots />` | Same, dots replaced by streaming text | Optimistic pair + `<InlineErrorBanner>` in assistant slot | Not in scope (see Future Work) |

The user message appears *immediately* on Send for chat — that's a UX bonus from the draft slice and addresses the implicit complaint ("nothing happens besides my message being inserted" only happens because of the slow refetch; under the new pattern the user bubble is part of the optimistic draft and appears synchronously with the click).

---

## Error handling

- **Inline AI:** Unchanged. `useAICompletion`'s existing error path stays. `<InlineAIResult />` renders `<InlineErrorBanner />` on `status === 'error'` (already wired).
- **Chat:**
  - Pre-stream errors (transport / 4xx): `markError` is called; `<ChatMessages />` renders the optimistic user bubble + an `<InlineErrorBanner>` in place of the assistant bubble.
  - Mid-stream errors (`event.type === 'error'`): same as above; the partial `assistantText` is discarded (the next refetch will not include it because the backend persists only on successful completion).
  - The existing global error surfacing via `useErrorStore` is not added here unless `<ChatMessages />`'s error rendering proves insufficient in manual testing. The local in-bubble error matches the inline-AI pattern (which already works without a global toast).
- **Network drop / browser back:** the mutation is a `useMutation`, so unmounting the chat does not abort the in-flight POST. The draft slice persists across panel re-mounts (it's a Zustand store), so a brief navigation away and back will continue to show the dots. A full route change clears the chat surface; stale drafts will auto-clear on `onSettled`.

---

## Testing

### Unit / component tests

- `frontend/tests/design/ThinkingDots.test.tsx` — renders three `.think-dot` spans, each with `data-testid="thinking-dots"` parent, role=status, label.
- `frontend/tests/store/chatDraft.test.ts` — start / appendDelta / markStreaming / markDone / markError / clear; ordering invariants (`appendDelta` is a no-op when no draft).
- `frontend/tests/hooks/useAICompletion.test.tsx` — extend existing test:
  - On `run()` start, status flips to `'thinking'` (not `'streaming'`).
  - Status flips to `'streaming'` on first non-empty `delta.content` chunk only.
  - Empty-delta chunks (e.g. role-only initial chunk) do not flip the status.
- `frontend/tests/components/InlineAIResult.test.tsx` — extend:
  - Dots render when `status === 'thinking'`.
  - Dots render when `status === 'streaming' && output === ''` (belt-and-braces).
  - Dots gone once `output` is non-empty.
- `frontend/tests/components/ChatMessages.test.tsx` — extend or create:
  - With a draft in `'thinking'`, both optimistic bubbles render and the assistant slot shows `<ThinkingDots />`.
  - On `'streaming'`, the assistant slot renders accumulated `assistantText` and no dots.
  - On `'done'` followed by draft cleared + cached messages updated, only the cached messages render (no double-render).
  - Optimistic bubbles are scoped to `draft.chatId === activeChatId` (switching chats hides the draft).
- `frontend/tests/hooks/useChat.test.tsx` — rewrite the send-mutation test:
  - Mock `apiStream` to yield three chunks, then `[DONE]`. Assert draft progression: `'thinking' → 'streaming' → 'done' → cleared`. Assert `invalidateQueries` called once after `[DONE]`.
  - Mock SSE error frame. Assert draft ends in `'error'` with the right `code` / `message`. Assert no `invalidateQueries` (or assert that the cache doesn't gain a stale assistant row).

### Visual / Storybook

- New story for `<ThinkingDots />`: default and a wrapper that toggles `prefers-reduced-motion` via CSS query for visual verification.
- Update `<InlineAIResult />` story (if it exists) to use the new component reference; if not, add a story showing the three states (thinking / streaming-with-text / done).
- Add a `<ChatMessages />` story with a fixture `chatDraft` to render the optimistic-pair state.

### Manual smoke (browser)

After implementation:
1. Send a chat message → user bubble appears immediately, dots appear in a new assistant bubble, dots are replaced by streaming text within ~1s, persisted message replaces the draft on stream-end.
2. Trigger Rewrite on a selection → card opens with blockquote + dots, dots replaced by streaming serif text.
3. With Venice key removed, send a chat message → optimistic user bubble + error banner in assistant slot.
4. With OS-level reduce-motion enabled (System Settings → Accessibility), dots are static at low opacity in both surfaces.

---

## Out of scope / Future Work

- **Stop / Cancel button on chat.** The mutation has no `controllerRef`; adding one is a separate UX decision (button placement, behaviour for partial assistant message, whether to roll back the user message). Track separately.
- **Live citations during chat stream.** Citation frame in the SSE stream is currently captured server-side and persisted with the assistant row. Rendering them mid-stream would require draft-side citation state. The post-refetch render still shows them.
- **Autoscroll tweak for streaming text.** The existing scroll-to-bottom keeps working, but a "stick to bottom only if user was already at bottom" refinement may be wanted once dogfooding reveals friction. Leave alone for now.

---

## Files

**Create:**
- `frontend/src/design/ThinkingDots.tsx`
- `frontend/src/design/ThinkingDots.stories.tsx`
- `frontend/src/store/chatDraft.ts`
- `frontend/tests/design/ThinkingDots.test.tsx`
- `frontend/tests/store/chatDraft.test.ts`

**Modify:**
- `frontend/src/hooks/useAICompletion.ts` (status union + run-start status + first-chunk transition)
- `frontend/src/components/InlineAIResult.tsx` (use `<ThinkingDots />`, widen the dots-render predicate)
- `frontend/src/hooks/useChat.ts` (rewrite `useSendChatMessageMutation`)
- `frontend/src/components/ChatMessages.tsx` (read draft, render optimistic pair)
- `frontend/src/index.css` (reduced-motion block for `.think-dot`)

**Test files updated:**
- `frontend/tests/hooks/useAICompletion.test.tsx`
- `frontend/tests/components/InlineAIResult.test.tsx`
- `frontend/tests/hooks/useChat.test.tsx`
- `frontend/tests/components/ChatMessages.test.tsx`
- `frontend/tests/components/ChatPanel.test.tsx` (only if its assertions touch the message-list shape; otherwise no change)

**No backend changes.**
