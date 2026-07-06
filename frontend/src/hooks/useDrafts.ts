import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  type Draft,
  type DraftCreateInput,
  type DraftMeta,
  type DraftUpdateInput,
  draftResponseSchema,
  draftsResponseSchema,
} from 'story-editor-shared';
import { ApiError, api } from '@/lib/api';
import { deleteDraft as deleteLocalDraft } from '@/lib/chapterDrafts';
import { useSessionStore } from '@/store/session';
import { chapterQueryKey, chaptersQueryKey } from './useChapters';

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

const DRAFT_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Positional display label for `label: null` drafts, derived from the
 * gap-free orderIndex: "Draft A".."Draft Z", then numeric ("Draft 27").
 * Deliberate boundary: Z is the 26th draft; "Draft 26" never appears.
 */
export function positionalDraftLabel(orderIndex: number): string {
  if (orderIndex < DRAFT_LETTERS.length) {
    return `Draft ${DRAFT_LETTERS[orderIndex] as string}`;
  }
  return `Draft ${String(orderIndex + 1)}`;
}

export function draftDisplayLabel(meta: Pick<DraftMeta, 'label' | 'orderIndex'>): string {
  return meta.label ?? positionalDraftLabel(meta.orderIndex);
}

export interface CreateDraftArgs {
  chapterId: string;
  storyId: string;
  input: DraftCreateInput;
}

export function useCreateDraftMutation(): UseMutationResult<Draft, Error, CreateDraftArgs> {
  const qc = useQueryClient();
  return useMutation<Draft, Error, CreateDraftArgs>({
    mutationFn: async ({ chapterId, input }) => {
      const res = await api<unknown>(`/chapters/${encodeURIComponent(chapterId)}/drafts`, {
        method: 'POST',
        body: input as Record<string, unknown>,
      });
      return draftResponseSchema.parse(res).draft;
    },
    onSuccess: (draft, vars) => {
      // Seed the record cache so selecting the new draft renders instantly.
      qc.setQueryData<Draft>(draftQueryKey(draft.id), draft);
      void qc.invalidateQueries({ queryKey: draftsQueryKey(vars.chapterId) });
      // draftCount changed on the chapter row.
      void qc.invalidateQueries({ queryKey: chaptersQueryKey(vars.storyId) });
    },
  });
}

export interface SetActiveDraftArgs {
  chapterId: string;
  storyId: string;
  draftId: string;
  /** `activeDraftIdOf(list)` read before mutating — that record's isActive flips too. */
  previousActiveDraftId: string | null;
}

export function useSetActiveDraftMutation(): UseMutationResult<void, Error, SetActiveDraftArgs> {
  const qc = useQueryClient();
  return useMutation<void, Error, SetActiveDraftArgs>({
    mutationFn: async ({ chapterId, draftId }) => {
      await api<void>(`/chapters/${encodeURIComponent(chapterId)}/active-draft`, {
        method: 'PUT',
        body: { draftId },
      });
    },
    onSuccess: (_void, vars) => {
      // Dots in the tree; chapter-row headline (wordCount/summary flags
      // follow the active draft server-side).
      void qc.invalidateQueries({ queryKey: draftsQueryKey(vars.chapterId) });
      void qc.invalidateQueries({ queryKey: chaptersQueryKey(vars.storyId) });
      // Chapter detail GET serves the ACTIVE draft's summary (step-6 D5) —
      // popover/sheet/export read it.
      void qc.invalidateQueries({ queryKey: chapterQueryKey(vars.chapterId) });
      // Both records whose isActive flipped.
      void qc.invalidateQueries({ queryKey: draftQueryKey(vars.draftId) });
      if (vars.previousActiveDraftId !== null) {
        void qc.invalidateQueries({ queryKey: draftQueryKey(vars.previousActiveDraftId) });
      }
    },
  });
}

export interface DeleteDraftArgs {
  chapterId: string;
  storyId: string;
  draftId: string;
}

export function useDeleteDraftMutation(): UseMutationResult<void, Error, DeleteDraftArgs> {
  const qc = useQueryClient();
  const userId = useSessionStore((s) => s.user?.id) ?? null;
  return useMutation<void, Error, DeleteDraftArgs>({
    mutationFn: async ({ draftId }) => {
      await api<void>(`/drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE' });
    },
    onSuccess: (_void, vars) => {
      // Prefix removal takes the record (['draft', id, 'detail']) AND its
      // chat lists (['draft', id, 'chats', kind]). Per-chat message caches
      // (['chat', chatId, 'messages']) are a different prefix — left to
      // gcTime; their lists are gone so they can never render again.
      qc.removeQueries({ queryKey: ['draft', vars.draftId] });
      void qc.invalidateQueries({ queryKey: draftsQueryKey(vars.chapterId) });
      void qc.invalidateQueries({ queryKey: chaptersQueryKey(vars.storyId) });
      // Best-effort device hygiene: a deleted draft's plaintext recovery row
      // must not linger in IndexedDB.
      if (userId !== null) {
        void deleteLocalDraft(userId, vars.chapterId, vars.draftId);
      }
    },
  });
}
