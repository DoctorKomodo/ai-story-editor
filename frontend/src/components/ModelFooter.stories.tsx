import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ModelFooter } from './ModelFooter';

const meta: Meta<typeof ModelFooter> = {
  title: 'Chat/ModelFooter',
  component: ModelFooter,
  decorators: [
    (Story) => (
      <QueryClientProvider client={new QueryClient()}>
        <div style={{ width: 360 }}>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof ModelFooter>;

export const Default: Story = {};
