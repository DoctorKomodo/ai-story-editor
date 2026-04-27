import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initAuth, useAuth } from '@/hooks/useAuth';
import { getAccessToken, resetApiClientForTests, setUnauthorizedHandler } from '@/lib/api';
import { useSessionStore } from '@/store/session';

type FetchMock = ReturnType<typeof vi.fn>;

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

  beforeEach(() => {
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
      jsonResponse(200, { user: { id: 'u1', username: 'alice' }, accessToken: 'tok-1' }),
    );

    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.login({ username: 'alice', password: 'hunter2hunter2' });
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/login');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ username: 'alice', password: 'hunter2hunter2' }));

    await waitFor(() => {
      expect(result.current.user).toEqual({ id: 'u1', username: 'alice' });
      expect(result.current.status).toBe('authenticated');
    });
    expect(getAccessToken()).toBe('tok-1');
  });

  it('register() calls POST /api/auth/register and returns { user, recoveryCode } WITHOUT populating the session', async () => {
    // The backend does not issue an access token or refresh cookie on
    // register; the page is responsible for the post-ack login. See [F59].
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, {
        user: { id: 'u2', username: 'bob' },
        recoveryCode: 'horse-battery-staple-correct',
      }),
    );

    const { result } = renderHook(() => useAuth());
    let registerResult: { user: { id: string; username: string }; recoveryCode: string } | null =
      null;
    await act(async () => {
      registerResult = await result.current.register({
        username: 'bob',
        password: 'hunter2hunter2',
      });
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/register');

    expect(registerResult).toEqual({
      user: { id: 'u2', username: 'bob' },
      recoveryCode: 'horse-battery-staple-correct',
    });

    // Crucially: the session is NOT populated by register(). The recovery-code
    // interstitial gates the post-ack login.
    expect(result.current.user).toBeNull();
    expect(getAccessToken()).toBeNull();
  });

  it('logout() calls POST /api/auth/logout and clears the session', async () => {
    // Start authenticated.
    useSessionStore.getState().setSession({ id: 'u1', username: 'alice' }, 'tok-1');
    expect(getAccessToken()).toBe('tok-1');

    fetchMock.mockResolvedValueOnce(emptyResponse(204));

    const { result } = renderHook(() => useAuth());
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
    expect(getAccessToken()).toBeNull();
  });

  it('logout() clears the session even if the network call fails', async () => {
    useSessionStore.getState().setSession({ id: 'u1', username: 'alice' }, 'tok-1');
    fetchMock.mockRejectedValueOnce(new TypeError('network down'));

    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.logout().catch(() => undefined);
    });

    await waitFor(() => {
      expect(result.current.user).toBeNull();
    });
    expect(getAccessToken()).toBeNull();
  });

  it('initAuth() attempts POST /api/auth/refresh on app load', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: 'refreshed-tok' }))
      .mockResolvedValueOnce(jsonResponse(200, { user: { id: 'u1', username: 'alice' } }));

    await act(async () => {
      await initAuth();
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    const [refreshUrl, refreshInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(refreshUrl).toBe('/api/auth/refresh');
    expect(refreshInit.method).toBe('POST');

    // /auth/me must carry the freshly-refreshed bearer — the api client
    // attaches it automatically because setAccessToken ran before /auth/me.
    const [meUrl, meInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(meUrl).toBe('/api/auth/me');
    const meHeaders = new Headers(meInit.headers);
    expect(meHeaders.get('Authorization')).toBe('Bearer refreshed-tok');

    await waitFor(() => {
      expect(useSessionStore.getState().status).toBe('authenticated');
    });
    expect(useSessionStore.getState().user).toEqual({ id: 'u1', username: 'alice' });
    expect(getAccessToken()).toBe('refreshed-tok');
  });

  it('initAuth() sets status=unauthenticated when refresh fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: { message: 'no session' } }));

    await act(async () => {
      await initAuth();
    });

    // Exactly one fetch call — the bare refresh. No redundant retry loop.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [refreshUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(refreshUrl).toBe('/api/auth/refresh');

    expect(useSessionStore.getState().status).toBe('unauthenticated');
    expect(useSessionStore.getState().user).toBeNull();
    expect(getAccessToken()).toBeNull();
  });

  it('initAuth() does not mutate the store after the abort signal fires', async () => {
    // Slow refresh — gives us a window to abort before /auth/me runs.
    let resolveRefresh!: (value: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveRefresh = resolve;
        }),
    );

    const controller = new AbortController();
    const initPromise = initAuth(controller.signal);
    // Abort BEFORE refresh resolves.
    controller.abort();
    resolveRefresh(jsonResponse(200, { accessToken: 'late-tok' }));
    await initPromise;

    // Status was set to 'loading' synchronously before the abort check on the
    // first await — but no further mutations should land. Specifically, user
    // must remain null and the access token must NOT be set.
    expect(useSessionStore.getState().user).toBeNull();
    expect(getAccessToken()).toBeNull();
    // Only the refresh fetch fired — /auth/me must not have been called.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
