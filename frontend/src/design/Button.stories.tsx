import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './primitives';

const meta = {
  title: 'Primitives/Button',
  component: Button,
  args: { children: 'Save changes' },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = { args: { variant: 'primary' } };
export const Ghost: Story = { args: { variant: 'ghost' } };
export const Danger: Story = { args: { variant: 'danger' } };
export const Link: Story = { args: { variant: 'link', children: 'Read more' } };
export const Loading: Story = {
  args: { variant: 'primary', loading: true, children: 'Saving…' },
};
export const Disabled: Story = { args: { variant: 'primary', disabled: true } };
export const SmallGhost: Story = { args: { variant: 'ghost', size: 'sm' } };
