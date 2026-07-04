import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChapterConflictBanner } from '@/components/ChapterConflictBanner';

describe('<ChapterConflictBanner>', () => {
  it('renders the conflict message', () => {
    render(<ChapterConflictBanner onReload={vi.fn()} onOverwrite={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('This chapter changed elsewhere.');
  });

  it('fires onReload when Reload is clicked', async () => {
    const onReload = vi.fn();
    render(<ChapterConflictBanner onReload={onReload} onOverwrite={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('fires onOverwrite when Overwrite is clicked', async () => {
    const onOverwrite = vi.fn();
    render(<ChapterConflictBanner onReload={vi.fn()} onOverwrite={onOverwrite} />);
    await userEvent.click(screen.getByRole('button', { name: 'Overwrite' }));
    expect(onOverwrite).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons while busy', async () => {
    const onReload = vi.fn();
    const onOverwrite = vi.fn();
    render(<ChapterConflictBanner onReload={onReload} onOverwrite={onOverwrite} busy />);

    const reloadBtn = screen.getByRole('button', { name: 'Reload' });
    const overwriteBtn = screen.getByRole('button', { name: 'Overwrite' });
    expect(reloadBtn).toBeDisabled();
    expect(overwriteBtn).toBeDisabled();

    await userEvent.click(reloadBtn);
    await userEvent.click(overwriteBtn);
    expect(onReload).not.toHaveBeenCalled();
    expect(onOverwrite).not.toHaveBeenCalled();
  });
});
