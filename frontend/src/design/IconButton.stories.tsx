import type { Meta, StoryObj } from '@storybook/react-vite';
import { IconButton } from './primitives';

function CloseGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <title>Close</title>
      <path d="M18 6L6 18" />
      <path d="M6 6l12 12" />
    </svg>
  );
}

function BoldGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <title>Bold</title>
      <path d="M6 4h7a4 4 0 010 8H6zM6 12h8a4 4 0 010 8H6z" />
    </svg>
  );
}

const meta = {
  title: 'Primitives/IconButton',
  component: IconButton,
  args: { ariaLabel: 'Close', children: <CloseGlyph /> },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Active: Story = {
  args: { ariaLabel: 'Bold', active: true, children: <BoldGlyph /> },
};
export const Disabled: Story = { args: { disabled: true } };
