import {
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Narrow chapter shape the chapter-list / editor need. Mirrors what the
 * backend's chapter repo returns — ciphertext fields are already stripped.
 * `bodyJson` is the TipTap document tree (or `null` for an empty chapter).
 */
export interface Chapter {
  id: string;
  storyId: string;
  title: string;
  wordCount: number;
  orderIndex: number;
  status: 'draft' | 'revision' | 'final';
  bodyJson: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface ChaptersResponse {
  chapters: Chapter[];
}

export interface ChapterResponse {
  chapter: Chapter;
}

/**
 * Query key for the ordered chapter list belonging to a story.
 */
export const chaptersQueryKey = (storyId: string): readonly [string, string] =>
  ['chapters', storyId] as const;

export function useChaptersQuery(storyId: string | undefined): UseQueryResult<Chapter[], Error> {
  return useQuery({
    queryKey: chaptersQueryKey(storyId ?? ''),
    queryFn: async (): Promise<Chapter[]> => {
      const res = await api<ChaptersResponse>(
        `/stories/${encodeURIComponent(storyId ?? '')}/chapters`,
      );
      return res.chapters;
    },
    enabled: Boolean(storyId),
  });
}

export interface CreateChapterInput {
  title: string;
  bodyJson?: unknown;
}

export function useCreateChapterMutation(
  storyId: string,
): UseMutationResult<Chapter, Error, CreateChapterInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateChapterInput): Promise<Chapter> => {
      const res = await api<ChapterResponse>(`/stories/${encodeURIComponent(storyId)}/chapters`, {
        method: 'POST',
        body: input,
      });
      return res.chapter;
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
export function withSequentialOrderIndex(list: readonly Chapter[]): Chapter[] {
  return list.map((c, idx) => (c.orderIndex === idx ? c : { ...c, orderIndex: idx }));
}

export interface ReorderMutationContext {
  previous: Chapter[] | undefined;
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
): UseMutationResult<void, Error, Chapter[], ReorderMutationContext> {
  const qc = useQueryClient();
  return useMutation<void, Error, Chapter[], ReorderMutationContext>({
    mutationFn: async (nextList: Chapter[]): Promise<void> => {
      const items: ReorderItem[] = nextList.map((c) => ({ id: c.id, orderIndex: c.orderIndex }));
      await api<void>(`/stories/${encodeURIComponent(storyId)}/chapters/reorder`, {
        method: 'PATCH',
        body: { chapters: items },
      });
    },
    onMutate: async (nextList: Chapter[]): Promise<ReorderMutationContext> => {
      await qc.cancelQueries({ queryKey: chaptersQueryKey(storyId) });
      const previous = qc.getQueryData<Chapter[]>(chaptersQueryKey(storyId));
      qc.setQueryData<Chapter[]>(chaptersQueryKey(storyId), nextList);
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous !== undefined) {
        qc.setQueryData<Chapter[]>(chaptersQueryKey(storyId), context.previous);
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
  current: readonly Chapter[],
  activeId: string,
  overId: string | null,
): Chapter[] | null {
  if (overId === null) return null;
  if (activeId === overId) return null;
  const fromIndex = current.findIndex((c) => c.id === activeId);
  const toIndex = current.findIndex((c) => c.id === overId);
  if (fromIndex === -1 || toIndex === -1) return null;
  const moved = arrayMove(current, fromIndex, toIndex);
  return withSequentialOrderIndex(moved);
}

/**
 * Read the chapters cache for a story. Thin wrapper that keeps tests + the
 * drag handler from having to spell out the query key.
 */
export function getChaptersFromCache(qc: QueryClient, storyId: string): Chapter[] | undefined {
  return qc.getQueryData<Chapter[]>(chaptersQueryKey(storyId));
}

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
      // return the matching entry without a round-trip.
      if (typeof storyId === 'string' && storyId.length > 0) {
        const list = qc.getQueryData<Chapter[]>(chaptersQueryKey(storyId));
        const hit = list?.find((c) => c.id === chapterId);
        if (hit) return hit;
      }
      if (typeof storyId !== 'string' || storyId.length === 0) {
        throw new Error('useChapterQuery: storyId required when chapter is not in cache');
      }
      const res = await api<ChapterResponse>(
        `/stories/${encodeURIComponent(storyId)}/chapters/${encodeURIComponent(chapterId)}`,
      );
      return res.chapter;
    },
    staleTime: 30_000,
  });
}

// ---- update chapter (F52) ----

export interface UpdateChapterInput {
  bodyJson?: unknown;
  title?: string;
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
      qc.setQueryData<Chapter[] | undefined>(chaptersQueryKey(chapter.storyId), (prev) => {
        if (!prev) return prev;
        return prev.map((c) => (c.id === chapter.id ? chapter : c));
      });
      qc.setQueryData<Chapter>(chapterQueryKey(chapter.id), chapter);
    },
  });
}
