import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
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
 * Single-story shape fetched by the editor. The editor needs the narrative
 * fields a dashboard card doesn't (worldNotes, systemPrompt, ...), but still
 * never sees ciphertext — the repo layer strips it on read. Chapters are
 * fetched separately by F10 (`useChapters(storyId)`), so this shape does
 * not embed them.
 */
export interface Story {
  id: string;
  title: string;
  genre: string | null;
  synopsis: string | null;
  worldNotes: string | null;
  targetWords: number | null;
  systemPrompt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoryDetailResponse {
  story: Story;
}

export const storyQueryKey = (id: string): readonly [string, string] => ['story', id] as const;

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
      const res = await api<StoryDetailResponse>(`/stories/${encodeURIComponent(id ?? '')}`);
      return res.story;
    },
    enabled: Boolean(id),
  });
}

export function useCreateStoryMutation(): UseMutationResult<StoryListItem, Error, StoryInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: StoryInput): Promise<StoryListItem> => {
      const res = await api<StoryResponse>('/stories', {
        method: 'POST',
        body: input,
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
        body: input,
      });
      return res.story;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: storiesQueryKey });
    },
  });
}
