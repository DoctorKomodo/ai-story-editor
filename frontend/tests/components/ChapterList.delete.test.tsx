import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChapterList } from '@/components/ChapterList';
import { resetApiClientForTests, setAccessToken, setUnauthorizedHandler } from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';
import { useSessionStore } from '@/store/session';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function chap(o: { id: string; orderIndex: number; title?: string; wordCount?: number }) {
  return {
    id: o.id,
    storyId: 'story-1',
    title: o.title ?? `Chapter ${String(o.orderIndex + 1)}`,
    wordCount: o.wordCount ?? 100,
    orderIndex: o.orderIndex,
    status: 'draft' as const,
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
  };
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
      />
    </QueryClientProvider>,
  );
  return { client: qc };
}

describe('ChapterList — delete', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetApiClientForTests();
    setAccessToken('tok-1');
    setUnauthorizedHandler(() => useSessionStore.getState().clearSession());
    useSessionStore.setState({ user: { id: 'u1', username: 'alice' }, status: 'authenticated' });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
  });

  it('renders × only on the active row', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        chapters: [chap({ id: 'c1', orderIndex: 0 }), chap({ id: 'c2', orderIndex: 1 })],
      }),
    );
    renderList({ activeChapterId: 'c2' });
    await screen.findByTestId('chapter-row-c2');
    expect(screen.getByTestId('chapter-row-c2-delete')).toBeInTheDocument();
    expect(screen.queryByTestId('chapter-row-c1-delete')).toBeNull();
  });

  it('clicking × opens InlineConfirm and replaces the word-count slot', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { chapters: [chap({ id: 'c1', orderIndex: 0, wordCount: 1500 })] }),
    );
    renderList({ activeChapterId: 'c1' });
    await screen.findByTestId('chapter-row-c1');
    expect(within(screen.getByTestId('chapter-row-c1')).getByText('1.5k')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('chapter-row-c1-delete'));
    expect(screen.getByTestId('chapter-row-c1-confirm-delete')).toHaveFocus();
    expect(within(screen.getByTestId('chapter-row-c1')).queryByText('1.5k')).toBeNull();
  });

  it('Escape dismisses the confirm', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { chapters: [chap({ id: 'c1', orderIndex: 0 })] }),
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
          chapters: [chap({ id: 'c1', orderIndex: 0 }), chap({ id: 'c2', orderIndex: 1 })],
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse(200, { chapters: [chap({ id: 'c2', orderIndex: 0 })] }));

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
      .mockResolvedValueOnce(jsonResponse(200, { chapters: [chap({ id: 'c1', orderIndex: 0 })] }))
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
