import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  type OutlineCreateInput,
  type OutlineItem,
  type OutlineReorderInput,
  type OutlineUpdateInput,
  outlineItemResponseSchema,
  outlineListResponseSchema,
} from 'story-editor-shared';
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
 * Types and response schemas are imported from `story-editor-shared`. The
 * `OutlineStatus` union below is a frontend-only UI rendering convention —
 * the wire contract / DB column are both free-form string, by deliberate
 * design (see outline.routes.ts:28-30 and schema.prisma:175).
 */
export type OutlineStatus = 'queued' | 'active' | 'done';

export const outlineQueryKey = (storyId: string): readonly ['outline', string] =>
  ['outline', storyId] as const;

export function useOutlineQuery(storyId: string | undefined): UseQueryResult<OutlineItem[], Error> {
  return useQuery({
    queryKey: outlineQueryKey(storyId ?? ''),
    queryFn: async (): Promise<OutlineItem[]> => {
      const raw = await api<unknown>(`/stories/${encodeURIComponent(storyId ?? '')}/outline`);
      const { outline } = outlineListResponseSchema.parse(raw);
      // Sort defensively — the backend already returns ordered, but the cache
      // shape this hook commits to is "sorted ascending by `order`" so the
      // optimistic-reorder path can skip a sort step.
      return [...outline].sort((a, b) => a.order - b.order);
    },
    enabled: Boolean(storyId),
    staleTime: 30_000,
  });
}

export function useCreateOutlineMutation(
  storyId: string,
): UseMutationResult<OutlineItem, Error, OutlineCreateInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: OutlineCreateInput): Promise<OutlineItem> => {
      const raw = await api<unknown>(`/stories/${encodeURIComponent(storyId)}/outline`, {
        method: 'POST',
        body: input,
      });
      const { outlineItem } = outlineItemResponseSchema.parse(raw);
      return outlineItem;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: outlineQueryKey(storyId) });
    },
  });
}

export interface UpdateOutlineArgs {
  id: string;
  patch: OutlineUpdateInput;
}

export function useUpdateOutlineMutation(
  storyId: string,
): UseMutationResult<OutlineItem, Error, UpdateOutlineArgs> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: UpdateOutlineArgs): Promise<OutlineItem> => {
      const raw = await api<unknown>(
        `/stories/${encodeURIComponent(storyId)}/outline/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          body: patch,
        },
      );
      const { outlineItem } = outlineItemResponseSchema.parse(raw);
      return outlineItem;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: outlineQueryKey(storyId) });
    },
  });
}

export function useDeleteOutlineMutation(
  storyId: string,
): UseMutationResult<void, Error, { id: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }): Promise<void> => {
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

// `items` derived from the shared schema so a wire-shape change surfaces here
// as a type error, not a runtime drift. `previousItems` has no wire analog
// (frontend-only optimistic rollback), so it stays as a hook-local field.
export interface ReorderOutlineInputArgs {
  items: OutlineReorderInput['items'];
  previousItems: OutlineItem[];
}

export function useReorderOutlineMutation(
  storyId: string,
): UseMutationResult<void, Error, ReorderOutlineInputArgs, ReorderOutlineMutationContext> {
  const qc = useQueryClient();
  return useMutation<void, Error, ReorderOutlineInputArgs, ReorderOutlineMutationContext>({
    mutationFn: async ({ items }: ReorderOutlineInputArgs): Promise<void> => {
      await api<void>(`/stories/${encodeURIComponent(storyId)}/outline/reorder`, {
        method: 'PATCH',
        body: { items },
      });
    },
    onMutate: async ({
      previousItems,
    }: ReorderOutlineInputArgs): Promise<ReorderOutlineMutationContext> => {
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
