import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChatTab } from './ChatTab';

const meta: Meta<typeof ChatTab> = {
  title: 'Chat/ChatTab',
  component: ChatTab,
  decorators: [
    (Story) => (
      <QueryClientProvider client={new QueryClient()}>
        <div style={{ width: 360, height: 720, border: '1px solid var(--line)' }}>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  args: { chapterId: 'demo-chapter', editor: null },
};
export default meta;
type Story = StoryObj<typeof ChatTab>;

// TODO: richer stories require fetch mocking — see frontend/.storybook for the
// current decorator pattern (no MSW handler is wired in yet, so this story
// renders the empty state while the chats-list query resolves to nothing).
export const Default: Story = {};
