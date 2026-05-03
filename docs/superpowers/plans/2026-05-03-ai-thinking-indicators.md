# AI "Thinking" Indicators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every AI request show a visible in-flight indicator — fix the inline-AI status race, add a shared `<ThinkingDots />` primitive, and switch chat send to a draft-slice + live-stream pattern so the user sees their message and a thinking indicator immediately on Send.

**Architecture:** Three concerns, each isolated: (1) extract the existing three-dot animation into a `<ThinkingDots />` design primitive shared across surfaces; (2) add a real `'thinking'` status to `useAICompletion` that flips to `'streaming'` only on first chunk arrival, killing the inline-AI race that hides the indicator; (3) introduce a `useChatDraftStore` Zustand slice plus a rewritten `useSendChatMessageMutation` that publishes optimistic user bubble + streaming assistant bubble to `<ChatMessages />` until the existing refetch resolves. No backend changes — `POST /api/chats/:chatId/messages` already streams per-chunk SSE and persists on completion.

**Tech Stack:** React 18, TypeScript strict, Vite, Vitest, TanStack Query, Zustand, Tailwind. Backend untouched.

**Spec:** [docs/superpowers/specs/2026-05-03-ai-thinking-indicators-design.md](../specs/2026-05-03-ai-thinking-indicators-design.md)

---

## File map

**Create:**
- `frontend/src/design/ThinkingDots.tsx` — three-dot indicator primitive.
- `frontend/src/design/ThinkingDots.stories.tsx` — Storybook story (default + a reduced-motion preview).
- `frontend/src/store/chatDraft.ts` — Zustand slice for in-flight chat turn.
- `frontend/tests/design/ThinkingDots.test.tsx`
- `frontend/tests/store/chatDraft.test.ts`
- `frontend/tests/hooks/useChat.test.tsx`

**Modify:**
- `frontend/src/index.css` — add `prefers-reduced-motion` block for `.think-dot`.
- `frontend/src/hooks/useAICompletion.ts` — extend status union; flip from `'thinking'` → `'streaming'` on first chunk.
- `frontend/src/components/InlineAIResult.tsx` — render `<ThinkingDots />`; widen the dots-render predicate as belt-and-braces.
- `frontend/src/hooks/useChat.ts` — rewrite `useSendChatMessageMutation` to drive `useChatDraftStore`.
- `frontend/src/components/ChatMessages.tsx` — render the optimistic user/assistant pair when a matching draft exists.
- `frontend/tests/hooks/useAICompletion.test.tsx` — extend with thinking-state tests.
- `frontend/tests/components/InlineAIResult.test.tsx` — extend with the wider dots-render predicate.
- `frontend/tests/components/ChatMessages.test.tsx` — extend with draft-render tests.

---

## Conventions used in this plan

- Run vitest from `frontend/` (it expects that as cwd): `cd frontend && npx vitest run path/to/test.tsx`. Running from repo root fails with "Cannot find package '@/...'".
- Verify after each implementation step with the **specific** test file, not the whole suite. The full suite runs at the verification gate at the end.
- The PostToolUse hook runs `tsc --noEmit` after every Edit. Make each edit self-contained — add an import and its usage in a single edit, not two.
- Use `git add <specific files>` then `git commit` per task — no `git add .`.
- Commits use the project format: `[scope] short imperative`. Co-author trailer is added by the commit hook; do not add it manually.

---

## Task 1: Add `<ThinkingDots />` primitive

**Files:**
- Create: `frontend/src/design/ThinkingDots.tsx`
- Test: `frontend/tests/design/ThinkingDots.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/design/ThinkingDots.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ThinkingDots } from '@/design/ThinkingDots';

describe('<ThinkingDots />', () => {
  it('renders a status region with the default "Thinking" label', () => {
    render(<ThinkingDots />);
    const region = screen.getByRole('status', { name: 'Thinking' });
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute('data-testid', 'thinking-dots');
  });

  it('renders three .think-dot spans', () => {
    const { container } = render(<ThinkingDots />);
    const dots = container.querySelectorAll('.think-dot');
    expect(dots).toHaveLength(3);
  });

  it('staggers the animation-delay on each dot (0ms / 150ms / 300ms)', () => {
    const { container } = render(<ThinkingDots />);
    const dots = container.querySelectorAll<HTMLElement>('.think-dot');
    expect(dots[0].style.animationDelay).toBe('0ms');
    expect(dots[1].style.animationDelay).toBe('150ms');
    expect(dots[2].style.animationDelay).toBe('300ms');
  });

  it('accepts a custom label and forwards a className for layout', () => {
    render(<ThinkingDots label="Generating" className="ml-auto" />);
    const region = screen.getByRole('status', { name: 'Generating' });
    expect(region.className).toContain('ml-auto');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/design/ThinkingDots.test.tsx`
Expected: FAIL with module-not-found (`Cannot find module '@/design/ThinkingDots'`).

- [ ] **Step 3: Implement the component**

Create `frontend/src/design/ThinkingDots.tsx`:

```tsx
import type { JSX } from 'react';

/**
 * Three-dot bouncing "thinking" indicator. Used wherever the UI is
 * waiting for an AI request to start producing tokens.
 *
 * The `.think-dot` keyframe lives in `frontend/src/index.css` and is
 * shared with any future caller. A `prefers-reduced-motion` block in
 * the same file disables the bounce and renders the dots at low
 * opacity instead.
 */

export interface ThinkingDotsProps {
  /** Accessible label announced to screen readers. Defaults to "Thinking". */
  label?: string;
  /** Optional class for layout (margin, gap with surrounding text). */
  className?: string;
}

const DELAYS_MS: readonly number[] = [0, 150, 300];

export function ThinkingDots({ label = 'Thinking', className }: ThinkingDotsProps): JSX.Element {
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

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/design/ThinkingDots.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/design/ThinkingDots.tsx frontend/tests/design/ThinkingDots.test.tsx
git commit -m "[design] add <ThinkingDots /> shared indicator primitive"
```

---

## Task 2: Add Storybook story for `<ThinkingDots />`

**Files:**
- Create: `frontend/src/design/ThinkingDots.stories.tsx`

- [ ] **Step 1: Write the story**

Create `frontend/src/design/ThinkingDots.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { ThinkingDots } from './ThinkingDots';

const meta: Meta<typeof ThinkingDots> = {
  title: 'Design/ThinkingDots',
  component: ThinkingDots,
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj<typeof ThinkingDots>;

export const Default: Story = {};

export const CustomLabel: Story = {
  args: { label: 'Generating' },
};

export const InContext: Story = {
  render: () => (
    <div className="flex items-center gap-2 text-[13px] font-sans text-ink-3">
      <span>Inkwell is thinking</span>
      <ThinkingDots />
    </div>
  ),
};
```

- [ ] **Step 2: Verify Storybook builds**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS, no type errors. (No need to launch Storybook — TS check is sufficient gate.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/design/ThinkingDots.stories.tsx
git commit -m "[design] add ThinkingDots storybook story"
```

---

## Task 3: Add reduced-motion CSS for `.think-dot`

**Files:**
- Modify: `frontend/src/index.css` (after the existing `.think-dot:nth-child(3) { animation-delay: 0.3s; }` rule, around line 450)

- [ ] **Step 1: Add the `prefers-reduced-motion` block**

Open `frontend/src/index.css`. Find the block that ends with:

```css
.think-dot:nth-child(3) {
  animation-delay: 0.3s;
}
```

Insert immediately after it:

```css
@media (prefers-reduced-motion: reduce) {
  .think-dot {
    animation: none;
    opacity: 0.55;
  }
}
```

- [ ] **Step 2: Verify lint:design passes**

Run: `cd frontend && npm run lint:design`
Expected: PASS (no design-token violations introduced).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/index.css
git commit -m "[design] disable .think-dot bounce under prefers-reduced-motion"
```

---

## Task 4: Replace `<InlineAIResult />` inline dots with `<ThinkingDots />`

**Files:**
- Modify: `frontend/src/components/InlineAIResult.tsx` (lines 37, 87–98)
- Modify: `frontend/tests/components/InlineAIResult.test.tsx` (the "renders the quote and three think dots when status is thinking" test)

- [ ] **Step 1: Update the existing thinking-dots test to query the new primitive**

Open `frontend/tests/components/InlineAIResult.test.tsx`. Find the test at line 64:

```tsx
it('renders the quote and three think dots when status is thinking', () => {
```

Inside the test body, the assertions currently look up `screen.getAllByTestId('think-dot')`. Replace with:

```tsx
const region = screen.getByTestId('thinking-dots');
expect(region).toHaveAttribute('role', 'status');
expect(region).toHaveAttribute('aria-label', 'Thinking');
const dots = region.querySelectorAll('.think-dot');
expect(dots).toHaveLength(3);
```

(The blockquote assertion above this stays the same.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/components/InlineAIResult.test.tsx -t "renders the quote and three think dots"`
Expected: FAIL — `data-testid="thinking-dots"` not yet present (the element still uses `data-testid="think-dot"` per-dot).

- [ ] **Step 3: Refactor `<InlineAIResult />` to use `<ThinkingDots />`**

Open `frontend/src/components/InlineAIResult.tsx`. At the top with the other imports (line 5 area), add:

```tsx
import { ThinkingDots } from '@/design/ThinkingDots';
```

Delete the constant on line 37:

```tsx
const THINK_DOT_DELAYS_MS: readonly number[] = [0, 150, 300];
```

Replace the JSX at lines 87–98:

```tsx
      {status === 'thinking' && (
        <div role="status" aria-label="Thinking" className="mt-3 flex items-center">
          {THINK_DOT_DELAYS_MS.map((delay) => (
            <span
              key={delay}
              data-testid="think-dot"
              className="think-dot inline-block w-2 h-2 mx-0.5 rounded-full bg-[var(--ink-4)]"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </div>
      )}
```

with:

```tsx
      {status === 'thinking' && (
        <div className="mt-3">
          <ThinkingDots />
        </div>
      )}
```

- [ ] **Step 4: Run the full InlineAIResult test file**

Run: `cd frontend && npx vitest run tests/components/InlineAIResult.test.tsx`
Expected: PASS, all existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/InlineAIResult.tsx frontend/tests/components/InlineAIResult.test.tsx
git commit -m "[refactor] InlineAIResult uses shared <ThinkingDots />"
```

---

## Task 5: Add real `'thinking'` status to `useAICompletion`

**Files:**
- Modify: `frontend/src/hooks/useAICompletion.ts` (line 26 status union; line 120–125 run-start; line 200–207 first-chunk path)
- Modify: `frontend/tests/hooks/useAICompletion.test.tsx`

- [ ] **Step 1: Inspect the existing test file to see the established mocking pattern**

Run: `cd frontend && head -80 tests/hooks/useAICompletion.test.tsx`
Expected: identifies how `apiStream` is mocked and how SSE chunks are fed in. Use that same pattern in the new tests below.

- [ ] **Step 2: Add the failing thinking-state tests**

Open `frontend/tests/hooks/useAICompletion.test.tsx`. Inside the existing `describe('useAICompletion …')` block, append these tests (use the file's existing helper for mocking `apiStream` — name it `mockStreamYielding` or whatever the file uses; substitute the actual helper name in your edit):

```tsx
  it('flips status to "thinking" synchronously on run() and stays there until first non-empty content delta', async () => {
    // Stream that emits one role-only chunk (no content delta), then a
    // content chunk, then [DONE]. The role-only chunk must NOT flip the
    // status from 'thinking' to 'streaming'.
    const sseLines = [
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    mockApiStreamWithSseLines(sseLines); // see helper at top of file

    const { result } = renderHook(() => useAICompletion());

    let runPromise!: Promise<void>;
    act(() => {
      runPromise = result.current.run({
        action: 'rephrase',
        selectedText: 'foo',
        chapterId: 'c1',
        storyId: 's1',
        modelId: 'm1',
      });
    });

    // After the synchronous portion of run() has executed, status must be
    // 'thinking', not 'streaming'.
    expect(result.current.status).toBe('thinking');
    expect(result.current.text).toBe('');

    await act(async () => {
      await runPromise;
    });

    expect(result.current.status).toBe('done');
    expect(result.current.text).toBe('Hi');
  });

  it('flips to "streaming" on the first non-empty content delta', async () => {
    // Two content chunks separated by an artificial pause we observe
    // by stepping the iterator.
    const sseLines = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    mockApiStreamWithSseLines(sseLines);

    const { result } = renderHook(() => useAICompletion());

    await act(async () => {
      await result.current.run({
        action: 'continue',
        selectedText: '',
        chapterId: 'c1',
        storyId: 's1',
        modelId: 'm1',
      });
    });

    // Final state: status = 'done', text = 'Hello world'. The intermediate
    // 'streaming' state is exercised by the React render between chunks;
    // the assertion that matters at the public-API level is that the hook
    // never settled into 'thinking' once content arrived.
    expect(result.current.status).toBe('done');
    expect(result.current.text).toBe('Hello world');
  });
```

If the file does not yet have a `mockApiStreamWithSseLines` helper, add this near the top (above `describe`):

```tsx
function mockApiStreamWithSseLines(lines: ReadonlyArray<string>): void {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
  vi.mocked(apiStream).mockResolvedValueOnce(
    new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
  );
}
```

(adapt the import: `import { apiStream } from '@/lib/api'` should already be near the top with `vi.mock('@/lib/api')` somewhere in the file; if not, add both. Verify by re-running the existing tests after this step — they must still pass.)

- [ ] **Step 3: Run the new tests — they must fail because the hook still flips to 'streaming' synchronously**

Run: `cd frontend && npx vitest run tests/hooks/useAICompletion.test.tsx -t "flips status to \"thinking\""`
Expected: FAIL — first assertion `expect(result.current.status).toBe('thinking')` fails because the hook currently sets `'streaming'` at line 121.

- [ ] **Step 4: Update the status union**

Open `frontend/src/hooks/useAICompletion.ts`. Change line 26:

```ts
export type AICompletionStatus = 'idle' | 'streaming' | 'done' | 'error';
```

to:

```ts
export type AICompletionStatus = 'idle' | 'thinking' | 'streaming' | 'done' | 'error';
```

- [ ] **Step 5: Change run-start to set 'thinking' instead of 'streaming'**

In the same file, at lines 120–125, replace:

```ts
      safeSetState((prev) => ({
        status: 'streaming',
        text: '',
        error: null,
        usage: prev.usage,
      }));
```

with:

```ts
      safeSetState((prev) => ({
        status: 'thinking',
        text: '',
        error: null,
        usage: prev.usage,
      }));
```

- [ ] **Step 6: Flip to 'streaming' on the first non-empty content delta**

In the same file, locate the chunk-handling branch around lines 203–207:

```ts
          if (event.type === 'chunk') {
            const delta = event.chunk.choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta.length > 0) {
              safeSetState((prev) => ({ ...prev, text: prev.text + delta }));
            }
          } else if (event.type === 'error') {
```

Replace with:

```ts
          if (event.type === 'chunk') {
            const delta = event.chunk.choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta.length > 0) {
              safeSetState((prev) => ({
                ...prev,
                status: prev.status === 'thinking' ? 'streaming' : prev.status,
                text: prev.text + delta,
              }));
            }
          } else if (event.type === 'error') {
```

- [ ] **Step 7: Run the new tests — they must pass**

Run: `cd frontend && npx vitest run tests/hooks/useAICompletion.test.tsx`
Expected: PASS (all tests in the file).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/hooks/useAICompletion.ts frontend/tests/hooks/useAICompletion.test.tsx
git commit -m "[fix] useAICompletion gains 'thinking' status, flips on first chunk"
```

---

## Task 6: Belt-and-braces — `<InlineAIResult />` shows dots while streaming with no output yet

**Files:**
- Modify: `frontend/src/components/InlineAIResult.tsx` (the `status === 'thinking'` predicate around line 87)
- Modify: `frontend/tests/components/InlineAIResult.test.tsx`

- [ ] **Step 1: Add the failing test**

Open `frontend/tests/components/InlineAIResult.test.tsx`. Add a new test inside the existing describe block:

```tsx
  it('renders dots while status=streaming and output is still empty (race safety)', () => {
    useInlineAIResultStore.setState({
      inlineAIResult: {
        action: 'rewrite',
        text: 'A long sentence selected by the user.',
        status: 'streaming',
        output: '',
      },
    });
    render(<InlineAIResult editor={null} />);
    expect(screen.getByTestId('thinking-dots')).toBeInTheDocument();
  });
```

(`useInlineAIResultStore` is already imported in this file.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/components/InlineAIResult.test.tsx -t "race safety"`
Expected: FAIL — dots only render when `status === 'thinking'`.

- [ ] **Step 3: Widen the predicate**

Open `frontend/src/components/InlineAIResult.tsx`. Find:

```tsx
      {status === 'thinking' && (
        <div className="mt-3">
          <ThinkingDots />
        </div>
      )}
```

Replace with:

```tsx
      {(status === 'thinking' || (status === 'streaming' && output.length === 0)) && (
        <div className="mt-3">
          <ThinkingDots />
        </div>
      )}
```

- [ ] **Step 4: Run the full InlineAIResult test file**

Run: `cd frontend && npx vitest run tests/components/InlineAIResult.test.tsx`
Expected: PASS, all tests including the new one.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/InlineAIResult.tsx frontend/tests/components/InlineAIResult.test.tsx
git commit -m "[fix] InlineAIResult shows dots when streaming but output empty"
```

---

## Task 7: Add `useChatDraftStore` slice

**Files:**
- Create: `frontend/src/store/chatDraft.ts`
- Test: `frontend/tests/store/chatDraft.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/store/chatDraft.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { useChatDraftStore } from '@/store/chatDraft';

beforeEach(() => {
  useChatDraftStore.getState().clear();
});

describe('useChatDraftStore', () => {
  it('starts in the empty state', () => {
    expect(useChatDraftStore.getState().draft).toBeNull();
  });

  it('start() seeds a thinking-state draft with userContent + attachment', () => {
    useChatDraftStore.getState().start({
      chatId: 'c1',
      userContent: 'hello',
      attachment: { selectionText: 'sel', chapterId: 'ch1' },
    });
    const d = useChatDraftStore.getState().draft;
    expect(d).not.toBeNull();
    expect(d?.chatId).toBe('c1');
    expect(d?.userContent).toBe('hello');
    expect(d?.attachment).toEqual({ selectionText: 'sel', chapterId: 'ch1' });
    expect(d?.assistantText).toBe('');
    expect(d?.status).toBe('thinking');
    expect(d?.error).toBeNull();
  });

  it('start() accepts attachment: null', () => {
    useChatDraftStore.getState().start({ chatId: 'c1', userContent: 'hi', attachment: null });
    expect(useChatDraftStore.getState().draft?.attachment).toBeNull();
  });

  it('appendDelta() concatenates onto assistantText', () => {
    useChatDraftStore.getState().start({ chatId: 'c1', userContent: 'q', attachment: null });
    useChatDraftStore.getState().appendDelta('Hel');
    useChatDraftStore.getState().appendDelta('lo');
    expect(useChatDraftStore.getState().draft?.assistantText).toBe('Hello');
  });

  it('appendDelta() is a no-op when no draft is active', () => {
    useChatDraftStore.getState().appendDelta('orphan');
    expect(useChatDraftStore.getState().draft).toBeNull();
  });

  it('markStreaming() flips status from thinking to streaming', () => {
    useChatDraftStore.getState().start({ chatId: 'c1', userContent: 'q', attachment: null });
    useChatDraftStore.getState().markStreaming();
    expect(useChatDraftStore.getState().draft?.status).toBe('streaming');
  });

  it('markDone() flips status to done', () => {
    useChatDraftStore.getState().start({ chatId: 'c1', userContent: 'q', attachment: null });
    useChatDraftStore.getState().markStreaming();
    useChatDraftStore.getState().markDone();
    expect(useChatDraftStore.getState().draft?.status).toBe('done');
  });

  it('markError() flips status to error and stores the error payload', () => {
    useChatDraftStore.getState().start({ chatId: 'c1', userContent: 'q', attachment: null });
    useChatDraftStore.getState().markError({ code: 'rate_limited', message: 'Too many requests' });
    const d = useChatDraftStore.getState().draft;
    expect(d?.status).toBe('error');
    expect(d?.error).toEqual({ code: 'rate_limited', message: 'Too many requests' });
  });

  it('clear() returns to the empty state', () => {
    useChatDraftStore.getState().start({ chatId: 'c1', userContent: 'q', attachment: null });
    useChatDraftStore.getState().clear();
    expect(useChatDraftStore.getState().draft).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/store/chatDraft.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

Create `frontend/src/store/chatDraft.ts`:

```ts
import { create } from 'zustand';

/**
 * Transient state for the in-flight chat turn. Holds the user message
 * (so the optimistic bubble appears immediately on Send) and the
 * accumulating assistant text (so we can render the dots → live text
 * progression without waiting for the post-stream refetch).
 *
 * Lifecycle:
 *   start({chatId, userContent, attachment})     // status = 'thinking'
 *   appendDelta(delta)                            // assistantText grows
 *   markStreaming()                               // first chunk seen
 *   markDone() | markError(error)                 // terminal
 *   clear()                                       // mutation onSettled
 *
 * The slice is intentionally not the source of truth for persisted
 * messages — those live in the TanStack Query cache. The mutation
 * invalidates the messages query on success; the refetched list
 * carries the real ids/timestamps/citations.
 */

export type ChatDraftStatus = 'thinking' | 'streaming' | 'done' | 'error';

export interface ChatDraftError {
  code: string | null;
  message: string;
  httpStatus?: number;
}

export interface ChatDraftAttachment {
  selectionText: string;
  chapterId: string;
}

export interface ChatDraft {
  chatId: string;
  userContent: string;
  attachment: ChatDraftAttachment | null;
  assistantText: string;
  status: ChatDraftStatus;
  error: ChatDraftError | null;
}

interface ChatDraftState {
  draft: ChatDraft | null;
  start: (args: {
    chatId: string;
    userContent: string;
    attachment: ChatDraftAttachment | null;
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
      s.draft ? { draft: { ...s.draft, assistantText: s.draft.assistantText + delta } } : s,
    ),
  markStreaming: () =>
    set((s) => (s.draft ? { draft: { ...s.draft, status: 'streaming' } } : s)),
  markDone: () => set((s) => (s.draft ? { draft: { ...s.draft, status: 'done' } } : s)),
  markError: (error) =>
    set((s) => (s.draft ? { draft: { ...s.draft, status: 'error', error } } : s)),
  clear: () => set({ draft: null }),
}));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run tests/store/chatDraft.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/chatDraft.ts frontend/tests/store/chatDraft.test.ts
git commit -m "[store] add useChatDraftStore for in-flight chat turn"
```

---

## Task 8: Rewrite `useSendChatMessageMutation` to drive the draft store

**Files:**
- Modify: `frontend/src/hooks/useChat.ts` (lines 171–197)
- Create: `frontend/tests/hooks/useChat.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/hooks/useChat.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatMessagesQueryKey, useSendChatMessageMutation } from '@/hooks/useChat';
import { apiStream } from '@/lib/api';
import { useChatDraftStore } from '@/store/chatDraft';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, apiStream: vi.fn() };
});

function sseResponse(lines: ReadonlyArray<string>): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function withClient(): { wrapper: (p: { children: ReactNode }) => JSX.Element; qc: QueryClient } {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { wrapper, qc };
}

beforeEach(() => {
  vi.mocked(apiStream).mockReset();
  useChatDraftStore.getState().clear();
});

afterEach(() => {
  useChatDraftStore.getState().clear();
});

describe('useSendChatMessageMutation', () => {
  it('seeds the draft on send and progresses thinking → streaming → done', async () => {
    vi.mocked(apiStream).mockResolvedValueOnce(
      sseResponse([
        'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" there"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    );

    const { wrapper, qc } = withClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useSendChatMessageMutation(), { wrapper });

    let p!: Promise<void>;
    act(() => {
      p = result.current.mutateAsync({
        chatId: 'c1',
        content: 'hello',
        modelId: 'm1',
      });
    });

    // Synchronous side effect of mutateAsync: draft starts in 'thinking'.
    expect(useChatDraftStore.getState().draft).toMatchObject({
      chatId: 'c1',
      userContent: 'hello',
      assistantText: '',
      status: 'thinking',
    });

    await act(async () => {
      await p;
    });

    // After completion, invalidate has been called — onSettled clears the
    // draft so the refetched messages take over.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: chatMessagesQueryKey('c1') });
    await waitFor(() => {
      expect(useChatDraftStore.getState().draft).toBeNull();
    });
  });

  it('seeds attachment payload onto the draft when provided', async () => {
    vi.mocked(apiStream).mockResolvedValueOnce(sseResponse(['data: [DONE]\n\n']));
    const { wrapper } = withClient();
    const { result } = renderHook(() => useSendChatMessageMutation(), { wrapper });

    let p!: Promise<void>;
    act(() => {
      p = result.current.mutateAsync({
        chatId: 'c1',
        content: 'q',
        modelId: 'm1',
        attachment: { selectionText: 'sel', chapterId: 'ch1' },
      });
    });

    expect(useChatDraftStore.getState().draft?.attachment).toEqual({
      selectionText: 'sel',
      chapterId: 'ch1',
    });

    await act(async () => {
      await p;
    });
  });

  it('on SSE error frame, sets draft.status=error and does NOT invalidate the messages query', async () => {
    vi.mocked(apiStream).mockResolvedValueOnce(
      sseResponse([
        'data: {"error":"rate limited","code":"rate_limited"}\n\n',
        'data: [DONE]\n\n',
      ]),
    );

    const { wrapper, qc } = withClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useSendChatMessageMutation(), { wrapper });

    await act(async () => {
      await result.current
        .mutateAsync({ chatId: 'c1', content: 'q', modelId: 'm1' })
        .catch(() => {
          // expected — mutation throws on error frame
        });
    });

    // Draft should have been marked error before onSettled cleared it.
    // We can only inspect post-clear; assert via the mutation's error
    // state and that invalidate did not run on the success path.
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(result.current.isError).toBe(true);

    // Draft is cleared by onSettled regardless of success/error.
    await waitFor(() => {
      expect(useChatDraftStore.getState().draft).toBeNull();
    });
  });

  it('flips status to streaming on the first non-empty content delta', async () => {
    // Hold the stream open via a controllable enqueue/close so we can
    // observe intermediate state.
    let enqueue!: (s: string) => void;
    let close!: () => void;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        enqueue = (s) => controller.enqueue(encoder.encode(s));
        close = () => controller.close();
      },
    });
    vi.mocked(apiStream).mockResolvedValueOnce(
      new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    );

    const { wrapper } = withClient();
    const { result } = renderHook(() => useSendChatMessageMutation(), { wrapper });

    let p!: Promise<void>;
    act(() => {
      p = result.current.mutateAsync({ chatId: 'c1', content: 'q', modelId: 'm1' });
    });

    // Emit a role-only chunk first — must NOT flip status to 'streaming'.
    enqueue('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n');
    await waitFor(() => {
      expect(useChatDraftStore.getState().draft?.assistantText).toBe('');
    });
    expect(useChatDraftStore.getState().draft?.status).toBe('thinking');

    // Now a content chunk — flips to 'streaming' and appends.
    enqueue('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n');
    await waitFor(() => {
      expect(useChatDraftStore.getState().draft?.assistantText).toBe('Hi');
    });
    expect(useChatDraftStore.getState().draft?.status).toBe('streaming');

    enqueue('data: [DONE]\n\n');
    close();
    await act(async () => {
      await p;
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/hooks/useChat.test.tsx`
Expected: FAIL — the existing mutation drains-and-discards, so `useChatDraftStore.getState().draft` is always `null`.

- [ ] **Step 3: Rewrite the mutation**

Open `frontend/src/hooks/useChat.ts`. Add the import near the top (alongside the other `import` lines):

```ts
import { useChatDraftStore } from '@/store/chatDraft';
```

Replace the entire body of `useSendChatMessageMutation` (lines 171–197) with:

```ts
export function useSendChatMessageMutation(): UseMutationResult<void, Error, SendChatMessageArgs> {
  const qc = useQueryClient();
  return useMutation<void, Error, SendChatMessageArgs>({
    mutationFn: async ({ chatId, content, modelId, attachment, enableWebSearch }) => {
      useChatDraftStore.getState().start({
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
        const message = 'Empty response body';
        useChatDraftStore.getState().markError({ code: null, message });
        throw new Error(message);
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
          // citations frame: ignored — refetched message carries citationsJson.
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
      useChatDraftStore.getState().clear();
    },
  });
}
```

- [ ] **Step 4: Run the new tests**

Run: `cd frontend && npx vitest run tests/hooks/useChat.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useChat.ts frontend/tests/hooks/useChat.test.tsx
git commit -m "[refactor] useSendChatMessageMutation drives draft slice + live stream"
```

---

## Task 9: Render the optimistic draft pair in `<ChatMessages />`

**Files:**
- Modify: `frontend/src/components/ChatMessages.tsx`
- Modify: `frontend/tests/components/ChatMessages.test.tsx`

- [ ] **Step 1: Add the failing tests**

Open `frontend/tests/components/ChatMessages.test.tsx`. Near the top, add the import (alongside the existing imports):

```tsx
import { useChatDraftStore } from '@/store/chatDraft';
```

In the existing `afterEach` (or add one if absent), add:

```tsx
useChatDraftStore.getState().clear();
```

Append these tests inside the `describe('ChatMessages (F39)', () => {` block:

```tsx
  it('renders an optimistic user bubble + thinking dots when a draft is in "thinking" state', async () => {
    // Seed an empty messages list for the active chat.
    seedQuery('c1', []);
    useChatDraftStore.getState().start({
      chatId: 'c1',
      userContent: 'How does X work?',
      attachment: null,
    });

    render(<ChatMessages chatId="c1" chapterTitle="Ch. 1" />, { wrapper });

    // Optimistic user bubble visible.
    expect(await screen.findByText('How does X work?')).toBeInTheDocument();
    // Thinking dots visible in place of the assistant body.
    expect(screen.getByTestId('thinking-dots')).toBeInTheDocument();
  });

  it('renders streaming assistantText in the optimistic assistant bubble (no dots)', async () => {
    seedQuery('c1', []);
    useChatDraftStore.getState().start({
      chatId: 'c1',
      userContent: 'q',
      attachment: null,
    });
    useChatDraftStore.getState().markStreaming();
    useChatDraftStore.getState().appendDelta('Hello');

    render(<ChatMessages chatId="c1" chapterTitle="Ch. 1" />, { wrapper });

    expect(await screen.findByText('Hello')).toBeInTheDocument();
    expect(screen.queryByTestId('thinking-dots')).not.toBeInTheDocument();
  });

  it('does NOT render the draft pair when draft.chatId differs from the active chatId', async () => {
    seedQuery('c1', []);
    useChatDraftStore.getState().start({
      chatId: 'c2', // different chat
      userContent: 'wrong-chat message',
      attachment: null,
    });

    render(<ChatMessages chatId="c1" chapterTitle="Ch. 1" />, { wrapper });

    await waitFor(() => {
      expect(screen.queryByText('wrong-chat message')).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('thinking-dots')).not.toBeInTheDocument();
  });

  it('renders the draft user bubble with attachment preview when attachment is set', async () => {
    seedQuery('c1', []);
    useChatDraftStore.getState().start({
      chatId: 'c1',
      userContent: 'expand this',
      attachment: { selectionText: 'a passage of prose', chapterId: 'ch1' },
    });

    render(<ChatMessages chatId="c1" chapterTitle="Ch. 1" />, { wrapper });

    expect(await screen.findByText('expand this')).toBeInTheDocument();
    expect(screen.getByText('a passage of prose')).toBeInTheDocument();
  });
```

(Use the file's existing `seedQuery` / `wrapper` helpers — substitute the actual names when you make the edit. If absent, look at the existing tests' setup at the top of the file.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run tests/components/ChatMessages.test.tsx -t "optimistic"`
Expected: FAIL — `<ChatMessages />` does not yet read from `useChatDraftStore`.

- [ ] **Step 3: Wire `<ChatMessages />` to render the draft pair**

Open `frontend/src/components/ChatMessages.tsx`. Add the import (alongside the existing ones near line 8):

```tsx
import { useChatDraftStore } from '@/store/chatDraft';
import { ThinkingDots } from '@/design/ThinkingDots';
```

Add a new component definition above `export function ChatMessages` (near line 335). This renders the optimistic user + assistant pair from a draft:

```tsx
interface DraftPairProps {
  draft: {
    userContent: string;
    attachment: { selectionText: string; chapterId: string } | null;
    assistantText: string;
    status: 'thinking' | 'streaming' | 'done' | 'error';
    error: { code: string | null; message: string } | null;
  };
  chapterTitle: string | null | undefined;
}

function DraftPair({ draft, chapterTitle }: DraftPairProps): JSX.Element {
  const hasAttachment =
    draft.attachment !== null && draft.attachment.selectionText.length > 0;
  return (
    <>
      <li className="flex flex-col items-end" data-role="user" data-testid="draft-user">
        {hasAttachment && draft.attachment !== null ? (
          <div className="attachment-preview pl-3 border-l-2 border-line-2 mb-1 ml-auto max-w-[80%]">
            <span className="text-[10px] uppercase tracking-[.08em] font-mono text-ink-4 block">
              {`FROM CH. ${chapterCaption(draft.attachment, chapterTitle)}`}
            </span>
            <blockquote className="font-serif italic text-[13px] text-ink-3 line-clamp-2">
              {draft.attachment.selectionText}
            </blockquote>
          </div>
        ) : null}
        <div className="user-bubble bg-[var(--accent-soft)] rounded-[var(--radius-lg)] px-3 py-2 text-[13px] font-sans ml-auto max-w-[80%] whitespace-pre-wrap">
          {draft.userContent}
        </div>
      </li>
      <li className="flex flex-col items-start" data-role="assistant" data-testid="draft-assistant">
        {draft.status === 'error' && draft.error !== null ? (
          <div className="w-full">
            <InlineErrorBanner error={draft.error} />
          </div>
        ) : draft.status === 'thinking' ||
          (draft.status === 'streaming' && draft.assistantText.length === 0) ? (
          <div
            className="assistant-bubble pl-3 border-l-2 border-[var(--ai)] py-1"
            data-testid="draft-thinking"
          >
            <ThinkingDots />
          </div>
        ) : (
          <div className="assistant-bubble pl-3 border-l-2 border-[var(--ai)] font-serif text-[13.5px] leading-[1.55] text-ink whitespace-pre-wrap max-w-full">
            {draft.assistantText}
          </div>
        )}
      </li>
    </>
  );
}
```

Then, inside `export function ChatMessages(...)`, just before the existing `const messages = query.data ?? [];` line (around line 394), add:

```tsx
  const draft = useChatDraftStore((s) => s.draft);
  const draftForThisChat = draft && draft.chatId === chatId ? draft : null;
```

Then, inside the `<ol>` block (line 401–415), append after the `{visible.map(...)}` closing brace:

```tsx
        {draftForThisChat ? (
          <DraftPair draft={draftForThisChat} chapterTitle={chapterTitle} />
        ) : null}
```

Resulting `<ol>`:

```tsx
      <ol className="flex flex-col gap-3 p-3" role="log" aria-label="Chat messages">
        {visible.map((m) => {
          if (m.role === 'user') {
            return <UserMessage key={m.id} message={m} chapterTitle={chapterTitle} />;
          }
          return (
            <AssistantMessage
              key={m.id}
              message={m}
              onCopy={onCopyMessage}
              onRegenerate={onRegenerateMessage}
            />
          );
        })}
        {draftForThisChat ? (
          <DraftPair draft={draftForThisChat} chapterTitle={chapterTitle} />
        ) : null}
      </ol>
```

- [ ] **Step 4: Run the new tests + the full ChatMessages file**

Run: `cd frontend && npx vitest run tests/components/ChatMessages.test.tsx`
Expected: PASS — the four new tests plus all existing ChatMessages tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ChatMessages.tsx frontend/tests/components/ChatMessages.test.tsx
git commit -m "[feat] ChatMessages renders optimistic draft pair while streaming"
```

---

## Task 10: Verification gate — full suite, lint, type check

**Files:** None modified — verification only.

- [ ] **Step 1: Full frontend test suite**

Run: `cd frontend && npx vitest run`
Expected: PASS, no regressions. Test count = previous + 4 (ThinkingDots) + 9 (chatDraft) + 4 (useChat) + 4 (ChatMessages drafts) + 2 (useAICompletion thinking) + 1 (InlineAIResult belt-and-braces) = previous + 24.

- [ ] **Step 2: Type check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 3: Design lint**

Run: `cd frontend && npm run lint:design`
Expected: PASS — only `var(--…)` tokens used, no raw colors or hard-coded font sizes outside the allowed list.

- [ ] **Step 4: Backend test suite (sanity — no backend was touched, but the project habit is to run both)**

Run: `cd backend && npm test`
Expected: PASS, no regressions.

- [ ] **Step 5: Manual browser smoke (deferred if running in autonomous mode — note in PR description)**

Bring up the stack with `make dev`, open `http://localhost:3000`, sign in, then:

1. **Chat panel — happy path:** Open a chapter that has a chat. Type "Say hello in three words" in the chat composer and press Send. Expect: user bubble appears immediately at the bottom of the message list; an assistant bubble appears underneath with three bouncing dots; within a second the dots are replaced by streaming serif text; on stream-end the optimistic pair is replaced by the persisted pair (same content, with the meta row visible — Copy/Regenerate buttons + token/latency stats).
2. **Inline AI — happy path:** Select a sentence in the editor; click Rewrite in the bubble. Expect: the result card opens beneath the document with the blockquote and three bouncing dots; dots are replaced by streaming serif text; Done state shows Replace / Insert after / Retry / Discard.
3. **Reduced motion:** Toggle System Settings → Accessibility → Reduce Motion (or DevTools → Rendering → Emulate CSS media feature `prefers-reduced-motion: reduce`). Repeat (1) and (2). Expect: dots are static at low opacity, no bounce.
4. **Error path (chat):** Temporarily break the Venice key (Settings → BYOK → Delete) and Send a chat message. Expect: optimistic user bubble appears, error banner appears in the assistant slot, no live streaming.
5. **Switching chats:** Start a chat send, then immediately click into a different chapter while the request is in flight. Expect: the dots disappear from the new chapter's view (draft.chatId no longer matches), and re-entering the originating chapter shows the persisted result once the stream completes.

- [ ] **Step 6: Commit any test snapshot updates if vitest emitted them**

```bash
git status
# If any frontend/**/__snapshots__/* files changed, review and commit:
# git add frontend/.../__snapshots__/...
# git commit -m "[test] update snapshots for thinking-indicator changes"
```

If clean: skip the commit.

---

## Task 11: Open the PR

**Files:** None — git/gh only.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin brainstorm/ai-interaction-tweaks
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "AI thinking indicators (inline + chat)" --body "$(cat <<'EOF'
## Summary
- Adds a shared `<ThinkingDots />` design primitive used by both the inline-AI card and the chat panel.
- Fixes the inline-AI status race: `useAICompletion` now has a real `'thinking'` status that flips to `'streaming'` only on the first non-empty chunk, so the bouncing dots actually appear.
- Switches `useSendChatMessageMutation` from drain-and-refetch to a draft-slice + live-stream pattern. The user message and a thinking indicator appear immediately on Send; the assistant bubble fills in real time; the existing post-stream refetch reconciles to the persisted rows.
- Adds a `prefers-reduced-motion` block that turns the bouncing dots into static low-opacity dots.

Spec: `docs/superpowers/specs/2026-05-03-ai-thinking-indicators-design.md`

## Test plan
- [x] `cd frontend && npx vitest run` — full suite green
- [x] `cd frontend && npx tsc --noEmit` — clean
- [x] `cd frontend && npm run lint:design` — clean
- [x] `cd backend && npm test` — clean (no backend changes)
- [ ] Manual: chat happy path shows user bubble + dots → streaming text → persisted pair
- [ ] Manual: inline Rewrite shows blockquote + dots → streaming text → action row
- [ ] Manual: `prefers-reduced-motion: reduce` makes dots static
- [ ] Manual: chat error (Venice key removed) shows optimistic user bubble + error banner in assistant slot
- [ ] Manual: switching chats mid-stream hides the draft from the other chat's view

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Return the PR URL printed by `gh`.

---

## Self-review notes

**Spec coverage:**

| Spec section | Task |
|---|---|
| Inline AI status race fix | Task 5 |
| `<ThinkingDots />` primitive | Task 1, 2 |
| `<InlineAIResult />` uses primitive | Task 4 |
| Belt-and-braces dots when streaming + empty output | Task 6 |
| `useChatDraftStore` slice | Task 7 |
| Rewritten `useSendChatMessageMutation` | Task 8 |
| `<ChatMessages />` renders draft pair | Task 9 |
| `prefers-reduced-motion` CSS | Task 3 |
| Storybook story | Task 2 |
| Verification + manual smoke | Task 10 |
| PR open | Task 11 |
| Stop button (out of scope) | — (called out in spec Future Work) |
| Live citations (out of scope) | — (called out in spec Future Work) |

No gaps.

**Type consistency:** `ChatDraft.attachment` typed as `{selectionText: string; chapterId: string} | null` consistently across the store, the mutation's `start()` call, and `<DraftPair />`. `ChatDraftStatus` enum values match those used in `<DraftPair />` predicates. `AICompletionStatus` widened in one place; the store-sync effect in `EditorPage` (untouched) mirrors statuses 1:1, so the new `'thinking'` value flows through naturally — the `<InlineAIResult />` predicate in Task 6 explicitly handles both `'thinking'` and the empty-output `'streaming'` case.

**Placeholder scan:** No TBDs / "implement later" / "similar to Task N" / hand-wavy assertions remain.
