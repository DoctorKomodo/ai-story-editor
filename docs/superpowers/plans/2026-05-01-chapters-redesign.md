# Chapters Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the chapters sidebar to a flat single-line layout (mono row numbers, serif titles, compact `k`-format word counts, soft-fill active row) with `MANUSCRIPT +` section header; bundle in inline-confirm delete and drag-handle a11y; surface tab counts under `CHAPTERS` / `CAST`; add a Sidebar storybook.

**Architecture:** Bottom-up — pure helpers (compact word-count, optimistic-delete reducer) → backend `chapter.repo.remove()` becomes a `$transaction` with sequential `orderIndex` reassignment using the existing D16 two-phase swap → frontend hook (`useDeleteChapterMutation`) → design primitives (`InlineConfirm`, `useInlineConfirm`, `GripIcon`, exported `CloseIcon`) → `ChapterListSectionHeader` → `ChapterList` row redesign → sensors expansion → delete wiring → CSS append → Sidebar tab strip changes (drop `+`, add count line) → `EditorPage` wiring → Storybook variants → aggregate verification.

**Tech Stack:** React 19, TypeScript strict, TailwindCSS, TanStack Query, Zustand, dnd-kit (`@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities`), Vitest + jsdom + Testing Library + userEvent, Storybook 10 (`@storybook/react-vite`), Express + Prisma (backend), Biome.

**Spec:** [`docs/superpowers/specs/2026-05-01-chapters-redesign-design.md`](../specs/2026-05-01-chapters-redesign-design.md). All locked design decisions live there; this plan implements them.

**Branch:** `feat/chapters-ui` (already created and checked out, with the spec committed at `ab351ec`).

**Conventions to follow:**
- TypeScript strict mode is on; no `any`.
- Tests live under `frontend/tests/...` mirroring `frontend/src/...`, and `backend/tests/...` mirroring `backend/src/...`.
- Component tests use `render` + `screen` + `userEvent` from `@testing-library/react` and `vitest`.
- Repo tests use the real test DB via `import { prisma } from '../setup'`.
- Tailwind classes only; tokens are CSS custom properties (`--ink`, `--accent-soft`, etc.).
- Commit message format: `[<area>] <terse summary>` — e.g. `[chapters-ui] add formatWordCountCompact helper`.

---

## Task 1: `formatWordCountCompact` helper

**Files:**
- Create: `frontend/src/lib/formatWordCount.ts`
- Test: `frontend/tests/lib/formatWordCount.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/lib/formatWordCount.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatWordCountCompact } from '@/lib/formatWordCount';

describe('formatWordCountCompact', () => {
  it('renders 0 as em-dash', () => {
    expect(formatWordCountCompact(0)).toBe('—');
  });

  it('renders negatives defensively as em-dash', () => {
    expect(formatWordCountCompact(-1)).toBe('—');
  });

  it('renders 1..999 as the raw integer', () => {
    expect(formatWordCountCompact(1)).toBe('1');
    expect(formatWordCountCompact(987)).toBe('987');
    expect(formatWordCountCompact(999)).toBe('999');
  });

  it('renders >=1000 as one-decimal k', () => {
    expect(formatWordCountCompact(1000)).toBe('1.0k');
    expect(formatWordCountCompact(2000)).toBe('2.0k');
    expect(formatWordCountCompact(2100)).toBe('2.1k');
    expect(formatWordCountCompact(2150)).toBe('2.2k'); // rounds half-up
    expect(formatWordCountCompact(12345)).toBe('12.3k');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/lib/formatWordCount`
Expected: FAIL — module `@/lib/formatWordCount` not found.

- [ ] **Step 3: Implement the helper**

Create `frontend/src/lib/formatWordCount.ts`:

```ts
/**
 * Compact word-count format used in the chapter row's right-side slot.
 *
 *   0          → '—'
 *   negative   → '—'  (defensive — should never happen)
 *   1..999     → raw integer as a string
 *   >=1000     → one-decimal `k` (e.g. 2100 → '2.1k', 2150 → '2.2k')
 */
export function formatWordCountCompact(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1000) return String(Math.trunc(n));
  return `${(n / 1000).toFixed(1)}k`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/lib/formatWordCount`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/formatWordCount.ts frontend/tests/lib/formatWordCount.test.ts
git commit -m "[chapters-ui] add formatWordCountCompact helper"
```

---

## Task 2: `computeChaptersAfterDelete` pure helper

**Files:**
- Modify: `frontend/src/hooks/useChapters.ts` (add export)
- Test: `frontend/tests/hooks/useChapter.test.tsx` (extend existing file)

- [ ] **Step 1: Write the failing test**

Append to `frontend/tests/hooks/useChapter.test.tsx` (after the last `describe` block):

```tsx
import { computeChaptersAfterDelete } from '@/hooks/useChapters';
import type { ChapterMeta } from '@/hooks/useChapters';

function meta(id: string, orderIndex: number): ChapterMeta {
  return {
    id,
    storyId: 's',
    title: id,
    wordCount: 0,
    orderIndex,
    status: 'draft',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
  };
}

describe('computeChaptersAfterDelete', () => {
  it('returns null when the chapter id is not present', () => {
    const list = [meta('a', 0), meta('b', 1)];
    expect(computeChaptersAfterDelete(list, 'zzz')).toBeNull();
  });

  it('removes the chapter and reassigns orderIndex 0..N-1', () => {
    const list = [meta('a', 0), meta('b', 1), meta('c', 2), meta('d', 3)];
    const next = computeChaptersAfterDelete(list, 'b');
    expect(next).not.toBeNull();
    expect(next?.map((c) => [c.id, c.orderIndex])).toEqual([
      ['a', 0],
      ['c', 1],
      ['d', 2],
    ]);
  });

  it('preserves existing orderIndex when no shift is needed', () => {
    const list = [meta('a', 0), meta('b', 1), meta('c', 2)];
    const next = computeChaptersAfterDelete(list, 'c');
    expect(next?.map((c) => [c.id, c.orderIndex])).toEqual([
      ['a', 0],
      ['b', 1],
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/hooks/useChapter`
Expected: FAIL — `computeChaptersAfterDelete` is not exported from `@/hooks/useChapters`.

- [ ] **Step 3: Add the helper to `useChapters.ts`**

Edit `frontend/src/hooks/useChapters.ts` — locate the existing `computeReorderedChapters` function (search for `export function computeReorderedChapters`) and add this immediately after it:

```ts
/**
 * Pure helper for the delete optimistic update — removes the chapter and
 * reassigns sequential orderIndex on the remainder.
 *
 * Returns `null` if the id isn't present (nothing to do — caller should
 * skip the mutation).
 */
export function computeChaptersAfterDelete(
  current: readonly ChapterMeta[],
  chapterId: string,
): ChapterMeta[] | null {
  const idx = current.findIndex((c) => c.id === chapterId);
  if (idx === -1) return null;
  const remaining = current.filter((c) => c.id !== chapterId);
  return withSequentialOrderIndex(remaining);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/hooks/useChapter`
Expected: PASS — including the 3 new tests plus all pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useChapters.ts frontend/tests/hooks/useChapter.test.tsx
git commit -m "[chapters-ui] add computeChaptersAfterDelete pure helper"
```

---

## Task 3: Backend `chapter.repo.remove()` reassigns orderIndex

**Files:**
- Modify: `backend/src/repos/chapter.repo.ts:157-161` (the `remove` function)
- Test: `backend/tests/repos/chapter.repo.test.ts` (extend existing file)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/repos/chapter.repo.test.ts` (after the last `it` block, still inside the existing top-level `describe`):

```ts
  describe('remove() — orderIndex reassignment', () => {
    it('removes the chapter and reassigns sequential orderIndex 0..N-1 on the remainder', async () => {
      const ctx = await makeUserContext('rm-reseq');
      const story = await createStoryRepo(ctx.req).create({ title: 's' });
      const repo = createChapterRepo(ctx.req);

      const a = await repo.create({ storyId: story.id as string, title: 'a', orderIndex: 0 });
      const b = await repo.create({ storyId: story.id as string, title: 'b', orderIndex: 1 });
      const c = await repo.create({ storyId: story.id as string, title: 'c', orderIndex: 2 });
      const d = await repo.create({ storyId: story.id as string, title: 'd', orderIndex: 3 });

      const ok = await repo.remove(b.id as string);
      expect(ok).toBe(true);

      const list = await repo.findManyForStory(story.id as string);
      expect(list.map((ch) => [ch.id, ch.orderIndex])).toEqual([
        [a.id, 0],
        [c.id, 1],
        [d.id, 2],
      ]);
    });

    it('returns false when the id does not exist and does not mutate other rows', async () => {
      const ctx = await makeUserContext('rm-noop');
      const story = await createStoryRepo(ctx.req).create({ title: 's' });
      const repo = createChapterRepo(ctx.req);
      await repo.create({ storyId: story.id as string, title: 'a', orderIndex: 0 });
      await repo.create({ storyId: story.id as string, title: 'b', orderIndex: 1 });

      const ok = await repo.remove('non-existent-id');
      expect(ok).toBe(false);

      const list = await repo.findManyForStory(story.id as string);
      expect(list.map((ch) => ch.orderIndex)).toEqual([0, 1]);
    });

    it('refuses to remove another user\'s chapter and leaves their list intact', async () => {
      const alice = await makeUserContext('rm-alice');
      const bob = await makeUserContext('rm-bob');
      const story = await createStoryRepo(alice.req).create({ title: 's' });
      const ch = await createChapterRepo(alice.req).create({
        storyId: story.id as string,
        title: 't',
        orderIndex: 0,
      });

      const ok = await createChapterRepo(bob.req).remove(ch.id as string);
      expect(ok).toBe(false);

      const list = await createChapterRepo(alice.req).findManyForStory(story.id as string);
      expect(list).toHaveLength(1);
      expect(list[0]?.id).toBe(ch.id);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm run db:test:reset && npm run test -- repos/chapter.repo`
Expected: the first new test (`reassigns sequential orderIndex 0..N-1`) FAILS — current `remove()` only deletes, leaves `[a:0, c:2, d:3]`.

- [ ] **Step 3: Replace the `remove()` implementation with a transactional version**

Edit `backend/src/repos/chapter.repo.ts` — replace lines `157-161`:

```ts
  async function remove(id: string) {
    const userId = resolveUserId(req);
    return client.$transaction(async (tx) => {
      const target = await tx.chapter.findFirst({
        where: { id, story: { userId } },
        select: { id: true, storyId: true },
      });
      if (!target) return false;

      await tx.chapter.delete({ where: { id: target.id } });

      // Re-pack remaining chapters into sequential orderIndex 0..N-1, ordered
      // by their existing (orderIndex, createdAt) — same key as findManyForStory.
      // Mirrors the [D16] two-phase swap (negative parking values dodge the
      // @@unique([storyId, orderIndex]) constraint mid-transaction).
      const remaining = await tx.chapter.findMany({
        where: { storyId: target.storyId },
        orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
        select: { id: true },
      });
      for (let i = 0; i < remaining.length; i++) {
        await tx.chapter.update({
          where: { id: remaining[i]!.id },
          data: { orderIndex: -(i + 1) },
        });
      }
      for (let i = 0; i < remaining.length; i++) {
        await tx.chapter.update({
          where: { id: remaining[i]!.id },
          data: { orderIndex: i },
        });
      }
      return true;
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm run db:test:reset && npm run test -- repos/chapter.repo`
Expected: PASS — all three new cases plus pre-existing chapter.repo tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/repos/chapter.repo.ts backend/tests/repos/chapter.repo.test.ts
git commit -m "[chapters-ui] chapter.remove() reassigns sequential orderIndex"
```

---

## Task 4: Verify DELETE route returns 204 + reassigned orderIndex

**Files:**
- Test: `backend/tests/routes/chapters.routes.test.ts` (extend existing file)

- [ ] **Step 1: Locate the existing DELETE-route describe block (or add one)**

Run: `grep -nE "DELETE|delete chapter|chapters/:chapterId" backend/tests/routes/chapters.routes.test.ts`
If a DELETE describe exists, append the new test inside it; otherwise add a new `describe('DELETE /api/stories/:storyId/chapters/:chapterId', ...)` block at the end of the file (still inside the top-level describe).

- [ ] **Step 2: Write the failing test**

Append (inside the appropriate describe — uses the same auth + supertest helpers the rest of the file uses; name them `agent` and `setupUser` if those are the existing helper names — read the top of the file to confirm and adapt the names below if they differ):

```ts
    it('204 on success and the next GET returns sequential orderIndex 0..N-1', async () => {
      const { agent, storyId } = await setupAuthedStoryWithChapters(['a', 'b', 'c', 'd']);

      // Sanity — list pre-delete.
      const before = await agent.get(`/api/stories/${storyId}/chapters`).expect(200);
      expect((before.body.chapters as Array<{ orderIndex: number }>).map((c) => c.orderIndex))
        .toEqual([0, 1, 2, 3]);

      const targetId = before.body.chapters[1].id as string;
      await agent.delete(`/api/stories/${storyId}/chapters/${targetId}`).expect(204);

      const after = await agent.get(`/api/stories/${storyId}/chapters`).expect(200);
      expect((after.body.chapters as Array<{ id: string; orderIndex: number }>)).toHaveLength(3);
      expect(after.body.chapters.map((c: { orderIndex: number }) => c.orderIndex)).toEqual([0, 1, 2]);
      expect(after.body.chapters.find((c: { id: string }) => c.id === targetId)).toBeUndefined();
    });
```

If `setupAuthedStoryWithChapters` does not exist in the file, look for whatever helper the existing chapter route tests use to seed an authed user + story + chapters and adapt the call. Do not invent a new helper — reuse the file's existing setup pattern.

- [ ] **Step 3: Run test to verify it passes**

Run: `cd backend && npm run db:test:reset && npm run test -- routes/chapters.routes`
Expected: PASS — the route already exists and the repo change from Task 3 makes the reassignment assertion succeed.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/routes/chapters.routes.test.ts
git commit -m "[chapters-ui] route test: DELETE chapter reassigns orderIndex"
```

---

## Task 5: Add `useDeleteChapterMutation` to the chapters hook

**Files:**
- Modify: `frontend/src/hooks/useChapters.ts`
- Test: `frontend/tests/hooks/useChapter.test.tsx` (extend further)

- [ ] **Step 1: Write the failing test**

Append to `frontend/tests/hooks/useChapter.test.tsx`:

```tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  chapterQueryKey,
  chaptersQueryKey,
  useDeleteChapterMutation,
} from '@/hooks/useChapters';

describe('useDeleteChapterMutation', () => {
  beforeEach(() => {
    resetApiClientForTests();
    setAccessToken('tok-1');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientForTests();
  });

  function makeWrapper(qc: QueryClient): React.FC<{ children: React.ReactNode }> {
    const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    return Wrapper;
  }

  it('DELETEs the chapter, evicts the per-chapter cache, and reassigns the list cache optimistically', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(chaptersQueryKey('s1'), [
      meta('a', 0),
      meta('b', 1),
      meta('c', 2),
    ]);
    qc.setQueryData(chapterQueryKey('b'), { ...meta('b', 1), bodyJson: null });

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const { result } = renderHook(() => useDeleteChapterMutation('s1'), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync({ chapterId: 'b' });
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/stories/s1/chapters/b');
    expect((init as RequestInit).method).toBe('DELETE');

    // Per-chapter cache evicted.
    expect(qc.getQueryData(chapterQueryKey('b'))).toBeUndefined();

    // After settled, the list cache is invalidated; we still expect the
    // optimistic state if no refetch is wired (no fetchMock for GET).
    await waitFor(() => {
      const list = qc.getQueryData<ChapterMeta[]>(chaptersQueryKey('s1'));
      expect(list?.map((c) => c.id)).toEqual(['a', 'c']);
    });
  });

  it('rolls back the cache on 500', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(chaptersQueryKey('s1'), [meta('a', 0), meta('b', 1)]);

    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: { code: 'oops' } }));

    const { result } = renderHook(() => useDeleteChapterMutation('s1'), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await expect(result.current.mutateAsync({ chapterId: 'b' })).rejects.toBeDefined();
    });

    expect(qc.getQueryData<ChapterMeta[]>(chaptersQueryKey('s1'))?.map((c) => c.id)).toEqual([
      'a',
      'b',
    ]);
  });
});
```

If `jsonResponse` is not already defined at the top of the test file, copy this helper alongside `meta`:

```ts
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/hooks/useChapter`
Expected: FAIL — `useDeleteChapterMutation` is not exported from `@/hooks/useChapters`.

- [ ] **Step 3: Add the mutation to `useChapters.ts`**

Edit `frontend/src/hooks/useChapters.ts` — append after `computeChaptersAfterDelete` (added in Task 2):

```ts
export interface DeleteChapterArgs {
  chapterId: string;
}

export interface DeleteMutationContext {
  previous: ChapterMeta[] | undefined;
}

/**
 * Delete a chapter via DELETE /api/stories/:storyId/chapters/:chapterId.
 *
 * Optimistic: removes from the list cache + reassigns sequential orderIndex
 * immediately. Backend reassigns server-side in the same transaction; we
 * mirror it client-side so the UI doesn't show a numbering gap during the
 * round-trip.
 *
 * On error: rolls back to the snapshot. On settled: invalidates so the
 * server's truth wins. On success: also evicts the per-chapter cache so a
 * stale hit can't resurrect deleted body content.
 */
export function useDeleteChapterMutation(
  storyId: string,
): UseMutationResult<void, Error, DeleteChapterArgs, DeleteMutationContext> {
  const qc = useQueryClient();
  return useMutation<void, Error, DeleteChapterArgs, DeleteMutationContext>({
    mutationFn: async ({ chapterId }) => {
      await api<void>(
        `/stories/${encodeURIComponent(storyId)}/chapters/${encodeURIComponent(chapterId)}`,
        { method: 'DELETE' },
      );
    },
    onMutate: async ({ chapterId }) => {
      await qc.cancelQueries({ queryKey: chaptersQueryKey(storyId) });
      const previous = qc.getQueryData<ChapterMeta[]>(chaptersQueryKey(storyId));
      if (previous !== undefined) {
        const next = computeChaptersAfterDelete(previous, chapterId);
        if (next !== null) {
          qc.setQueryData<ChapterMeta[]>(chaptersQueryKey(storyId), next);
        }
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous !== undefined) {
        qc.setQueryData<ChapterMeta[]>(chaptersQueryKey(storyId), context.previous);
      }
    },
    onSuccess: (_void, { chapterId }) => {
      qc.removeQueries({ queryKey: chapterQueryKey(chapterId) });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: chaptersQueryKey(storyId) });
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/hooks/useChapter`
Expected: PASS — both `useDeleteChapterMutation` cases plus all earlier tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useChapters.ts frontend/tests/hooks/useChapter.test.tsx
git commit -m "[chapters-ui] add useDeleteChapterMutation with optimistic reassign"
```

---

## Task 6: Promote `CloseIcon` to export, add `GripIcon`

**Files:**
- Modify: `frontend/src/design/primitives.tsx`

- [ ] **Step 1: Promote `CloseIcon` to a named export**

Edit `frontend/src/design/primitives.tsx` — locate `function CloseIcon(): JSX.Element {` (currently a private function) and change `function` to `export function`. No other change to its body.

- [ ] **Step 2: Add `GripIcon` next to `CloseIcon`**

Add (immediately after `CloseIcon`):

```tsx
export function GripIcon(): JSX.Element {
  return (
    <svg
      width="12"
      height="14"
      viewBox="0 0 12 14"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="3" cy="3" r="1.2" />
      <circle cx="9" cy="3" r="1.2" />
      <circle cx="3" cy="7" r="1.2" />
      <circle cx="9" cy="7" r="1.2" />
      <circle cx="3" cy="11" r="1.2" />
      <circle cx="9" cy="11" r="1.2" />
    </svg>
  );
}
```

- [ ] **Step 3: Verify typecheck still passes**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/design/primitives.tsx
git commit -m "[chapters-ui] export CloseIcon, add GripIcon"
```

---

## Task 7: Add `InlineConfirm` + `useInlineConfirm` to primitives

**Files:**
- Modify: `frontend/src/design/primitives.tsx`

- [ ] **Step 1: Add the hook + component**

Edit `frontend/src/design/primitives.tsx` — append at the end of the file (just before the trailing `export { useId, useRef };` re-export, or wherever the existing trailing re-exports live):

```tsx
/* ============================================================================
 * useInlineConfirm — controlled state for an inline Delete/Cancel pair.
 *
 * Owns the ephemeral concerns:
 *   - Open / close.
 *   - Escape dismisses.
 *   - Outside-click on the host element dismisses (capture-phase mousedown
 *     so a row-level handler doesn't swallow the event first).
 * ========================================================================== */

export interface UseInlineConfirmReturn {
  open: boolean;
  ask: () => void;
  dismiss: () => void;
  props: { onCancel: () => void };
}

export function useInlineConfirm(
  hostRef: RefObject<HTMLElement | null>,
): UseInlineConfirmReturn {
  const [open, setOpen] = useState(false);

  const ask = useCallback(() => {
    setOpen(true);
  }, []);
  const dismiss = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: globalThis.MouseEvent): void => {
      const host = hostRef.current;
      if (!host) return;
      if (e.target instanceof Node && host.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener('mousedown', onDown, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
    };
  }, [open, hostRef]);

  return { open, ask, dismiss, props: { onCancel: dismiss } };
}

/* ============================================================================
 * <InlineConfirm/> — destructive Delete/Cancel pair, autofocus on Delete.
 * ========================================================================== */

export interface InlineConfirmProps {
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
  testId?: string;
}

export function InlineConfirm({
  label,
  onConfirm,
  onCancel,
  pending,
  testId,
}: InlineConfirmProps): JSX.Element {
  const deleteRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    deleteRef.current?.focus();
  }, []);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCancel();
    }
  };

  return (
    <div
      role="group"
      aria-label={label}
      data-testid={testId}
      onKeyDown={onKeyDown}
      className="flex items-center gap-1.5"
    >
      <Button
        ref={deleteRef}
        variant="danger"
        size="sm"
        loading={pending}
        onClick={onConfirm}
        data-testid={testId ? `${testId}-delete` : undefined}
      >
        Delete
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onCancel}
        disabled={pending}
        data-testid={testId ? `${testId}-cancel` : undefined}
      >
        Cancel
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Add `RefObject` and `KeyboardEvent as ReactKeyboardEvent` to the existing type-only import block**

Edit the existing top-of-file `import type { ... } from 'react';` block to also include `KeyboardEvent as ReactKeyboardEvent` and `RefObject` (both may already be imported — check first; do not duplicate).

- [ ] **Step 3: Verify typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/design/primitives.tsx
git commit -m "[chapters-ui] add InlineConfirm + useInlineConfirm primitives"
```

---

## Task 8: Storybook for `InlineConfirm`

**Files:**
- Create: `frontend/src/design/InlineConfirm.stories.tsx`

- [ ] **Step 1: Write the story file**

Create `frontend/src/design/InlineConfirm.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useRef } from 'react';
import { InlineConfirm, useInlineConfirm } from './primitives';

function Harness(): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const confirm = useInlineConfirm(hostRef);

  return (
    <div ref={hostRef} style={{ width: 320 }}>
      <div className="flex items-center justify-between rounded border border-line p-2 bg-bg-elevated">
        <span className="font-sans text-[13px] text-ink">Threshold</span>
        {confirm.open ? (
          <InlineConfirm
            {...confirm.props}
            label="Delete chapter"
            onConfirm={() => {
              window.alert('confirmed');
              confirm.dismiss();
            }}
            testId="confirm"
          />
        ) : (
          <button
            type="button"
            onClick={confirm.ask}
            className="font-sans text-[12px] text-danger underline"
          >
            Delete
          </button>
        )}
      </div>
      <p className="mt-3 font-sans text-[11px] text-ink-4">
        Click outside the row to dismiss. Press Escape to dismiss. Press Enter to confirm.
      </p>
    </div>
  );
}

const meta = {
  title: 'Primitives/InlineConfirm',
  component: Harness,
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
```

- [ ] **Step 2: Smoke-build Storybook**

Run: `cd frontend && npm run storybook -- --no-open --quiet & sleep 6 && kill %1`

If `npm run storybook` doesn't accept `--no-open`, instead run `cd frontend && npm run build-storybook` once and confirm no build errors.

Expected: build / boot completes without errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/design/InlineConfirm.stories.tsx
git commit -m "[chapters-ui] storybook: InlineConfirm primitive"
```

---

## Task 9: `ChapterListSectionHeader` component

**Files:**
- Create: `frontend/src/components/ChapterListSectionHeader.tsx`

- [ ] **Step 1: Write the component**

Create `frontend/src/components/ChapterListSectionHeader.tsx`:

```tsx
import type { JSX } from 'react';
import { IconButton, Spinner } from '@/design/primitives';

interface PlusIconProps {
  className?: string;
}

function PlusIcon({ className }: PlusIconProps): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export interface ChapterListSectionHeaderProps {
  onAdd: () => void;
  pending?: boolean;
}

/**
 * MANUSCRIPT + section header for the chapter list. Stateless. Cast and
 * Outline panels will copy this shape later.
 */
export function ChapterListSectionHeader({
  onAdd,
  pending = false,
}: ChapterListSectionHeaderProps): JSX.Element {
  return (
    <div className="flex items-center justify-between px-3 pt-3 pb-1.5">
      <span
        className="font-mono text-[11px] tracking-[.08em] uppercase text-ink-4"
        data-testid="chapter-list-section-label"
      >
        MANUSCRIPT
      </span>
      <IconButton
        ariaLabel="Add chapter"
        onClick={onAdd}
        disabled={pending}
        testId="chapter-list-add"
      >
        {pending ? <Spinner size={12} /> : <PlusIcon />}
      </IconButton>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ChapterListSectionHeader.tsx
git commit -m "[chapters-ui] add ChapterListSectionHeader component"
```

---

## Task 10: ChapterList — visual reskin (flat row, number, serif, k-format)

**Files:**
- Modify: `frontend/src/components/ChapterList.tsx`
- Test: `frontend/tests/components/ChapterList.test.tsx` (extend)

This task changes the row layout but does NOT add delete or new sensors yet (Tasks 11 + 12 do those). It does replace the standalone "Add chapter" button with the new section header.

- [ ] **Step 1: Write failing assertions for the new visual contract**

Append to `frontend/tests/components/ChapterList.test.tsx` inside the existing `describe('ChapterList (F10)')`:

```tsx
  it('renders zero-padded row numbers from orderIndex+1', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        chapters: [
          chap({ id: 'c1', orderIndex: 0, title: 'A' }),
          chap({ id: 'c2', orderIndex: 1, title: 'B' }),
        ],
      }),
    );
    renderList(() => {});
    await screen.findByTestId('chapter-row-c1');
    expect(within(screen.getByTestId('chapter-row-c1')).getByText('01')).toBeInTheDocument();
    expect(within(screen.getByTestId('chapter-row-c2')).getByText('02')).toBeInTheDocument();
  });

  it('renders compact word counts and em-dash for zero', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        chapters: [
          chap({ id: 'c1', orderIndex: 0, wordCount: 2100, title: 'A' }),
          chap({ id: 'c2', orderIndex: 1, wordCount: 0, title: 'B' }),
        ],
      }),
    );
    renderList(() => {});
    await screen.findByTestId('chapter-row-c1');
    expect(within(screen.getByTestId('chapter-row-c1')).getByText('2.1k')).toBeInTheDocument();
    expect(within(screen.getByTestId('chapter-row-c2')).getByText('—')).toBeInTheDocument();
  });

  it('section header renders MANUSCRIPT label and an Add Chapter + button that POSTs', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { chapters: [] }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          chapter: { ...chap({ id: 'new', orderIndex: 0, title: 'Untitled chapter' }), bodyJson: null },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { chapters: [chap({ id: 'new', orderIndex: 0, title: 'Untitled chapter' })] }));

    const onSelect = vi.fn();
    renderList(onSelect);
    await screen.findByTestId('chapter-list-section-label');
    expect(screen.getByTestId('chapter-list-section-label')).toHaveTextContent('MANUSCRIPT');
    await userEvent.click(screen.getByTestId('chapter-list-add'));
    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith('new');
    });
  });
```

The third test replaces the existing `"Add chapter" click POSTs ...` test — locate that test in the file and delete it (the new one supersedes it because the button moved into the section header).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/components/ChapterList.test`
Expected: FAIL on the three new assertions.

- [ ] **Step 3: Replace `ChapterList.tsx` row + container with the new visual**

Edit `frontend/src/components/ChapterList.tsx`. The shape:

- Top of file imports add `formatWordCountCompact` and `ChapterListSectionHeader`:

```tsx
import { ChapterListSectionHeader } from '@/components/ChapterListSectionHeader';
import { formatWordCountCompact } from '@/lib/formatWordCount';
import { GripIcon } from '@/design/primitives';
```

- Drop the existing `formatWordCount` function (no longer used).
- Drop `Button` import (replaced by IconButton inside section header).
- `ChapterRow` becomes the flat single-line layout. Replace the existing function with:

```tsx
function ChapterRow({ chapter, active, onSelect }: ChapterRowProps): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } =
    useSortable({ id: chapter.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-active={active ? 'true' : undefined}
      data-over={isOver ? 'true' : undefined}
      data-testid={`chapter-row-${chapter.id}`}
      aria-current={active ? 'true' : undefined}
      className={[
        'group flex items-center gap-2 pl-3 pr-2 h-8 rounded-[var(--radius)]',
        'transition-colors cursor-pointer',
        active ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--surface-hover)]',
        isOver ? 'ring-1 ring-ink' : '',
        isDragging ? 'opacity-60' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        type="button"
        aria-label="Reorder"
        data-testid={`chapter-row-${chapter.id}-grip`}
        className={[
          'grip cursor-grab touch-none text-ink-4 hover:text-ink-2',
          'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
          'is-coarse-pointer-visible',
          'flex-shrink-0',
        ].join(' ')}
        {...attributes}
        {...listeners}
      >
        <GripIcon />
      </button>
      <span
        aria-hidden="true"
        className="font-mono text-[11px] text-ink-4 tabular-nums w-5 flex-shrink-0"
      >
        {String(chapter.orderIndex + 1).padStart(2, '0')}
      </span>
      <button
        type="button"
        onClick={() => {
          onSelect(chapter.id);
        }}
        className="flex-1 min-w-0 text-left font-serif text-[14px] text-ink leading-tight truncate"
      >
        {chapterDisplayTitle(chapter)}
      </button>
      <span className="font-mono text-[11px] text-ink-4 tabular-nums w-14 flex-shrink-0 text-right">
        {formatWordCountCompact(chapter.wordCount)}
      </span>
    </li>
  );
}
```

- The exported `ChapterList` body: replace the standalone `<Button … >Add chapter</Button>` with `<ChapterListSectionHeader onAdd={handleAdd} pending={createChapter.isPending} />`. Drop the surrounding `flex flex-col gap-3` wrapper's gap to match the new tighter layout — replace with `flex flex-col` (no gap), and pad the empty/loading messages with `px-3`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/components/ChapterList.test`
Expected: PASS — including all three new tests AND every pre-existing test (some pre-existing tests may need to be updated if they assert the v1 "Add chapter" text or the old word-count format; if so, replace the assertions in those tests with the new layout, e.g. assert on the section-header label / `chapter-list-add` testId / compact word-count strings).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ChapterList.tsx frontend/tests/components/ChapterList.test.tsx
git commit -m "[chapters-ui] reskin ChapterList row to flat single-line layout"
```

---

## Task 11: Expand sensors — KeyboardSensor + TouchSensor

**Files:**
- Modify: `frontend/src/components/ChapterList.tsx`

- [ ] **Step 1: Replace the `useSensors(...)` block**

Edit `frontend/src/components/ChapterList.tsx` — top of file imports:

```tsx
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
```

In the `ChapterList` body, replace the existing single-sensor `useSensors(...)` call with:

```tsx
  // Mouse: 4px activation distance.
  // Touch: 200ms long-press, 5px tolerance — lets the user scroll the list
  //        without accidentally lifting a row.
  // Keyboard: Space lifts/drops, arrow keys reorder, Escape cancels.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
```

- [ ] **Step 2: Verify all chapter-list tests still pass**

Run: `cd frontend && npx vitest run tests/components/ChapterList.test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ChapterList.tsx
git commit -m "[chapters-ui] add KeyboardSensor + TouchSensor to chapter reorder"
```

---

## Task 12: Delete wiring — `×` on active row + InlineConfirm + delete mutation + `onChapterDeleted`

**Files:**
- Modify: `frontend/src/components/ChapterList.tsx`
- Test: `frontend/tests/components/ChapterList.delete.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/components/ChapterList.delete.test.tsx`:

```tsx
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChapterList } from '@/components/ChapterList';
import { resetApiClientForTests, setAccessToken, setUnauthorizedHandler } from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';
import { useSessionStore } from '@/store/session';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function chap(o: { id: string; orderIndex: number; title?: string; wordCount?: number }) {
  return {
    id: o.id,
    storyId: 'story-1',
    title: o.title ?? `Chapter ${String(o.orderIndex + 1)}`,
    wordCount: o.wordCount ?? 100,
    orderIndex: o.orderIndex,
    status: 'draft' as const,
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
  };
}

function renderList(opts: {
  activeChapterId: string | null;
  onChapterDeleted?: (id: string) => void;
}): { client: QueryClient } {
  const qc = createQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <ChapterList
        storyId="story-1"
        activeChapterId={opts.activeChapterId}
        onSelectChapter={() => {}}
        onChapterDeleted={opts.onChapterDeleted}
      />
    </QueryClientProvider>,
  );
  return { client: qc };
}

describe('ChapterList — delete', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetApiClientForTests();
    setAccessToken('tok-1');
    setUnauthorizedHandler(() => useSessionStore.getState().clearSession());
    useSessionStore.setState({ user: { id: 'u1', username: 'alice' }, status: 'authenticated' });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
  });

  it('renders × only on the active row', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        chapters: [chap({ id: 'c1', orderIndex: 0 }), chap({ id: 'c2', orderIndex: 1 })],
      }),
    );
    renderList({ activeChapterId: 'c2' });
    await screen.findByTestId('chapter-row-c2');
    expect(screen.getByTestId('chapter-row-c2-delete')).toBeInTheDocument();
    expect(screen.queryByTestId('chapter-row-c1-delete')).toBeNull();
  });

  it('clicking × opens InlineConfirm and replaces the word-count slot', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { chapters: [chap({ id: 'c1', orderIndex: 0, wordCount: 1500 })] }),
    );
    renderList({ activeChapterId: 'c1' });
    await screen.findByTestId('chapter-row-c1');
    expect(within(screen.getByTestId('chapter-row-c1')).getByText('1.5k')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('chapter-row-c1-delete'));
    expect(screen.getByTestId('chapter-row-c1-confirm-delete')).toHaveFocus();
    expect(within(screen.getByTestId('chapter-row-c1')).queryByText('1.5k')).toBeNull();
  });

  it('Escape dismisses the confirm', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { chapters: [chap({ id: 'c1', orderIndex: 0 })] }),
    );
    renderList({ activeChapterId: 'c1' });
    await screen.findByTestId('chapter-row-c1');
    await userEvent.click(screen.getByTestId('chapter-row-c1-delete'));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByTestId('chapter-row-c1-confirm-delete')).toBeNull();
    });
  });

  it('clicking Delete fires DELETE and removes the row optimistically; onChapterDeleted is called', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          chapters: [chap({ id: 'c1', orderIndex: 0 }), chap({ id: 'c2', orderIndex: 1 })],
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse(200, { chapters: [chap({ id: 'c2', orderIndex: 0 })] }));

    const onChapterDeleted = vi.fn();
    renderList({ activeChapterId: 'c1', onChapterDeleted });
    await screen.findByTestId('chapter-row-c1');
    await userEvent.click(screen.getByTestId('chapter-row-c1-delete'));
    await userEvent.click(screen.getByTestId('chapter-row-c1-confirm-delete'));

    await waitFor(() => {
      expect(screen.queryByTestId('chapter-row-c1')).toBeNull();
    });
    expect(onChapterDeleted).toHaveBeenCalledWith('c1');
  });

  it('on 500 the row is restored and an aria-live status is set', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, { chapters: [chap({ id: 'c1', orderIndex: 0 })] }),
      )
      .mockResolvedValueOnce(jsonResponse(500, { error: { code: 'oops' } }));

    renderList({ activeChapterId: 'c1' });
    await screen.findByTestId('chapter-row-c1');
    await userEvent.click(screen.getByTestId('chapter-row-c1-delete'));
    await userEvent.click(screen.getByTestId('chapter-row-c1-confirm-delete'));

    await waitFor(() => {
      expect(screen.getByTestId('chapter-row-c1')).toBeInTheDocument();
    });
    expect(screen.getByText(/Delete failed/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/components/ChapterList.delete`
Expected: FAIL — `ChapterList` does not yet accept `onChapterDeleted`, render `chapter-row-*-delete`, or wire the mutation.

- [ ] **Step 3: Wire delete in `ChapterList.tsx`**

Edit `frontend/src/components/ChapterList.tsx`:

(a) Imports — add to the existing imports:

```tsx
import { useRef, useState, useCallback } from 'react';
import {
  CloseIcon,
  IconButton,
  InlineConfirm,
  useInlineConfirm,
} from '@/design/primitives';
import { useDeleteChapterMutation } from '@/hooks/useChapters';
```

(b) Extend `ChapterListProps`:

```tsx
export interface ChapterListProps {
  storyId: string;
  activeChapterId: string | null;
  onSelectChapter: (chapterId: string) => void;
  onChapterDeleted?: (chapterId: string) => void;
}
```

(c) Extend `ChapterRowProps` and update the `ChapterRow` to render the `×` + InlineConfirm in the right slot. Replace the existing `ChapterRow` body's right-side word-count `<span>` with the conditional below; the rest of the row stays as written in Task 10:

```tsx
interface ChapterRowProps {
  chapter: ChapterMeta;
  active: boolean;
  onSelect: (id: string) => void;
  onRequestDelete: (chapterId: string) => Promise<void>;
  isDeleting: boolean;
}

function ChapterRow({
  chapter,
  active,
  onSelect,
  onRequestDelete,
  isDeleting,
}: ChapterRowProps): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } =
    useSortable({ id: chapter.id });

  const liRef = useRef<HTMLLIElement>(null);
  const confirm = useInlineConfirm(liRef);

  const setRefs = (node: HTMLLIElement | null): void => {
    liRef.current = node;
    setNodeRef(node);
  };

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const onConfirmDelete = async (): Promise<void> => {
    try {
      await onRequestDelete(chapter.id);
      confirm.dismiss();
    } catch {
      // Mutation surfaces error via parent's aria-live region; keep the
      // confirm open so the user can retry.
    }
  };

  return (
    <li
      ref={setRefs}
      style={style}
      data-active={active ? 'true' : undefined}
      data-over={isOver ? 'true' : undefined}
      data-testid={`chapter-row-${chapter.id}`}
      aria-current={active ? 'true' : undefined}
      className={[
        'group flex items-center gap-2 pl-3 pr-2 h-8 rounded-[var(--radius)]',
        'transition-colors cursor-pointer',
        active ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--surface-hover)]',
        isOver ? 'ring-1 ring-ink' : '',
        isDragging ? 'opacity-60' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        type="button"
        aria-label="Reorder"
        data-testid={`chapter-row-${chapter.id}-grip`}
        className={[
          'grip cursor-grab touch-none text-ink-4 hover:text-ink-2',
          'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
          'is-coarse-pointer-visible',
          'flex-shrink-0',
        ].join(' ')}
        {...attributes}
        {...listeners}
      >
        <GripIcon />
      </button>
      <span
        aria-hidden="true"
        className="font-mono text-[11px] text-ink-4 tabular-nums w-5 flex-shrink-0"
      >
        {String(chapter.orderIndex + 1).padStart(2, '0')}
      </span>
      <button
        type="button"
        onClick={() => {
          onSelect(chapter.id);
        }}
        className="flex-1 min-w-0 text-left font-serif text-[14px] text-ink leading-tight truncate"
      >
        {chapterDisplayTitle(chapter)}
      </button>
      {confirm.open ? (
        <InlineConfirm
          {...confirm.props}
          label={`Delete ${chapterDisplayTitle(chapter)}`}
          onConfirm={() => {
            void onConfirmDelete();
          }}
          pending={isDeleting}
          testId={`chapter-row-${chapter.id}-confirm`}
        />
      ) : (
        <>
          <span className="font-mono text-[11px] text-ink-4 tabular-nums w-14 flex-shrink-0 text-right">
            {formatWordCountCompact(chapter.wordCount)}
          </span>
          {active ? (
            <IconButton
              ariaLabel={`Delete ${chapterDisplayTitle(chapter)}`}
              onClick={confirm.ask}
              testId={`chapter-row-${chapter.id}-delete`}
              className="flex-shrink-0"
            >
              <CloseIcon />
            </IconButton>
          ) : null}
        </>
      )}
    </li>
  );
}
```

(d) `ChapterList` body — add `deleteChapter`, `deleteStatus`, `pendingDeleteId`, and `handleRequestDelete`. Wire `onChapterDeleted` and pass props through:

```tsx
  const deleteChapter = useDeleteChapterMutation(storyId);
  const [deleteStatus, setDeleteStatus] = useState<string>('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const handleRequestDelete = useCallback(
    async (chapterId: string): Promise<void> => {
      setDeleteStatus('');
      setPendingDeleteId(chapterId);
      try {
        await deleteChapter.mutateAsync({ chapterId });
        if (onChapterDeleted) onChapterDeleted(chapterId);
      } catch (err) {
        const message =
          err instanceof ApiError && err.status === 404
            ? 'Chapter already removed — refreshed'
            : 'Delete failed — try again';
        setDeleteStatus(message);
        throw err;
      } finally {
        setPendingDeleteId(null);
      }
    },
    [deleteChapter, onChapterDeleted],
  );
```

(e) Pass `onRequestDelete` and `isDeleting` into each `<ChapterRow>`:

```tsx
              {list.map((c) => (
                <ChapterRow
                  key={c.id}
                  chapter={c}
                  active={c.id === activeChapterId}
                  onSelect={onSelectChapter}
                  onRequestDelete={handleRequestDelete}
                  isDeleting={pendingDeleteId === c.id}
                />
              ))}
```

(f) The bottom `aria-live` region must surface `deleteStatus` alongside `reorderStatus`:

```tsx
      <div role="status" aria-live="polite" className="sr-only">
        {reorderStatus}
        {deleteStatus}
      </div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/components/ChapterList`
Expected: PASS — both `ChapterList.test.tsx` and `ChapterList.delete.test.tsx`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ChapterList.tsx frontend/tests/components/ChapterList.delete.test.tsx
git commit -m "[chapters-ui] wire inline-confirm delete on active row"
```

---

## Task 13: CSS append — coarse-pointer + active/over grip overrides

**Files:**
- Modify: `frontend/src/index.css` (append at the end)

- [ ] **Step 1: Append the rules**

Edit `frontend/src/index.css` — append at the very end of the file:

```css
/* ============================================================================
 * Chapters UI — affordance visibility on active / drop-target rows + coarse
 * pointer (touch) hit-target enlargement. Scoped to chapter rows by testId
 * prefix to avoid collisions with unrelated `*-delete` testIds.
 * ========================================================================== */
[data-testid^='chapter-row-'][data-active='true'] [data-testid$='-grip'],
[data-testid^='chapter-row-'][data-over='true'] [data-testid$='-grip'] {
  opacity: 1;
}

@media (pointer: coarse) {
  .is-coarse-pointer-visible { opacity: 1 !important; }
  [data-testid^='chapter-row-'][data-testid$='-grip'],
  [data-testid^='chapter-row-'][data-testid$='-delete'] {
    min-width: 32px;
    min-height: 32px;
  }
}
```

- [ ] **Step 2: Smoke-build the frontend**

Run: `cd frontend && npx vite build`
Expected: build succeeds (CSS is parseable).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/index.css
git commit -m "[chapters-ui] CSS overrides for active grip + coarse pointer"
```

---

## Task 14: Drop the Sidebar header `+` button

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx`
- Test: `frontend/tests/components/Sidebar.test.tsx`

- [ ] **Step 1: Write the failing regression test**

In `frontend/tests/components/Sidebar.test.tsx`, replace the existing `'clicking the plus button fires onAdd'` test with:

```tsx
  it('does not render a sidebar-level + button (chapters owns its own add)', () => {
    renderSidebar({ onAdd: vi.fn() });
    expect(screen.queryByTestId('sidebar-add-button')).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/components/Sidebar`
Expected: FAIL — the `+` button is still rendered.

- [ ] **Step 3: Remove the button from `Sidebar.tsx`**

Edit `frontend/src/components/Sidebar.tsx`:

(a) Remove the entire `<button … data-testid="sidebar-add-button"> … <PlusIcon/> … </button>` element from the header (around lines 155-164).
(b) Remove the now-unused `PlusIcon` function.
(c) Remove `onAdd?: () => void` from `SidebarProps`.
(d) Remove the destructured `onAdd` from the function signature.

The story-picker already has `flex-1`, so it grows to fill the freed space without further changes.

- [ ] **Step 4: Update other test cases that reference `onAdd`**

Search the test file for `onAdd` and either remove the references (if the test was about the `+` button) or replace them with a no-op (if the test passed `onAdd` only because `SidebarProps` required it — it's now optional, so just drop the prop).

Run: `grep -n "onAdd" frontend/tests/components/Sidebar.test.tsx`
For each match, delete the `onAdd` reference. The previous test that used to fire-click the `+` and assert `onAdd` was called is replaced by the regression in Step 1.

- [ ] **Step 5: Run tests to verify**

Run: `cd frontend && npx vitest run tests/components/Sidebar`
Expected: PASS.

- [ ] **Step 6: Verify no other consumers pass `onAdd`**

Run: `grep -rn "onAdd" frontend/src`
Expected: zero hits in `Sidebar` consumers; if `EditorPage.tsx` passes `onAdd`, remove that prop in Task 16.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/Sidebar.tsx frontend/tests/components/Sidebar.test.tsx
git commit -m "[chapters-ui] drop sidebar-level + button (chapters owns its add)"
```

---

## Task 15: Sidebar tab strip — counts under labels

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx`
- Test: `frontend/tests/components/Sidebar.test.tsx`

- [ ] **Step 1: Write failing tests for the count line**

Append to `frontend/tests/components/Sidebar.test.tsx` inside the `describe('Sidebar')`:

```tsx
  it('renders count line under CHAPTERS and CAST when counts are provided', () => {
    renderSidebar({ chaptersCount: 9, castCount: 4 });
    expect(within(screen.getByTestId('sidebar-tab-chapters')).getByText('9')).toBeInTheDocument();
    expect(within(screen.getByTestId('sidebar-tab-cast')).getByText('4')).toBeInTheDocument();
  });

  it('OUTLINE never renders a count', () => {
    renderSidebar({ chaptersCount: 5, castCount: 2 });
    const outlineTab = screen.getByTestId('sidebar-tab-outline');
    // No tabular-nums count children — only the label.
    expect(outlineTab.textContent).toBe('Outline');
  });

  it('omits the count when null (loading)', () => {
    renderSidebar({ chaptersCount: null, castCount: null });
    expect(screen.getByTestId('sidebar-tab-chapters').textContent).toBe('Chapters');
    expect(screen.getByTestId('sidebar-tab-cast').textContent).toBe('Cast');
  });

  it('tab aria-label includes the count for screen readers', () => {
    renderSidebar({ chaptersCount: 9, castCount: 4 });
    expect(screen.getByTestId('sidebar-tab-chapters')).toHaveAttribute('aria-label', 'Chapters (9)');
    expect(screen.getByTestId('sidebar-tab-cast')).toHaveAttribute('aria-label', 'Cast (4)');
    expect(screen.getByTestId('sidebar-tab-outline')).not.toHaveAttribute('aria-label');
  });
```

Add `within` to the existing `import { … } from '@testing-library/react';` line.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/components/Sidebar`
Expected: FAIL — counts not rendered.

- [ ] **Step 3: Update `SidebarProps` and the tab render**

Edit `frontend/src/components/Sidebar.tsx`:

(a) Extend `SidebarProps`:

```tsx
export interface SidebarProps {
  storyTitle?: string | null;
  totalWordCount?: number;
  goalWordCount?: number;
  onOpenStoryPicker?: () => void;
  /** Render `N` under the CHAPTERS label. `null` ⇒ count line hidden (loading). */
  chaptersCount?: number | null;
  /** Render `N` under the CAST label. `null` ⇒ count line hidden. */
  castCount?: number | null;
  chaptersBody: ReactNode;
  castBody?: ReactNode;
  outlineBody?: ReactNode;
}
```

(b) Extend `TabSpec`:

```tsx
interface TabSpec {
  id: SidebarTab;
  label: string;
  panelId: string;
  tabId: string;
}
```

(no change — keep the existing shape, but at render time look up the count by id).

(c) Destructure the new props in the function signature; default to `null`:

```tsx
export function Sidebar({
  storyTitle = null,
  totalWordCount,
  goalWordCount,
  onOpenStoryPicker,
  chaptersCount = null,
  castCount = null,
  chaptersBody,
  castBody = null,
  outlineBody = null,
}: SidebarProps): JSX.Element {
```

(d) Replace the tab `<button>` body inside `TABS.map(...)` so the label and count line stack:

```tsx
        {TABS.map((t) => {
          const isActive = activeTab === t.id;
          const count =
            t.id === 'chapters' ? chaptersCount : t.id === 'cast' ? castCount : null;
          const ariaLabel = count !== null ? `${t.label} (${String(count)})` : undefined;
          return (
            <button
              key={t.id}
              id={t.tabId}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={t.panelId}
              aria-label={ariaLabel}
              data-testid={t.tabId}
              onClick={() => {
                setSidebarTab(t.id);
              }}
              className={[
                'sidebar-tab flex flex-col items-center gap-0 px-3 pt-2 pb-1.5',
                'font-mono text-[11px] uppercase tracking-[.08em] transition-colors',
                isActive ? 'text-ink border-b-2 border-ink -mb-px' : 'text-ink-3 hover:text-ink-2',
              ].join(' ')}
            >
              <span>{t.label}</span>
              {count !== null ? (
                <span
                  className={[
                    'font-mono text-[11px] tabular-nums',
                    isActive ? 'text-ink-3' : 'text-ink-4',
                  ].join(' ')}
                >
                  {String(count)}
                </span>
              ) : null}
            </button>
          );
        })}
```

If the existing tab `<button>` already renders its label via `t.label`, replace the inner content with the `<span>{t.label}</span>` + count block above. Keep any existing `className` rules around active-underline behaviour — adapt to the conditional shown above so the existing visual stays consistent.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/components/Sidebar`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Sidebar.tsx frontend/tests/components/Sidebar.test.tsx
git commit -m "[chapters-ui] sidebar tab strip renders counts under CHAPTERS/CAST"
```

---

## Task 16: EditorPage wiring — counts + onChapterDeleted

**Files:**
- Modify: `frontend/src/pages/EditorPage.tsx`

- [ ] **Step 1: Find the `<Sidebar … />` render and the `<ChapterList … />` render**

Run: `grep -n "<Sidebar\|<ChapterList" frontend/src/pages/EditorPage.tsx`

- [ ] **Step 2: Add `chaptersCount` + `castCount` to the Sidebar render**

Locate the `useChaptersQuery` and `useCharactersQuery` calls (or add them if absent — they already exist per the spec data-flow analysis) and pass:

```tsx
        <Sidebar
          storyTitle={story?.title ?? null}
          totalWordCount={totalWords}
          goalWordCount={story?.goalWordCount ?? undefined}
          onOpenStoryPicker={openStoryPicker}
          chaptersCount={chaptersQuery.data?.length ?? null}
          castCount={charactersQuery.data?.length ?? null}
          chaptersBody={...}
          castBody={...}
          outlineBody={...}
        />
```

If the existing render passes an `onAdd` prop, **remove** it (Task 14 dropped that prop from `SidebarProps`).

If `charactersQuery` is not currently in scope at this site, add `const charactersQuery = useCharactersQuery(story?.id ?? null);` near the other queries (it must already be imported and used by `CastTab` — confirm by grepping `useCharactersQuery` usage; if it's not imported here, add `import { useCharactersQuery } from '@/hooks/useCharacters';`).

- [ ] **Step 3: Add `onChapterDeleted` to the ChapterList render**

```tsx
              <ChapterList
                storyId={story.id}
                activeChapterId={activeChapterId}
                onSelectChapter={setActiveChapterId}
                onChapterDeleted={(deletedId) => {
                  if (deletedId === activeChapterId) setActiveChapterId(null);
                }}
              />
```

- [ ] **Step 4: Verify typecheck and tests**

Run: `cd frontend && npx tsc --noEmit && npx vitest run tests/components/Sidebar tests/components/ChapterList`
Expected: clean + PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/EditorPage.tsx
git commit -m "[chapters-ui] EditorPage wires tab counts + onChapterDeleted"
```

---

## Task 17: Refit `ChapterList.stories.tsx` for the new visual

**Files:**
- Modify: `frontend/src/components/ChapterList.stories.tsx`

- [ ] **Step 1: Update story args and add a DeleteConfirm variant**

Replace the entire file `frontend/src/components/ChapterList.stories.tsx` with:

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ChapterMeta } from '@/hooks/useChapters';
import { chaptersQueryKey } from '@/hooks/useChapters';
import { ChapterList } from './ChapterList';

const STORY_ID = 'story-demo';

const sampleChapters: ChapterMeta[] = [
  { id: 'c1', storyId: STORY_ID, title: 'The Churn at Dawn', wordCount: 2800, orderIndex: 0, status: 'draft', createdAt: '2026-04-01T12:00:00Z', updatedAt: '2026-04-30T12:00:00Z' },
  { id: 'c2', storyId: STORY_ID, title: 'A Visitor from the Other Wing', wordCount: 3100, orderIndex: 1, status: 'draft', createdAt: '2026-04-02T12:00:00Z', updatedAt: '2026-04-30T12:00:00Z' },
  { id: 'c3', storyId: STORY_ID, title: 'What Ilonoré Brought', wordCount: 2900, orderIndex: 2, status: 'draft', createdAt: '2026-04-03T12:00:00Z', updatedAt: '2026-04-30T12:00:00Z' },
  { id: 'c4', storyId: STORY_ID, title: 'The Weight of Ash', wordCount: 3500, orderIndex: 3, status: 'draft', createdAt: '2026-04-04T12:00:00Z', updatedAt: '2026-04-30T12:00:00Z' },
  { id: 'c5', storyId: STORY_ID, title: 'Maulster\'s Jaw', wordCount: 2600, orderIndex: 4, status: 'draft', createdAt: '2026-04-05T12:00:00Z', updatedAt: '2026-04-30T12:00:00Z' },
  { id: 'c6', storyId: STORY_ID, title: '', wordCount: 0, orderIndex: 5, status: 'draft', createdAt: '2026-04-06T12:00:00Z', updatedAt: '2026-04-30T12:00:00Z' },
];

function withClient(seed: ChapterMeta[] | null) {
  return (Story: () => React.ReactElement) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY, gcTime: Number.POSITIVE_INFINITY } },
    });
    if (seed !== null) {
      client.setQueryData(chaptersQueryKey(STORY_ID), seed);
    }
    return (
      <QueryClientProvider client={client}>
        <div style={{ width: 260 }}>
          <Story />
        </div>
      </QueryClientProvider>
    );
  };
}

const meta = {
  title: 'Components/ChapterList',
  component: ChapterList,
  args: {
    storyId: STORY_ID,
    activeChapterId: null,
    onSelectChapter: () => {},
  },
} satisfies Meta<typeof ChapterList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { activeChapterId: 'c1' },
  decorators: [withClient(sampleChapters)],
};

export const Empty: Story = {
  decorators: [withClient([])],
};

export const Loading: Story = {
  decorators: [withClient(null)],
};

/**
 * Click the × on the active row to see the inline Delete/Cancel pair.
 * The mutation will fail (no MSW handler) — what's being eyeballed is the
 * visual swap from word-count slot to the buttons.
 */
export const DeleteConfirm: Story = {
  args: { activeChapterId: 'c1' },
  decorators: [withClient(sampleChapters)],
};
```

- [ ] **Step 2: Smoke-build Storybook**

Run: `cd frontend && npm run build-storybook`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ChapterList.stories.tsx
git commit -m "[chapters-ui] storybook: refit ChapterList stories to new visual"
```

---

## Task 18: New `Sidebar.stories.tsx`

**Files:**
- Create: `frontend/src/components/Sidebar.stories.tsx`

- [ ] **Step 1: Write the story file**

Create `frontend/src/components/Sidebar.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { useSidebarTabStore } from '@/store/sidebarTab';
import type { SidebarTab } from '@/store/sidebarTab';

function ResetTab({ to, children }: { to: SidebarTab; children: React.ReactNode }): React.ReactElement {
  useEffect(() => {
    useSidebarTabStore.setState({ sidebarTab: to });
    return () => {
      useSidebarTabStore.setState({ sidebarTab: 'chapters' });
    };
  }, [to]);
  return <>{children}</>;
}

function withTab(tab: SidebarTab) {
  return (Story: () => React.ReactElement) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY, gcTime: Number.POSITIVE_INFINITY } },
    });
    return (
      <QueryClientProvider client={client}>
        <ResetTab to={tab}>
          <div style={{ height: 640, width: 280, border: '1px solid var(--line)' }}>
            <Story />
          </div>
        </ResetTab>
      </QueryClientProvider>
    );
  };
}

const placeholderBody = (label: string): React.ReactNode => (
  <div className="p-3 font-sans text-[12.5px] text-ink-3">{label}</div>
);

const meta = {
  title: 'Components/Sidebar',
  component: Sidebar,
  args: {
    storyTitle: 'The Long Sky',
    totalWordCount: 18_400,
    goalWordCount: 80_000,
    chaptersCount: 9,
    castCount: 4,
    chaptersBody: placeholderBody('CHAPTERS panel body'),
    castBody: placeholderBody('CAST panel body'),
    outlineBody: placeholderBody('OUTLINE panel body'),
  },
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  decorators: [withTab('chapters')],
};

export const NoStory: Story = {
  args: {
    storyTitle: null,
    chaptersCount: null,
    castCount: null,
    chaptersBody: placeholderBody('— no story —'),
  },
  decorators: [withTab('chapters')],
};

export const NoGoal: Story = {
  args: { goalWordCount: undefined },
  decorators: [withTab('chapters')],
};

export const CastTabActive: Story = {
  decorators: [withTab('cast')],
};

export const OutlineTabActive: Story = {
  decorators: [withTab('outline')],
};

export const LongStoryTitle: Story = {
  args: { storyTitle: 'The Very Long Story Title That Should Truncate With An Ellipsis Inside The Picker' },
  decorators: [withTab('chapters')],
};
```

- [ ] **Step 2: Smoke-build Storybook**

Run: `cd frontend && npm run build-storybook`
Expected: build succeeds and includes `Components/Sidebar`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Sidebar.stories.tsx
git commit -m "[chapters-ui] storybook: Sidebar shell variants"
```

---

## Task 19: Drag a11y unit test (KeyboardSensor wiring)

**Files:**
- Test: `frontend/tests/components/ChapterList.dragA11y.test.tsx` (new)

This task asserts the keyboard sensor is wired and `computeReorderedChapters` produces the right output for the index shifts the keyboard sensor would emit. Real-DOM keyboard reorder is covered by the X24 Playwright sweep — jsdom + dnd-kit's `KeyboardSensor` is unreliable for full integration assertions.

- [ ] **Step 1: Write the test**

Create `frontend/tests/components/ChapterList.dragA11y.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { computeReorderedChapters } from '@/hooks/useChapters';
import type { ChapterMeta } from '@/hooks/useChapters';

function meta(id: string, orderIndex: number): ChapterMeta {
  return {
    id,
    storyId: 's',
    title: id,
    wordCount: 0,
    orderIndex,
    status: 'draft',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
  };
}

describe('Chapter reorder — keyboard-shift index math', () => {
  it('moves a row down by 1 (Down arrow → activeId/overId pair)', () => {
    const list = [meta('a', 0), meta('b', 1), meta('c', 2)];
    const next = computeReorderedChapters(list, 'a', 'b');
    expect(next?.map((c) => c.id)).toEqual(['b', 'a', 'c']);
    expect(next?.map((c) => c.orderIndex)).toEqual([0, 1, 2]);
  });

  it('moves a row up by 1 (Up arrow)', () => {
    const list = [meta('a', 0), meta('b', 1), meta('c', 2)];
    const next = computeReorderedChapters(list, 'c', 'b');
    expect(next?.map((c) => c.id)).toEqual(['a', 'c', 'b']);
  });

  it('returns null when active === over (Space-drop on same row)', () => {
    const list = [meta('a', 0), meta('b', 1)];
    expect(computeReorderedChapters(list, 'a', 'a')).toBeNull();
  });

  it('returns null when overId is null (Escape cancel before drop)', () => {
    const list = [meta('a', 0), meta('b', 1)];
    expect(computeReorderedChapters(list, 'a', null)).toBeNull();
  });
});

describe('ChapterList — KeyboardSensor wiring', () => {
  it('imports KeyboardSensor + sortableKeyboardCoordinates from dnd-kit', async () => {
    // Smoke: the module must load without throwing under jsdom. The sensors
    // themselves are tested at the integration layer by the Playwright sweep
    // [X24]; here we only assert the symbols are present in the bundle so a
    // future refactor can't accidentally drop them.
    const core = await import('@dnd-kit/core');
    const sortable = await import('@dnd-kit/sortable');
    expect(core.KeyboardSensor).toBeDefined();
    expect(core.TouchSensor).toBeDefined();
    expect(sortable.sortableKeyboardCoordinates).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd frontend && npx vitest run tests/components/ChapterList.dragA11y`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/tests/components/ChapterList.dragA11y.test.tsx
git commit -m "[chapters-ui] unit-test reorder index math + dnd-kit symbol presence"
```

---

## Task 20: Aggregate verification

This is the final gate before opening the PR.

- [ ] **Step 1: Backend test DB reset + full backend suite**

Run: `cd backend && npm run db:test:reset && npm run test`
Expected: PASS.

- [ ] **Step 2: Backend typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Frontend full suite**

Run: `cd frontend && npm run test`
Expected: PASS.

- [ ] **Step 4: Frontend typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Biome**

Run: `npx biome check frontend backend`
Expected: zero warnings, zero errors. If formatting drifts, run `npx biome check --write frontend backend` and commit the formatting-only result with `[chapters-ui] biome format`.

- [ ] **Step 6: Storybook smoke build**

Run: `cd frontend && npm run build-storybook`
Expected: build succeeds; output dir populated.

- [ ] **Step 7: Frontend production build**

Run: `cd frontend && npx vite build`
Expected: build succeeds.

- [ ] **Step 8: Manual sanity check via dev stack**

Run: `make dev`
Open `http://localhost:3000`, log in with the seeded dev user, confirm:
- Chapter list matches the screenshots: flat single-line rows, mono row numbers (`01..0N`), serif titles, compact word counts (`2.0k`, `2.1k`, `—`), soft-fill active row.
- Section header `MANUSCRIPT +` is present and clicking `+` adds a chapter.
- The sidebar header has no `+` button.
- Tab strip shows `CHAPTERS \n N` and `CAST \n N`; `OUTLINE` shows label only.
- Clicking the active row's `×` opens the inline `Delete | Cancel` pair; Delete removes the row optimistically; Escape and outside-click dismiss.
- Drag-and-drop reorder still works; the source row dims and the over-row gets a 1px ink ring.

If any of these fail, file a fix task before merging.

- [ ] **Step 9: Push the branch**

```bash
git push -u origin feat/chapters-ui
```

(The PR itself is opened by the user, not by this plan.)

---

## Self-review notes (written at plan-time)

- All locked decisions in the spec map to tasks: visual reskin (Tasks 9, 10, 13, 17), delete (Tasks 1, 2, 5, 7, 8, 12), drag a11y (Tasks 11, 19), tab counts (Tasks 14, 15, 16, 18), backend reassign (Tasks 3, 4), Sidebar storybook (Task 18).
- No placeholders. Every code-bearing step shows full code; every test step shows the assertion or expected exit-state.
- Type consistency: `ChapterMeta` and `chaptersQueryKey` / `chapterQueryKey` reused unchanged; `useDeleteChapterMutation` signature matches the test's `mutateAsync({ chapterId })` call shape; `Sidebar`'s new `chaptersCount` / `castCount` are typed `number | null` consistently across tests, types, and the `EditorPage` wiring.
- Out of scope items from the spec stay out (Cast/Outline panel redesigns, snapshot tests, real `TrashIcon`, new tokens).
- Risks called out in the spec are mitigated: KeyboardSensor flakiness handled by Task 19 + X24 Playwright sweep; broad CSS suffix selectors scoped to `chapter-row-`; rollback on delete failure has its own test in Task 12.
