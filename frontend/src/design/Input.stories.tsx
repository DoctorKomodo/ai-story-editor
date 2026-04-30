import type { Meta, StoryObj } from '@storybook/react-vite';
import { Input } from './primitives';

const meta = {
  title: 'Primitives/Input',
  component: Input,
  args: { defaultValue: '' },
  decorators: [
    (Story) => (
      <div style={{ width: 320 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { placeholder: 'mono (default)' } };
export const Serif: Story = { args: { font: 'serif', placeholder: 'serif' } };
export const Sans: Story = { args: { font: 'sans', placeholder: 'sans' } };
export const Invalid: Story = { args: { invalid: true, defaultValue: 'foo bar' } };
export const Disabled: Story = { args: { disabled: true, defaultValue: 'read-only' } };
export const Placeholder: Story = { args: { placeholder: 'Enter a story title…' } };
