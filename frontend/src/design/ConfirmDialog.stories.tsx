import type { Meta, StoryObj } from '@storybook/react-vite';
import { ConfirmDialog } from './primitives';

const meta = {
  title: 'Primitives/ConfirmDialog',
  component: ConfirmDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    open: true,
    title: 'Delete "The Hollow Crown"?',
    body: 'This permanently removes the story and all its chapters, characters, outline, and chats.',
    confirmLabel: 'Delete',
    onConfirm: () => {},
    onCancel: () => {},
    testId: 'confirm-dialog',
  },
} satisfies Meta<typeof ConfirmDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Default: destructive action, danger button. */
export const Default: Story = {};

/** Non-destructive action — the regenerate-from-here confirm. */
export const Primary: Story = {
  args: {
    title: 'Regenerate from here?',
    body: 'This will delete 7 messages below and regenerate the reply.',
    confirmLabel: 'Regenerate',
    confirmVariant: 'primary',
  },
};

/** In flight: Cancel is disabled and the action button shows a spinner. */
export const Pending: Story = {
  args: { confirmLabel: 'Deleting…', pending: true },
};

/** The action failed. The dialog stays open and shows the reason. */
export const WithError: Story = {
  args: { error: 'Could not delete the story. Please try again.' },
};
