# [F53] Mount AI Surfaces in EditorPage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire three AI surfaces into the post-F52 EditorPage so the user can actually invoke AI from the editor: `<SelectionBubble>` (page-root, listens for prose selections inside `.paper-prose`), `<InlineAIResult>` (below the Paper, renders the streaming card seeded by the bubble), and `<ContinueWriting>` (at end-of-paper, ⌥+Enter or click → continue stream). The bubble's `'rewrite' | 'describe' | 'expand'` actions seed `useInlineAIResultStore` and call `useAICompletion().run`; the bubble's `'ask'` action calls `triggerAskAI(...)` (F41 helper, already shipped).

**Architecture:**
- Page-level handler `handleSelectionAction(action: SelectionAction)` is the single entry point for the bubble's four actions. It reads the live selection from the live `editor` instance + `useSelectionStore` (already populated by `<SelectionBubble>`'s own `useSelectionListener`), does the bubble→completion-action mapping, seeds `useInlineAIResultStore`, kicks off `useAICompletion.run(...)`, and pipes the SSE text deltas into the store as they arrive.
- Bubble→completion mapping is locked here:
  - `'rewrite'` → `'rephrase'`
  - `'describe'` → `'summarise'` (a one-paragraph description of the passage; matches the AI prompt builder's existing `summarise` action)
  - `'expand'` → `'expand'`
  - `'ask'` → not a completion call; calls `triggerAskAI({ selectionText, chapter })` from `frontend/src/lib/askAi.ts` and ends.
- The `useAICompletion` hook already exposes `{ status, text }` that update during streaming. F53 adds a small effect on the page that mirrors `text` / `status` into `useInlineAIResultStore` so `<InlineAIResult>` (which reads from the store) renders progressive output and final state.
- Retry: `<InlineAIResult>`'s `onRetry` callback receives no args. F53 captures the last `RunArgs` in a ref and on retry calls `useAICompletion.run(lastArgsRef.current)`.
- `<ContinueWriting>` is mounted at the end of the Paper region — same column, below the prose. It binds to the same `editor` instance + the active chapter id + a model id from `useSelectedModel`. The component already implements the ⌥+Enter listener and the streaming pill UI per F35. F53's job is wiring its props.

**Decision points pinned (no TBDs):**
1. **Mount order:** `<SelectionBubble>` is rendered at page root (sibling of AppShell), so it can absolute-position itself over the prose area regardless of the editor slot's overflow. `<InlineAIResult>` and `<ContinueWriting>` are rendered inside the Paper region (below the editor's own `.paper-prose` div, above the Export section). This matches the prototype's layout in `editor.jsx`.
2. **Bubble→completion action mapping:** `rewrite→rephrase, describe→summarise, expand→expand, ask→triggerAskAI`. Locked above.
3. **Selection text source:** read from `editor.state.doc.textBetween(from, to, ' ')` at the moment the bubble fires (not from `useSelectionStore.text`, which may be a stale stringified snapshot). Use the page's existing `extractSelection(editor)` helper from F51.
4. **`useInlineAIResultStore` seed shape:** `{ action: bubbleAction, text: selectedText, status: 'thinking', output: '' }` immediately on click. Then on each `useAICompletion` text delta: `{ ...prev, status: 'streaming', output: deltaText }`. On `done`: `{ status: 'done' }`. On `error`: `{ status: 'error' }`. The InlineAIResult component already discriminates on these states.
5. **Model id source:** `useSelectedModel().selectedModelId` (or analogous shape). If null, surface a small inline error in the inline-result card and abort — no completion fired. The selected model is set by F42 ModelPicker.
6. **`onRetry` re-runs the same `RunArgs` only.** It does NOT re-extract the current selection; the original text is what the user wanted rewritten/described/expanded.
7. **`ask` action does NOT seed `useInlineAIResultStore`.** It fully delegates to `triggerAskAI`, which routes to the chat composer via attached-selection / composer-draft stores. The inline result card stays hidden.
8. **ContinueWriting's `onRetry` is internal** (per its existing implementation); F53 doesn't touch it.

**Tech Stack:** React 19, TypeScript strict, existing AI hooks. No new deps.

**Source-of-truth references:**
- SelectionBubble: `frontend/src/components/SelectionBubble.tsx:32-38` — `SelectionAction = 'rewrite' | 'describe' | 'expand' | 'ask'`; `proseSelector?` defaults to `.paper-prose`.
- InlineAIResult: `frontend/src/components/InlineAIResult.tsx:32-39` — `{ editor, onRetry? }`; reads from `useInlineAIResultStore`.
- ContinueWriting: `frontend/src/components/ContinueWriting.tsx:35-42` — `{ editor, storyId, chapterId, modelId, visible? }`. Owns its own AI completion + ⌥+Enter listener.
- triggerAskAI: `frontend/src/lib/askAi.ts:38` — `triggerAskAI({ selectionText, chapter: { id, number, title } })`.
- useAICompletion: `frontend/src/hooks/useAICompletion.ts:70` — `{ run, cancel, reset, status, text, error, usage }`.
- useInlineAIResultStore: `frontend/src/store/inlineAIResult.ts` — `{ inlineAIResult, setInlineAIResult, clear }`.
- useSelectionStore: `frontend/src/store/selection.ts` — populated by SelectionBubble's listener; useful for `chapter`-level snapshots if needed.

---

## File Structure

**Modify:**
- `frontend/src/pages/EditorPage.tsx` — add the AI-surface mounts + `handleSelectionAction` + the streaming-mirror effect.
- `frontend/tests/pages/editor.test.tsx` — add tests for the wiring (each bubble action maps to the right call, retry re-runs the last RunArgs).

**Not touched:**
- `<SelectionBubble>`, `<InlineAIResult>`, `<ContinueWriting>` — used as-is.
- `useAICompletion`, `useInlineAIResultStore`, `triggerAskAI` — used as-is.
- AI backend / prompt builder — already shipped per V series.

---

## Task 1: Page-level `handleSelectionAction` + AI completion plumbing

**Files:**
- Modify: `frontend/src/pages/EditorPage.tsx`

- [ ] **Step 1: Add the handler + completion mirror**

In `frontend/src/pages/EditorPage.tsx`, after the existing `editor` / `setEditor` state and `chapterQuery` block (post-F52), add:

```tsx
import { useAICompletion, type RunArgs } from '@/hooks/useAICompletion';
import { useInlineAIResultStore } from '@/store/inlineAIResult';
import { useSelectedModel } from '@/hooks/useSelectedModel';
import { triggerAskAI } from '@/lib/askAi';
import type { SelectionAction } from '@/components/SelectionBubble';
import { SelectionBubble } from '@/components/SelectionBubble';
import { InlineAIResult } from '@/components/InlineAIResult';
import { ContinueWriting } from '@/components/ContinueWriting';
```

Inside `EditorPage` body, after existing hooks:

```tsx
const aiCompletion = useAICompletion();
const setInlineAIResult = useInlineAIResultStore((s) => s.setInlineAIResult);
const clearInlineAIResult = useInlineAIResultStore((s) => s.clear);
const { selectedModelId } = useSelectedModel();

const lastRunArgsRef = useRef<RunArgs | null>(null);

// Bubble action → completion-action mapping.
const ACTION_MAP: Record<Exclude<SelectionAction, 'ask'>, RunArgs['action']> = useMemo(
  () => ({
    rewrite: 'rephrase',
    describe: 'summarise',
    expand: 'expand',
  }),
  [],
);

const handleSelectionAction = useCallback(
  (action: SelectionAction): void => {
    if (!editor || !story?.id || !activeChapterId) return;
    const selectedText = extractSelection(editor);
    if (selectedText.trim().length === 0) return;

    if (action === 'ask') {
      const ch = activeChapter;
      if (!ch) return;
      triggerAskAI({
        selectionText: selectedText,
        chapter: {
          id: ch.id,
          number: ch.orderIndex + 1,
          title: ch.title,
        },
      });
      return;
    }

    if (!selectedModelId) {
      setInlineAIResult({
        action,
        text: selectedText,
        status: 'error',
        output: 'No model selected. Open the model picker to choose one.',
      });
      return;
    }

    const completionAction = ACTION_MAP[action];
    const args: RunArgs = {
      action: completionAction,
      selectedText,
      chapterId: activeChapterId,
      storyId: story.id,
      modelId: selectedModelId,
    };
    lastRunArgsRef.current = args;
    setInlineAIResult({ action, text: selectedText, status: 'thinking', output: '' });
    void aiCompletion.run(args);
  },
  [editor, story?.id, activeChapterId, activeChapter, selectedModelId, aiCompletion, setInlineAIResult, ACTION_MAP],
);

const handleInlineRetry = useCallback((): void => {
  const args = lastRunArgsRef.current;
  if (!args) return;
  setInlineAIResult({
    action: (Object.entries(ACTION_MAP).find(([, v]) => v === args.action)?.[0] ?? 'rewrite') as Exclude<SelectionAction, 'ask'>,
    text: args.selectedText,
    status: 'thinking',
    output: '',
  });
  void aiCompletion.run(args);
}, [aiCompletion, setInlineAIResult, ACTION_MAP]);

// Mirror the streaming completion into the inline result store. The store is
// what <InlineAIResult> renders from.
useEffect(() => {
  const status = aiCompletion.status;
  if (status === 'idle') return;
  setInlineAIResult((prev) => {
    if (!prev) return null;
    if (status === 'streaming') {
      return { ...prev, status: 'streaming', output: aiCompletion.text };
    }
    if (status === 'done') {
      return { ...prev, status: 'done', output: aiCompletion.text };
    }
    if (status === 'error') {
      return { ...prev, status: 'error', output: aiCompletion.error?.message ?? 'AI request failed.' };
    }
    return prev;
  });
}, [aiCompletion.status, aiCompletion.text, aiCompletion.error, setInlineAIResult]);
```

(`useInlineAIResultStore.setInlineAIResult` accepts a value — not an updater. The plan above calls it inside an effect that takes the previous from the store via a getter. Adapt to the actual API: the store's setter accepts `InlineAIResultValue | null` directly. In the effect, read the current value via `useInlineAIResultStore.getState().inlineAIResult` and pass the merged object back. Apply this adjustment now in the implementation; the plan shape above is illustrative.)

Concrete adjusted version of the mirror effect:

```tsx
useEffect(() => {
  if (aiCompletion.status === 'idle') return;
  const prev = useInlineAIResultStore.getState().inlineAIResult;
  if (!prev) return;
  if (aiCompletion.status === 'streaming') {
    setInlineAIResult({ ...prev, status: 'streaming', output: aiCompletion.text });
  } else if (aiCompletion.status === 'done') {
    setInlineAIResult({ ...prev, status: 'done', output: aiCompletion.text });
  } else if (aiCompletion.status === 'error') {
    setInlineAIResult({
      ...prev,
      status: 'error',
      output: aiCompletion.error?.message ?? 'AI request failed.',
    });
  }
}, [aiCompletion.status, aiCompletion.text, aiCompletion.error, setInlineAIResult]);
```

- [ ] **Step 2: Mount the three components**

In the JSX, the editor slot (post-F52) becomes:

```tsx
editor={
  <div className="flex h-full flex-col">
    <FormatBar editor={editor} />
    <div className="flex-1 overflow-y-auto">
      <Paper
        // ... existing F52 props ...
      />
      <InlineAIResult editor={editor} onRetry={handleInlineRetry} />
      {activeChapterId && story?.id && selectedModelId ? (
        <ContinueWriting
          editor={editor}
          storyId={story.id}
          chapterId={activeChapterId}
          modelId={selectedModelId}
        />
      ) : null}
      {chaptersQuery.data ? <Export ... /> : null}
    </div>
  </div>
}
```

At page root (sibling of AppShell, inside the existing fragment from F51):

```tsx
<SelectionBubble proseSelector=".paper-prose" onAction={handleSelectionAction} />
```

- [ ] **Step 3: Clean up on chapter / story switch**

Add an effect that clears the inline result + cancels in-flight completion when the active chapter changes, so a half-streamed rewrite doesn't bleed into the next chapter:

```tsx
useEffect(() => {
  clearInlineAIResult();
  aiCompletion.cancel();
  lastRunArgsRef.current = null;
}, [activeChapterId, story?.id, clearInlineAIResult, aiCompletion]);
```

- [ ] **Step 4: Confirm typecheck**

```bash
cd frontend && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/EditorPage.tsx
git commit -m "[F53] EditorPage: SelectionBubble + InlineAIResult + ContinueWriting wiring"
```

---

## Task 2: Test the wiring

**Files:**
- Modify: `frontend/tests/pages/editor.test.tsx`

- [ ] **Step 1: Add the bubble→completion test**

```tsx
it('selecting text + clicking Rewrite seeds the inline result store and calls /api/ai/complete with action=rephrase', async () => {
  // Setup: mount EditorPage with a story + chapter; select model via store.
  // Capture the editor via onReady. Insert text, programmatically extend selection,
  // then click the bubble's "Rewrite" button.

  // Mock fetch to return an SSE-formatted stream for /api/ai/complete.
  fetchMock.mockImplementationOnce((url) => {
    if (typeof url === 'string' && url.startsWith('/api/ai/complete')) {
      // Minimal SSE: one delta + done. Adapt to whatever sse.ts parses.
      const body = 'data: {"text":"Rephrased!"}\n\ndata: [DONE]\n\n';
      return Promise.resolve(new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }));
    }
    // ... existing handlers ...
  });

  // ... drive the bubble click ...

  await waitFor(() => {
    expect(useInlineAIResultStore.getState().inlineAIResult?.action).toBe('rewrite');
  });
  await waitFor(() => {
    expect(useInlineAIResultStore.getState().inlineAIResult?.status).toBe('done');
  });
});
```

(SSE parsing in tests is fiddly. If the existing AI tests already have a helper for mocking the stream, reuse it. Otherwise, isolating this assertion to "bubble click triggers `aiCompletion.run` with the right args" via a `vi.spyOn(useAICompletion, 'run')` is acceptable — the streaming path itself is already tested in `tests/components/AIStream.test.tsx`.)

- [ ] **Step 2: Add the ask-AI test**

```tsx
it('selecting text + clicking Ask AI calls triggerAskAI with the selection + chapter', async () => {
  const triggerSpy = vi.spyOn(askAiModule, 'triggerAskAI'); // import * as askAiModule from '@/lib/askAi';
  // ... drive the bubble click on Ask AI ...
  await waitFor(() => {
    expect(triggerSpy).toHaveBeenCalledWith(expect.objectContaining({
      selectionText: expect.any(String),
      chapter: expect.objectContaining({ id: expect.any(String), number: expect.any(Number) }),
    }));
  });
});
```

- [ ] **Step 3: Add the no-model-selected test**

```tsx
it('rewrite without a selected model surfaces an error in the inline result card without firing /api/ai/complete', async () => {
  // Setup the store with selectedModelId=null. Click Rewrite.
  // Assert no fetch to /api/ai/complete; assert store has status='error'.
});
```

- [ ] **Step 4: Run the tests**

```bash
cd frontend && npm run test:frontend -- --run tests/pages/editor.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/tests/pages/editor.test.tsx
git commit -m "[F53] tests: bubble action mapping + ask-AI + no-model error"
```

---

## Task 3: Verify, smoke, tick

- [ ] **Step 1: Run surrounding suites**

```bash
cd frontend && npm run test:frontend -- --run \
  tests/pages/editor.test.tsx \
  tests/components/SelectionBubble.test.tsx \
  tests/components/InlineAIResult.test.tsx \
  tests/components/ContinueWriting.test.tsx \
  tests/flows/ask-ai.test.tsx
```

Expected: all green.

- [ ] **Step 2: Manual smoke**

```bash
make dev
```

- Open a chapter with content. Select a passage. Bubble appears anchored to the selection.
- Click Rewrite. Inline AI card appears below the prose with "Thinking…", then streams the rephrased passage. Replace / Insert After buttons enable on `done`.
- Click Describe. Same flow with the summarise prompt.
- Click Expand. Same flow with the expand prompt.
- Click Ask AI. Selection clears; chat composer opens with the "Help me with this passage — " starter; selection is attached as a chip.
- ⌥+Enter at end-of-chapter: ContinueWriting fires; pill shows streaming; result is inserted with the AI tint.
- Switch chapters mid-stream. The inline result card disappears and the in-flight request is cancelled.

- [ ] **Step 3: Tick `[F53]` in TASKS.md**

Auto-tick if verify passes.

- [ ] **Step 4: Final commit**

```bash
git add TASKS.md
git commit -m "[F53] tick — AI surfaces wired in EditorPage"
```

---

## Self-Review Notes

- **Spec coverage:** every bubble action has an explicit handler. `triggerAskAI` is reused from F41. ContinueWriting is mounted with its expected props.
- **Action mapping is locked:** rewrite→rephrase, describe→summarise, expand→expand. No follow-up "decide on mapping" left over.
- **No-model-selected case** is handled with an inline error, not a silent no-op.
- **Cleanup on chapter switch** prevents stream-bleed across chapters.
- **No backend / hook / store changes** — F53 is pure integration.
