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
    onSuccess: () => {
      invalidate();
    },
  });

  const renameMut = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => patchChat(id, title),
    onSuccess: () => {
      invalidate();
    },
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => deleteChat(id),
    onSuccess: () => {
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
