import type { Meta, StoryObj } from '@storybook/react-vite';
import { Field, Input, useId } from './primitives';

function FieldDemo({
  label,
  hint,
  error,
  invalid,
}: {
  label: string;
  hint?: string;
  error?: string;
  invalid?: boolean;
}) {
  const id = useId();
  return (
    <div style={{ width: 320 }}>
      <Field label={label} hint={hint} error={error} htmlFor={id}>
        <Input id={id} invalid={invalid} defaultValue="" placeholder="Type something…" />
      </Field>
    </div>
  );
}

const meta = {
  title: 'Primitives/Field',
  component: FieldDemo,
} satisfies Meta<typeof FieldDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithHint: Story = { args: { label: 'Display name', hint: 'Optional' } };
export const WithError: Story = {
  args: { label: 'Username', error: 'Already taken', invalid: true },
};
export const Required: Story = { args: { label: 'Password', hint: 'Required' } };
