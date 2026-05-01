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
 * Metadata-only chapter shape, returned by the list endpoint
 * (`GET /api/stories/:storyId/chapters`). The list does NOT include `bodyJson`
 * — sidebar / list consumers don't need it, and decrypting every chapter on
 * every list refresh is expensive at scale. The single-chapter
 * `useChapterQuery` is the sole authority for `bodyJson`.
 */
export interface ChapterMeta {
  id: string;
  storyId: string;
  title: string;
  wordCount: number;
  orderIndex: number;
  status: 'draft' | 'revision' | 'final';
  createdAt: string;
  updatedAt: string;
}

/**
 * Full chapter shape, returned by the single-chapter endpoint
 * (`GET /api/stories/:storyId/chapters/:chapterId`) and by create / update
 * mutations. `bodyJson` is the TipTap document tree (or `null` for an empty
 * chapter), decrypted by the backend chapter repo.
 */
export interface Chapter extends ChapterMeta {
  bodyJson: unknown;
}

export interface ChaptersResponse {
  chapters: ChapterMeta[];
}

export interface ChapterResponse {
  chapter: Chapter;
}

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
      // List cache is metadata-only — strip `bodyJson` before merging.
      const { bodyJson: _bodyJson, ...meta } = chapter;
      void _bodyJson;
      qc.setQueryData<ChapterMeta[] | undefined>(chaptersQueryKey(chapter.storyId), (prev) => {
        if (!prev) return prev;
        return prev.map((c) => (c.id === chapter.id ? (meta as ChapterMeta) : c));
      });
      // Per-chapter cache holds the full body — feeds the next render of Paper.
      qc.setQueryData<Chapter>(chapterQueryKey(chapter.id), chapter);
    },
  });
}
