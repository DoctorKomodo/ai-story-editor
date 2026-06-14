import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ResendConfirmDialog } from '@/components/messageRow/ResendConfirmDialog';

describe('ResendConfirmDialog', () => {
  it('names the count and fires onConfirm', () => {
    const onConfirm = vi.fn();
    render(<ResendConfirmDialog count={7} onConfirm={onConfirm} onCancel={vi.fn()} />);
    expect(screen.getByText(/7 messages/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('fires onCancel', () => {
    const onCancel = vi.fn();
    render(<ResendConfirmDialog count={3} onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('uses singular "message" when count is 1', () => {
    render(<ResendConfirmDialog count={1} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/1 message\b/)).toBeTruthy();
    expect(screen.queryByText(/1 messages/)).toBeNull();
  });
});
