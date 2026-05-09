# Chat Composer Alignment + Dead-UI Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align `ChatComposer.tsx`'s visual design with `SceneComposer.tsx`, remove three pieces of dead UI (mode tabs, inline send-square, suggestion chips inside ChatMessages empty state), and wire a real Stop affordance for in-flight chat sends by threading an AbortController through `useSendChatMessageMutation`.

**Architecture:** Pure refactor — no new components, no backend work. The endpoint, SSE protocol, and parser stay unchanged. The chat-tab streaming hook (`useSendChatMessageMutation`) gains AbortController plumbing that mirrors the pattern already in `useSceneTranscript.ts` and `useAICompletion.ts`. The composer becomes a Scene-flavoured pill-button shell while keeping its three chat-specific affordances (auto-grow textarea, attachment preview, web-search toggle). One folded-in scope: the dead "Rewrite this passage / Describe a scene / Expand the next paragraph" suggestion chips inside `ChatMessages`'s empty state get removed alongside the composer mode tabs that fed them (`story-editor-274`).

**Tech Stack:** React 19, TypeScript strict, TanStack Query 5, Zustand, TailwindCSS (token-only via `frontend/scripts/lint-design.mjs`), Vitest + Testing Library, Storybook 9.

**bd issues:** `story-editor-bw2` (primary), `story-editor-274` (folded in).

**Branch:** `feature/chat-composer-bw2`, based on `feature/chat-session-picker`.

---

## File Structure

The plan touches eight files across `frontend/src` and `frontend/tests`, plus one new Storybook entry:

| File | Responsibility | Change |
|---|---|---|
| `frontend/src/components/ChatComposer.tsx` | Presentational composer shell | Major restyle + prop additions + dead-UI removal |
| `frontend/src/hooks/useChat.ts` | Chat data hooks | Add AbortController + `stop()` to `useSendChatMessageMutation` |
| `frontend/src/components/ChatTab.tsx` | Chat-tab orchestrator | Pass `state` + `onStop` to `<ChatComposer>` |
| `frontend/src/components/ChatMessages.tsx` | Chat message list | Remove dead suggestion chips + helpers + `onPickSuggestion` prop |
| `frontend/src/components/ChatComposer.stories.tsx` | Storybook | **Create** (does not exist today) |
| `frontend/tests/components/ChatComposer.test.tsx` | Composer unit tests | Drop dead-UI tests; add idle/streaming/escape tests |
| `frontend/tests/hooks/useChat.test.tsx` | Hook tests | Add `stop()` aborts the in-flight stream |
| `frontend/tests/components/ChatTab.test.tsx` | Orchestrator tests | Add streaming-state composer test |
| `frontend/tests/components/ChatMessages.test.tsx` | Messages tests | Drop suggestion-chip tests |

The decomposition is feature-shaped: each file has one clear concern that lines up with one task in the plan. Task ordering moves from inside-out — dead-UI removal first (smallest blast radius), then the abort wiring, then the visual restyle, then the orchestrator wiring, then stories + final verification.

---

## Pre-flight

- [ ] **Step 0: Verify branch and starting state**

```bash
git branch --show-current
git log --oneline -3
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run lint:design
```

Expected:
- Current branch is `feature/chat-composer-bw2`.
- Recent commits include the spec at `2028a7b` and the bd-state commit at `45a9d27`.
- typecheck exits 0.
- Full frontend suite passes (~899 tests, exact count may shift).
- lint:design exits 0.

If anything fails, stop and reconcile before starting Task 1.

---

## Task 1: Remove dead suggestion chips from `ChatMessages.tsx` (folds in `story-editor-274`)

**Files:**
- Modify: `frontend/src/components/ChatMessages.tsx` — remove `SuggestionKind` type, `SUGGESTION_DEFS` array, `WandIcon` / `SparklesIcon` / `ExpandIcon` helpers, `onPickSuggestion` prop, the suggestion-chip JSX block in the empty state.
- Modify: `frontend/tests/components/ChatMessages.test.tsx` — delete the test that asserts on the suggestion chips.

The dead UI is: three buttons inside `ChatMessages`'s `chatId === null` empty state — "Rewrite this passage", "Describe a scene", "Expand the next paragraph" — that call `onPickSuggestion(kind)`. Post-Task-5 of n4h, no caller passes `onPickSuggestion`, so the callback is always `undefined` and the buttons silently do nothing.

- [ ] **Step 1: Read the existing surface**

```bash
grep -n "SuggestionKind\|SUGGESTION_DEFS\|onPickSuggestion\|WandIcon\|SparklesIcon\|ExpandIcon\|suggestion-chip" frontend/src/components/ChatMessages.tsx
```

Expected output (line numbers may have shifted; just confirm each symbol exists):
- Line ~34: `export type SuggestionKind = 'rewrite' | 'describe' | 'expand';`
- Line ~37: docblock about the empty state.
- Line ~45: `onPickSuggestion?: (kind: SuggestionKind) => void;` prop.
- Lines ~86, ~112, ~130: three icon helpers (`WandIcon`, `SparklesIcon`, `ExpandIcon`).
- Lines ~188-196: `SUGGESTION_DEFS` array.
- Line ~389: `onPickSuggestion` destructured from props.
- Lines ~401-417: the `<div className="suggestion-chips">` JSX block.

If any symbol is missing, stop and report — the file may have been edited since this plan was written.

- [ ] **Step 2: Update the failing test first (TDD)**

Open `frontend/tests/components/ChatMessages.test.tsx`. Locate the test at line ~85:

```ts
it('empty state: renders "Start a conversation" + 3 suggestion chips that fire onPickSuggestion', async () => {
  const onPick = vi.fn();
  renderWithProviders(<ChatMessages chatId={null} onPickSuggestion={onPick} />);
  // …assertions on chips + onPick…
});
```

Replace it with a test that the empty state has NO suggestion chips:

```ts
it('empty state: renders "Start a conversation" without any suggestion chips', () => {
  renderWithProviders(<ChatMessages chatId={null} />);
  expect(screen.getByText('Start a conversation')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Rewrite this passage/i })).toBeNull();
  expect(screen.queryByRole('button', { name: /Describe a scene/i })).toBeNull();
  expect(screen.queryByRole('button', { name: /Expand the next paragraph/i })).toBeNull();
});
```

Note that the `onPickSuggestion` prop is no longer passed (Step 4 will remove the type).

- [ ] **Step 3: Run the test to verify it fails**

```bash
npm --prefix frontend test -- tests/components/ChatMessages.test.tsx
```

Expected: the new test FAILS because the suggestion chips still exist (`queryByRole` returns three buttons, not null).

- [ ] **Step 4: Remove the dead code from `ChatMessages.tsx`**

In `frontend/src/components/ChatMessages.tsx`, delete:

1. The `SuggestionKind` type (line ~34):
```ts
export type SuggestionKind = 'rewrite' | 'describe' | 'expand';
```

2. The `WandIcon`, `SparklesIcon`, and `ExpandIcon` helper functions (lines ~86, ~112, ~130 — three separate `function FooIcon(): JSX.Element { … }` blocks).

3. The `SUGGESTION_DEFS` array (lines ~188-196):
```ts
const SUGGESTION_DEFS: ReadonlyArray<{ … }> = [ … ];
```

4. The `onPickSuggestion?: (kind: SuggestionKind) => void;` prop on `ChatMessagesProps` (line ~45).

5. The `onPickSuggestion` destructure from the function signature (line ~389) — remove that one parameter from the destructuring.

6. The suggestion-chip JSX block (lines ~401-417). The empty state should now read:

```tsx
if (chatId === null) {
  return (
    <div className="flex flex-col gap-3 p-4 text-center" data-testid="chat-empty">
      <p className="text-[13px] text-ink-3 font-sans">Start a conversation</p>
    </div>
  );
}
```

After the deletes, run `grep -n "SuggestionKind\|SUGGESTION_DEFS\|onPickSuggestion\|WandIcon\|SparklesIcon\|ExpandIcon\|suggestion-chip" frontend/src/components/ChatMessages.tsx` — expected: zero matches.

- [ ] **Step 5: Run the test to verify it passes**

```bash
npm --prefix frontend test -- tests/components/ChatMessages.test.tsx
```

Expected: PASS for the new empty-state test, plus the 20 other pre-existing tests still pass.

- [ ] **Step 6: Run full gates**

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run lint:design
npm --prefix frontend test
```

Expected: typecheck 0; lint:design clean; all frontend tests pass. Test count drops by 0 (we replaced one test, didn't remove one).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ChatMessages.tsx frontend/tests/components/ChatMessages.test.tsx
git commit -m "[chat-composer-bw2] remove dead suggestion chips from ChatMessages empty state

Closes story-editor-274. The Rewrite/Describe/Expand chips called
onPickSuggestion which no caller has passed since the n4h Task-5
EditorPage cleanup. Drops the SuggestionKind type, the SUGGESTION_DEFS
array, the three icon helpers, and the onPickSuggestion prop."
```

---

## Task 2: Wire AbortController through `useSendChatMessageMutation`

**Files:**
- Modify: `frontend/src/hooks/useChat.ts` — add an internal `useRef<AbortController | null>(null)`; create a fresh controller per send; pass `signal` to both `apiStream` and `parseAiSseStream`; expose `stop: () => void` on the returned hook.
- Modify: `frontend/tests/hooks/useChat.test.tsx` — add a test that `stop()` aborts the in-flight stream.

The hook currently calls `apiStream(...)` at line ~241 with no `signal`, and `parseAiSseStream(res.body)` at line ~218 with no `signal`. The infrastructure exists in both functions (they accept `signal` and propagate abort) — only the React layer is missing. After this task, chat catches up with `useSceneTranscript.ts` and `useAICompletion.ts` on abort coverage.

- [ ] **Step 1: Read the existing implementation**

```bash
grep -n "useSendChatMessageMutation\|apiStream\|parseAiSseStream\|signal" frontend/src/hooks/useChat.ts
```

Expected: `useSendChatMessageMutation` declared around line 222; `apiStream(...)` called with `{ method: 'POST', body }` (no signal); `parseAiSseStream(res.body)` called with one argument.

- [ ] **Step 2: Write the failing test**

Open `frontend/tests/hooks/useChat.test.tsx`. Inside the existing `describe('useSendChatMessageMutation', () => { … })` block (around line 59), append a new test:

```ts
  it('stop() aborts the in-flight stream', async () => {
    // Build an apiStream mock that returns a never-resolving SSE stream so we
    // can call stop() mid-flight and assert the abort propagates.
    let abortedSignal: AbortSignal | null = null;
    const neverEndingStream = new ReadableStream({
      start(_controller) {
        // Intentionally don't enqueue anything — the test aborts before any
        // chunk arrives.
      },
    });
    vi.mocked(apiStream).mockImplementation(async (_path, init) => {
      abortedSignal = (init as { signal?: AbortSignal } | undefined)?.signal ?? null;
      return new Response(neverEndingStream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });

    const { result } = renderHook(() => useSendChatMessageMutation(), { wrapper });

    const sendPromise = result.current.mutateAsync({
      chatId: 'c1',
      content: 'hello',
      modelId: 'm1',
    });

    // Give the mutationFn a tick to invoke apiStream and stash the controller.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(result.current.stop).toBeDefined();
    result.current.stop();

    // The mutation should reject with an AbortError (or settle with markError).
    await expect(sendPromise).rejects.toThrow();

    expect(abortedSignal).not.toBeNull();
    expect(abortedSignal?.aborted).toBe(true);
  });
```

Note this test depends on:
- `vi.mocked(apiStream)` already existing in the file (it does — the file uses `vi.mock('@/lib/api', …)` to spy on `apiStream`; check the top of the test file for the mock setup and reuse it).
- The `wrapper` helper that wraps tests in `QueryClientProvider` (also already in the file).
- The hook returning a `stop` function (which doesn't exist yet — that's what makes this test fail).

If `vi.mocked(apiStream)` is not already imported / mocked in the file, add the mock at module scope:

```ts
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, apiStream: vi.fn(actual.apiStream) };
});
```

(This is the same pattern `ChatTab.test.tsx` uses.) Don't add it if the file already mocks `apiStream`.

- [ ] **Step 3: Run the test to verify it fails**

```bash
npm --prefix frontend test -- tests/hooks/useChat.test.tsx
```

Expected: FAIL with `result.current.stop is not a function` or `expect(result.current.stop).toBeDefined()` failing.

- [ ] **Step 4: Implement the abort wiring in `useSendChatMessageMutation`**

Open `frontend/src/hooks/useChat.ts`. Find `useSendChatMessageMutation` (around line 222) and modify it:

a. Add `useRef` to the React imports at the top of the file (it may already be imported).

b. At the top of the `useSendChatMessageMutation` function body, add the ref:

```ts
export function useSendChatMessageMutation(): UseMutationResult<void, Error, SendChatMessageArgs> & {
  stop: () => void;
} {
  const qc = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);

  const mutation = useMutation<void, Error, SendChatMessageArgs>({
    // … existing onMutate, mutationFn, onSuccess, onSettled
  });

  return {
    ...mutation,
    stop: () => {
      abortRef.current?.abort();
    },
  };
}
```

c. Inside `mutationFn`, before the `apiStream(...)` call, create a fresh controller and stash it:

```ts
mutationFn: async ({ chatId, content, modelId, retry, attachment, enableWebSearch }) => {
  const controller = new AbortController();
  abortRef.current = controller;

  const body: Record<string, unknown> = { modelId };
  if (content !== undefined) body.content = content;
  if (retry === true) body.retry = true;
  if (attachment) body.attachment = attachment;
  if (enableWebSearch === true) body.enableWebSearch = true;

  let res: Response;
  try {
    res = await apiStream(`/chats/${encodeURIComponent(chatId)}/messages`, {
      method: 'POST',
      body,
      signal: controller.signal,
    });
  } catch (err) {
    if (abortRef.current === controller) abortRef.current = null;
    const message = err instanceof Error ? err.message : 'Chat send failed';
    const code = err instanceof ApiError ? (err.code ?? null) : null;
    useChatDraftStore.getState().markError({ code, message });
    throw err;
  }

  if (!res.body) {
    if (abortRef.current === controller) abortRef.current = null;
    const message = 'Empty response body';
    useChatDraftStore.getState().markError({ code: null, message });
    throw new Error(message);
  }

  let firstChunkSeen = false;
  try {
    for await (const event of parseAiSseStream(res.body, controller.signal)) {
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
      // citations frame: ignored — refetched message carries citationsJson.
    }
  } catch (err) {
    if (useChatDraftStore.getState().draft?.status !== 'error') {
      const message = err instanceof Error ? err.message : 'Chat stream failed';
      const code = err instanceof ApiError ? (err.code ?? null) : null;
      useChatDraftStore.getState().markError({ code, message });
    }
    throw err;
  } finally {
    if (abortRef.current === controller) abortRef.current = null;
  }
},
```

The three meaningful diffs vs the current implementation:
1. `const controller = new AbortController(); abortRef.current = controller;` at the top.
2. `signal: controller.signal` added to `apiStream(...)` and as the second arg to `parseAiSseStream(...)`.
3. `if (abortRef.current === controller) abortRef.current = null;` in the catch + finally to release the ref. The `=== controller` guard prevents a stale finally from clobbering a newer in-flight controller (matters if the user kicks off a second send before the first has cleaned up).

The hook's existing `onMutate`, `onSuccess`, and `onSettled` callbacks are unchanged.

- [ ] **Step 5: Run the test to verify it passes**

```bash
npm --prefix frontend test -- tests/hooks/useChat.test.tsx
```

Expected: PASS for the new `stop()` test, plus all pre-existing tests still pass.

- [ ] **Step 6: Run typecheck**

```bash
npm --prefix frontend run typecheck
```

Expected: exit 0. The hook's return type now extends `UseMutationResult<...> & { stop: () => void }`; verify any TypeScript callers (currently just `ChatTab.tsx`, which doesn't call `stop()` yet) aren't broken.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/hooks/useChat.ts frontend/tests/hooks/useChat.test.tsx
git commit -m "[chat-composer-bw2] thread AbortController through useSendChatMessageMutation

Mirrors the pattern in useSceneTranscript.ts and useAICompletion.ts:
the hook owns a useRef<AbortController> per send, passes signal to
apiStream and parseAiSseStream, and exposes stop() on the returned
mutation. Closes a chat-side gap where the user had no way to abort
a long-running Venice response."
```

---

## Task 3: Restyle `ChatComposer.tsx` and add `state` / `onStop` props

**Files:**
- Modify: `frontend/src/components/ChatComposer.tsx` — remove dead mode-tab UI; restyle to match SceneComposer; add `state` / `onStop` props; wire Escape-to-stop.
- Modify: `frontend/tests/components/ChatComposer.test.tsx` — drop dead-UI tests; add idle/streaming/escape tests.

This is the visible visual change. The composer keeps its three chat-specific affordances (auto-grow textarea, attachment preview, web-search toggle) but adopts SceneComposer's container chrome, sunken-paper textarea, and footer-pill button pattern.

- [ ] **Step 1: Read the current composer surface**

```bash
grep -n "MODE_TABS\|ChatComposerMode\|ArrowUpIcon\|setMode\|modeTabClass\|placeholder" frontend/src/components/ChatComposer.tsx
```

Expected: confirm `MODE_TABS` (line ~59), `ChatComposerMode` (~37), `ArrowUpIcon` (~103), `setMode` (~124), `modeTabClass` (~202), and the placeholder string `"Ask, rewrite, describe…"` (~243).

- [ ] **Step 2: Update the failing tests first**

Open `frontend/tests/components/ChatComposer.test.tsx`.

a. Find the existing tests (around lines 54-200) and **delete** the following:

- The test "renders a textarea with the expected placeholder" — its expected placeholder string changes; we'll re-add a corrected version below.
- The test 'Send button click calls onSend with content/attachment/mode' — its assertion on `args.mode === 'ask'` becomes invalid after `mode` is removed from `SendArgs`.
- Any test asserting on the mode tabs row: `'clicking Rewrite mode tab makes it active and submits with mode: rewrite'` (~line 171), `'after submit, mode resets to ask'` (~line 196), and any other test that queries `screen.getByRole('tab', …)` with `'Ask'` / `'Rewrite'` / `'Describe'` names.

b. Add the following new tests inside the existing `describe('ChatComposer (F40)', () => { … })` block, at the bottom (just before the closing brace of the outer describe). These tests cover the new contract:

```ts
  it('renders a textarea with the new placeholder', () => {
    renderWithQuery(<ChatComposer onSend={vi.fn()} />);
    const textarea = screen.getByPlaceholderText('Send a message…');
    expect(textarea).toBeInTheDocument();
  });

  it('Send button click calls onSend with content + attachment (no mode field)', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    renderWithQuery(<ChatComposer onSend={onSend} />);
    await user.type(screen.getByLabelText('Message'), 'hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledTimes(1);
    const args = onSend.mock.calls[0]?.[0] as SendArgs;
    expect(args.content).toBe('hello');
    expect(args.attachment).toBeNull();
    expect(args.enableWebSearch).toBe(false);
    expect((args as { mode?: unknown }).mode).toBeUndefined();
  });

  it('idle state: shows the Send button and hides Stop', () => {
    renderWithQuery(<ChatComposer onSend={vi.fn()} state="idle" onStop={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop generation' })).toBeNull();
  });

  it('streaming state: shows the Stop button and hides Send', () => {
    renderWithQuery(<ChatComposer onSend={vi.fn()} state="streaming" onStop={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Stop generation' })).toBeInTheDocument();
  });

  it('streaming state: textarea is disabled', () => {
    renderWithQuery(<ChatComposer onSend={vi.fn()} state="streaming" onStop={vi.fn()} />);
    expect(screen.getByLabelText('Message')).toBeDisabled();
  });

  it('streaming state: clicking Stop invokes onStop', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    renderWithQuery(<ChatComposer onSend={vi.fn()} state="streaming" onStop={onStop} />);
    await user.click(screen.getByRole('button', { name: 'Stop generation' }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('streaming state: pressing Escape inside the textarea invokes onStop', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    renderWithQuery(<ChatComposer onSend={vi.fn()} state="streaming" onStop={onStop} />);
    const textarea = screen.getByLabelText('Message');
    textarea.focus();
    await user.keyboard('{Escape}');
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('idle state: pressing Escape does NOT invoke onStop', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    renderWithQuery(<ChatComposer onSend={vi.fn()} state="idle" onStop={onStop} />);
    const textarea = screen.getByLabelText('Message');
    textarea.focus();
    await user.keyboard('{Escape}');
    expect(onStop).not.toHaveBeenCalled();
  });

  it('streaming state: Cmd+Enter does NOT invoke onSend', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    renderWithQuery(<ChatComposer onSend={onSend} state="streaming" onStop={vi.fn()} />);
    // Streaming state disables the textarea so we can't type, but we can still
    // dispatch the keydown directly on the document to ensure no global handler
    // submits.
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(onSend).not.toHaveBeenCalled();
  });
```

The test for `userEvent.setup()` + `user.keyboard('{Escape}')` requires that `userEvent` is imported at the top of the file. Check the existing imports — if `userEvent` is not imported, add `import userEvent from '@testing-library/user-event';`.

c. Keep all attachment-preview tests, web-search-toggle tests, focus-token tests, and pending-draft hydration tests as-is. Verify with:

```bash
grep -c "^  it(" frontend/tests/components/ChatComposer.test.tsx
```

Expected: the test count should be roughly the same (you removed ~3 dead-UI tests and added ~9 new ones, net +6).

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npm --prefix frontend test -- tests/components/ChatComposer.test.tsx
```

Expected: the new tests FAIL with messages like `screen.getByPlaceholderText('Send a message…')` not found, `screen.getByRole('button', { name: 'Send' })` not found, etc. The pre-existing tests for attachment / web-search may still pass.

- [ ] **Step 4: Restyle `ChatComposer.tsx`**

Open `frontend/src/components/ChatComposer.tsx`. The full new file:

```tsx
import {
  type ChangeEvent,
  type JSX,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useModelsQuery } from '@/hooks/useModels';
import { useUserSettings } from '@/hooks/useUserSettings';
import { type AttachedSelectionValue, useAttachedSelectionStore } from '@/store/attachedSelection';
import { useComposerDraftStore } from '@/store/composerDraft';

/**
 * [F40] Chat composer.
 *
 * Visual sibling of SceneComposer: identical container chrome, sunken-paper
 * textarea, and footer-pill button. Differs in three chat-specific affordances:
 * the auto-grow textarea (28–120px), the optional attachment preview block,
 * and the optional web-search toggle.
 *
 * State contract (mirrors SceneComposer):
 * - `state="idle"`      → Send pill, textarea enabled, Cmd/Ctrl+Enter submits.
 * - `state="streaming"` → Stop pill, textarea disabled, Escape calls onStop.
 *
 * Attachment: when `attachedSelection` is set in the Zustand store, renders the
 * attachment preview block above the textarea. On submit the store is cleared.
 */

export interface SendArgs {
  content: string;
  attachment: AttachedSelectionValue | null;
  /**
   * [F50] When true, the next `POST /chats/:chatId/messages` should set
   * `enableWebSearch: true`. Per-turn, not session-wide — the composer
   * resets the toggle to false after each successful send so credits are
   * never silently burned across a long conversation.
   */
  enableWebSearch: boolean;
}

export interface ChatComposerProps {
  onSend: (args: SendArgs) => void | Promise<void>;
  disabled?: boolean;
  state?: 'idle' | 'streaming';
  onStop?: () => void;
}

const MAX_TEXTAREA_HEIGHT_PX = 120;

function PaperclipIcon(): JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="flex-shrink-0 mt-0.5 text-ink-4"
    >
      <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.49" />
    </svg>
  );
}

function XIcon(): JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function StopIcon(): JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <rect x="1" y="1" width="8" height="8" rx="1" fill="currentColor" />
    </svg>
  );
}

export function ChatComposer({
  onSend,
  disabled = false,
  state = 'idle',
  onStop,
}: ChatComposerProps): JSX.Element {
  const [value, setValue] = useState<string>('');
  const [useWebSearch, setUseWebSearch] = useState<boolean>(false);
  const attachment = useAttachedSelectionStore((s) => s.attachedSelection);
  const clearAttachment = useAttachedSelectionStore((s) => s.clear);
  const pendingDraft = useComposerDraftStore((s) => s.draft);
  const clearDraft = useComposerDraftStore((s) => s.clearDraft);
  const focusToken = useComposerDraftStore((s) => s.focusToken);
  const modelId = useUserSettings().chat.model;
  const modelsQuery = useModelsQuery();
  const selectedModel = useMemo(() => {
    const list = modelsQuery.data ?? [];
    if (modelId === null) return null;
    return list.find((m) => m.id === modelId) ?? null;
  }, [modelsQuery.data, modelId]);
  const showWebSearchToggle = selectedModel !== null && selectedModel.supportsWebSearch === true;

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const isStreaming = state === 'streaming';

  // Auto-grow: reset to 'auto' so scrollHeight reflects current content,
  // then cap at MAX_TEXTAREA_HEIGHT_PX.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `value` is the trigger — every keystroke must re-measure scrollHeight, the body reads it via the ref
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (el === null) return;
    el.style.height = 'auto';
    el.style.height = `${String(Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT_PX))}px`;
  }, [value]);

  // [F41] When a pending draft is pushed via the composer-draft slice
  // (e.g. from `triggerAskAI`), prepend it to the current value and clear
  // the slice. If the textarea is empty, the draft becomes the value.
  useEffect(() => {
    if (pendingDraft === null) return;
    setValue((prev) => (prev.length === 0 ? pendingDraft : pendingDraft + prev));
    clearDraft();
  }, [pendingDraft, clearDraft]);

  // [F41] Focus the textarea whenever a focus request comes in. Skip the
  // initial render (token === 0) so mounting the composer doesn't steal
  // focus from elsewhere on the page.
  useEffect(() => {
    if (focusToken === 0) return;
    textareaRef.current?.focus();
  }, [focusToken]);

  const trimmed = value.trim();
  const isSendDisabled =
    disabled || isStreaming || (trimmed.length === 0 && attachment === null);

  function handleSend(): void {
    if (isSendDisabled) return;
    const args: SendArgs = {
      content: trimmed,
      attachment,
      enableWebSearch: useWebSearch,
    };
    void onSend(args);
    setValue('');
    clearAttachment();
    // [F50] Per-turn semantics: reset the toggle so the next message
    // does not inadvertently re-trigger web search.
    setUseWebSearch(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      if (isStreaming) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      handleSend();
      return;
    }
    if (e.key === 'Escape' && isStreaming && onStop) {
      e.preventDefault();
      onStop();
    }
  }

  function onChange(e: ChangeEvent<HTMLTextAreaElement>): void {
    setValue(e.target.value);
  }

  return (
    <div
      className="border-t border-line p-3 bg-bg flex flex-col gap-2"
      data-testid="chat-composer-root"
    >
      {attachment !== null ? (
        <div
          className="attachment-preview flex items-start gap-2 px-2 py-1.5 rounded-[var(--radius)] bg-bg-sunken border border-line"
          data-testid="composer-attachment"
        >
          <PaperclipIcon />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[.08em] font-mono text-ink-4">
              {`ATTACHED FROM CH. ${String(attachment.chapter.number)}`}
            </div>
            <blockquote className="font-serif italic text-[12.5px] text-ink-3 line-clamp-2">
              {attachment.text}
            </blockquote>
          </div>
          <button
            type="button"
            onClick={() => {
              clearAttachment();
            }}
            aria-label="Clear attachment"
            className="icon-btn flex-shrink-0 w-5 h-5"
          >
            <XIcon />
          </button>
        </div>
      ) : null}

      <textarea
        ref={textareaRef}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder="Send a message…"
        rows={1}
        disabled={isStreaming}
        className="resize-none bg-bg-sunken border border-line rounded-[var(--radius)] px-3 py-2 text-[13px] text-ink placeholder:text-ink-4 focus:outline-none focus:border-ink-3 disabled:opacity-60 max-h-[120px] min-h-[28px]"
        aria-label="Message"
      />

      <div className="flex items-center justify-between">
        <span className="text-[11px] font-mono text-ink-4">
          {isStreaming ? 'generating… ⎋ to stop' : '⌘↵ to send'}
        </span>
        {isStreaming ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop generation"
            className="px-3 py-1 rounded-[var(--radius)] bg-danger text-bg text-[12px] inline-flex items-center gap-1.5"
          >
            <StopIcon />
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={isSendDisabled}
            aria-label="Send"
            className="px-3 py-1 rounded-[var(--radius)] bg-ink text-bg text-[12px] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        )}
      </div>

      {showWebSearchToggle ? (
        <div className="flex items-center gap-2" data-testid="composer-web-search-toggle">
          <label
            htmlFor="chat-web-search"
            className="flex items-center gap-1.5 font-sans text-[11px] text-ink-3"
          >
            <input
              id="chat-web-search"
              type="checkbox"
              checked={useWebSearch}
              onChange={(e) => {
                setUseWebSearch(e.target.checked);
              }}
              aria-describedby="chat-web-search-hint"
              className="h-3.5 w-3.5"
            />
            <span>Web search</span>
          </label>
          <span id="chat-web-search-hint" className="font-sans text-[11px] text-ink-4">
            Web search — may increase response time + cost.
          </span>
        </div>
      ) : null}
    </div>
  );
}
```

Notes on what changed vs the current file:
- Deleted: `ChatComposerMode`, `MODE_TABS`, `mode` / `setMode` state, `modeTabClass` helper, `ArrowUpIcon`, the textarea-wrapper `<div className="flex items-end gap-2 …">` and its inline send button, the mode-tabs JSX block.
- Removed `mode` from `SendArgs`.
- Added `state` and `onStop` props with defaults.
- Replaced the textarea wrapper with a Scene-styled bare textarea.
- Pill button moved to the footer row; renders `Send` (idle) or `Stop` (streaming).
- New `StopIcon` helper (copied from SceneComposer).
- New keydown branch: `Escape` while streaming calls `onStop`.
- Container container: now `border-t border-line p-3 bg-bg` (matches Scene).
- Placeholder text: `"Send a message…"`.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm --prefix frontend test -- tests/components/ChatComposer.test.tsx
```

Expected: all tests pass — both the new tests added in Step 2 and the surviving pre-existing ones.

If a pre-existing attachment-preview or web-search test fails because it referenced the old `ArrowUpIcon` or used `mode` in its `SendArgs` assertions, fix those tests by updating the affected assertions to the new `SendArgs` shape (no `mode` field). Don't restore the dead code.

- [ ] **Step 6: Run full gates**

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run lint:design
npm --prefix frontend test
```

Expected: typecheck 0; lint:design clean; full frontend suite green. Note: ChatTab tests will fail or warn at this point because ChatTab still calls `<ChatComposer>` without `state`/`onStop` — that's fine, the props are optional with defaults. Task 4 wires them properly.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ChatComposer.tsx frontend/tests/components/ChatComposer.test.tsx
git commit -m "[chat-composer-bw2] restyle ChatComposer to match SceneComposer; add idle/streaming contract

Removes the dead Ask/Rewrite/Describe mode-tabs row and the inline
send-square. Adopts SceneComposer's container chrome (border-t,
bg-bg, sunken-paper textarea) and footer-pill button pattern. Adds
state and onStop props for the Stop affordance. Escape during
streaming calls onStop, mirroring Scene's '⎋ to stop' hint.

Keeps the three chat-specific affordances unchanged: auto-grow
textarea (28-120px), optional attachment preview block, optional
web-search toggle."
```

---

## Task 4: Wire `state` and `onStop` from `ChatTab` to `ChatComposer`

**Files:**
- Modify: `frontend/src/components/ChatTab.tsx` — derive `state` from `sendChatMessage.isPending`; pass `onStop={sendChatMessage.stop}`.
- Modify: `frontend/tests/components/ChatTab.test.tsx` — add a test that streaming-state composer renders the Stop button.

This is the final glue task. After Task 2 the hook exposes `stop()`; after Task 3 the composer accepts `state` and `onStop`. This task connects them.

- [ ] **Step 1: Read the current call site**

```bash
grep -n "ChatComposer\|sendChatMessage" frontend/src/components/ChatTab.tsx
```

Expected: line ~198 has `<ChatComposer onSend={onSend} disabled={sendChatMessage.isPending} />`.

- [ ] **Step 2: Update the failing test first**

Open `frontend/tests/components/ChatTab.test.tsx`. Inside the existing `describe('ChatTab — smoke', () => { … })` block, append:

```ts
  it('renders the Stop button while a chat send is in flight', async () => {
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/chapters/ch1/chats') && !url.includes('/messages')) {
        return jsonResponse(200, {
          chats: [
            {
              id: 'c1',
              chapterId: 'ch1',
              title: 'Existing chat',
              kind: 'ask',
              messageCount: 0,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        });
      }
      if (url.includes('/api/chats/c1/messages') && (input as Request | { method?: string })?.method === undefined) {
        return jsonResponse(200, { messages: [] });
      }
      return jsonResponse(404, { error: 'not_mocked' });
    }) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);

    // Make apiStream return a never-finishing SSE stream so isPending stays true.
    const neverEndingStream = new ReadableStream({ start(_c) { /* no-op */ } });
    vi.mocked(apiStream).mockResolvedValueOnce(
      new Response(neverEndingStream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<ChatTab chapterId="ch1" editor={null} />, makeClient());

    // Wait for the chat list to load + auto-select.
    await screen.findByRole('button', { name: /Chat: Existing chat/ });

    // Type and submit.
    const textarea = await screen.findByLabelText('Message');
    await user.type(textarea, 'hello world');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    // While the SSE never resolves, the composer should show Stop.
    const stopBtn = await screen.findByRole('button', { name: 'Stop generation' });
    expect(stopBtn).toBeInTheDocument();

    // Cleanup: abort the in-flight stream so the test doesn't leak.
    await user.click(stopBtn);
  });
```

The test depends on `apiStream` already being mocked at module scope in this file (it is — see the existing `vi.mock('@/lib/api', …)` near the top). If not, add the standard partial-mock:

```ts
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, apiStream: vi.fn(actual.apiStream) };
});
```

Also import `apiStream` from `@/lib/api` at the top of the test file if it isn't already:

```ts
import { apiStream } from '@/lib/api';
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npm --prefix frontend test -- tests/components/ChatTab.test.tsx
```

Expected: FAIL because `ChatComposer` is not in streaming state — `state` defaults to `'idle'`, so the Send button stays visible and `findByRole('button', { name: 'Stop generation' })` times out.

- [ ] **Step 4: Wire the props in `ChatTab.tsx`**

Open `frontend/src/components/ChatTab.tsx`. Find the `<ChatComposer>` JSX (around line 198) and change:

```diff
-        <ChatComposer onSend={onSend} disabled={sendChatMessage.isPending} />
+        <ChatComposer
+          onSend={onSend}
+          disabled={sendChatMessage.isPending}
+          state={sendChatMessage.isPending ? 'streaming' : 'idle'}
+          onStop={sendChatMessage.stop}
+        />
```

That's the only change to `ChatTab.tsx`.

- [ ] **Step 5: Run the test to verify it passes**

```bash
npm --prefix frontend test -- tests/components/ChatTab.test.tsx
```

Expected: all 5 ChatTab tests pass (the original 4 + the new streaming test).

- [ ] **Step 6: Run full gates**

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run lint:design
npm --prefix frontend test
```

Expected: typecheck 0; lint:design clean; full frontend suite green.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ChatTab.tsx frontend/tests/components/ChatTab.test.tsx
git commit -m "[chat-composer-bw2] wire Stop affordance from ChatTab to ChatComposer

Derives composer state from sendChatMessage.isPending and passes
sendChatMessage.stop as onStop. The Stop pill in the composer now
aborts the in-flight Venice response."
```

---

## Task 5: Add `ChatComposer.stories.tsx`

**Files:**
- Create: `frontend/src/components/ChatComposer.stories.tsx` — does not exist today; Storybook visual coverage of the new contract.

The plan defers richer Storybook scaffolding for later visual review; this task ships the four variants the spec requires so the `Chat/ChatComposer` namespace exists.

- [ ] **Step 1: Read the SceneComposer stories template**

```bash
cat frontend/src/components/SceneComposer.stories.tsx
```

Use it as the starting structure (`Meta<typeof …>`, decorators, two named stories). The chat composer stories need a richer setup because of the `useUserSettings` / `useModelsQuery` / `useAttachedSelectionStore` / `useComposerDraftStore` dependencies — see Step 2.

- [ ] **Step 2: Write the stories file**

Create `frontend/src/components/ChatComposer.stories.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { ChatComposer } from './ChatComposer';
import { type Model, modelsQueryKey } from '@/hooks/useModels';
import { DEFAULT_SETTINGS, userSettingsQueryKey, type UserSettings } from '@/hooks/useUserSettings';
import { useAttachedSelectionStore } from '@/store/attachedSelection';

const PLAIN_MODEL: Model = {
  id: 'qwen-3-6-plus',
  name: 'Qwen 3.6 Plus',
  contextLength: 32_000,
  defaultTemperature: 0.7,
  defaultTopP: 1,
  maxCompletionTokens: 4096,
  supportsWebSearch: false,
} as Model;

const WEB_SEARCH_MODEL: Model = { ...PLAIN_MODEL, id: 'venice-uncensored', supportsWebSearch: true };

function makeClient(model: Model): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData<UserSettings>(userSettingsQueryKey, {
    ...DEFAULT_SETTINGS,
    chat: { ...DEFAULT_SETTINGS.chat, model: model.id },
  });
  qc.setQueryData<Model[]>(modelsQueryKey, [model]);
  return qc;
}

const meta: Meta<typeof ChatComposer> = {
  title: 'Chat/ChatComposer',
  component: ChatComposer,
  args: { onSend: () => {}, onStop: () => {} },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeClient(PLAIN_MODEL)}>
        <div style={{ width: 360 }}>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof ChatComposer>;

export const Idle: Story = { args: { state: 'idle' } };

export const Streaming: Story = { args: { state: 'streaming' } };

export const IdleWithAttachment: Story = {
  args: { state: 'idle' },
  decorators: [
    (Story) => {
      // Seed the attached-selection store on mount; clear on unmount so other
      // stories don't inherit the attachment.
      useEffect(() => {
        useAttachedSelectionStore.getState().setAttachedSelection({
          chapter: { id: 'ch1', number: 4, title: 'The veranda' },
          text: 'Linda was already there with two glasses of something sweating onto the rail.',
        });
        return () => {
          useAttachedSelectionStore.getState().clear();
        };
      }, []);
      return <Story />;
    },
  ],
};

export const WebSearchToggleVisible: Story = {
  args: { state: 'idle' },
  decorators: [
    (Story) => (
      <QueryClientProvider client={makeClient(WEB_SEARCH_MODEL)}>
        <div style={{ width: 360 }}>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};
```

If the `Model` type, `modelsQueryKey`, or `useAttachedSelectionStore`'s `setAttachedSelection` action shape differs from what's shown, read the actual exports first and adjust the seed values to match. Don't fabricate fields — if a Model field doesn't exist, drop it from the seed object (the type assertion `as Model` covers any test-only narrowing).

The `IdleWithAttachment` story's nested decorator is correct: Storybook composes decorators outer-to-inner, so the `QueryClientProvider` from `meta.decorators` runs first and the `useEffect`-based attachment seeder runs inside it.

The `WebSearchToggleVisible` story re-wraps with its own `QueryClientProvider` to inject the web-search-supporting model. Storybook's default decorator merge will run BOTH the meta-level provider and this story's provider — that's a benign nesting (the inner provider takes precedence).

- [ ] **Step 3: Verify the stories build**

```bash
npm --prefix frontend run lint:design
npm --prefix frontend run typecheck
```

Expected: both exit 0. Stories are NOT exempt from `lint:design` — verify by checking `frontend/scripts/lint-design.mjs` if any token violation surfaces (none should; the composer uses only token classes).

If you want a sanity-check launch, run `npm --prefix frontend run storybook` and visit the four stories in the browser — but this is optional; the code paths are identical to the test paths and the test suite will catch any runtime errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ChatComposer.stories.tsx
git commit -m "[chat-composer-bw2] add ChatComposer Storybook (Idle, Streaming, IdleWithAttachment, WebSearchToggleVisible)"
```

---

## Task 6: Final guardrails + bd close + push

**Files:** none (verification only).

- [ ] **Step 1: Run all gates**

```bash
npm --prefix frontend run lint:design
npm --prefix frontend run typecheck
npm --prefix frontend test
```

Expected: each exits 0. Test count delta vs the starting baseline:
- Task 1: +0 (replaced one suggestion-chip test).
- Task 2: +1 (new `stop()` test).
- Task 3: +9 / -3 = net +6 (added idle/streaming/escape tests; deleted dead-UI tests).
- Task 4: +1 (streaming-state composer test in ChatTab).
- Task 5: +0 (Storybook doesn't add to the vitest run).

Total delta: roughly +8 tests vs Pre-flight Step 0's count.

- [ ] **Step 2: Manual spot-check (optional but recommended)**

```bash
make dev
```

Browse to `http://localhost:3000`, sign in, open a story / chapter, click the Chat tab. Verify:

1. The composer chrome matches the Scene composer side-by-side (open the Scene tab and the Chat tab — visual check).
2. Empty Chat session: the empty state shows just "Start a conversation" with NO Rewrite / Describe / Expand buttons.
3. Type a long-running prompt (something that triggers a multi-second Venice response). While the response streams: the textarea is dimmed, the pill on the right reads "Stop" in danger color, the footer hint reads `generating… ⎋ to stop`.
4. Click Stop. The stream halts within a beat; the user can immediately type a new message and resend.
5. Press Escape while streaming. Same effect as clicking Stop.
6. Repeat across paper / sepia / dark themes (Settings → Appearance).

If anything misbehaves, capture it in `bd create` and stop. Do not patch in `make dev`.

```bash
make stop
```

- [ ] **Step 3: Close bd issues**

The `story-editor-bw2` close goes through the `/bd-close-reviewed` gate (the new CLAUDE.md flow):

```bash
/bd-close-reviewed story-editor-bw2
```

That runs typecheck on affected workspaces, executes the `verify:` line, fans path-matched surface reviewers (none are wired to ChatComposer / ChatMessages / useChat — these aren't auth/session/encryption/repo-boundary surface, so no reviewer should fire), and refuses close on `BLOCK` / `FIX_BEFORE_MERGE`.

For `story-editor-274`, since the work landed in Task 1 of this same PR, close it with a closure-reason note:

```bash
bd close story-editor-274 --reason="Folded into story-editor-bw2; landed in Task 1 of feature/chat-composer-bw2."
```

(The plain `bd close` is acceptable here per the new flow's "skip /bd-execute" carve-out: this is a same-PR scope-fold, not a separate work item.)

- [ ] **Step 4: Push**

```bash
git pull --rebase
git push
git status   # MUST show "up to date with origin"
```

If the push reports a divergence with origin, resolve with rebase. Don't force-push. The PR base will be `feature/chat-session-picker` (the chat-picker work needs to merge first, then bw2 can rebase onto main).

---

## Self-Review

- **Spec coverage.** Each section/requirement from `docs/superpowers/specs/2026-05-08-chat-composer-alignment-design.md` maps to a task:
  - "Remove dead Mode tabs row" — Task 3.
  - "`mode` field on `SendArgs` removed" — Task 3.
  - "Inline send-square + `ArrowUpIcon` removed" — Task 3.
  - "Container restyle (border-t, bg-bg, sunken textarea, footer pill)" — Task 3.
  - "`state` / `onStop` props" — Task 3 (composer side) + Task 4 (orchestrator wiring).
  - "Escape-to-stop" — Task 3.
  - "`useSendChatMessageMutation` AbortController + `stop()`" — Task 2.
  - "ChatTab passes `state` + `onStop`" — Task 4.
  - "ChatMessages: remove `SuggestionKind`, `SUGGESTION_DEFS`, three icons, `onPickSuggestion`, suggestion-chip JSX" — Task 1.
  - "Storybook variants (Idle, IdleWithAttachment, Streaming, WebSearchToggleVisible)" — Task 5.
  - All test updates listed in the spec — covered across Tasks 1, 2, 3, 4.

- **Placeholder scan.** No `TBD`, no `add validation`, no `similar to Task N`. Every code step has the actual code. Test snippets are complete (the helper-import / wrapper / decorator references are precise enough that a fresh implementer can resolve them by reading the existing test file's imports).

- **Type consistency.** `SendArgs` after Task 3 has fields `{ content, attachment, enableWebSearch }` — no `mode`. That shape is referenced consistently in Task 3's "Send button click" test, in the `SendArgs` interface definition, and in `handleSend`. The `ChatComposer` props after Task 3 are `{ onSend, disabled?, state?, onStop? }` — the same shape Task 4 passes from `ChatTab`. The `useSendChatMessageMutation` return type after Task 2 is `UseMutationResult<...> & { stop: () => void }` — matched by Task 4's `sendChatMessage.stop` access. No drift.

- **Test test-and-implement ordering.** Each task writes the failing test first, runs it, then implements. The two exceptions are Task 1 Step 2 (TDD pattern: replace the test that asserted the chips work with one that asserts the chips don't exist; the new test fails until the chips are removed) and Task 5 (Storybook stories — no automated test, only the lint:design + typecheck gate; flagged as such).
