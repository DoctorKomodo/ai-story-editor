import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { StoryListItem } from 'story-editor-shared';
import { storiesQueryKey } from '@/hooks/useStories';
import { StoryBrowser } from './StoryBrowser';

const SAMPLE_STORIES: StoryListItem[] = [
  {
    id: 's1',
    title: 'The Cartographer',
    genre: 'Literary fantasy',
    synopsis: null,
    worldNotes: null,
    targetWords: 90_000,
    includePreviousChaptersInPrompt: true,
    chapterCount: 12,
    totalWordCount: 38_412,
    createdAt: '2026-02-12T00:00:00Z',
    updatedAt: '2026-04-18T00:00:00Z',
  },
  {
    id: 's2',
    title: 'Foundry',
    genre: 'Hard sci-fi',
    synopsis: null,
    worldNotes: null,
    targetWords: 120_000,
    includePreviousChaptersInPrompt: true,
    chapterCount: 4,
    totalWordCount: 11_220,
    createdAt: '2026-03-04T00:00:00Z',
    updatedAt: '2026-04-29T00:00:00Z',
  },
];

function makeClient(stories: StoryListItem[]): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: Number.POSITIVE_INFINITY,
      },
    },
  });
  client.setQueryData(storiesQueryKey, stories);
  return client;
}

interface DemoProps {
  stories: StoryListItem[];
  embedded?: boolean;
  activeStoryId?: string | null;
}

function Demo({ stories, embedded = false, activeStoryId = null }: DemoProps) {
  return (
    <QueryClientProvider client={makeClient(stories)}>
      <MemoryRouter>
        <StoryBrowser
          open
          onClose={() => {
            // demo no-op
          }}
          activeStoryId={activeStoryId}
          embedded={embedded}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const meta = {
  title: 'Components/StoryBrowser',
  component: Demo,
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Dashboard landing surface — embedded (no backdrop / Close). Click "New story"
 * to open the create modal in place.
 */
export const Embedded: Story = {
  args: { stories: SAMPLE_STORIES, embedded: true, activeStoryId: 's2' },
};

/**
 * In-editor modal — dismissible picker. Click "New story" to open the create
 * modal over it.
 */
export const Modal: Story = {
  args: { stories: SAMPLE_STORIES, activeStoryId: 's1' },
};
