# Chat Composer Alignment + Dead-UI Cleanup

**bd issues:** `story-editor-bw2` (primary), `story-editor-274` (folded in).

## Goal

Bring `ChatComposer.tsx`'s visual design into alignment with `SceneComposer.tsx`, remove three pieces of dead chat-tab UI, and wire a real Stop affordance for in-flight chat sends. After this PR the Chat tab and Scene tab read as design siblings — the same container chrome, the same sunken-paper textarea, the same idle/streaming pill button — while keeping the chat-specific affordances (auto-grow, attachment preview, web-search toggle).

## Why

- The mode-tabs row (Ask / Rewrite / Describe) under the message box is dead UI: only "ask" is wired; the other two render `aria-selected` state but trigger nothing meaningful. They were left over from an earlier design iteration. The dropdown picker and the inline AI selection bubble already cover rewrite/describe/expand from the editor side.
- The composer's send affordance (a small ink-square with an up-arrow inside the textarea row) doesn't match how Scene presents Generate/Stop — and there's no visible Stop affordance in chat at all today. A long Venice response or a hung connection has no user-driven exit.
- The "Start a conversation" empty state inside `ChatMessages` shows three suggestion chips ("Rewrite this passage", "Describe a scene", "Expand the next paragraph") that don't do anything — `onPickSuggestion` is passed `undefined` from every consumer post-Task-5. Same lineage as the mode tabs.
- The chat tab is the most-used pane in the app; visual debt accumulates here faster than anywhere else.

## Visual Spec

```
┌──────────────────────────────────────┐  ← border-t border-line p-3 bg-bg
│ [optional ATTACHMENT preview block]  │
│                                      │
│ ┌──────────────────────────────────┐ │  ← bg-bg-sunken border rounded
│ │ Send a message…                  │ │     (auto-grow, 28–120px)
│ │                                  │ │
│ └──────────────────────────────────┘ │
│                                      │
│ ⌘↵ to send             [   Send   ] │  ← idle:    bg-ink text-bg pill
│ generating… ⎋ to stop  [⏹ Stop    ] │  ← stream:  bg-danger text-bg pill
│                                      │
│ ☐ Web search — may increase…        │  ← unchanged, conditional on model
└──────────────────────────────────────┘
```

Side-by-side with Scene:
- **Container chrome:** identical (`border-t border-line p-3 bg-bg flex flex-col gap-2`).
- **Textarea:** identical Tailwind classes; chat keeps auto-grow (28–120px) instead of Scene's fixed `rows={3}` because chat messages are typically a single line. Both use `bg-bg-sunken border border-line rounded` and `disabled:opacity-60` while streaming.
- **Footer row:** identical layout (`flex items-center justify-between`). Left = mono `⌘↵ to send` hint (idle) / `generating… ⎋ to stop` (streaming). Right = pill button.
- **Pill button:** identical sizing (`px-3 py-1 rounded-[var(--radius)] text-[12px]`). Idle = `bg-ink text-bg`, label "Send". Streaming = `bg-danger text-bg`, stop-icon + label "Stop".
- **Differences from Scene (kept intentionally):** auto-grow textarea, optional attachment preview block above, optional web-search toggle below.

## Component Contract Changes

### `ChatComposer.tsx`

**Props (interface delta):**

| Prop | Before | After |
|---|---|---|
| `onSend` | `(args: SendArgs) => void \| Promise<void>` | unchanged |
| `disabled` | `boolean?` | unchanged |
| `state` | — | `'idle' \| 'streaming'` (defaults to `'idle'` if omitted) |
| `onStop` | — | `() => void` (only invoked when `state === 'streaming'`) |

**`SendArgs` (interface delta):**

| Field | Before | After |
|---|---|---|
| `content` | `string` | unchanged |
| `attachment` | `AttachedSelectionValue \| null` | unchanged |
| `mode` | `'ask' \| 'rewrite' \| 'describe'` | **REMOVED** |
| `enableWebSearch` | `boolean` | unchanged |

**Removed source surface:**
- `ChatComposerMode` type export.
- `MODE_TABS` constant array.
- `mode` / `setMode` state.
- `modeTabClass` helper.
- The mode-tabs JSX block (the bottom `<div role="tablist" aria-label="Composer mode">` and its sibling Cmd-Enter span).
- `ArrowUpIcon` helper component (the new pill is a text label, not an icon button).
- The inline 28×28 ink-square send button inside the textarea wrapper.
- The textarea wrapper div's `flex items-end gap-2 px-2 py-1.5 rounded-[var(--radius)] border border-line bg-bg focus-within:border-ink-3` (replaced by Scene-styled textarea directly).

**Behavioural contract:**
- **Idle.** Textarea enabled. Footer-left hint = `⌘↵ to send`. Footer-right pill = "Send" (`bg-ink`, disabled when `value.trim() === '' && attachment === null`). `Cmd/Ctrl+Enter` submits.
- **Streaming.** Textarea disabled (`disabled` attr + `opacity-60`). Footer-left hint = `generating… ⎋ to stop`. Footer-right pill = "Stop" (`bg-danger`, stop-icon, always enabled). `Cmd/Ctrl+Enter` is a no-op. `Escape` calls `onStop()`.
- After `Stop` is clicked: the parent's `useSendChatMessageMutation` aborts the SSE; the existing `markError` path runs; user can re-edit the text and resend.

### `useSendChatMessageMutation` (in `useChat.ts`)

**Today:** calls `apiStream(...)` with no `signal`. There is no way to abort an in-flight chat send.

**After:** maintains an internal `useRef<AbortController | null>(null)`. The `mutationFn` creates a fresh `AbortController` on each invocation, stashes it in the ref, and passes `signal: ac.signal` to `apiStream`. The hook's return type extends `UseMutationResult<...>` with a `stop: () => void` method that calls `ref.current?.abort()`. When the abort fires the SSE stream's `parseAiSseStream` propagates the cancellation; the existing `markError` catch handles the user-facing draft state.

```ts
export function useSendChatMessageMutation(): UseMutationResult<void, Error, SendChatMessageArgs> & {
  stop: () => void;
}
```

The `stop` method is a no-op when no send is in flight (i.e., `ref.current` is null or already aborted). It does **not** clear the chat draft store or reset any other state — only the existing `mutationFn` catch path does that, fired by the abort propagating into `parseAiSseStream`.

### `ChatTab.tsx`

Pass `state` and `onStop` into the composer:

```tsx
<ChatComposer
  onSend={onSend}
  disabled={sendChatMessage.isPending}
  state={sendChatMessage.isPending ? 'streaming' : 'idle'}
  onStop={sendChatMessage.stop}
/>
```

The `disabled` prop is now structurally redundant with `state === 'streaming'` (both gate keystroke submission), but keeping it preserves the prop's existing semantics for other future callers and avoids a breaking change to a public component contract within this PR.

### `ChatMessages.tsx` (folding in story-editor-274)

**Removed:**
- The `SuggestionKind` type export.
- The `SUGGESTION_DEFS` constant array.
- `WandIcon`, `SparklesIcon`, `ExpandIcon` helper components (used only by the suggestion chips).
- The `onPickSuggestion?: (kind: SuggestionKind) => void` prop.
- The `<div className="suggestion-chips">` JSX block in the `chatId === null` empty state. Replace with a quieter empty state — just the existing `<p className="text-[13px] text-ink-3 font-sans">Start a conversation</p>` with the suggestion chips row removed.

**Kept:** the rest of the component — `UserMessage`, `AssistantMessage`, `DraftPair`, `ContextChip` (separate concern, story-editor-7at), the inline error banner.

## Storybook Updates

`ChatComposer.stories.tsx` — drop the existing mode-tab story if present; add three explicit variants:
- **`Idle`** — empty value, attachment null, web-search-supporting model NOT selected.
- **`IdleWithAttachment`** — same, but with a seeded attachment via the `useAttachedSelectionStore` decorator.
- **`Streaming`** — `state="streaming"`, textarea pre-populated with a long message, Stop button visible.
- **`WebSearchToggleVisible`** — same as Idle but with a model that has `supportsWebSearch === true`.

`ChatMessages.stories.tsx` — if it exists, drop the `EmptyWithSuggestions` story or rename to `Empty` to reflect the simplified empty state.

## Test Updates

### `ChatComposer.test.tsx`

**Delete:**
- Any test asserting on the mode tabs (`'Ask'` / `'Rewrite'` / `'Describe'` role=tab queries, `aria-selected` toggling, `mode` field on `SendArgs`).
- Any test asserting on the inline ink-square send button.

**Add:**
- `'Idle: clicking Send invokes onSend with the trimmed content'`.
- `'Idle: Cmd+Enter invokes onSend with the trimmed content'`.
- `'Idle: Send button is disabled when value is empty and no attachment'`.
- `'Streaming: Send pill is replaced with Stop pill'`.
- `'Streaming: clicking Stop invokes onStop'`.
- `'Streaming: textarea is disabled'`.
- `'Streaming: Escape invokes onStop'`.

**Keep:** all attachment-preview tests, web-search-toggle tests, the focus-token test, the pending-draft hydration test.

### `useChat.test.tsx`

**Add:**
- `'useSendChatMessageMutation.stop() aborts the in-flight stream'` — call `mutateAsync` against a never-finishing SSE mock, then `stop()`, then assert the mutation rejects with an `AbortError` (or that the existing `markError` path was hit on the chat draft store).

### `ChatTab.test.tsx`

**Add:**
- `'when sendChatMessage is pending, ChatComposer renders the Stop button'` — drive the test through the existing happy-path send mock, freeze before the SSE completes, assert Stop is visible.

### `ChatMessages.test.tsx`

**Delete (folding in 274):**
- Any test asserting on the suggestion chips (`'Rewrite this passage'`, `'Describe a scene'`, `'Expand the next paragraph'` role=button queries, `onPickSuggestion` invocation).

## Files Changed

| File | Change |
|---|---|
| `frontend/src/components/ChatComposer.tsx` | Major restyle + prop additions + dead-mode-tabs removal. |
| `frontend/src/hooks/useChat.ts` | `useSendChatMessageMutation` adds AbortController + `stop()`. |
| `frontend/src/components/ChatTab.tsx` | Pass `state` and `onStop` to composer. |
| `frontend/src/components/ChatMessages.tsx` | Remove dead suggestion chips + their helpers + the `onPickSuggestion` prop. |
| `frontend/src/components/ChatComposer.stories.tsx` | Variant set updated. |
| `frontend/tests/components/ChatComposer.test.tsx` | Drop dead-UI tests; add idle/streaming tests. |
| `frontend/tests/hooks/useChat.test.tsx` | Add stop() abort test. |
| `frontend/tests/components/ChatTab.test.tsx` | Add streaming-state composer test. |
| `frontend/tests/components/ChatMessages.test.tsx` | Drop suggestion-chip tests. |

## Out of Scope

- Threading `chapterTitle` / `attachedCharacterCount` / `attachedTokenCount` through to `ChatMessages` — story-editor-7at, which has been re-scoped to *remove* the ContextChip rather than thread the values.
- The History tab + duplicate Settings icon cleanup — story-editor-tv4. (The `+ New chat` button portion of tv4 already landed as part of n4h.)
- The @-mention character autocomplete — story-editor-2p7.
- Backend changes — none. The SSE streaming endpoint and the `apiStream` helper already accept an `AbortSignal`; this PR only wires it through the React layer.

## Review Surface

- `ChatComposer.tsx` is purely presentational; lives outside the encrypted-content path; no security review needed beyond standard frontend lint/typecheck/design-token gates.
- `useChat.ts` AbortController wiring touches a hook used by every chat send. Standard frontend gates suffice; no server-side or repo-boundary review needed.
- `ChatMessages.tsx` reads decrypted chat content; this PR doesn't change what it renders — only removes dead helpers — but the leak-test invariant still applies.

## Acceptance

- ChatComposer in idle state renders identically to SceneComposer's idle state from the container border, the textarea styling, the footer-row layout, and the pill button. (Side-by-side Storybook visual comparison.)
- ChatComposer in streaming state matches SceneComposer's streaming state (Stop pill in danger color, mono "generating… ⎋ to stop" hint).
- Sending a chat message that takes >2 seconds to finish: clicking Stop terminates the stream within ~100ms; the user can immediately re-edit and resend without a page refresh.
- Pressing Escape during streaming has the same effect as clicking Stop.
- The chat empty state (no chat yet) shows only "Start a conversation" — no clickable suggestion chips.
- All four files in the test changes pass; full frontend suite stays green; lint:design + typecheck both clean.
