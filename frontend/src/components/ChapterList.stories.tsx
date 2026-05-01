import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ChapterMeta } from '@/hooks/useChapters';
import { chaptersQueryKey } from '@/hooks/useChapters';
import { ChapterList } from './ChapterList';

const STORY_ID = 'story-demo';

const sampleChapters: ChapterMeta[] = [
  {
    id: 'c1',
    storyId: STORY_ID,
    title: 'Threshold',
    wordCount: 1240,
    orderIndex: 0,
    status: 'draft',
    createdAt: '2026-04-01T12:00:00Z',
    updatedAt: '2026-04-30T12:00:00Z',
  },
  {
    id: 'c2',
    storyId: STORY_ID,
    title: 'Descent',
    wordCount: 980,
    orderIndex: 1,
    status: 'draft',
    createdAt: '2026-04-02T12:00:00Z',
    updatedAt: '2026-04-30T12:00:00Z',
  },
  {
    id: 'c3',
    storyId: STORY_ID,
    title: '',
    wordCount: 0,
    orderIndex: 2,
    status: 'draft',
    createdAt: '2026-04-03T12:00:00Z',
    updatedAt: '2026-04-30T12:00:00Z',
  },
];

function withClient(seed: ChapterMeta[] | null) {
  return (Story: () => React.ReactElement) => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Number.POSITIVE_INFINITY,
          gcTime: Number.POSITIVE_INFINITY,
        },
      },
    });
    if (seed !== null) {
      client.setQueryData(chaptersQueryKey(STORY_ID), seed);
    }
    return (
      <QueryClientProvider client={client}>
        <div style={{ width: 240 }}>
          <Story />
        </div>
      </QueryClientProvider>
    );
  };
}

const meta = {
  title: 'Components/ChapterList',
  component: ChapterList,
  args: {
    storyId: STORY_ID,
    activeChapterId: null,
    onSelectChapter: () => {},
  },
} satisfies Meta<typeof ChapterList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithChapters: Story = {
  args: { activeChapterId: 'c2' },
  decorators: [withClient(sampleChapters)],
};

export const Empty: Story = {
  decorators: [withClient([])],
};

export const Loading: Story = {
  decorators: [withClient(null)],
};
