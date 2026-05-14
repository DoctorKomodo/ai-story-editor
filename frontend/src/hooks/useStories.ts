import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  type Story,
  type StoryCreateInput,
  type StoryListItem,
  type StoryUpdateInput,
  storiesResponseSchema,
  storyResponseSchema,
} from 'story-editor-shared';
import { api } from '@/lib/api';

/**
 * Story list queries + create mutation (F6).
 * Single-story query + update mutation for the editor (F7).
 *
 * Backend contract (B1):
 * - GET   /api/stories          → { stories: StoryListItem[] }  (includes chapterCount, totalWordCount aggregates)
 * - POST  /api/stories          → { story: Story }
 * - GET   /api/stories/:id      → { story: Story }
 * - PATCH /api/stories/:id      → { story: Story }
 *
 * Story and StoryListItem types and response schemas are imported from story-editor-shared.
 * Components must import `type Story` / `type StoryListItem` directly from 'story-editor-shared'.
 */

export const storyQueryKey = (id: string): readonly [string, string] => ['story', id] as const;
export const storiesQueryKey = ['stories'] as const;

export function useStoriesQuery(): UseQueryResult<StoryListItem[], Error> {
  return useQuery({
    queryKey: storiesQueryKey,
    queryFn: async (): Promise<StoryListItem[]> => {
      const raw = await api<unknown>('/stories');
      const { stories } = storiesResponseSchema.parse(raw);
      return stories;
    },
  });
}

/**
 * Fetch a single story by id. Backend returns `{ story }` with ciphertext
 * fields stripped. 403 is used for both "unknown id" and "not owned" to
 * avoid id-enumeration oracles — the editor page surfaces a neutral error
 * rather than propagating the raw status.
 */
export function useStoryQuery(id: string | undefined): UseQueryResult<Story, Error> {
  return useQuery({
    queryKey: storyQueryKey(id ?? ''),
    queryFn: async (): Promise<Story> => {
      const raw = await api<unknown>(`/stories/${encodeURIComponent(id ?? '')}`);
      const { story } = storyResponseSchema.parse(raw);
      return story;
    },
    enabled: Boolean(id),
  });
}

export function useCreateStoryMutation(): UseMutationResult<Story, Error, StoryCreateInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: StoryCreateInput): Promise<Story> => {
      const raw = await api<unknown>('/stories', { method: 'POST', body: input });
      const { story } = storyResponseSchema.parse(raw);
      return story;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: storiesQueryKey });
    },
  });
}

export interface UpdateStoryArgs {
  id: string;
  input: StoryUpdateInput;
}

export function useUpdateStoryMutation(): UseMutationResult<Story, Error, UpdateStoryArgs> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: UpdateStoryArgs): Promise<Story> => {
      const raw = await api<unknown>(`/stories/${id}`, { method: 'PATCH', body: input });
      const { story } = storyResponseSchema.parse(raw);
      return story;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: storiesQueryKey });
    },
  });
}
