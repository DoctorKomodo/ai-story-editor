import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { StoryListItem } from 'story-editor-shared';
import { userEvent, within } from 'storybook/test';
import { Button } from '@/design/primitives';
import { storiesQueryKey } from '@/hooks/useStories';
import { StoryPicker } from './StoryPicker';

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
  {
    id: 's3',
    title: 'Untitled',
    genre: null,
    synopsis: null,
    worldNotes: null,
    targetWords: null,
    includePreviousChaptersInPrompt: true,
    chapterCount: 0,
    totalWordCount: 0,
    createdAt: '2026-04-30T00:00:00Z',
    updatedAt: '2026-04-30T00:00:00Z',
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
  const [open, setOpen] = useState(true);
  return (
    <QueryClientProvider client={makeClient(stories)}>
      {!embedded ? (
        <Button variant="ghost" onClick={() => setOpen(true)}>
          Reopen picker
        </Button>
      ) : null}
      <StoryPicker
        open={embedded ? true : open}
        onClose={() => setOpen(false)}
        activeStoryId={activeStoryId}
        onSelectStory={() => {
          // demo no-op
        }}
        onCreateStory={() => {
          // demo no-op
        }}
        onImportDocx={() => {
          // demo no-op
        }}
        embedded={embedded}
      />
    </QueryClientProvider>
  );
}

const meta = {
  title: 'Components/StoryPicker',
  component: Demo,
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Modal mode — opens with a backdrop and a close-X. */
export const Open: Story = {
  args: { stories: SAMPLE_STORIES, activeStoryId: 's1' },
};

/** Empty vault — renders <StoryPickerEmpty> in the body. */
export const Empty: Story = {
  args: { stories: [] },
};

/**
 * [F58] Embedded mode — dashboard surface. No backdrop, no Escape, no Close
 * button.
 */
export const Embedded: Story = {
  args: { stories: SAMPLE_STORIES, embedded: true, activeStoryId: 's2' },
};

/**
 * [story-editor-0wz] Clicking a row's delete icon opens the confirm dialog —
 * title names the story, body warns about the full cascade (chapters,
 * characters, outline, chats), Cancel / destructive Delete.
 */
export const DeleteConfirm: Story = {
  args: { stories: SAMPLE_STORIES, activeStoryId: 's1' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Delete "The Cartographer"' }));
  },
};

/**
 * [story-editor-0wz] Confirming schedules the 5s soft-delete: the row hides
 * immediately and the undo toast appears (same shape as ChatSceneTab's).
 */
export const Deleting: Story = {
  args: { stories: SAMPLE_STORIES, activeStoryId: 's1' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Delete "The Cartographer"' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Delete' }));
  },
};
