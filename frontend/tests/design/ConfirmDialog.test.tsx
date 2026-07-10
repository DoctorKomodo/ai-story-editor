import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '@/design/primitives';

type Props = ComponentProps<typeof ConfirmDialog>;

function renderDialog(overrides: Partial<Props> = {}): {
  onConfirm: ReturnType<typeof vi.fn>;
  onCancel: ReturnType<typeof vi.fn>;
} {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmDialog
      open
      title="Delete this thing?"
      body="This cannot be undone."
      confirmLabel="Delete"
      onConfirm={onConfirm}
      onCancel={onCancel}
      testId="cd"
      {...overrides}
    />,
  );
  return { onConfirm, onCancel };
}

describe('ConfirmDialog', () => {
  it('renders an alertdialog named by its heading', () => {
    renderDialog();
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this thing?' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    renderDialog({ open: false });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('defaults the action button to the danger variant and the cancel label to "Cancel"', () => {
    renderDialog();
    const confirm = screen.getByTestId('cd-confirm');
    expect(confirm).toHaveTextContent('Delete');
    expect(confirm.className).toMatch(/bg-\[var\(--danger\)\]/);
    expect(screen.getByTestId('cd-cancel')).toHaveTextContent('Cancel');
  });

  it('honours confirmVariant="primary" and a custom cancelLabel', () => {
    renderDialog({ confirmVariant: 'primary', confirmLabel: 'Regenerate', cancelLabel: 'Back' });
    const confirm = screen.getByTestId('cd-confirm');
    expect(confirm).toHaveTextContent('Regenerate');
    expect(confirm.className).toMatch(/bg-ink/);
    expect(screen.getByTestId('cd-cancel')).toHaveTextContent('Back');
  });

  it('fires onConfirm and onCancel', async () => {
    const user = userEvent.setup();
    const { onConfirm, onCancel } = renderDialog();
    await user.click(screen.getByTestId('cd-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId('cd-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons while pending', () => {
    renderDialog({ pending: true });
    expect(screen.getByTestId('cd-confirm')).toBeDisabled();
    expect(screen.getByTestId('cd-cancel')).toBeDisabled();
  });

  it('renders an error as role="alert" and keeps the dialog open', () => {
    renderDialog({ error: 'Could not delete.' });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Could not delete.');
    expect(alert).toHaveAttribute('data-testid', 'cd-error');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('omits derived test ids when no testId is given', () => {
    render(
      <ConfirmDialog
        open
        title="T"
        body="B"
        confirmLabel="Go"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // Derived ids must be absent, not the literal string "undefined-confirm".
    expect(screen.getByRole('button', { name: 'Go' })).not.toHaveAttribute('data-testid');
    expect(screen.getByRole('button', { name: 'Cancel' })).not.toHaveAttribute('data-testid');
    expect(screen.getByRole('alertdialog')).not.toHaveAttribute('data-testid');
  });
});
