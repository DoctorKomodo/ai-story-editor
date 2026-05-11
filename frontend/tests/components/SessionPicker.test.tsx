import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type Session, SessionPicker } from '@/components/SessionPicker';

const LABELS = {
  kindLabel: 'SCENE',
  ariaPrefix: 'Scene session: ',
  dropdownHeader: 'Scenes in this chapter',
  newButtonLabel: 'New scene',
} as const;

const sessions: Session[] = [
  { id: 's1', title: 'Veranda', lastActivityAt: '2026-05-07T12:00:00Z' },
  { id: 's2', title: 'Cellar', lastActivityAt: '2026-05-06T12:00:00Z' },
];

describe('SessionPicker', () => {
  let onSelect: ReturnType<typeof vi.fn>;
  let onRename: ReturnType<typeof vi.fn>;
  let onDelete: ReturnType<typeof vi.fn>;
  let onNew: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onSelect = vi.fn();
    onRename = vi.fn();
    onDelete = vi.fn();
    onNew = vi.fn();
  });

  function renderPicker(
    overrides: Partial<{ sessions: Session[]; activeSessionId: string | null }> = {},
  ) {
    return render(
      <SessionPicker
        labels={LABELS}
        sessions={overrides.sessions ?? sessions}
        activeSessionId={overrides.activeSessionId ?? 's1'}
        onSelect={onSelect}
        onRename={onRename}
        onDelete={onDelete}
        onNew={onNew}
      />,
    );
  }

  it('shows the active session title in the closed button', () => {
    renderPicker();
    expect(screen.getByRole('button', { name: /scene session: veranda/i })).toBeInTheDocument();
  });

  it('shows "No session yet" when empty', () => {
    renderPicker({ sessions: [], activeSessionId: null });
    expect(screen.getByText(/no session yet/i)).toBeInTheDocument();
  });

  it('opens the dropdown on click and lists all sessions', async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(screen.getByRole('button', { name: /scene session/i }));
    expect(screen.getByRole('option', { name: /veranda/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('option', { name: /cellar/i })).toBeInTheDocument();
  });

  it('calls onSelect when a session row is clicked', async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(screen.getByRole('button', { name: /scene session/i }));
    await user.click(screen.getByRole('option', { name: /cellar/i }));
    expect(onSelect).toHaveBeenCalledWith('s2');
  });

  it('inline-renames a session — Enter to save', async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(screen.getByRole('button', { name: /scene session/i }));
    await user.click(screen.getByRole('button', { name: /rename veranda/i }));
    const input = screen.getByDisplayValue('Veranda');
    await user.clear(input);
    await user.type(input, 'Veranda confrontation{enter}');
    expect(onRename).toHaveBeenCalledWith('s1', 'Veranda confrontation');
  });

  it('Escape cancels rename without firing onRename', async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(screen.getByRole('button', { name: /scene session/i }));
    await user.click(screen.getByRole('button', { name: /rename veranda/i }));
    await user.keyboard('{Escape}');
    expect(onRename).not.toHaveBeenCalled();
  });

  it('calls onDelete when delete is clicked', async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(screen.getByRole('button', { name: /scene session/i }));
    await user.click(screen.getByRole('button', { name: /delete veranda/i }));
    expect(onDelete).toHaveBeenCalledWith('s1');
  });

  it('calls onNew when "New scene" is clicked', async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(screen.getByRole('button', { name: /scene session/i }));
    await user.click(screen.getByRole('button', { name: /new scene/i }));
    expect(onNew).toHaveBeenCalledOnce();
  });

  // [B1] Escape during rename should only exit rename mode, NOT close the dropdown.
  it('[B1] Escape during rename exits rename mode but leaves dropdown open', async () => {
    const user = userEvent.setup();
    renderPicker();
    // Open the dropdown.
    await user.click(screen.getByRole('button', { name: /scene session/i }));
    // Start renaming.
    await user.click(screen.getByRole('button', { name: /rename veranda/i }));
    expect(screen.getByDisplayValue('Veranda')).toBeInTheDocument();

    // Press Escape — should cancel rename but keep the listbox in the DOM.
    await user.keyboard('{Escape}');

    // Rename input is gone.
    expect(screen.queryByDisplayValue('Veranda')).not.toBeInTheDocument();
    // Dropdown is still open (listbox role still present).
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    // onRename must not have fired.
    expect(onRename).not.toHaveBeenCalled();
  });

  // [B2] Blur after Escape should not commit the rename.
  it('[B2] blur after Escape does not commit the rename', async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(screen.getByRole('button', { name: /scene session/i }));
    await user.click(screen.getByRole('button', { name: /rename veranda/i }));
    const input = screen.getByDisplayValue('Veranda');
    // Type something first so there is a changed draft.
    await user.clear(input);
    await user.type(input, 'New Name');

    // Simulate Escape then blur (same sequence as real browser).
    await user.keyboard('{Escape}');
    // jsdom doesn't fire blur automatically after Escape; fire it manually.
    input.blur();

    // onRename must not have been called — the cancel should have suppressed the blur.
    expect(onRename).not.toHaveBeenCalled();
  });
});
