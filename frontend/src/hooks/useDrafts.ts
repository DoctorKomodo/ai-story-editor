import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  type Draft,
  type DraftMeta,
  type DraftUpdateInput,
  draftResponseSchema,
  draftsResponseSchema,
} from 'story-editor-shared';
import { ApiError, api } from '@/lib/api';
import { chaptersQueryKey } from './useChapters';

/**
 * Draft query hooks — the editor's data layer post-[9wk.6].
 *
 * Key design: the draft-record key carries a 'detail' suffix so it can never
 * prefix-match the chat keys (['draft', draftId, 'chats', kind]) under
 * TanStack's partial matching — invalidating a draft record must not refetch
 * its chat lists.
 */

export const draftsQueryKey = (chapterId: string): readonly [string, string, string] =>
  ['chapter', chapterId, 'drafts'] as const;

export const draftQueryKey = (draftId: string): readonly [string, string, string] =>
  ['draft', draftId, 'detail'] as const;

export function useDraftsQuery(chapterId: string | null): UseQueryResult<DraftMeta[], Error> {
  return useQuery({
    queryKey: draftsQueryKey(chapterId ?? ''),
    enabled: chapterId !== null,
    queryFn: async (): Promise<DraftMeta[]> => {
      const res = await api<unknown>(`/chapters/${encodeURIComponent(chapterId ?? '')}/drafts`);
      return draftsResponseSchema.parse(res).drafts;
    },
  });
}

export function useDraftQuery(draftId: string | null): UseQueryResult<Draft, Error> {
  return useQuery({
    queryKey: draftQueryKey(draftId ?? ''),
    enabled: draftId !== null,
    queryFn: async (): Promise<Draft> => {
      const res = await api<unknown>(`/drafts/${encodeURIComponent(draftId ?? '')}`);
      return draftResponseSchema.parse(res).draft;
    },
    staleTime: 30_000,
  });
}

export interface UpdateDraftArgs {
  draftId: string;
  chapterId: string;
  storyId: string;
  input: DraftUpdateInput;
}

export function useUpdateDraftMutation(): UseMutationResult<Draft, Error, UpdateDraftArgs> {
  const qc = useQueryClient();
  return useMutation<Draft, Error, UpdateDraftArgs>({
    mutationFn: async ({ draftId, input }) => {
      const res = await api<unknown>(`/drafts/${encodeURIComponent(draftId)}`, {
        method: 'PATCH',
        body: input as Record<string, unknown>,
      });
      return draftResponseSchema.parse(res).draft;
    },
    onSuccess: (draft, vars) => {
      // The draft record cache feeds the editor's baseline + concurrency
      // timestamp — write it synchronously so the next render sees the fresh
      // updatedAt (same pattern as useUpdateChapterMutation's setQueryData).
      qc.setQueryData<Draft>(draftQueryKey(draft.id), draft);
      // Sidebar surfaces (draft meta wordCount/booleans; chapter-list
      // wordCount/summary icon follow the active draft server-side).
      void qc.invalidateQueries({ queryKey: draftsQueryKey(vars.chapterId) });
      void qc.invalidateQueries({ queryKey: chaptersQueryKey(vars.storyId) });
    },
  });
}

/**
 * True for the 409 `conflict` the draft PATCH returns when
 * `expectedUpdatedAt` no longer matches Draft.updatedAt.
 */
export function isDraftConflictError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409 && err.code === 'conflict';
}

/** The active entry's id, or null while the list hasn't loaded. */
export function activeDraftIdOf(drafts: DraftMeta[] | undefined): string | null {
  return drafts?.find((d) => d.isActive)?.id ?? null;
}
