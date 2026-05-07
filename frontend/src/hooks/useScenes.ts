import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { type ChatRow, createChat, deleteChat, listChats, patchChat } from '@/lib/api';

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
        qc.setQueryData<ChatRow[]>(sceneListKey(chapterId), (prev) => [newChat, ...(prev ?? [])]);
      }
      invalidate();
    },
  });

  const renameMut = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => patchChat(id, title),
    onSuccess: (_, vars) => {
      if (chapterId) {
        qc.setQueryData<ChatRow[]>(sceneListKey(chapterId), (prev) =>
          (prev ?? []).map((c) => (c.id === vars.id ? { ...c, title: vars.title } : c)),
        );
      }
      invalidate();
    },
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => deleteChat(id),
    onSuccess: (_, deletedId) => {
      if (chapterId) {
        qc.setQueryData<ChatRow[]>(sceneListKey(chapterId), (prev) =>
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
export type SceneRow = ChatRow & { kind: 'scene' };
