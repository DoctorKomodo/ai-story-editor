import type { Meta, StoryObj } from '@storybook/react-vite';
import { AutosaveIndicator } from './AutosaveIndicator';

const meta = {
  title: 'Components/AutosaveIndicator',
  component: AutosaveIndicator,
  args: { savedAt: null, retryAt: null },
} satisfies Meta<typeof AutosaveIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = { args: { status: 'idle' } };

export const Saving: Story = { args: { status: 'saving' } };

export const Saved: Story = {
  args: { status: 'saved', savedAt: Date.now() - 12_000 },
};

export const ErrorRetrying: Story = {
  args: { status: 'error', retryAt: Date.now() + 8_000 },
};
