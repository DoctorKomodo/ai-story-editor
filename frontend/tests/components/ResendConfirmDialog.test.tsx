import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ResendConfirmDialog } from '@/components/messageRow/ResendConfirmDialog';

describe('ResendConfirmDialog', () => {
  it('names the count and fires onConfirm', () => {
    const onConfirm = vi.fn();
    render(<ResendConfirmDialog count={7} onConfirm={onConfirm} onCancel={vi.fn()} />);
    expect(screen.getByText(/7 messages/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resend' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('fires onCancel', () => {
    const onCancel = vi.fn();
    render(<ResendConfirmDialog count={3} onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
