import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { ChapterSummarySheet } from './ChapterSummarySheet';

const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
};

describe('ChapterSummarySheet', () => {
  it('renders nothing when open is false', () => {
    render(
      wrap(
        <ChapterSummarySheet
          chapterId="c1"
          storyId="s1"
          open={false}
          onClose={vi.fn()}
          initialSummary={{ events: '', stateAtEnd: '', openThreads: '' }}
        />,
      ),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked without firing PUT', async () => {
    const onClose = vi.fn();
    const fetchSpy = vi.spyOn(global, 'fetch');
    render(
      wrap(
        <ChapterSummarySheet
          chapterId="c1"
          storyId="s1"
          open
          onClose={onClose}
          initialSummary={{ events: '', stateAtEnd: '', openThreads: '' }}
        />,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('submits all three fields via PUT /stories/s1/chapters/c1/summary', async () => {
    const onClose = vi.fn();
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          summary: { events: 'a', stateAtEnd: 'b', openThreads: 'c' },
          summaryUpdatedAt: '2026-05-18T00:00:00.000Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    render(
      wrap(
        <ChapterSummarySheet
          chapterId="c1"
          storyId="s1"
          open
          onClose={onClose}
          initialSummary={{ events: '', stateAtEnd: '', openThreads: '' }}
        />,
      ),
    );
    await userEvent.type(screen.getByLabelText(/events/i), 'a');
    await userEvent.type(screen.getByLabelText(/state at end/i), 'b');
    await userEvent.type(screen.getByLabelText(/open threads/i), 'c');
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/stories/s1/chapters/c1/summary'),
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('seeds fields from initialSummary', () => {
    render(
      wrap(
        <ChapterSummarySheet
          chapterId="c1"
          storyId="s1"
          open
          onClose={vi.fn()}
          initialSummary={{ events: 'ev', stateAtEnd: 'st', openThreads: 'ot' }}
        />,
      ),
    );
    expect(screen.getByLabelText(/events/i)).toHaveValue('ev');
    expect(screen.getByLabelText(/state at end/i)).toHaveValue('st');
    expect(screen.getByLabelText(/open threads/i)).toHaveValue('ot');
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(
      wrap(
        <ChapterSummarySheet
          chapterId="c1"
          storyId="s1"
          open
          onClose={onClose}
          initialSummary={{ events: '', stateAtEnd: '', openThreads: '' }}
        />,
      ),
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
