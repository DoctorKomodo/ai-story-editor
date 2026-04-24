import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetApiClientForTests, setAccessToken, setUnauthorizedHandler } from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';
import { DashboardPage } from '@/pages/DashboardPage';
import { useSessionStore } from '@/store/session';

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderDashboard(): ReturnType<typeof render> {
  const client = createQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// A fixed "now" used by the component under test. Using fake timers lets us
// assert the "Edited Nh ago" string deterministically.
const NOW = new Date('2026-04-24T12:00:00.000Z');

function makeStory(
  overrides: Partial<{
    id: string;
    title: string;
    genre: string | null;
    synopsis: string | null;
    chapterCount: number;
    totalWordCount: number;
    updatedAt: string;
  }> = {},
): Record<string, unknown> {
  return {
    id: 's1',
    title: 'Dune',
    genre: 'Sci-Fi',
    synopsis: 'A boy on a desert planet.',
    worldNotes: null,
    targetWords: null,
    systemPrompt: null,
    chapterCount: 3,
    totalWordCount: 4500,
    createdAt: '2026-04-24T00:00:00.000Z',
    updatedAt: '2026-04-24T10:00:00.000Z', // 2h before NOW
    ...overrides,
  };
}

describe('DashboardPage (F5)', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    resetApiClientForTests();
    setAccessToken('tok-1');
    setUnauthorizedHandler(() => {
      useSessionStore.getState().clearSession();
    });
    useSessionStore.setState({
      user: { id: 'u1', username: 'alice' },
      status: 'authenticated',
    });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    // Stub Date so formatRelative sees a fixed "now" without actually freezing
    // the event loop timers (waitFor/userEvent depend on real setTimeout).
    const OriginalDate = Date;
    class StubDate extends OriginalDate {
      constructor(...args: ConstructorParameters<typeof Date>) {
        if (args.length === 0) {
          super(NOW.getTime());
        } else {
          // @ts-expect-error - spread to original Date ctor
          super(...args);
        }
      }
      static override now(): number {
        return NOW.getTime();
      }
    }
    vi.stubGlobal('Date', StubDate);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
  });

  it('renders loading state with role=status', async () => {
    // Never-resolving promise keeps us in loading.
    fetchMock.mockReturnValueOnce(new Promise<Response>(() => {}));
    renderDashboard();

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('status').textContent ?? '').toMatch(/loading/i);
  });

  it('renders stories with title, genre, synopsis, chapter count, word count, and relative time', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        stories: [
          makeStory({
            id: 's1',
            title: 'Dune',
            genre: 'Sci-Fi',
            synopsis: 'A boy on a desert planet.',
            chapterCount: 3,
            totalWordCount: 4500,
            updatedAt: '2026-04-24T10:00:00.000Z', // 2h ago
          }),
          makeStory({
            id: 's2',
            title: 'Foundation',
            genre: 'Sci-Fi',
            synopsis: 'Psychohistory saves the galaxy.',
            chapterCount: 1,
            totalWordCount: 800,
            updatedAt: '2026-04-23T12:00:00.000Z', // 1d ago
          }),
        ],
      }),
    );

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Dune')).toBeInTheDocument();
    });

    expect(screen.getByText('Foundation')).toBeInTheDocument();

    // First card.
    const duneCard = screen.getByText('Dune').closest('a') as HTMLElement;
    expect(duneCard).not.toBeNull();
    expect(within(duneCard).getByText('Sci-Fi')).toBeInTheDocument();
    expect(within(duneCard).getByText(/a boy on a desert planet/i)).toBeInTheDocument();
    expect(within(duneCard).getByText(/3 chapters/i)).toBeInTheDocument();
    expect(within(duneCard).getByText(/4,500 words/i)).toBeInTheDocument();
    expect(within(duneCard).getByText(/edited 2h ago/i)).toBeInTheDocument();

    // Second card.
    const foundationCard = screen.getByText('Foundation').closest('a') as HTMLElement;
    expect(within(foundationCard).getByText(/1 chapter\b/i)).toBeInTheDocument();
    expect(within(foundationCard).getByText(/edited 1d ago/i)).toBeInTheDocument();
  });

  it('story card links to /stories/:id', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { stories: [makeStory({ id: 'abc', title: 'Dune' })] }),
    );
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Dune')).toBeInTheDocument();
    });

    const card = screen.getByText('Dune').closest('a');
    expect(card).not.toBeNull();
    expect(card).toHaveAttribute('href', '/stories/abc');
  });

  it('empty state renders "No stories yet" with a "Create your first story" CTA', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { stories: [] }));
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/no stories yet/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /create your first story/i })).toBeInTheDocument();
  });

  it('clicking "New Story" opens the StoryModal', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { stories: [] }));
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/no stories yet/i)).toBeInTheDocument();
    });

    expect(screen.queryByRole('dialog')).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^new story$/i }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /new story/i })).toBeInTheDocument();
  });

  it('error state renders error message', async () => {
    // Query client retries once on non-401 errors, so each call must produce a
    // fresh Response (the body is single-read, and retries would otherwise read
    // an already-consumed body and lose the server message).
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse(500, { error: { message: 'Database is down', code: 'DB_DOWN' } }),
      ),
    );
    renderDashboard();

    const alert = await screen.findByRole('alert', {}, { timeout: 3000 });
    expect(alert).toHaveTextContent(/database is down/i);
  });

  it('modal success triggers a refetch of /api/stories', async () => {
    // Initial list.
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { stories: [] }));
    // Create response.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { story: makeStory({ id: 's-new', title: 'A new story' }) }),
    );
    // Refetch after invalidation.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        stories: [
          makeStory({ id: 's-new', title: 'A new story', chapterCount: 0, totalWordCount: 0 }),
        ],
      }),
    );

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/no stories yet/i)).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^new story$/i }));

    await user.type(screen.getByLabelText(/title/i), 'A new story');
    await user.click(screen.getByRole('button', { name: /create story/i }));

    // Wait for the refetch to happen — the new story should appear in the list.
    await waitFor(() => {
      expect(screen.getByText('A new story')).toBeInTheDocument();
    });

    const storiesListCalls = fetchMock.mock.calls.filter(
      ([url, init]: [string, RequestInit | undefined]) =>
        url === '/api/stories' && (!init?.method || init.method === 'GET'),
    );
    expect(storiesListCalls.length).toBeGreaterThanOrEqual(2);
  });
});
