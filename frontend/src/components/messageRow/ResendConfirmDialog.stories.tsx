import type { Meta, StoryObj } from '@storybook/react-vite';
import { ResendConfirmDialog } from './ResendConfirmDialog';

const meta: Meta<typeof ResendConfirmDialog> = {
  title: 'MessageRow/ResendConfirmDialog',
  component: ResendConfirmDialog,
  decorators: [
    (Story) => (
      <div className="bg-bg p-4 min-h-[200px] flex items-center justify-center">
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof ResendConfirmDialog>;

export const Default: Story = {
  args: {
    count: 3,
    verb: 'Resend',
    onConfirm: () => console.log('confirmed'),
    onCancel: () => console.log('cancelled'),
  },
};

export const Regenerate: Story = {
  args: {
    count: 2,
    verb: 'Regenerate',
    onConfirm: () => console.log('confirmed'),
    onCancel: () => console.log('cancelled'),
  },
};
