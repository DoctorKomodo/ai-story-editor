import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRouter } from '@/router';
import { createQueryClient } from '@/lib/queryClient';
import { resetApiClientForTests, setAccessToken, setUnauthorizedHandler } from '@/lib/api';
import { useSessionStore } from '@/store/session';

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeStory(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'abc123',
    title: 'The Long Dark',
    genre: 'Sci-Fi',
    synopsis: 'A ship adrift.',
    worldNotes: null,
    targetWords: 80_000,
    systemPrompt: null,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-24T10:00:00.000Z',
    ...overrides,
  };
}

function renderEditor(): ReturnType<typeof render> {
  const client = createQueryClient();
  return render(
    <MemoryRouter initialEntries={['/stories/abc123']}>
      <AppRouter queryClient={client} />
    </MemoryRouter>,
  );
}

/**
 * Build a fetch router shared across tests.
 *
 * `useInitAuth()` fires on mount and hits POST /auth/refresh + GET /auth/me
 * regardless of the pre-populated session — during that bootstrap it flips
 * status to 'loading', which would send RequireAuth into its own loading
 * state and drop our page. We therefore mock the bootstrap as a valid
 * round-trip so the session stays authenticated. The caller supplies the
 * `/stories/abc123` response. Any other URL errors loudly.
 */
function mockImpl(
  storyHandler: (url: string) => Promise<Response>,
): (url: string) => Promise<Response> {
  return (url: string) => {
    if (url.endsWith('/auth/refresh')) {
      return Promise.resolve(jsonResponse(200, { accessToken: 'tok-refresh' }));
    }
    if (url.endsWith('/auth/me')) {
      return Promise.resolve(
        jsonResponse(200, { user: { id: 'u1', username: 'alice' } }),
      );
    }
    if (url.endsWith('/stories/abc123')) {
      return storyHandler(url);
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  };
}

describe('EditorPage (F7)', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    resetApiClientForTests();
    setAccessToken('tok-1');
    // resetApiClientForTests cleared the unauthorized handler session.ts
    // wired at module load; re-install it.
    setUnauthorizedHandler(() => {
      useSessionStore.getState().clearSession();
    });
    useSessionStore.setState({
      user: { id: 'u1', username: 'alice' },
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

  it('renders loading state with role=status before the story resolves', async () => {
    let resolveStory: ((res: Response) => void) | null = null;
    const pending = new Promise<Response>((resolve) => {
      resolveStory = resolve;
    });
    fetchMock.mockImplementation(mockImpl(() => pending));

    renderEditor();

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
    expect(screen.getByRole('status').textContent ?? '').toMatch(/loading story/i);

    // Shell isn't mounted while loading.
    expect(screen.queryByRole('main', { name: /editor/i })).toBeNull();
    expect(screen.queryByRole('complementary', { name: /ai assistant/i })).toBeNull();

    // Resolve the pending promise so React Query cleans up between tests.
    resolveStory?.(jsonResponse(200, { story: makeStory() }));
  });

  it('renders the story title and three landmark regions (banner + main + 2 asides)', async () => {
    fetchMock.mockImplementation(
      mockImpl(() =>
        Promise.resolve(jsonResponse(200, { story: makeStory({ title: 'The Long Dark' }) })),
      ),
    );

    renderEditor();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /the long dark/i })).toBeInTheDocument();
    });

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main', { name: /editor/i })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: /chapters/i })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: /ai assistant/i })).toBeInTheDocument();
  });

  it('back-to-dashboard link points to "/"', async () => {
    fetchMock.mockImplementation(
      mockImpl(() => Promise.resolve(jsonResponse(200, { story: makeStory() }))),
    );

    renderEditor();

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /back to dashboard/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: /back to dashboard/i })).toHaveAttribute('href', '/');
  });

  it('toggle button hides and re-shows the AI panel and flips aria-expanded', async () => {
    fetchMock.mockImplementation(
      mockImpl(() => Promise.resolve(jsonResponse(200, { story: makeStory() }))),
    );

    renderEditor();

    await waitFor(() => {
      expect(screen.getByRole('complementary', { name: /ai assistant/i })).toBeInTheDocument();
    });

    const toggle = screen.getByRole('button', { name: /hide ai/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const user = userEvent.setup();
    await user.click(toggle);

    // Collapsed: AI panel is unmounted; the toggle flips label + aria-expanded.
    expect(screen.queryByRole('complementary', { name: /ai assistant/i })).toBeNull();
    const showBtn = screen.getByRole('button', { name: /show ai/i });
    expect(showBtn).toHaveAttribute('aria-expanded', 'false');

    // Left sidebar and editor remain regardless.
    expect(screen.getByRole('complementary', { name: /chapters/i })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: /editor/i })).toBeInTheDocument();

    await user.click(showBtn);
    expect(screen.getByRole('complementary', { name: /ai assistant/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /hide ai/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('renders a neutral error state when the story fetch 403s', async () => {
    // Query client retries once on non-401 errors — each call must return a
    // fresh Response since bodies are single-read.
    fetchMock.mockImplementation(
      mockImpl(() =>
        Promise.resolve(jsonResponse(403, { error: { message: 'Forbidden', code: 'FORBIDDEN' } })),
      ),
    );

    renderEditor();

    const alert = await screen.findByRole('alert', {}, { timeout: 3000 });
    expect(alert.textContent ?? '').toMatch(/could not load story/i);
    // Neutral copy — don't leak "Forbidden" straight to the user.
    expect(alert.textContent ?? '').not.toMatch(/forbidden/i);

    // Dashboard link present as a fallback.
    expect(screen.getByRole('link', { name: /back to dashboard/i })).toHaveAttribute('href', '/');
    // Shell is NOT mounted when the story can't load.
    expect(screen.queryByRole('main', { name: /editor/i })).toBeNull();
  });
});
