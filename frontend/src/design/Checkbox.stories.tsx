import type { Meta, StoryObj } from '@storybook/react-vite';
import { Checkbox } from './primitives';

const meta = {
  title: 'Primitives/Checkbox',
  component: Checkbox,
  args: { 'aria-label': 'Example checkbox' },
  decorators: [
    (Story) => (
      <div style={{ padding: 16 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unchecked: Story = { args: { defaultChecked: false } };
export const Checked: Story = { args: { defaultChecked: true } };
export const Disabled: Story = { args: { defaultChecked: true, disabled: true } };
