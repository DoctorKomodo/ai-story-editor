# [F52] Replace Editor (F8) with FormatBar + Paper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Swap the F8 `<Editor>` mounted in EditorPage's editor slot for the F31 `<FormatBar>` + F32 `<Paper>` stack. Wire a real chapter save pipeline (`useChapterQuery` + `useUpdateChapterMutation`) since the F7 page never had one. Resolve the "Find UI placeholder (TODO)" baked into the task copy by shipping a disabled-button state and registering a separate `[X9]` task for the real Find feature.

**Architecture:**
- Two new query/mutation hooks live in `frontend/src/hooks/useChapters.ts` (the file already houses the chapter list / create / reorder hooks): `useChapterQuery(chapterId)` and `useUpdateChapterMutation()`. Both wrap `api()` directly — no new files, matches the existing convention.
- The editor slot in `EditorPage` becomes: `<FormatBar editor={editor} /> + <Paper {...} initialBodyJson={chapter.bodyJson} onReady={setEditor} onUpdate={save} />`. The `editor` instance is captured into local page state via `onReady`, then handed to `<FormatBar>`. F8 `<Editor>` is removed from the import list and the file is left in place (its component tests still reference it; F-series cleanup may remove the component once no test does, per the F52 task copy's "may be deleted once no test references it").
- Save pipeline: `Paper`'s `onUpdate({ bodyJson, wordCount })` flows into a wrapper that invokes `useAutosave`'s `enqueue()` — F48 already shipped the indicator, but the autosave hook is generic. F52 wires the chapter-specific PATCH inside the page (no new hook layer) so the save path is in one obvious place. F56 will swap the indicator UI; F52 ships the data flow that F56 reads.
- Word count + status chip in `<Paper>`'s sub-row come from chapter metadata: `wordCount` from `chapter.wordCount` (server-of-record after save; optimistic update on local change is safe — `Paper`'s sub-row is decorative).
- **Find UI** — task copy says "in-paper find UI placeholder (TODO)". This plan **does not ship a find feature**, but **does not leave a TODO either**: F52 modifies `<FormatBar>` to render the Find button **disabled** when `onToggleFind` is undefined (a one-line attribute change to a shipped component, justified by the F52 contract), and adds **`[X9]` Find UI** to TASKS.md as a separate, properly-scoped task for the actual feature. F52 passes no `onToggleFind` to FormatBar, so the button renders disabled with a `title` attribute pointing at the future feature.
- The `<Export>` block (F20) currently rendered below the F8 Editor stays in place inside the editor slot, below `<Paper>`. F52 makes no Export changes.

**Decision points pinned (no TBDs):**
1. **Find UI is deferred via `[X9]`, NOT via a code TODO.** The button is rendered disabled in F52; X9 wires it.
2. **Save pipeline lives at the page level**, not inside Paper. Paper stays presentational. Reason: the page already owns the chapter id and the autosave plumbing; threading them down into Paper would couple Paper to TanStack Query, which it currently isn't.
3. **`useChapterQuery` reads from the chapters-list cache when available** (`getChaptersFromCache(qc, storyId)`) and falls back to a single-chapter GET only when the cache is cold. Avoids a redundant round-trip on every chapter switch.
4. **`useUpdateChapterMutation` does NOT mark the chapter as save-failed in the global store on rejection.** Failure is surfaced via `useAutosave`'s `status: 'error'` + retry. The mutation's `onError` is a no-op; `useAutosave` owns the retry/visible-status logic.
5. **`onReady` may fire twice in StrictMode** — already handled by Paper's existing `readyFiredFor` guard. No additional work.
6. **F8 Editor is left in place but unimported by EditorPage.** Tests that mount `<Editor>` directly still pass; cleanup is a separate hygiene task, not F52's job.
7. **Chapter PATCH payload includes `bodyJson` and `wordCount` only** — title edits are out of F52 scope (chapter title editing is part of the sidebar's chapter-row UI; F52 does not touch it).
8. **Empty chapter selection** (no `activeChapterId`): the editor slot renders a small "Select a chapter" placeholder; FormatBar renders with `editor={null}` (already supported per F31).

**Tech Stack:** React 19, TypeScript strict, Tailwind, TanStack Query (`useQuery`, `useMutation`), Zustand (`useActiveChapterStore`). No new deps.

**Source-of-truth references:**
- FormatBar: `frontend/src/components/FormatBar.tsx:17-20` — `{ editor, onToggleFind? }`. Find button at line 615.
- Paper: `frontend/src/components/Paper.tsx:29-40` — props include `initialBodyJson`, `onUpdate`, `onReady`.
- Existing chapter hooks: `frontend/src/hooks/useChapters.ts:42, 60, 129, 185` — `useChaptersQuery`, `useCreateChapterMutation`, `useReorderChaptersMutation`, `getChaptersFromCache`.
- Autosave: `frontend/src/hooks/useAutosave.ts:36` — `useAutosave<T>({ value, onSave, debounceMs })` returns `{ status, savedAt, retryAt, ... }`.
- Backend chapter routes (already shipped): `GET /api/stories/:storyId/chapters/:id`, `PATCH /api/stories/:storyId/chapters/:id` — confirm in `backend/src/routes/chapters.routes.ts` before writing the hook.

---

## File Structure

**Modify:**
- `frontend/src/hooks/useChapters.ts` — add `useChapterQuery(chapterId)` and `useUpdateChapterMutation()`.
- `frontend/src/components/FormatBar.tsx` — one-line: render Find button disabled when `onToggleFind` is undefined; add a `title` attribute documenting the X9 status.
- `frontend/src/pages/EditorPage.tsx` — replace `<Editor>` import with `<FormatBar>` + `<Paper>`; wire chapter query + autosave + update mutation. The F51 rewrite already established the editor-slot layout; F52 fills it in.
- `frontend/tests/pages/editor.test.tsx` — update editor-slot assertions (FormatBar test-ids, Paper test-ids).
- `frontend/tests/components/FormatBar.test.tsx` — add a "Find button is disabled when onToggleFind is undefined" assertion.
- `TASKS.md` — add `[X9]` Find UI task.

**Create:**
- `frontend/tests/hooks/useChapter.test.ts` — unit tests for the new query + mutation.

**Not touched:**
- `<Paper>` (F32) — used as-is. Already supports `initialBodyJson` / `onUpdate` / `onReady`.
- `<Editor>` (F8) — left in place (no consumers in EditorPage after F52, but its tests still mount it directly; deletion is a separate hygiene call).
- `<Export>` — still rendered below the new editor stack.

---

## Task 1: Add `useChapterQuery` + `useUpdateChapterMutation`

**Files:**
- Modify: `frontend/src/hooks/useChapters.ts`
- Create: `frontend/tests/hooks/useChapter.test.ts`

- [ ] **Step 1: Confirm the backend contract**

```bash
grep -n "GET /api/stories/:storyId/chapters/:id\|PATCH /api/stories/:storyId/chapters/:id\|router.get.*chapters/:chapterId\|router.patch.*chapters/:chapterId" backend/src/routes/chapters.routes.ts
```

Expected: both routes exist (per [B3]). The PATCH accepts `{ bodyJson?, title?, wordCount? }` and returns `{ chapter }` per the existing list mutation conventions. Read the route handler for the exact body schema before writing the hook.

- [ ] **Step 2: Write the failing tests**

Create `frontend/tests/hooks/useChapter.test.ts`:

```ts
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chaptersQueryKey,
  useChapterQuery,
  useUpdateChapterMutation,
} from '@/hooks/useChapters';
import { resetApiClientForTests, setAccessToken } from '@/lib/api';

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useChapterQuery', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    resetApiClientForTests();
    setAccessToken('tok');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientForTests();
  });

  it('returns the chapter from the chapters-list cache when present (no extra fetch)', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const cached = {
      id: 'c1',
      storyId: 's1',
      title: 'Opening',
      orderIndex: 0,
      wordCount: 42,
      bodyJson: { type: 'doc', content: [] },
    };
    client.setQueryData(chaptersQueryKey('s1'), [cached]);

    const { result } = renderHook(() => useChapterQuery('c1'), { wrapper: makeWrapper(client) });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual(cached);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to a single-chapter GET when the cache is cold', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        chapter: {
          id: 'c1',
          storyId: 's1',
          title: 'Opening',
          orderIndex: 0,
          wordCount: 42,
          bodyJson: null,
        },
      }),
    );

    const { result } = renderHook(() => useChapterQuery('c1', 's1'), {
      wrapper: makeWrapper(client),
    });

    await waitFor(() => expect(result.current.data?.id).toBe('c1'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('/api/stories/s1/chapters/c1');
  });

  it('returns undefined data while chapterId is null', () => {
    const client = new QueryClient();
    const { result } = renderHook(() => useChapterQuery(null), { wrapper: makeWrapper(client) });
    expect(result.current.data).toBeUndefined();
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useUpdateChapterMutation', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    resetApiClientForTests();
    setAccessToken('tok');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientForTests();
  });

  it('PATCHes the chapter with bodyJson + wordCount', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        chapter: {
          id: 'c1',
          storyId: 's1',
          title: 'Opening',
          orderIndex: 0,
          wordCount: 5,
          bodyJson: { type: 'doc' },
        },
      }),
    );

    const { result } = renderHook(() => useUpdateChapterMutation(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        storyId: 's1',
        chapterId: 'c1',
        input: { bodyJson: { type: 'doc' }, wordCount: 5 },
      });
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/stories/s1/chapters/c1');
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe(JSON.stringify({ bodyJson: { type: 'doc' }, wordCount: 5 }));
  });

  it('updates the chapters-list cache with the response on success', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    client.setQueryData(chaptersQueryKey('s1'), [
      {
        id: 'c1',
        storyId: 's1',
        title: 'Opening',
        orderIndex: 0,
        wordCount: 0,
        bodyJson: null,
      },
    ]);

    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        chapter: {
          id: 'c1',
          storyId: 's1',
          title: 'Opening',
          orderIndex: 0,
          wordCount: 5,
          bodyJson: { type: 'doc' },
        },
      }),
    );

    const { result } = renderHook(() => useUpdateChapterMutation(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        storyId: 's1',
        chapterId: 'c1',
        input: { bodyJson: { type: 'doc' }, wordCount: 5 },
      });
    });

    const list = client.getQueryData(chaptersQueryKey('s1')) as { wordCount: number }[];
    expect(list[0]?.wordCount).toBe(5);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd frontend && npm run test:frontend -- --run tests/hooks/useChapter.test.ts
```

Expected: FAIL — `useChapterQuery` and `useUpdateChapterMutation` are not exported.

- [ ] **Step 4: Implement the hooks**

Append to `frontend/src/hooks/useChapters.ts`:

```ts
// ---- single-chapter query (F52) ----

export const chapterQueryKey = (chapterId: string): readonly [string, string] =>
  ['chapter', chapterId] as const;

/**
 * Read a single chapter. When `storyId` is supplied and the chapter is already
 * present in the chapters-list cache for that story, returns it from cache
 * with no fetch. Otherwise issues `GET /api/stories/:storyId/chapters/:id`.
 *
 * Disabled when `chapterId` is null/undefined.
 */
export function useChapterQuery(
  chapterId: string | null | undefined,
  storyId?: string,
): UseQueryResult<Chapter, Error> {
  const qc = useQueryClient();
  return useQuery({
    queryKey: chapterQueryKey(chapterId ?? ''),
    enabled: typeof chapterId === 'string' && chapterId.length > 0,
    queryFn: async (): Promise<Chapter> => {
      if (typeof chapterId !== 'string' || chapterId.length === 0) {
        throw new Error('chapterId required');
      }
      // Cache short-circuit: if the chapters list for the story is in cache,
      // try to find the chapter there first.
      if (typeof storyId === 'string' && storyId.length > 0) {
        const list = qc.getQueryData<Chapter[]>(chaptersQueryKey(storyId));
        const hit = list?.find((c) => c.id === chapterId);
        if (hit) return hit;
      }
      // No story id, or cache miss: hit the single-chapter endpoint. Note: the
      // route requires the storyId in the URL — surface it from the chapter's
      // own data isn't possible (we don't have it yet). When called without
      // storyId, callers must wait for the chapters-list query to seed the
      // cache; otherwise this throws.
      if (typeof storyId !== 'string' || storyId.length === 0) {
        throw new Error('useChapterQuery: storyId required when chapter is not in cache');
      }
      const res = await api<ChapterResponse>(
        `/stories/${encodeURIComponent(storyId)}/chapters/${encodeURIComponent(chapterId)}`,
      );
      return res.chapter;
    },
    // Don't garbage-collect aggressively — the editor mounts/unmounts on tab
    // switches and we don't want to refetch every time.
    staleTime: 30_000,
  });
}

// ---- update chapter (F52) ----

export interface UpdateChapterInput {
  bodyJson?: unknown;
  title?: string;
  wordCount?: number;
}

export interface UpdateChapterArgs {
  storyId: string;
  chapterId: string;
  input: UpdateChapterInput;
}

export function useUpdateChapterMutation(): UseMutationResult<Chapter, Error, UpdateChapterArgs> {
  const qc = useQueryClient();
  return useMutation<Chapter, Error, UpdateChapterArgs>({
    mutationFn: async ({ storyId, chapterId, input }) => {
      const res = await api<ChapterResponse>(
        `/stories/${encodeURIComponent(storyId)}/chapters/${encodeURIComponent(chapterId)}`,
        { method: 'PATCH', body: input as Record<string, unknown> },
      );
      return res.chapter;
    },
    onSuccess: (chapter) => {
      // Update the chapters-list cache in place (don't full-invalidate — the
      // user is actively typing and a refetch would re-render with stale text).
      qc.setQueryData<Chapter[] | undefined>(chaptersQueryKey(chapter.storyId), (prev) => {
        if (!prev) return prev;
        return prev.map((c) => (c.id === chapter.id ? chapter : c));
      });
      // Also update the single-chapter cache if it exists.
      qc.setQueryData<Chapter>(chapterQueryKey(chapter.id), chapter);
    },
  });
}
```

(Imports at the top of the file should already include `useMutation`, `useQuery`, `useQueryClient`, `UseMutationResult`, `UseQueryResult` for the existing hooks; verify and add any missing ones.)

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd frontend && npm run test:frontend -- --run tests/hooks/useChapter.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useChapters.ts frontend/tests/hooks/useChapter.test.ts
git commit -m "[F52] hooks: useChapterQuery + useUpdateChapterMutation"
```

---

## Task 2: Disable FormatBar's Find button + add `[X9]` to TASKS.md

**Files:**
- Modify: `frontend/src/components/FormatBar.tsx` (one-line change)
- Modify: `frontend/tests/components/FormatBar.test.tsx`
- Modify: `TASKS.md`

- [ ] **Step 1: Modify FormatBar's Find button**

Open `frontend/src/components/FormatBar.tsx`, find the line:

```tsx
<FbButton label="Find" onClick={() => onToggleFind?.()}>
```

(around line 615). Replace with:

```tsx
<FbButton
  label="Find"
  onClick={() => onToggleFind?.()}
  disabled={onToggleFind === undefined}
  title={onToggleFind === undefined ? 'Find — coming in [X9]' : undefined}
>
```

If `<FbButton>` doesn't accept `disabled` / `title`, look at its definition (in the same file) and add support — both should already be plumbed since other buttons use `disabled` for null-editor states. If not, add the two props to `FbButton`'s prop interface and pass them through to the underlying `<button>`.

- [ ] **Step 2: Add a regression test**

In `frontend/tests/components/FormatBar.test.tsx`, add:

```tsx
it('Find button is disabled and surfaces the [X9] title when onToggleFind is undefined', () => {
  // Mount FormatBar with editor=null and no onToggleFind prop.
  render(<FormatBar editor={null} />);
  const findBtn = screen.getByRole('button', { name: /find/i });
  expect(findBtn).toBeDisabled();
  expect(findBtn).toHaveAttribute('title', expect.stringMatching(/x9/i));
});

it('Find button is enabled when onToggleFind is provided', () => {
  const onToggleFind = vi.fn();
  render(<FormatBar editor={null} onToggleFind={onToggleFind} />);
  const findBtn = screen.getByRole('button', { name: /find/i });
  expect(findBtn).not.toBeDisabled();
});
```

- [ ] **Step 3: Add `[X9]` to TASKS.md**

In the `## 💡 X — Extras (after core is complete)` section, append after the last existing X-task:

```markdown
- [ ] **[X9]** Find / Replace UI in the editor. Wire `<FormatBar>`'s `onToggleFind` callback to a small inline find bar inside `<Paper>` that highlights matches, supports next/previous, and optionally Replace. Decision (capture in plan): inline strip vs floating popover. Match the prototype's mockup if one is added; otherwise design-first.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/EditorFind.test.tsx`
```

- [ ] **Step 4: Run the FormatBar tests**

```bash
cd frontend && npm run test:frontend -- --run tests/components/FormatBar.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/FormatBar.tsx \
       frontend/tests/components/FormatBar.test.tsx \
       TASKS.md
git commit -m "[F52] FormatBar: disable Find when no handler; register [X9]"
```

---

## Task 3: Swap Editor → FormatBar + Paper in EditorPage

**Files:**
- Modify: `frontend/src/pages/EditorPage.tsx`
- Modify: `frontend/tests/pages/editor.test.tsx`

- [ ] **Step 1: Update the editor slot**

In `frontend/src/pages/EditorPage.tsx`, replace the import:

```tsx
import { Editor } from '@/components/Editor';
```

with:

```tsx
import { FormatBar } from '@/components/FormatBar';
import { Paper } from '@/components/Paper';
import { useChapterQuery, useUpdateChapterMutation } from '@/hooks/useChapters';
import { useAutosave } from '@/hooks/useAutosave';
```

Add (inside the `EditorPage` component body, after the existing `editor` / `setEditor` state):

```tsx
const chapterQuery = useChapterQuery(activeChapterId, story?.id);
const updateChapter = useUpdateChapterMutation();

// Autosave: debounce content changes, fire PATCH, surface status to TopBar.
const autosave = useAutosave({
  value: chapterQuery.data?.bodyJson ?? null,
  onSave: async (value) => {
    if (!story?.id || !activeChapterId || value === undefined) return;
    await updateChapter.mutateAsync({
      storyId: story.id,
      chapterId: activeChapterId,
      input: { bodyJson: value, wordCount: lastWordCountRef.current ?? 0 },
    });
  },
  debounceMs: 800,
});

const lastWordCountRef = useRef<number | null>(null);

const handlePaperUpdate = useCallback(
  ({ bodyJson, wordCount }: { bodyJson: unknown; wordCount: number }): void => {
    lastWordCountRef.current = wordCount;
    autosave.enqueue(bodyJson);
  },
  [autosave],
);
```

(Adjust to the actual `useAutosave` API — the plan above assumes `{ value, onSave, debounceMs }` returning `{ enqueue, status, savedAt, retryAt }`. Read the hook before writing the call site and match its real signature; do not change the hook.)

Replace the `<Editor onReady={handleEditorReady} />` element inside the `editor` slot with:

```tsx
<div className="flex h-full flex-col">
  <FormatBar editor={editor} />
  <div className="flex-1 overflow-y-auto">
    <Paper
      storyTitle={story.title}
      storyGenre={story.genre}
      storyWordCount={story.totalWordCount}
      chapterNumber={activeChapter ? activeChapter.orderIndex + 1 : null}
      chapterTitle={activeChapter?.title ?? null}
      initialBodyJson={(chapterQuery.data?.bodyJson as JSONContent | null) ?? null}
      onUpdate={handlePaperUpdate}
      onReady={handleEditorReady}
    />
    {chaptersQuery.data ? (
      <Export
        story={{
          title: story.title,
          chapters: chaptersQuery.data.map((c) => ({
            title: c.title,
            orderIndex: c.orderIndex,
            bodyJson: c.bodyJson ?? undefined,
          })),
        }}
      />
    ) : null}
  </div>
</div>
```

When `activeChapterId` is null, `chapterQuery.data` is undefined and Paper renders with the empty doc (its existing behaviour). The format bar still renders, with all action buttons disabled because `editor` is null until Paper mounts a TipTap instance.

Plumb the autosave status into TopBar:

```tsx
saveState={autosaveStatusToSaveState(autosave.status)}
savedAtRelative={
  autosave.savedAt !== null
    ? formatRelativeTimeLocal(now() - autosave.savedAt)  // small inline helper or inline string
    : null
}
```

(F56 will replace the TopBar's inline indicator with the F48 `<AutosaveIndicator>` and pull `savedAt` / `retryAt` directly. F52 just maps the autosave hook's `status` enum to TopBar's `SaveState` enum: `'idle' | 'saving' | 'saved' | 'error' → 'idle' | 'saving' | 'saved' | 'failed'`. Add a tiny inline mapper at the bottom of the file.)

Add the helper at the bottom of the file:

```ts
function autosaveStatusToSaveState(status: 'idle' | 'saving' | 'saved' | 'error'): SaveState {
  if (status === 'error') return 'failed';
  return status;
}
```

- [ ] **Step 2: Update editor page tests**

The test file (after F51) asserts AppShell test-ids. Add new assertions for FormatBar + Paper presence and the save flow:

```tsx
it('renders FormatBar + Paper inside the editor slot', async () => {
  // ... existing setup with stories + chapters fetch mocks ...
  await waitFor(() => expect(screen.getByTestId('app-shell-editor')).toBeInTheDocument());
  // FormatBar exposes a "Style" pill or the "Bold" button as a stable anchor.
  expect(screen.getByRole('button', { name: /bold/i })).toBeInTheDocument();
  // Paper exposes data-testid="paper-status-chip" on the sub-row when status is provided;
  // a more stable check is the chapter-heading testid:
  expect(screen.queryByTestId('chapter-heading')).toBeInTheDocument();
});

it('typing in the editor fires PATCH /api/stories/:s/chapters/:c after debounce', async () => {
  // ... setup so a chapter is active and chapterQuery resolved ...
  // Drive the editor via onReady-captured instance:
  // Wait for the Paper to mount, capture editor via spy on setEditor or via window.
  // Trigger an insertContent('Hello'); advance fake timers past the debounce window;
  // assert fetchMock called with PATCH /api/stories/s1/chapters/c1.
});
```

(Driving the editor in jsdom is most reliable via the `onReady` capture pattern that F62 / F64 already use — do that.)

- [ ] **Step 3: Run the tests**

```bash
cd frontend && npm run test:frontend -- --run tests/pages/editor.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/EditorPage.tsx frontend/tests/pages/editor.test.tsx
git commit -m "[F52] EditorPage: FormatBar + Paper + chapter save pipeline"
```

---

## Task 4: Verify, smoke, tick

- [ ] **Step 1: Run the surrounding suite**

```bash
cd frontend && npm run test:frontend -- --run \
  tests/pages/editor.test.tsx \
  tests/hooks/useChapter.test.ts \
  tests/components/FormatBar.test.tsx \
  tests/components/Paper.test.tsx
```

Expected: all green.

- [ ] **Step 2: Manual smoke**

```bash
make dev
```

- Open a chapter. Confirm FormatBar renders above a centred 720px Paper column with the chapter heading and `§ NN` label.
- Bold/Italic/H1/H2/Quote toggles work; reflect editor state.
- Type in the prose. After ~800ms idle, the TopBar's saveState flips to "Saving…" then "Saved · …". Reload — content survives.
- Click the Find button. It is disabled and shows "Find — coming in [X9]" on hover.
- Switch chapters in the sidebar. Paper swaps content. Editor preserves typing in the new chapter independently.
- F62's `@`-trigger menu (already shipped if F62 has shipped before F52, otherwise N/A in incremental order) opens at the caret since `formatBarExtensions` is the extension list.
- F64 hint strip (if shipped before F52) is visible when the chapter is empty.

- [ ] **Step 3: Tick `[F52]` in TASKS.md**

Auto-tick if verify passes.

- [ ] **Step 4: Final commit**

```bash
git add TASKS.md
git commit -m "[F52] tick — Editor swapped for FormatBar + Paper"
```

---

## Self-Review Notes

- **Spec coverage:** every task-copy clause maps to a step. Find UI is resolved via `[X9]` + a disabled-button affordance, not a code TODO.
- **No TBDs:** chapter save pipeline is shipped; FormatBar's Find button is disabled with documented title; X9 is registered as a separate trackable task.
- **Forward compat:** F56 reads `useAutosave.status` from the same site; F62/F64/F66 already build against `Paper.tsx`; F53 will register SelectionBubble against `proseSelector=".paper-prose"`.
- **No backend changes** — both `GET` and `PATCH` chapter routes already exist per [B3].
