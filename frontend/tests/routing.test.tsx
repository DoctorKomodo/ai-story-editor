import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRouter } from '@/router';
import { useSessionStore } from '@/store/session';
import { setAccessToken } from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';

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
    useSessionStore.setState({ user: null, status: 'idle' });
  });

  it('unauthenticated request to / redirects to /login', async () => {
    // initAuth's refresh fails → status becomes 'unauthenticated'.
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 401 }),
    );

    renderAt('/');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    });
  });

  it('authenticated session lands on / (dashboard)', async () => {
    // Pre-seed the store as authenticated so RequireAuth admits us immediately.
    useSessionStore
      .getState()
      .setSession({ id: 'u1', username: 'alice' }, 'tok-1');
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
      expect(
        screen.getByRole('heading', { name: /your stories/i }),
      ).toBeInTheDocument();
    });
  });

  it('authenticated session can load /stories/:id (editor)', async () => {
    useSessionStore
      .getState()
      .setSession({ id: 'u1', username: 'alice' }, 'tok-1');
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accessToken: 'tok-1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ user: { id: 'u1', username: 'alice' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    renderAt('/stories/story-123');

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /editor/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/story-123/)).toBeInTheDocument();
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
  });

  it('/register is reachable without auth', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    renderAt('/register');
    expect(screen.getByRole('heading', { name: /create account/i })).toBeInTheDocument();
  });
});
