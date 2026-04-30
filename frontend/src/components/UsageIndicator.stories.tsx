import type { Meta, StoryObj } from '@storybook/react-vite';
import { UsageIndicator } from './UsageIndicator';

const meta = {
  title: 'Components/UsageIndicator',
  component: UsageIndicator,
} satisfies Meta<typeof UsageIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { usage: { remainingRequests: 142, remainingTokens: 87_500 } },
};

export const HighVolume: Story = {
  args: { usage: { remainingRequests: 4_200, remainingTokens: 1_240_000 } },
};

export const RequestsOnly: Story = {
  args: { usage: { remainingRequests: 12, remainingTokens: null } },
};
