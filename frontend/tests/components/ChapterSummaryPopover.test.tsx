import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { ChapterSummaryPopover } from '@/components/ChapterSummaryPopover';
import { chapterQueryKey } from '@/hooks/useChapters';
import { __resetShortcutsForTests } from '@/hooks/useKeyboardShortcuts';

const META = {
  id: 'c1',
  storyId: 's1',
  orderIndex: 0,
  title: 'Ch',
  wordCount: 10,
  createdAt: '2026-05-18T00:00:00.000Z',
  updatedAt: '2026-05-18T00:00:00.000Z',
};

const anchorEls: HTMLElement[] = [];

afterEach(() => {
  for (const a of anchorEls) a.remove();
  anchorEls.length = 0;
});

function renderHarness(
  detail: { hasSummary: boolean; summaryIsStale: boolean; summary: unknown },
  props: Partial<React.ComponentProps<typeof ChapterSummaryPopover>> = {},
) {
  __resetShortcutsForTests();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(chapterQueryKey('c1'), {
    ...META,
    bodyJson: null,
    summaryUpdatedAt: detail.hasSummary ? '2026-05-18T00:00:00.000Z' : null,
    ...detail,
  });
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  anchorEls.push(anchor);
  return render(
    <QueryClientProvider client={qc}>
      <ChapterSummaryPopover
        chapter={{ ...META, hasSummary: detail.hasSummary, summaryIsStale: detail.summaryIsStale }}
        storyId="s1"
        anchorEl={anchor}
        modelId="m1"
        onClose={() => {}}
        onEdit={() => {}}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('ChapterSummaryPopover', () => {
  it('renders three FieldRows in current state', () => {
    renderHarness({
      hasSummary: true,
      summaryIsStale: false,
      summary: { events: 'a', stateAtEnd: 'b', openThreads: 'c' },
    });
    expect(screen.getByText('Events')).toBeInTheDocument();
    expect(screen.getByText('State at end')).toBeInTheDocument();
    expect(screen.getByText('Open threads')).toBeInTheDocument();
  });

  it('renders Generate button in missing state', () => {
    renderHarness({ hasSummary: false, summaryIsStale: false, summary: null });
    expect(screen.getByRole('button', { name: /generate summary/i })).toBeInTheDocument();
  });

  it('shows the corrupted/unreadable branch when hasSummary but summary is null', () => {
    renderHarness({ hasSummary: true, summaryIsStale: false, summary: null });
    expect(screen.getByRole('button', { name: /(regenerate|generate)/i })).toBeInTheDocument();
    // Both the header pill ("unreadable") and the body copy ("couldn't be read") satisfy this;
    // either presence confirms the corrupted branch rendered.
    expect(screen.getAllByText(/unreadable|couldn.t be read/i).length).toBeGreaterThan(0);
  });

  it('Regenerate fires the summarise mutation (POST /stories/s1/chapters/c1/summarise)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          summary: { events: 'a', stateAtEnd: 'b', openThreads: 'c' },
          summaryUpdatedAt: '2026-05-18T00:00:00.000Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    renderHarness({
      hasSummary: true,
      summaryIsStale: false,
      summary: { events: 'a', stateAtEnd: 'b', openThreads: 'c' },
    });
    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/stories/s1/chapters/c1/summarise'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('Edit fires onEdit with the chapter id', () => {
    const onEdit = vi.fn();
    renderHarness(
      {
        hasSummary: true,
        summaryIsStale: false,
        summary: { events: 'a', stateAtEnd: 'b', openThreads: 'c' },
      },
      { onEdit },
    );
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect(onEdit).toHaveBeenCalledWith('c1');
  });

  it('Escape closes', () => {
    const onClose = vi.fn();
    renderHarness(
      {
        hasSummary: true,
        summaryIsStale: false,
        summary: { events: 'a', stateAtEnd: 'b', openThreads: 'c' },
      },
      { onClose },
    );
    // The keyboard-shortcut registry listens on document, not window.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('renders "possibly stale" pill and Edit+Regenerate in stale state', () => {
    renderHarness({
      hasSummary: true,
      summaryIsStale: true,
      summary: { events: 'a', stateAtEnd: 'b', openThreads: 'c' },
    });
    expect(screen.getByText(/possibly stale/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /regenerate/i })).toBeInTheDocument();
  });

  it('disables Generate/Regenerate when modelId is empty', () => {
    renderHarness(
      {
        hasSummary: true,
        summaryIsStale: false,
        summary: { events: 'a', stateAtEnd: 'b', openThreads: 'c' },
      },
      { modelId: '' },
    );
    expect(screen.getByRole('button', { name: /regenerate/i })).toBeDisabled();

    // Also check the Generate button in the missing state.
    renderHarness({ hasSummary: false, summaryIsStale: false, summary: null }, { modelId: '' });
    expect(screen.getByRole('button', { name: /generate summary/i })).toBeDisabled();
  });

  it('shows Cancel button while generating and Cancel calls onClose', async () => {
    const onClose = vi.fn();
    // Never-resolving fetch so the mutation stays pending.
    vi.spyOn(global, 'fetch').mockReturnValue(new Promise(() => {}));
    renderHarness(
      {
        hasSummary: true,
        summaryIsStale: false,
        summary: { events: 'a', stateAtEnd: 'b', openThreads: 'c' },
      },
      { onClose },
    );
    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('surfaces Venice errors with the error banner (code + message + Venice detail)', async () => {
    // Backend returns the venice-errors.ts envelope on a rate-limited 429.
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'venice_rate_limited',
            message: 'Venice is rate limiting this request. Try again shortly.',
            retryAfterSeconds: 30,
            details: { veniceMessage: 'Rate limit exceeded for model llama-3.1-70b.' },
          },
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    renderHarness({
      hasSummary: true,
      summaryIsStale: false,
      summary: { events: 'a', stateAtEnd: 'b', openThreads: 'c' },
    });
    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));
    const banner = await screen.findByTestId('venice-error-banner');
    expect(banner).toHaveTextContent(/venice_rate_limited/i);
    expect(banner).toHaveTextContent(/rate limiting/i);
    // The Venice "details.veniceMessage" must reach the inline caption.
    expect(banner).toHaveTextContent(/rate limit exceeded for model/i);
  });

  it('banner Retry re-fires the summarise mutation', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: 'venice_unavailable', message: 'Venice is temporarily unavailable.' },
          }),
          { status: 502, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            summary: { events: 'a', stateAtEnd: 'b', openThreads: 'c' },
            summaryUpdatedAt: '2026-05-18T00:00:00.000Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    renderHarness({
      hasSummary: false,
      summaryIsStale: false,
      summary: null,
    });
    fireEvent.click(screen.getByRole('button', { name: /generate summary/i }));
    await screen.findByTestId('venice-error-banner');
    // The banner's own Retry button (not the page-level Generate one).
    // `vi.spyOn(global, 'fetch')` returns a shared spy whose `mock.calls`
    // accumulates across tests in this file (no global mockReset), so we
    // capture a baseline and assert on the delta rather than the absolute count.
    const baseline = fetchSpy.mock.calls.length;
    const banner = screen.getByTestId('venice-error-banner');
    fireEvent.click(within(banner).getByRole('button', { name: /retry/i }));
    await waitFor(() => {
      expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(baseline + 1);
    });
    const retriedCall = fetchSpy.mock.calls[baseline];
    expect(retriedCall?.[0]).toEqual(expect.stringContaining('/stories/s1/chapters/c1/summarise'));
    expect(retriedCall?.[1]).toEqual(expect.objectContaining({ method: 'POST' }));
  });
});
