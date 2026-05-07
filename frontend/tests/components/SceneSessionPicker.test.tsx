import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type SceneSession, SceneSessionPicker } from '@/components/SceneSessionPicker';

const sessions: SceneSession[] = [
  { id: 's1', title: 'Veranda', updatedAt: '2026-05-07T12:00:00Z' },
  { id: 's2', title: 'Cellar', updatedAt: '2026-05-06T12:00:00Z' },
];

describe('SceneSessionPicker', () => {
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
    overrides: Partial<{ sessions: SceneSession[]; activeSessionId: string | null }> = {},
  ) {
    return render(
      <SceneSessionPicker
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
});
