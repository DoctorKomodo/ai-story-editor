import {
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  type Chapter,
  type ChapterCreateInput,
  type ChapterMeta,
  type ChapterUpdateInput,
  chapterResponseSchema,
  chaptersResponseSchema,
} from 'story-editor-shared';
import { ApiError, api } from '@/lib/api';

/**
 * Query key for the ordered chapter list belonging to a story.
 */
export const chaptersQueryKey = (storyId: string): readonly [string, string] =>
  ['chapters', storyId] as const;

export function useChaptersQuery(
  storyId: string | undefined,
): UseQueryResult<ChapterMeta[], Error> {
  return useQuery({
    queryKey: chaptersQueryKey(storyId ?? ''),
    queryFn: async (): Promise<ChapterMeta[]> => {
      const res = await api<unknown>(`/stories/${encodeURIComponent(storyId ?? '')}/chapters`);
      return chaptersResponseSchema.parse(res).chapters;
    },
    enabled: Boolean(storyId),
  });
}

export function useCreateChapterMutation(
  storyId: string,
): UseMutationResult<Chapter, Error, ChapterCreateInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ChapterCreateInput): Promise<Chapter> => {
      const res = await api<unknown>(`/stories/${encodeURIComponent(storyId)}/chapters`, {
        method: 'POST',
        body: input,
      });
      return chapterResponseSchema.parse(res).chapter;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chaptersQueryKey(storyId) });
    },
  });
}

/**
 * Ordered item contract for the reorder endpoint.
 *
 * Backend route: `PATCH /api/stories/:storyId/chapters/reorder` with body
 * `{ chapters: [{ id, orderIndex }] }`. Validated for duplicate ids and
 * duplicate orderIndexes; we therefore pass sequential 0..N-1 values from
 * the client to keep things simple and predictable.
 */
export interface ReorderItem {
  id: string;
  orderIndex: number;
}

/**
 * Pure array-move helper. Returns a new array; asserts indices are in range.
 * Factored out so F11's drag handler can be unit-tested without dnd-kit.
 */
export function arrayMove<T>(list: readonly T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex) return list.slice();
  if (fromIndex < 0 || fromIndex >= list.length) return list.slice();
  if (toIndex < 0 || toIndex >= list.length) return list.slice();
  const next = list.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved as T);
  return next;
}

/**
 * Reassign sequential `orderIndex` values 0..N-1 across the given chapters.
 * The backend validates uniqueness; duplicates must not slip through.
 */
export function withSequentialOrderIndex<T extends { orderIndex: number }>(
  list: readonly T[],
): T[] {
  return list.map((c, idx) => (c.orderIndex === idx ? c : { ...c, orderIndex: idx }));
}

export interface ReorderMutationContext {
  previous: ChapterMeta[] | undefined;
}

/**
 * F11 — chapter reorder with optimistic cache update and rollback.
 *
 * Caller supplies the *already-reordered* chapter list (typically produced
 * by `arrayMove` + `withSequentialOrderIndex`). We:
 *
 * 1. Snapshot the current cache.
 * 2. Write the reordered list to the cache immediately (optimistic).
 * 3. PATCH `/chapters/reorder` with `{ chapters: [{id, orderIndex}] }`.
 * 4. On error: restore snapshot + announce via aria-live.
 * 5. On settled: invalidate so the server's ordering wins.
 */
export function useReorderChaptersMutation(
  storyId: string,
): UseMutationResult<void, Error, ChapterMeta[], ReorderMutationContext> {
  const qc = useQueryClient();
  return useMutation<void, Error, ChapterMeta[], ReorderMutationContext>({
    mutationFn: async (nextList: ChapterMeta[]): Promise<void> => {
      const items: ReorderItem[] = nextList.map((c) => ({ id: c.id, orderIndex: c.orderIndex }));
      await api<void>(`/stories/${encodeURIComponent(storyId)}/chapters/reorder`, {
        method: 'PATCH',
        body: { chapters: items },
      });
    },
    onMutate: async (nextList: ChapterMeta[]): Promise<ReorderMutationContext> => {
      await qc.cancelQueries({ queryKey: chaptersQueryKey(storyId) });
      const previous = qc.getQueryData<ChapterMeta[]>(chaptersQueryKey(storyId));
      qc.setQueryData<ChapterMeta[]>(chaptersQueryKey(storyId), nextList);
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous !== undefined) {
        qc.setQueryData<ChapterMeta[]>(chaptersQueryKey(storyId), context.previous);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: chaptersQueryKey(storyId) });
    },
  });
}

/**
 * Pure handler used by the ChapterList's `DndContext.onDragEnd`. Factored out
 * so tests can drive it directly without simulating pointer events under
 * jsdom.
 *
 * Given the current cache and a dnd-kit-style `{active, over}` pair, returns
 * the new chapter list (with sequential orderIndex reassigned). Returns `null`
 * when nothing needs to change (no `over`, same id, or unknown ids).
 */
export function computeReorderedChapters(
  current: readonly ChapterMeta[],
  activeId: string,
  overId: string | null,
): ChapterMeta[] | null {
  if (overId === null) return null;
  if (activeId === overId) return null;
  const fromIndex = current.findIndex((c) => c.id === activeId);
  const toIndex = current.findIndex((c) => c.id === overId);
  if (fromIndex === -1 || toIndex === -1) return null;
  const moved = arrayMove(current, fromIndex, toIndex);
  return withSequentialOrderIndex(moved);
}

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

/**
 * Read the chapters cache for a story. Thin wrapper that keeps tests + the
 * drag handler from having to spell out the query key.
 */
export function getChaptersFromCache(qc: QueryClient, storyId: string): ChapterMeta[] | undefined {
  return qc.getQueryData<ChapterMeta[]>(chaptersQueryKey(storyId));
}

// ---- single-chapter query (F52) ----

export const chapterQueryKey = (chapterId: string): readonly [string, string] =>
  ['chapter', chapterId] as const;

/**
 * Read a single chapter via `GET /api/stories/:storyId/chapters/:chapterId`.
 * `storyId` is required for the URL build. The single-chapter query is the
 * sole authority for `bodyJson` — the chapters-list cache is metadata-only,
 * so a list-cache short-circuit would feed `null` into Paper's body and would
 * not re-fetch the freshly-decrypted body when the user re-opens the chapter.
 *
 * TanStack Query handles repeat visits via `staleTime` (30s) + `gcTime`
 * (default 5min): cache hits within staleTime are instant, stale-but-cached
 * hits return immediately and refetch in the background, and the autosave
 * `onSuccess` continuously refreshes the cache while editing.
 *
 * Disabled when `chapterId` is null/undefined.
 */
export function useChapterQuery(
  chapterId: string | null | undefined,
  storyId?: string,
): UseQueryResult<Chapter, Error> {
  return useQuery({
    queryKey: chapterQueryKey(chapterId ?? ''),
    enabled: typeof chapterId === 'string' && chapterId.length > 0,
    queryFn: async (): Promise<Chapter> => {
      if (typeof chapterId !== 'string' || chapterId.length === 0) {
        throw new Error('chapterId required');
      }
      if (typeof storyId !== 'string' || storyId.length === 0) {
        throw new Error('useChapterQuery: storyId required');
      }
      const res = await api<unknown>(
        `/stories/${encodeURIComponent(storyId)}/chapters/${encodeURIComponent(chapterId)}`,
      );
      return chapterResponseSchema.parse(res).chapter;
    },
    staleTime: 30_000,
  });
}

// ---- update chapter (F52) ----

export interface UpdateChapterArgs {
  storyId: string;
  chapterId: string;
  input: ChapterUpdateInput;
}

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

/**
 * True for the 409 `conflict` the backend returns when a PATCH's
 * `expectedUpdatedAt` precondition no longer matches the chapter's current
 * `updatedAt` (another writer moved it since this client last read it).
 */
export function isChapterConflictError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409 && err.code === 'conflict';
}

export function useUpdateChapterMutation(): UseMutationResult<Chapter, Error, UpdateChapterArgs> {
  const qc = useQueryClient();
  return useMutation<Chapter, Error, UpdateChapterArgs>({
    mutationFn: async ({ storyId, chapterId, input }) => {
      const res = await api<unknown>(
        `/stories/${encodeURIComponent(storyId)}/chapters/${encodeURIComponent(chapterId)}`,
        { method: 'PATCH', body: input as Record<string, unknown> },
      );
      return chapterResponseSchema.parse(res).chapter;
    },
    onSuccess: (chapter) => {
      // List cache is metadata-only — strip `bodyJson` before merging.
      const { bodyJson: _bodyJson, ...meta } = chapter;
      void _bodyJson;
      qc.setQueryData<ChapterMeta[] | undefined>(chaptersQueryKey(chapter.storyId), (prev) => {
        if (!prev) return prev;
        return prev.map((c) => (c.id === chapter.id ? meta : c));
      });
      // Per-chapter cache holds the full body — feeds the next render of Paper.
      qc.setQueryData<Chapter>(chapterQueryKey(chapter.id), chapter);
    },
  });
}
