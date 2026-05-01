import type { Meta, StoryObj } from '@storybook/react-vite';
import { Pill } from './primitives';

const meta = {
  title: 'Primitives/Pill',
  component: Pill,
  args: { children: 'Open' },
} satisfies Meta<typeof Pill>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Accent: Story = { args: { tone: 'accent' } };
export const AI: Story = { args: { tone: 'ai', children: 'AI' } };
export const Danger: Story = { args: { tone: 'danger', children: 'Failed' } };
export const Neutral: Story = { args: { tone: 'neutral', children: 'Draft' } };
