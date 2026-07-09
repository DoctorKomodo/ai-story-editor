import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { JSONContent } from '@tiptap/core';
import { Paper } from '@/components/Paper';

// Empty client — Paper's character/settings queries degrade to defaults with
// no network in Storybook.
function client(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

const BODY: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'The tower had stood empty for a hundred years before the light returned to its highest window.',
        },
      ],
    },
  ],
};

const meta: Meta<typeof Paper> = {
  title: 'Components/Paper',
  component: Paper,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <QueryClientProvider client={client()}>
        <div className="min-h-screen bg-bg">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof Paper>;

export const TitledChapter: Story = {
  args: {
    chapterId: 'ch-1',
    chapterTitle: 'The Reckoning',
    chapterNumber: 3,
    draftLabel: 'Draft A',
    initialWordCount: 1204,
    initialBodyJson: BODY,
    storyId: 'story-1',
  },
};

export const UntitledChapter: Story = {
  args: {
    chapterId: 'ch-2',
    chapterTitle: '',
    chapterNumber: 1,
    draftLabel: 'Draft 1',
    initialWordCount: 0,
    storyId: 'story-1',
  },
};

export const NoChapterSelected: Story = {
  args: {
    chapterId: null,
    chapterTitle: null,
    initialWordCount: 0,
    storyId: 'story-1',
  },
};
