import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * F29 — outline (Story Arc) queries + create / update / delete / reorder
 * mutations. Mirrors `useChapters.ts` for the optimistic-reorder pattern.
 *
 * Backend contract (B8):
 * - GET    /api/stories/:storyId/outline                → { outline: OutlineItem[] }
 * - POST   /api/stories/:storyId/outline                → { outlineItem: OutlineItem }
 * - PATCH  /api/stories/:storyId/outline/:id            → { outlineItem: OutlineItem }
 * - DELETE /api/stories/:storyId/outline/:id            → 204
 * - PATCH  /api/stories/:storyId/outline/reorder        → 204 (body { items: [{id, order}] })
 *
 * `status` is intentionally free-form on the backend (z.string().min(1).max(40)).
 * The frontend convention is `'queued' | 'active' | 'done'`, but we keep the
 * client-side type wide so unknown statuses round-trip cleanly.
 */
export type OutlineStatus = 'queued' | 'active' | 'done';

export interface OutlineItem {
  id: string;
  storyId: string;
  title: string;
  sub: string | null;
  status: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface OutlineListResponse {
  outline: OutlineItem[];
}

export interface OutlineItemResponse {
  outlineItem: OutlineItem;
}

export const outlineQueryKey = (storyId: string): readonly ['outline', string] =>
  ['outline', storyId] as const;

export function useOutlineQuery(storyId: string | undefined): UseQueryResult<OutlineItem[], Error> {
  return useQuery({
    queryKey: outlineQueryKey(storyId ?? ''),
    queryFn: async (): Promise<OutlineItem[]> => {
      const res = await api<OutlineListResponse>(
        `/stories/${encodeURIComponent(storyId ?? '')}/outline`,
      );
      // Sort defensively — the backend already returns ordered, but the cache
      // shape this hook commits to is "sorted ascending by `order`" so the
      // optimistic-reorder path can skip a sort step.
      return [...res.outline].sort((a, b) => a.order - b.order);
    },
    enabled: Boolean(storyId),
    staleTime: 30_000,
  });
}

export interface CreateOutlineInput {
  title: string;
  sub?: string | null;
  status: string;
}

export function useCreateOutlineMutation(
  storyId: string,
): UseMutationResult<OutlineItem, Error, CreateOutlineInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateOutlineInput): Promise<OutlineItem> => {
      const res = await api<OutlineItemResponse>(
        `/stories/${encodeURIComponent(storyId)}/outline`,
        {
          method: 'POST',
          body: input,
        },
      );
      return res.outlineItem;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: outlineQueryKey(storyId) });
    },
  });
}

export type UpdateOutlinePatch = Partial<{
  title: string;
  sub: string | null;
  status: string;
  order: number;
}>;

export interface UpdateOutlineInput {
  id: string;
  patch: UpdateOutlinePatch;
}

export function useUpdateOutlineMutation(
  storyId: string,
): UseMutationResult<OutlineItem, Error, UpdateOutlineInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: UpdateOutlineInput): Promise<OutlineItem> => {
      const res = await api<OutlineItemResponse>(
        `/stories/${encodeURIComponent(storyId)}/outline/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          body: patch,
        },
      );
      return res.outlineItem;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: outlineQueryKey(storyId) });
    },
  });
}

export interface DeleteOutlineInput {
  id: string;
}

export function useDeleteOutlineMutation(
  storyId: string,
): UseMutationResult<void, Error, DeleteOutlineInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: DeleteOutlineInput): Promise<void> => {
      await api<void>(`/stories/${encodeURIComponent(storyId)}/outline/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: outlineQueryKey(storyId) });
    },
  });
}

/**
 * Pure array-move helper. Returns a new array; out-of-range indices return a
 * shallow copy unchanged. Same behaviour as `arrayMove` in `useChapters.ts`.
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
 * Reassign sequential `order` values 0..N-1 across the given items. The backend
 * requires unique `order` values; passing 0..N-1 keeps the contract trivial.
 */
export function withSequentialOrder(list: readonly OutlineItem[]): OutlineItem[] {
  return list.map((item, idx) => (item.order === idx ? item : { ...item, order: idx }));
}

/**
 * Pure handler for `DndContext.onDragEnd`. Returns `null` when nothing needs
 * to change (no `over`, same id, or unknown ids). Mirrors
 * `computeReorderedChapters`.
 */
export function computeReorderedOutline(
  current: readonly OutlineItem[],
  activeId: string,
  overId: string | null,
): OutlineItem[] | null {
  if (overId === null) return null;
  if (activeId === overId) return null;
  const fromIndex = current.findIndex((c) => c.id === activeId);
  const toIndex = current.findIndex((c) => c.id === overId);
  if (fromIndex === -1 || toIndex === -1) return null;
  const moved = arrayMove(current, fromIndex, toIndex);
  return withSequentialOrder(moved);
}

export interface ReorderOutlineMutationContext {
  previous: OutlineItem[] | undefined;
}

export interface ReorderOutlineInput {
  items: { id: string; order: number }[];
  previousItems: OutlineItem[];
}

/**
 * F29 — outline reorder with optimistic cache update + rollback on failure.
 *
 * Caller supplies the *already-reordered* item list (typically produced by
 * `computeReorderedOutline`) under `previousItems` for the optimistic write,
 * plus the `items: [{id, order}]` payload that goes on the wire. Mirrors the
 * shape of `useReorderChaptersMutation` — the only differences are the body
 * key (`items` vs `chapters`) and field name (`order` vs `orderIndex`).
 */
export function useReorderOutlineMutation(
  storyId: string,
): UseMutationResult<void, Error, ReorderOutlineInput, ReorderOutlineMutationContext> {
  const qc = useQueryClient();
  return useMutation<void, Error, ReorderOutlineInput, ReorderOutlineMutationContext>({
    mutationFn: async ({ items }: ReorderOutlineInput): Promise<void> => {
      await api<void>(`/stories/${encodeURIComponent(storyId)}/outline/reorder`, {
        method: 'PATCH',
        body: { items },
      });
    },
    onMutate: async ({
      previousItems,
    }: ReorderOutlineInput): Promise<ReorderOutlineMutationContext> => {
      await qc.cancelQueries({ queryKey: outlineQueryKey(storyId) });
      const previous = qc.getQueryData<OutlineItem[]>(outlineQueryKey(storyId));
      qc.setQueryData<OutlineItem[]>(outlineQueryKey(storyId), previousItems);
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous !== undefined) {
        qc.setQueryData<OutlineItem[]>(outlineQueryKey(storyId), context.previous);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: outlineQueryKey(storyId) });
    },
  });
}
