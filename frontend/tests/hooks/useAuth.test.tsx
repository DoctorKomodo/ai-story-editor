import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initAuth, useAuth } from '@/hooks/useAuth';
import { resetApiClientForTests, setUnauthorizedHandler } from '@/lib/api';
import { useSessionStore } from '@/store/session';

type FetchMock = ReturnType<typeof vi.fn>;

function makeWrapper(client: QueryClient): (props: { children: ReactNode }) => JSX.Element {
  return function Wrapper({ children }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

describe('useAuth', () => {
  let fetchMock: FetchMock;
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    resetApiClientForTests();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    // Re-install the unauthorized handler that session.ts wires up at module
    // load — `resetApiClientForTests` clears it so each test starts clean.
    setUnauthorizedHandler(() => {
      useSessionStore.getState().clearSession();
    });
    useSessionStore.setState({ user: null, status: 'idle' });
  });

  afterEach(() => {
    queryClient.clear();
    queryClient.unmount();
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    // Wrap the store reset in act(): Vitest runs afterEach hooks in reverse
    // registration order, so the test-file hook fires BEFORE setup.ts's
    // cleanup() unmounts the TestComponent — setting state here would
    // otherwise notify still-mounted subscribers outside act.
    act(() => {
      useSessionStore.setState({ user: null, status: 'idle' });
    });
  });

  it('login() calls POST /api/auth/login and populates the session', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        user: { id: 'u1', username: 'alice', name: 'Alice' },
      }),
    );

    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper(queryClient) });
    await act(async () => {
      await result.current.login({ username: 'alice', password: 'hunter2hunter2' });
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/login');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ username: 'alice', password: 'hunter2hunter2' }));

    await waitFor(() => {
      expect(result.current.user).toEqual({ id: 'u1', username: 'alice', name: 'Alice' });
      expect(result.current.status).toBe('authenticated');
    });
  });

  it('register() calls POST /api/auth/register and returns { user, recoveryCode } WITHOUT populating the session', async () => {
    // The backend does not issue a session cookie on register; the page is
    // responsible for the post-ack login. See [F59].
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, {
        user: { id: 'u2', username: 'bob', name: 'Display Name' },
        recoveryCode: 'horse-battery-staple-correct',
      }),
    );

    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper(queryClient) });
    let registerResult: {
      user: { id: string; username: string; name: string };
      recoveryCode: string;
    } | null = null;
    await act(async () => {
      registerResult = await result.current.register({
        name: 'Display Name',
        username: 'bob',
        password: 'hunter2hunter2',
      });
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/register');
    // The body must forward the user-supplied display name distinctly from the
    // username — register no longer defaults `name = username`.
    expect(init.body).toBe(
      JSON.stringify({ name: 'Display Name', username: 'bob', password: 'hunter2hunter2' }),
    );

    expect(registerResult).toEqual({
      user: { id: 'u2', username: 'bob', name: 'Display Name' },
      recoveryCode: 'horse-battery-staple-correct',
    });

    // Crucially: the session is NOT populated by register(). The recovery-code
    // interstitial gates the post-ack login.
    expect(result.current.user).toBeNull();
  });

  it('logout() calls POST /api/auth/logout and clears the session', async () => {
    // Start authenticated.
    useSessionStore.getState().setSession({ id: 'u1', username: 'alice', name: 'Alice' });

    fetchMock.mockResolvedValueOnce(emptyResponse(204));

    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper(queryClient) });
    await act(async () => {
      await result.current.logout();
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/logout');
    expect(init.method).toBe('POST');

    await waitFor(() => {
      expect(result.current.user).toBeNull();
      expect(result.current.status).toBe('unauthenticated');
    });
  });

  it('logout() clears the session even if the network call fails', async () => {
    useSessionStore.getState().setSession({ id: 'u1', username: 'alice', name: 'Alice' });
    fetchMock.mockRejectedValueOnce(new TypeError('network down'));

    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper(queryClient) });
    await act(async () => {
      await result.current.logout().catch(() => undefined);
    });

    await waitFor(() => {
      expect(result.current.user).toBeNull();
    });
  });

  it('initAuth() calls GET /api/auth/me on app load', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { user: { id: 'u1', username: 'alice', name: 'Alice' } }),
    );

    await act(async () => {
      await initAuth();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/me');
    expect(init.method).toBeUndefined(); // GET (default)

    await waitFor(() => {
      expect(useSessionStore.getState().status).toBe('authenticated');
    });
    expect(useSessionStore.getState().user).toEqual({
      id: 'u1',
      username: 'alice',
      name: 'Alice',
    });
  });

  it('initAuth() sets status=unauthenticated when /auth/me returns 401', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: { message: 'no session' } }));

    await act(async () => {
      await initAuth();
    });

    // Exactly one fetch call — the /auth/me probe. No refresh dance.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/me');

    expect(useSessionStore.getState().status).toBe('unauthenticated');
    expect(useSessionStore.getState().user).toBeNull();
  });

  it('initAuth() does not mutate the store after the abort signal fires', async () => {
    // Slow /auth/me — gives us a window to abort before setSession runs.
    let resolveMe!: (value: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveMe = resolve;
        }),
    );

    const controller = new AbortController();
    const initPromise = initAuth(controller.signal);
    // Abort BEFORE /auth/me resolves.
    controller.abort();
    resolveMe(jsonResponse(200, { user: { id: 'u1', username: 'alice', name: 'Alice' } }));
    await initPromise;

    // Status was set to 'loading' synchronously before the abort check on the
    // first await — but no further mutations should land. Specifically, user
    // must remain null.
    expect(useSessionStore.getState().user).toBeNull();
    // Only the /auth/me fetch fired.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
