import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DraftMeta } from 'story-editor-shared';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { ChapterList } from '@/components/ChapterList';
import { resetApiClientForTests, setUnauthorizedHandler } from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';
import { useSessionStore } from '@/store/session';
import { makeChapterMeta } from '../fixtures/chapter';

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function draftMeta(
  overrides: Partial<DraftMeta> & Pick<DraftMeta, 'id' | 'orderIndex'>,
): DraftMeta {
  return {
    chapterId: 'ch-1',
    label: null,
    wordCount: 500,
    isActive: false,
    hasSummary: false,
    summaryIsStale: false,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T01:00:00.000Z',
    ...overrides,
  };
}

const CH1_DRAFTS: DraftMeta[] = [
  draftMeta({ id: 'd-a', orderIndex: 0, isActive: true }),
  draftMeta({ id: 'd-b', orderIndex: 1 }),
  draftMeta({ id: 'd-c', orderIndex: 2 }),
];

interface Handlers {
  onSelectChapter: Mock<(chapterId: string) => void>;
  onSelectDraft: Mock<(chapterId: string, draftId: string) => void>;
  onRequestNewDraft: Mock<(chapterId: string) => void>;
}

function renderList(activeChapterId: string | null): Handlers {
  const handlers: Handlers = {
    onSelectChapter: vi.fn(),
    onSelectDraft: vi.fn(),
    onRequestNewDraft: vi.fn(),
  };
  render(
    <QueryClientProvider client={createQueryClient()}>
      <ChapterList
        storyId="story-1"
        activeChapterId={activeChapterId}
        onSelectChapter={handlers.onSelectChapter}
        onOpenSummary={vi.fn()}
        openPopoverChapterId={null}
        viewedDraftId={null}
        onSelectDraft={handlers.onSelectDraft}
        onRequestNewDraft={handlers.onRequestNewDraft}
      />
    </QueryClientProvider>,
  );
  return handlers;
}

describe('ChapterList draft tree (9wk.7)', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    resetApiClientForTests();
    setUnauthorizedHandler(() => {
      useSessionStore.getState().clearSession();
    });
    useSessionStore.setState({
      user: { id: 'u1', username: 'alice', name: 'Alice' },
      status: 'authenticated',
    });
    fetchMock = vi.fn();
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/chapters')) {
        return Promise.resolve(
          jsonResponse(200, {
            chapters: [
              makeChapterMeta({ id: 'ch-1', orderIndex: 0, title: 'Many', draftCount: 3 }),
              makeChapterMeta({ id: 'ch-2', orderIndex: 1, title: 'One', draftCount: 1 }),
            ],
          }),
        );
      }
      if (url.endsWith('/chapters/ch-1/drafts')) {
        return Promise.resolve(jsonResponse(200, { drafts: CH1_DRAFTS }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
  });

  it('multi-draft chapter shows a caret; single-draft chapter shows none', async () => {
    renderList(null);
    const rowMany = await screen.findByTestId('chapter-row-ch-1');
    const rowOne = screen.getByTestId('chapter-row-ch-2');
    expect(within(rowMany).getByRole('button', { name: 'Show drafts' })).toBeInTheDocument();
    expect(within(rowOne).queryByRole('button', { name: 'Show drafts' })).toBeNull();
  });

  it('the open chapter auto-expands its drafts (caret reports expanded)', async () => {
    renderList('ch-1');
    expect(await screen.findByTestId('draft-list-ch-1')).toBeInTheDocument();
    expect(await screen.findByText('Draft B')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show drafts' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('a non-open multi-draft chapter starts collapsed and toggles via the caret', async () => {
    renderList('ch-2');
    await screen.findByTestId('chapter-row-ch-1');
    expect(screen.queryByTestId('draft-list-ch-1')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Show drafts' }));
    expect(await screen.findByTestId('draft-list-ch-1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Show drafts' }));
    expect(screen.queryByTestId('draft-list-ch-1')).toBeNull();
  });

  it('the open chapter can be manually collapsed (override beats the default)', async () => {
    renderList('ch-1');
    expect(await screen.findByTestId('draft-list-ch-1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show drafts' }));
    expect(screen.queryByTestId('draft-list-ch-1')).toBeNull();
  });

  it('single-draft chapter shows the ＋ affordance which fires onRequestNewDraft', async () => {
    const { onRequestNewDraft } = renderList(null);
    const rowOne = await screen.findByTestId('chapter-row-ch-2');
    await userEvent.click(within(rowOne).getByRole('button', { name: 'New draft' }));
    expect(onRequestNewDraft).toHaveBeenCalledWith('ch-2');
  });

  it('clicking a draft row propagates onSelectDraft up through ChapterList', async () => {
    const { onSelectDraft } = renderList('ch-1');
    await screen.findByTestId('draft-list-ch-1');
    // The draft list's own fetch resolves a tick after the wrapper <ul> mounts
    // (chapters query -> re-render -> DraftList mount -> its own query) —
    // await the row text rather than assume it's already there.
    await userEvent.click(await screen.findByText('Draft B'));
    expect(onSelectDraft).toHaveBeenCalledWith('ch-1', 'd-b');
  });
});
