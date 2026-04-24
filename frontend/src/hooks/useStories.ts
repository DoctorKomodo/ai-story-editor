import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Narrow story shape the dashboard + modal need. Deliberately does NOT mirror
 * the full Prisma row — ciphertext fields are stripped server-side, and the
 * dashboard only needs the summary payload.
 */
export interface StoryListItem {
  id: string;
  title: string;
  genre: string | null;
  synopsis: string | null;
  worldNotes: string | null;
  targetWords: number | null;
  systemPrompt: string | null;
  chapterCount: number;
  totalWordCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface StoriesResponse {
  stories: StoryListItem[];
}

export interface StoryResponse {
  story: StoryListItem;
}

/**
 * Fields accepted by both `POST /stories` and `PATCH /stories/:id`. All
 * optional fields accept `null` to clear the value server-side.
 */
export interface StoryInput {
  title: string;
  genre?: string | null;
  synopsis?: string | null;
  worldNotes?: string | null;
  targetWords?: number | null;
  systemPrompt?: string | null;
}

export const storiesQueryKey = ['stories'] as const;

export function useStoriesQuery(): UseQueryResult<StoryListItem[], Error> {
  return useQuery({
    queryKey: storiesQueryKey,
    queryFn: async (): Promise<StoryListItem[]> => {
      const res = await api<StoriesResponse>('/stories');
      return res.stories;
    },
  });
}

export function useCreateStoryMutation(): UseMutationResult<StoryListItem, Error, StoryInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: StoryInput): Promise<StoryListItem> => {
      const res = await api<StoryResponse>('/stories', {
        method: 'POST',
        body: input as unknown as Record<string, unknown>,
      });
      return res.story;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: storiesQueryKey });
    },
  });
}

export interface UpdateStoryArgs {
  id: string;
  input: Partial<StoryInput>;
}

export function useUpdateStoryMutation(): UseMutationResult<StoryListItem, Error, UpdateStoryArgs> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: UpdateStoryArgs): Promise<StoryListItem> => {
      const res = await api<StoryResponse>(`/stories/${id}`, {
        method: 'PATCH',
        body: input as unknown as Record<string, unknown>,
      });
      return res.story;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: storiesQueryKey });
    },
  });
}
