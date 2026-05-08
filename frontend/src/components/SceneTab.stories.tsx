import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SceneTab } from './SceneTab';

const meta: Meta<typeof SceneTab> = {
  title: 'Chat/SceneTab',
  component: SceneTab,
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
type Story = StoryObj<typeof SceneTab>;

export const Default: Story = {};
