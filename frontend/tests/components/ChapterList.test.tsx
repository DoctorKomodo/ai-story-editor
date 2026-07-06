import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

function renderList(
  onSelect: (id: string) => void,
  activeChapterId: string | null = null,
  client?: QueryClient,
  onOpenSummary?: (chapterId: string, anchorEl: HTMLElement) => void,
  openPopoverChapterId?: string | null,
): { client: QueryClient } {
  const qc = client ?? createQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <ChapterList
        storyId="story-1"
        activeChapterId={activeChapterId}
        onSelectChapter={onSelect}
        onOpenSummary={onOpenSummary ?? vi.fn()}
        openPopoverChapterId={openPopoverChapterId}
        viewedDraftId={null}
        onSelectDraft={vi.fn()}
        onRequestNewDraft={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return { client: qc };
}

describe('ChapterList (F10)', () => {
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
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
  });

  it('renders chapter titles and word counts after fetching', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/chapters')) {
        return Promise.resolve(
          jsonResponse(200, {
            chapters: [
              makeChapterMeta({ id: 'c1', orderIndex: 0, title: 'The Beginning', wordCount: 1234 }),
              makeChapterMeta({ id: 'c2', orderIndex: 1, title: 'The Middle', wordCount: 2 }),
            ],
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    const onSelect = vi.fn();
    renderList(onSelect);

    expect(await screen.findByText('The Beginning')).toBeInTheDocument();
    expect(screen.getByText('The Middle')).toBeInTheDocument();
    // New compact format: 1234 → '1.2k', 2 → '2'
    expect(screen.getByText('1.2k')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('clicking a row fires onSelectChapter with the chapter id', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/chapters')) {
        return Promise.resolve(
          jsonResponse(200, {
            chapters: [
              makeChapterMeta({ id: 'c1', orderIndex: 0, title: 'One' }),
              makeChapterMeta({ id: 'c2', orderIndex: 1, title: 'Two' }),
            ],
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    const onSelect = vi.fn();
    renderList(onSelect);

    const row = await screen.findByRole('button', { name: /Two/ });
    await userEvent.setup().click(row);
    expect(onSelect).toHaveBeenCalledWith('c2');
  });

  it('applies aria-current="true" to the active row', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/chapters')) {
        return Promise.resolve(
          jsonResponse(200, {
            chapters: [
              makeChapterMeta({ id: 'c1', orderIndex: 0, title: 'One' }),
              makeChapterMeta({ id: 'c2', orderIndex: 1, title: 'Two' }),
            ],
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderList(vi.fn(), 'c2');

    await screen.findByText('Two');
    const items = screen.getAllByRole('listitem');
    const active = items.find((el) => el.getAttribute('aria-current') === 'true');
    expect(active).toBeDefined();
    expect(within(active as HTMLElement).getByText('Two')).toBeInTheDocument();
  });

  it('renders empty state when the chapter list is empty', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/chapters')) {
        return Promise.resolve(jsonResponse(200, { chapters: [] }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderList(vi.fn());

    expect(await screen.findByText(/no chapters yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add chapter/i })).toBeInTheDocument();
  });

  it('loading state has role="status"', async () => {
    let resolveFetch!: (res: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/chapters')) {
        return pending;
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderList(vi.fn());

    const status = await screen.findByRole('status');
    expect(status.textContent ?? '').toMatch(/loading chapters/i);

    resolveFetch(jsonResponse(200, { chapters: [] }));
  });

  it('drag handle has aria-label="Reorder"', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/chapters')) {
        return Promise.resolve(
          jsonResponse(200, {
            chapters: [makeChapterMeta({ id: 'c1', orderIndex: 0, title: 'One' })],
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderList(vi.fn());

    const handle = await screen.findByRole('button', { name: 'Reorder' });
    expect(handle).toBeInTheDocument();
  });

  it('error state shows role="alert"', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/chapters')) {
        return Promise.resolve(
          jsonResponse(500, { error: { message: 'Server boom', code: 'internal' } }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderList(vi.fn());

    const alert = await screen.findByRole('alert', {}, { timeout: 3000 });
    expect(alert.textContent ?? '').toMatch(/could not load chapters/i);
  });

  it('renders zero-padded row numbers from orderIndex+1', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        chapters: [
          makeChapterMeta({ id: 'c1', orderIndex: 0, title: 'A' }),
          makeChapterMeta({ id: 'c2', orderIndex: 1, title: 'B' }),
        ],
      }),
    );
    renderList(() => {});
    await screen.findByTestId('chapter-row-c1');
    expect(within(screen.getByTestId('chapter-row-c1')).getByText('01')).toBeInTheDocument();
    expect(within(screen.getByTestId('chapter-row-c2')).getByText('02')).toBeInTheDocument();
  });

  it('renders compact word counts and em-dash for zero', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        chapters: [
          makeChapterMeta({ id: 'c1', orderIndex: 0, wordCount: 2100, title: 'A' }),
          makeChapterMeta({ id: 'c2', orderIndex: 1, wordCount: 0, title: 'B' }),
        ],
      }),
    );
    renderList(() => {});
    await screen.findByTestId('chapter-row-c1');
    expect(within(screen.getByTestId('chapter-row-c1')).getByText('2.1k')).toBeInTheDocument();
    expect(within(screen.getByTestId('chapter-row-c2')).getByText('—')).toBeInTheDocument();
  });

  it('section header renders MANUSCRIPT label and an Add Chapter + button that POSTs', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { chapters: [] }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          chapter: {
            ...makeChapterMeta({ id: 'new', orderIndex: 0, title: 'Untitled chapter' }),
            bodyJson: null,
            summary: null,
            summaryUpdatedAt: null,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          chapters: [makeChapterMeta({ id: 'new', orderIndex: 0, title: 'Untitled chapter' })],
        }),
      );

    const onSelect = vi.fn();
    renderList(onSelect);
    await screen.findByTestId('chapter-list-section-label');
    expect(screen.getByTestId('chapter-list-section-label')).toHaveTextContent('MANUSCRIPT');
    await userEvent.click(screen.getByTestId('chapter-list-add'));
    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith('new');
    });
  });

  it('renders with design-system token classes (no raw Tailwind colors)', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/chapters')) {
        return Promise.resolve(
          jsonResponse(200, { chapters: [makeChapterMeta({ id: 'ch-1', orderIndex: 0 })] }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderList(vi.fn(), 'ch-1');

    const list = await screen.findByTestId('chapter-list');
    expect(list.className).not.toMatch(/\b(neutral|red|blue|gray|slate)-\d/);

    const addButton = screen.getByTestId('chapter-list-add');
    expect(addButton.className).not.toMatch(/\b(neutral|red|blue|gray|slate)-\d/);

    const row = screen.getByTestId('chapter-row-ch-1');
    expect(row.className).not.toMatch(/\b(neutral|red|blue|gray|slate)-\d/);
    // New layout uses data-active attribute + bg token instead of border-ink
    expect(row).toHaveAttribute('data-active', 'true');
  });

  it('renders SummaryStateIcon on every row, with state derived from list-meta flags', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/chapters')) {
        return Promise.resolve(
          jsonResponse(200, {
            chapters: [
              makeChapterMeta({
                id: 'c1',
                orderIndex: 0,
                hasSummary: false,
                summaryIsStale: false,
              }),
              makeChapterMeta({ id: 'c2', orderIndex: 1, hasSummary: true, summaryIsStale: false }),
              makeChapterMeta({ id: 'c3', orderIndex: 2, hasSummary: true, summaryIsStale: true }),
            ],
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderList(vi.fn());

    await screen.findByTestId('chapter-row-c1');
    expect(
      within(screen.getByTestId('chapter-row-c1')).getByRole('button', {
        name: 'No summary yet — click to generate',
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('chapter-row-c2')).getByRole('button', {
        name: 'Summary present — click to view',
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('chapter-row-c3')).getByRole('button', {
        name: 'Summary possibly stale — click to view',
      }),
    ).toBeInTheDocument();
  });

  it('clicking the icon fires onOpenSummary(chapterId, anchorEl) and does NOT bubble to onSelectChapter', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/chapters')) {
        return Promise.resolve(
          jsonResponse(200, {
            chapters: [
              makeChapterMeta({
                id: 'c1',
                orderIndex: 0,
                hasSummary: false,
                summaryIsStale: false,
              }),
            ],
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    const onSelect = vi.fn();
    const onOpenSummary = vi.fn();
    renderList(onSelect, null, undefined, onOpenSummary);

    await screen.findByTestId('chapter-row-c1');
    const icon = within(screen.getByTestId('chapter-row-c1')).getByRole('button', {
      name: 'No summary yet — click to generate',
    });
    await userEvent.setup().click(icon);

    expect(onOpenSummary).toHaveBeenCalledOnce();
    const [calledId, calledEl] = onOpenSummary.mock.calls[0] as [string, HTMLElement];
    expect(calledId).toBe('c1');
    expect(calledEl).toBeInstanceOf(HTMLElement);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('hides SummaryStateIcon while InlineConfirm is open on a row', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/chapters')) {
        return Promise.resolve(
          jsonResponse(200, {
            chapters: [
              makeChapterMeta({
                id: 'c1',
                orderIndex: 0,
                hasSummary: false,
                summaryIsStale: false,
              }),
            ],
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderList(vi.fn(), 'c1');

    await screen.findByTestId('chapter-row-c1');
    expect(
      within(screen.getByTestId('chapter-row-c1')).getByRole('button', {
        name: 'No summary yet — click to generate',
      }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('chapter-row-c1-delete'));

    expect(
      within(screen.getByTestId('chapter-row-c1')).queryByRole('button', {
        name: 'No summary yet — click to generate',
      }),
    ).toBeNull();
  });

  it('openPopoverChapterId sets aria-pressed="true" on the matching row only', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/stories/story-1/chapters')) {
        return Promise.resolve(
          jsonResponse(200, {
            chapters: [
              makeChapterMeta({
                id: 'c1',
                orderIndex: 0,
                hasSummary: false,
                summaryIsStale: false,
              }),
              makeChapterMeta({
                id: 'c2',
                orderIndex: 1,
                hasSummary: false,
                summaryIsStale: false,
              }),
            ],
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderList(vi.fn(), null, undefined, undefined, 'c1');

    await screen.findByTestId('chapter-row-c1');
    const c1Icon = within(screen.getByTestId('chapter-row-c1')).getByRole('button', {
      name: 'No summary yet — click to generate',
    });
    const c2Icon = within(screen.getByTestId('chapter-row-c2')).getByRole('button', {
      name: 'No summary yet — click to generate',
    });
    expect(c1Icon).toHaveAttribute('aria-pressed', 'true');
    expect(c2Icon).toHaveAttribute('aria-pressed', 'false');
  });
});
