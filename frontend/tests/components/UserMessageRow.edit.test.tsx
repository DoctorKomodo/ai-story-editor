import { fireEvent, render, screen } from '@testing-library/react';
import type { Message } from 'story-editor-shared';
import { describe, expect, it, vi } from 'vitest';
import { UserMessageRow } from '@/components/messageRow/UserMessageRow';

function makeMsg(overrides: Partial<Message> = {}): Message {
  return {
    id: 'u1',
    role: 'user',
    content: 'hello',
    attachmentJson: null,
    citationsJson: null,
    model: null,
    tokens: null,
    latencyMs: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  };
}

describe('UserMessageRow edit/resend', () => {
  it('renders Edit + Resend when handlers are provided', () => {
    render(<UserMessageRow message={makeMsg()} onBeginEdit={vi.fn()} onResend={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resend' })).toBeTruthy();
  });

  it('renders no actions when handlers are absent (draft rows)', () => {
    render(<UserMessageRow message={makeMsg()} />);
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('shows a textarea + Cancel/Confirm in edit mode', () => {
    render(
      <UserMessageRow
        message={makeMsg()}
        isEditing
        onBeginEdit={vi.fn()}
        onResend={vi.fn()}
        onConfirmEdit={vi.fn()}
        onCancelEdit={vi.fn()}
      />,
    );
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('hello');
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('Confirm with changed text calls onConfirmEdit(id, text)', () => {
    const onConfirmEdit = vi.fn();
    render(
      <UserMessageRow
        message={makeMsg()}
        isEditing
        onConfirmEdit={onConfirmEdit}
        onCancelEdit={vi.fn()}
        onBeginEdit={vi.fn()}
        onResend={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'changed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirmEdit).toHaveBeenCalledWith('u1', 'changed');
  });

  it('Confirm with unchanged text calls onCancelEdit (no PATCH)', () => {
    const onConfirmEdit = vi.fn();
    const onCancelEdit = vi.fn();
    render(
      <UserMessageRow
        message={makeMsg()}
        isEditing
        onConfirmEdit={onConfirmEdit}
        onCancelEdit={onCancelEdit}
        onBeginEdit={vi.fn()}
        onResend={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirmEdit).not.toHaveBeenCalled();
    expect(onCancelEdit).toHaveBeenCalled();
  });

  it('Confirm is disabled when the text is empty', () => {
    render(
      <UserMessageRow
        message={makeMsg()}
        isEditing
        onConfirmEdit={vi.fn()}
        onCancelEdit={vi.fn()}
        onBeginEdit={vi.fn()}
        onResend={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
    expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('disables Edit + Resend while actionsDisabled', () => {
    render(
      <UserMessageRow
        message={makeMsg()}
        actionsDisabled
        onBeginEdit={vi.fn()}
        onResend={vi.fn()}
      />,
    );
    expect((screen.getByRole('button', { name: 'Edit' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Resend' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
