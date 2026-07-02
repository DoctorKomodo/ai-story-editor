import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DraftRestoreBanner } from '@/components/DraftRestoreBanner';

describe('<DraftRestoreBanner>', () => {
  it('renders the draft age text', () => {
    const savedAt = new Date('2026-07-02T12:00:00.000Z').getTime();
    render(<DraftRestoreBanner savedAt={savedAt} onRestore={vi.fn()} onDiscard={vi.fn()} />);
    expect(screen.getByTestId('draft-restore-banner')).toHaveTextContent('Unsaved draft from');
    expect(screen.getByTestId('draft-restore-banner')).toHaveTextContent('found on this device.');
  });

  it('fires onRestore when "Restore draft" is clicked', async () => {
    const onRestore = vi.fn();
    render(<DraftRestoreBanner savedAt={Date.now()} onRestore={onRestore} onDiscard={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Restore draft' }));
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it('fires onDiscard when "Discard" is clicked', async () => {
    const onDiscard = vi.fn();
    render(<DraftRestoreBanner savedAt={Date.now()} onRestore={vi.fn()} onDiscard={onDiscard} />);
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });
});
