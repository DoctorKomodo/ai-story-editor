import type { Meta, StoryObj } from '@storybook/react-vite';
import { ApiError } from '@/lib/api';
import { AIResult } from './AIResult';

const meta = {
  title: 'Components/AIResult',
  component: AIResult,
  args: {
    onInsertAtCursor: () => {},
    onDismiss: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ width: 520 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AIResult>;

export default meta;
type Story = StoryObj<typeof meta>;

const SAMPLE_TEXT =
  'Lyra paused at the threshold, weighing the cost of one more step. Behind her, the corridor breathed.';

export const Streaming: Story = {
  args: {
    status: 'streaming',
    text: 'Lyra paused at the threshold, weighing the cost of one more',
    error: null,
  },
};

export const Done: Story = {
  args: { status: 'done', text: SAMPLE_TEXT, error: null },
};

export const ErrorRateLimit: Story = {
  args: {
    status: 'error',
    text: '',
    error: new ApiError(429, 'Rate limit reached', 'rate_limited'),
  },
};

export const ErrorVeniceKeyRequired: Story = {
  args: {
    status: 'error',
    text: '',
    error: new ApiError(409, 'Add a Venice API key', 'venice_key_required'),
  },
};
