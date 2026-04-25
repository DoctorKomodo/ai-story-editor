import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';
import { AppRouter } from '@/router';
import { useSessionStore } from '@/store/session';

type FetchMock = ReturnType<typeof vi.fn>;

function renderAt(path: string) {
  // Fresh QueryClient per render so tests never share cache via the module
  // singleton in `@/lib/queryClient`.
  const client = createQueryClient();
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRouter queryClient={client} />
    </MemoryRouter>,
  );
}

describe('routing', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setAccessToken(null);
    useSessionStore.setState({ user: null, status: 'idle' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setAccessToken(null);
    // Wrap in act(): vitest runs afterEach hooks in reverse registration order,
    // so this fires before setup.ts's cleanup() unmounts; otherwise the state
    // change notifies still-mounted subscribers outside act.
    act(() => {
      useSessionStore.setState({ user: null, status: 'idle' });
    });
  });

  it('unauthenticated request to / redirects to /login', async () => {
    // initAuth's refresh fails → status becomes 'unauthenticated'.
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));

    renderAt('/');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    });
  });

  it('authenticated session lands on / (dashboard)', async () => {
    // Pre-seed the store as authenticated so RequireAuth admits us immediately.
    useSessionStore.getState().setSession({ id: 'u1', username: 'alice' }, 'tok-1');
    // initAuth will still try to refresh — return a successful refresh + /me
    // so state stays authenticated after bootstrap. The dashboard also fires
    // a GET /api/stories on mount, so mock every call via mockImplementation
    // rather than a brittle ordered queue.
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/auth/refresh')) {
        return Promise.resolve(
          new Response(JSON.stringify({ accessToken: 'tok-1' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (url.endsWith('/auth/me')) {
        return Promise.resolve(
          new Response(JSON.stringify({ user: { id: 'u1', username: 'alice' } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (url.endsWith('/stories')) {
        return Promise.resolve(
          new Response(JSON.stringify({ stories: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    renderAt('/');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /your stories/i })).toBeInTheDocument();
    });
  });

  it('authenticated session can load /stories/:id (editor)', async () => {
    useSessionStore.getState().setSession({ id: 'u1', username: 'alice' }, 'tok-1');
    // Router-based fetch mock: initAuth's refresh + /me keep the session
    // authenticated; EditorPage then fetches the story to render its title.
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/auth/refresh')) {
        return Promise.resolve(
          new Response(JSON.stringify({ accessToken: 'tok-1' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (url.endsWith('/auth/me')) {
        return Promise.resolve(
          new Response(JSON.stringify({ user: { id: 'u1', username: 'alice' } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (url.endsWith('/stories/story-123')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              story: {
                id: 'story-123',
                title: 'Dune',
                genre: null,
                synopsis: null,
                worldNotes: null,
                targetWords: null,
                systemPrompt: null,
                createdAt: '2026-04-01T00:00:00.000Z',
                updatedAt: '2026-04-24T10:00:00.000Z',
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    renderAt('/stories/story-123');

    // F7 replaces the stub "Editor" heading with the story's title.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /dune/i })).toBeInTheDocument();
    });
    // Three-pane shell is mounted.
    expect(screen.getByRole('main', { name: /editor/i })).toBeInTheDocument();
  });

  it('unauthenticated request to /stories/:id redirects to /login', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));

    renderAt('/stories/anything');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    });
  });

  it('/login is reachable without auth', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    renderAt('/login');
    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    // Wait for initAuth's async refresh to settle so the post-render
    // clearSession() lands inside act (not as a trailing warning).
    await waitFor(() => {
      expect(useSessionStore.getState().status).toBe('unauthenticated');
    });
  });

  it('/register is reachable without auth', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    renderAt('/register');
    expect(screen.getByRole('heading', { name: /create account/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(useSessionStore.getState().status).toBe('unauthenticated');
    });
  });
});
