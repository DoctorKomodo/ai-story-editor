import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { ChatSummary } from 'story-editor-shared';
import { createChat, deleteChat, listChats, patchChat } from '@/lib/api';

const sceneListKey = (chapterId: string) => ['scenes', chapterId] as const;

export function useScenes(chapterId: string | null) {
  const qc = useQueryClient();
  const enabled = chapterId !== null;

  const query = useQuery({
    queryKey: chapterId ? sceneListKey(chapterId) : ['scenes', 'none'],
    queryFn: () => listChats(chapterId!, { kind: 'scene' }),
    enabled,
  });

  const invalidate = useCallback(() => {
    if (chapterId) qc.invalidateQueries({ queryKey: sceneListKey(chapterId) });
  }, [qc, chapterId]);

  const createMut = useMutation({
    mutationFn: () => createChat(chapterId!, { kind: 'scene' }),
    onSuccess: (newChat) => {
      if (chapterId) {
        // Optimistically prepend so the just-created chat appears in `sessions`
        // immediately. The invalidate below reconciles with the server.
        const summary: ChatSummary = { ...newChat, messageCount: 0 };
        qc.setQueryData<ChatSummary[]>(sceneListKey(chapterId), (prev) => [
          summary,
          ...(prev ?? []),
        ]);
      }
      invalidate();
    },
  });

  const renameMut = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => patchChat(id, title),
    onSuccess: (updatedChat, vars) => {
      if (chapterId) {
        // Use the server-returned title rather than vars.title so that any
        // server-side normalisation (trim, truncation) is reflected immediately
        // in the cache without waiting for the invalidate refetch.
        qc.setQueryData<ChatSummary[]>(sceneListKey(chapterId), (prev) =>
          (prev ?? []).map((c) => (c.id === vars.id ? { ...c, title: updatedChat.title } : c)),
        );
      }
      invalidate();
    },
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => deleteChat(id),
    onSuccess: (_, deletedId) => {
      if (chapterId) {
        qc.setQueryData<ChatSummary[]>(sceneListKey(chapterId), (prev) =>
          (prev ?? []).filter((c) => c.id !== deletedId),
        );
      }
      invalidate();
    },
  });

  return {
    sessions: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    create: () => createMut.mutateAsync(),
    rename: (id: string, title: string) => renameMut.mutateAsync({ id, title }),
    remove: (id: string) => removeMut.mutateAsync(id),
  };
}

export type UseScenesReturn = ReturnType<typeof useScenes>;
export type SceneRow = ChatSummary & { kind: 'scene' };
