import type { Meta, StoryObj } from '@storybook/react-vite';
import { InlineEdit } from './primitives';

const meta = {
  title: 'Primitives/InlineEdit',
  component: InlineEdit,
  args: {
    initialValue: 'Grimdark ending',
    placeholder: 'Draft B',
    ariaLabel: 'Rename draft',
    onCommit: () => {},
    onCancel: () => {},
  },
  argTypes: {
    onCommit: { action: 'commit' },
    onCancel: { action: 'cancel' },
  },
} satisfies Meta<typeof InlineEdit>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EditingExistingLabel: Story = {};

export const EmptyWithPositionalPlaceholder: Story = {
  args: { initialValue: '' },
};
