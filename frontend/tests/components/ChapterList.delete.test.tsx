import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChapterList } from '@/components/ChapterList';
import { resetApiClientForTests, setUnauthorizedHandler } from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';
import { useSessionStore } from '@/store/session';
import { makeChapterMeta } from '../fixtures/chapter';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderList(opts: {
  activeChapterId: string | null;
  onChapterDeleted?: (id: string) => void;
}): { client: QueryClient } {
  const qc = createQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <ChapterList
        storyId="story-1"
        activeChapterId={opts.activeChapterId}
        onSelectChapter={() => {}}
        onChapterDeleted={opts.onChapterDeleted}
        onOpenSummary={() => {}}
        viewedDraftId={null}
        onSelectDraft={() => {}}
        onRequestNewDraft={() => {}}
      />
    </QueryClientProvider>,
  );
  return { client: qc };
}

describe('ChapterList — delete', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetApiClientForTests();
    setUnauthorizedHandler(() => useSessionStore.getState().clearSession());
    useSessionStore.setState({
      user: { id: 'u1', username: 'alice', name: 'Alice' },
      status: 'authenticated',
    });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
  });

  it('renders × on every row (always mounted, opacity-gated); clickable on the active row', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        chapters: [
          makeChapterMeta({ id: 'c1', orderIndex: 0 }),
          makeChapterMeta({ id: 'c2', orderIndex: 1 }),
        ],
      }),
    );
    renderList({ activeChapterId: 'c2' });
    await screen.findByTestId('chapter-row-c2');
    // Delete button is now present in the DOM for BOTH rows (reveal is opacity,
    // not mount) so selecting a chapter no longer reflows the row.
    expect(screen.getByTestId('chapter-row-c1-delete')).toBeInTheDocument();
    expect(screen.getByTestId('chapter-row-c2-delete')).toBeInTheDocument();
  });

  it('clicking × opens the InlineConfirm and focuses its delete button', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        chapters: [makeChapterMeta({ id: 'c1', orderIndex: 0, wordCount: 1500 })],
      }),
    );
    renderList({ activeChapterId: 'c1' });
    await screen.findByTestId('chapter-row-c1');
    // The word count is now an always-mounted hover overlay on the title, not a
    // trailing slot the confirm swaps out — so it stays in the DOM throughout.
    expect(within(screen.getByTestId('chapter-row-c1')).getByText('1.5k')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('chapter-row-c1-delete'));
    expect(screen.getByTestId('chapter-row-c1-confirm-delete')).toHaveFocus();
  });

  it('Escape dismisses the confirm', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { chapters: [makeChapterMeta({ id: 'c1', orderIndex: 0 })] }),
    );
    renderList({ activeChapterId: 'c1' });
    await screen.findByTestId('chapter-row-c1');
    await userEvent.click(screen.getByTestId('chapter-row-c1-delete'));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByTestId('chapter-row-c1-confirm-delete')).toBeNull();
    });
  });

  it('clicking Delete fires DELETE and removes the row optimistically; onChapterDeleted is called', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          chapters: [
            makeChapterMeta({ id: 'c1', orderIndex: 0 }),
            makeChapterMeta({ id: 'c2', orderIndex: 1 }),
          ],
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse(200, { chapters: [makeChapterMeta({ id: 'c2', orderIndex: 0 })] }),
      );

    const onChapterDeleted = vi.fn();
    renderList({ activeChapterId: 'c1', onChapterDeleted });
    await screen.findByTestId('chapter-row-c1');
    await userEvent.click(screen.getByTestId('chapter-row-c1-delete'));
    await userEvent.click(screen.getByTestId('chapter-row-c1-confirm-delete'));

    await waitFor(() => {
      expect(screen.queryByTestId('chapter-row-c1')).toBeNull();
    });
    expect(onChapterDeleted).toHaveBeenCalledWith('c1');
  });

  it('on 500 the row is restored and an aria-live status is set', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, { chapters: [makeChapterMeta({ id: 'c1', orderIndex: 0 })] }),
      )
      .mockResolvedValueOnce(jsonResponse(500, { error: { code: 'oops' } }));

    renderList({ activeChapterId: 'c1' });
    await screen.findByTestId('chapter-row-c1');
    await userEvent.click(screen.getByTestId('chapter-row-c1-delete'));
    await userEvent.click(screen.getByTestId('chapter-row-c1-confirm-delete'));

    await waitFor(() => {
      expect(screen.getByTestId('chapter-row-c1')).toBeInTheDocument();
    });
    expect(screen.getByText(/Delete failed/)).toBeInTheDocument();
  });
});
