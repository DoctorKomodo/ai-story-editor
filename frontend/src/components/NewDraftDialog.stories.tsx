import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { userEvent, within } from 'storybook/test';
import { NewDraftDialog } from '@/components/NewDraftDialog';

const meta: Meta<typeof NewDraftDialog> = {
  title: 'Components/NewDraftDialog',
  component: NewDraftDialog,
  args: {
    chapterId: 'ch-1',
    storyId: 'story-1',
    draftCount: 3,
    viewedIsActive: true,
  },
  argTypes: {
    onClose: { action: 'close' },
    onCreated: { action: 'created' },
  },
  decorators: [
    (Story) => (
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <Story />
      </QueryClientProvider>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof NewDraftDialog>;

export const ForkCurrentDraft: Story = {};

export const ViewingNonActiveDraft: Story = {
  args: { viewedIsActive: false },
};

export const ForkWithCopyChats: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId('new-draft-copy-chats'));
  },
};
