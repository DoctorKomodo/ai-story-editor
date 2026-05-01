import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetApiClientForTests, setAccessToken, setUnauthorizedHandler } from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';
import { AppRouter } from '@/router';
import { useActiveChapterStore } from '@/store/activeChapter';
import { useSessionStore } from '@/store/session';
import { useSidebarTabStore } from '@/store/sidebarTab';

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

function mockImpl(
  storyHandler: (url: string) => Promise<Response>,
): (url: string) => Promise<Response> {
  return (url: string) => {
    if (url.endsWith('/auth/refresh')) {
      return Promise.resolve(jsonResponse(200, { accessToken: 'tok-refresh' }));
    }
    if (url.endsWith('/auth/me')) {
      return Promise.resolve(jsonResponse(200, { user: { id: 'u1', username: 'alice' } }));
    }
    if (url.endsWith('/stories/abc123')) {
      return storyHandler(url);
    }
    if (url.endsWith('/stories/abc123/chapters')) {
      return Promise.resolve(jsonResponse(200, { chapters: [] }));
    }
    if (url.endsWith('/stories/abc123/characters')) {
      return Promise.resolve(jsonResponse(200, { characters: [] }));
    }
    if (url.endsWith('/stories/abc123/outline')) {
      return Promise.resolve(jsonResponse(200, { items: [] }));
    }
    if (url.endsWith('/ai/balance')) {
      return Promise.resolve(jsonResponse(200, { balance: { dollars: 1.23, vcu: 100 } }));
    }
    if (url.endsWith('/ai/models')) {
      return Promise.resolve(jsonResponse(200, { models: [] }));
    }
    if (url.endsWith('/users/me/settings')) {
      return Promise.resolve(
        jsonResponse(200, {
          settings: {
            theme: 'paper',
            prose: { font: 'serif', size: 18, lineHeight: 1.7 },
            writing: {
              spellcheck: true,
              typewriterMode: false,
              focusMode: false,
              dailyWordGoal: 500,
            },
            chat: { model: null, temperature: 0.7, topP: 1, maxTokens: 1024 },
            ai: { includeVeniceSystemPrompt: true },
          },
        }),
      );
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  };
}

describe('EditorPage (F51 — AppShell shell)', () => {
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
    // Stores are module-level singletons; reset between tests.
    useActiveChapterStore.setState({ activeChapterId: null });
    useSidebarTabStore.setState({ sidebarTab: 'chapters' });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    act(() => {
      useSessionStore.setState({ user: null, status: 'idle' });
      useActiveChapterStore.setState({ activeChapterId: null });
      useSidebarTabStore.setState({ sidebarTab: 'chapters' });
    });
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
    expect(screen.queryByTestId('app-shell')).toBeNull();

    resolveStory?.(jsonResponse(200, { story: makeStory() }));
  });

  it('mounts the AppShell with topbar / sidebar / editor / chat slots once the story loads', async () => {
    fetchMock.mockImplementation(
      mockImpl(() => Promise.resolve(jsonResponse(200, { story: makeStory() }))),
    );

    renderEditor();

    await waitFor(() => {
      expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    });

    expect(screen.getByTestId('app-shell-topbar')).toBeInTheDocument();
    expect(screen.getByTestId('app-shell-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('app-shell-editor')).toBeInTheDocument();
    expect(screen.getByTestId('app-shell-chat')).toBeInTheDocument();
  });

  it('renders the story title in the breadcrumb', async () => {
    fetchMock.mockImplementation(
      mockImpl(() =>
        Promise.resolve(jsonResponse(200, { story: makeStory({ title: 'The Long Dark' }) })),
      ),
    );

    renderEditor();

    await waitFor(() => {
      expect(screen.getByTestId('topbar')).toBeInTheDocument();
    });
    // Story title appears both in the topbar breadcrumb and the sidebar story-picker.
    expect(screen.getAllByText('The Long Dark').length).toBeGreaterThan(0);
  });

  it('switches the sidebar tab via the Cast / Outline tab buttons', async () => {
    fetchMock.mockImplementation(
      mockImpl(() => Promise.resolve(jsonResponse(200, { story: makeStory() }))),
    );

    renderEditor();

    await waitFor(() => {
      expect(screen.getByTestId('app-shell-sidebar')).toBeInTheDocument();
    });

    const castTab = screen.getByTestId('sidebar-tab-cast');
    await userEvent.setup().click(castTab);
    expect(useSidebarTabStore.getState().sidebarTab).toBe('cast');

    const outlineTab = screen.getByTestId('sidebar-tab-outline');
    await userEvent.setup().click(outlineTab);
    expect(useSidebarTabStore.getState().sidebarTab).toBe('outline');
  });

  it('sidebar + button on Chapters tab POSTs to /stories/:id/chapters', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (
        url.endsWith('/stories/abc123/chapters') &&
        (init?.method ?? 'GET').toUpperCase() === 'POST'
      ) {
        return Promise.resolve(
          jsonResponse(201, {
            chapter: {
              id: 'new-ch',
              storyId: 'abc123',
              title: '',
              orderIndex: 0,
              wordCount: 0,
              createdAt: '2026-04-27T00:00:00.000Z',
              updatedAt: '2026-04-27T00:00:00.000Z',
            },
          }),
        );
      }
      return mockImpl(() => Promise.resolve(jsonResponse(200, { story: makeStory() })))(url);
    });

    renderEditor();

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-add-button')).toBeInTheDocument();
    });

    await userEvent.setup().click(screen.getByTestId('sidebar-add-button'));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) =>
          typeof url === 'string' &&
          url.endsWith('/stories/abc123/chapters') &&
          (init as RequestInit | undefined)?.method?.toUpperCase() === 'POST',
      );
      expect(call).toBeDefined();
    });
  });

  it('sidebar + button on Cast tab POSTs to /stories/:id/characters', async () => {
    useSidebarTabStore.setState({ sidebarTab: 'cast' });
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (
        url.endsWith('/stories/abc123/characters') &&
        (init?.method ?? 'GET').toUpperCase() === 'POST'
      ) {
        return Promise.resolve(
          jsonResponse(201, {
            character: {
              id: 'new-char',
              storyId: 'abc123',
              name: 'Untitled',
              role: null,
              age: null,
              appearance: null,
              voice: null,
              arc: null,
              personality: null,
              createdAt: '2026-04-27T00:00:00.000Z',
              updatedAt: '2026-04-27T00:00:00.000Z',
            },
          }),
        );
      }
      if (url.endsWith('/stories/abc123/characters/new-char')) {
        return Promise.resolve(
          jsonResponse(200, {
            character: {
              id: 'new-char',
              storyId: 'abc123',
              name: 'Untitled',
              role: null,
              age: null,
              appearance: null,
              voice: null,
              arc: null,
              personality: null,
              createdAt: '2026-04-27T00:00:00.000Z',
              updatedAt: '2026-04-27T00:00:00.000Z',
            },
          }),
        );
      }
      return mockImpl(() => Promise.resolve(jsonResponse(200, { story: makeStory() })))(url);
    });

    renderEditor();

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-add-button')).toBeInTheDocument();
    });

    await userEvent.setup().click(screen.getByTestId('sidebar-add-button'));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) =>
          typeof url === 'string' &&
          url.endsWith('/stories/abc123/characters') &&
          (init as RequestInit | undefined)?.method?.toUpperCase() === 'POST',
      );
      expect(call).toBeDefined();
    });
  });

  it('renders a neutral error state when the story fetch 403s', async () => {
    fetchMock.mockImplementation(
      mockImpl(() =>
        Promise.resolve(jsonResponse(403, { error: { message: 'Forbidden', code: 'FORBIDDEN' } })),
      ),
    );

    renderEditor();

    const alert = await screen.findByRole('alert', {}, { timeout: 3000 });
    expect(alert.textContent ?? '').toMatch(/(could not load story|story not found)/i);
    expect(alert.textContent ?? '').not.toMatch(/forbidden/i);

    // Shell is NOT mounted when the story can't load.
    expect(screen.queryByTestId('app-shell')).toBeNull();
  });
});
