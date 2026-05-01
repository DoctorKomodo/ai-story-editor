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
    title: 'The Churn at Dawn',
    wordCount: 2800,
    orderIndex: 0,
    status: 'draft',
    createdAt: '2026-04-01T12:00:00Z',
    updatedAt: '2026-04-30T12:00:00Z',
  },
  {
    id: 'c2',
    storyId: STORY_ID,
    title: 'A Visitor from the Other Wing',
    wordCount: 3100,
    orderIndex: 1,
    status: 'draft',
    createdAt: '2026-04-02T12:00:00Z',
    updatedAt: '2026-04-30T12:00:00Z',
  },
  {
    id: 'c3',
    storyId: STORY_ID,
    title: 'What Ilonoré Brought',
    wordCount: 2900,
    orderIndex: 2,
    status: 'draft',
    createdAt: '2026-04-03T12:00:00Z',
    updatedAt: '2026-04-30T12:00:00Z',
  },
  {
    id: 'c4',
    storyId: STORY_ID,
    title: 'The Weight of Ash',
    wordCount: 3500,
    orderIndex: 3,
    status: 'draft',
    createdAt: '2026-04-04T12:00:00Z',
    updatedAt: '2026-04-30T12:00:00Z',
  },
  {
    id: 'c5',
    storyId: STORY_ID,
    title: "Maulster's Jaw",
    wordCount: 2600,
    orderIndex: 4,
    status: 'draft',
    createdAt: '2026-04-05T12:00:00Z',
    updatedAt: '2026-04-30T12:00:00Z',
  },
  {
    id: 'c6',
    storyId: STORY_ID,
    title: '',
    wordCount: 0,
    orderIndex: 5,
    status: 'draft',
    createdAt: '2026-04-06T12:00:00Z',
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
        <div style={{ width: 260 }}>
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

export const Default: Story = {
  args: { activeChapterId: 'c1' },
  decorators: [withClient(sampleChapters)],
};

export const Empty: Story = {
  decorators: [withClient([])],
};

export const Loading: Story = {
  decorators: [withClient(null)],
};

/**
 * Click the × on the active row to see the inline Delete/Cancel pair.
 * The mutation will fail (no MSW handler) — what's being eyeballed is the
 * visual swap from word-count slot to the buttons.
 */
export const DeleteConfirm: Story = {
  args: { activeChapterId: 'c1' },
  decorators: [withClient(sampleChapters)],
};
