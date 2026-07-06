import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { InlineEdit } from '@/design/primitives';

function setup(initialValue = 'Old name'): {
  onCommit: ReturnType<typeof vi.fn>;
  onCancel: ReturnType<typeof vi.fn>;
} {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  render(
    <InlineEdit
      initialValue={initialValue}
      placeholder="Draft B"
      ariaLabel="Rename draft"
      onCommit={onCommit}
      onCancel={onCancel}
      testId="inline-edit"
    />,
  );
  return { onCommit, onCancel };
}

describe('InlineEdit', () => {
  it('autofocuses with the initial value selected', () => {
    setup();
    const input = screen.getByRole('textbox', { name: 'Rename draft' }) as HTMLInputElement;
    expect(input).toHaveFocus();
    expect(input.value).toBe('Old name');
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('Old name'.length);
  });

  it('Enter commits the trimmed value', async () => {
    const { onCommit } = setup();
    const input = screen.getByRole('textbox', { name: 'Rename draft' });
    await userEvent.clear(input);
    await userEvent.type(input, '  New name  {Enter}');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('New name');
  });

  it('clearing to empty commits the empty string (caller decides semantics)', async () => {
    const { onCommit } = setup();
    const input = screen.getByRole('textbox', { name: 'Rename draft' });
    await userEvent.clear(input);
    await userEvent.keyboard('{Enter}');
    expect(onCommit).toHaveBeenCalledWith('');
  });

  it('Escape cancels without committing — including via the following blur', async () => {
    const { onCommit, onCancel } = setup();
    const input = screen.getByRole('textbox', { name: 'Rename draft' });
    await userEvent.type(input, ' changed');
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    // A blur after Escape (e.g. parent unmount ordering) must not commit.
    (input as HTMLInputElement).blur();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('blur commits the trimmed value', async () => {
    const { onCommit } = setup();
    const input = screen.getByRole('textbox', { name: 'Rename draft' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Blurred name');
    (input as HTMLInputElement).blur();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('Blurred name');
  });
});
