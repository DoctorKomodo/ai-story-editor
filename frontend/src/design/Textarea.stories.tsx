import type { Meta, StoryObj } from '@storybook/react-vite';
import { Textarea } from './primitives';

const meta = {
  title: 'Primitives/Textarea',
  component: Textarea,
  args: { defaultValue: '' },
  decorators: [
    (Story) => (
      <div style={{ width: 480 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { placeholder: 'Your prose here…' } };
export const Filled: Story = {
  args: { defaultValue: 'Once upon a time…\n\nThe end.', rows: 5 },
};
export const Invalid: Story = { args: { invalid: true, defaultValue: '!!!' } };
export const Disabled: Story = { args: { disabled: true, defaultValue: 'cannot edit' } };
