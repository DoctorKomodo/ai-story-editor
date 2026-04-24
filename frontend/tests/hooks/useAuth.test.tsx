import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth, initAuth } from '@/hooks/useAuth';
import { useSessionStore } from '@/store/session';
import { getAccessToken, setAccessToken } from '@/lib/api';

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
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setAccessToken(null);
    // Reset the session store.
    useSessionStore.setState({ user: null, accessToken: null, status: 'idle' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setAccessToken(null);
    useSessionStore.setState({ user: null, accessToken: null, status: 'idle' });
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

    expect(result.current.user).toEqual({ id: 'u1', username: 'alice' });
    expect(result.current.status).toBe('authenticated');
    expect(getAccessToken()).toBe('tok-1');
  });

  it('register() calls POST /api/auth/register and populates the session', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { user: { id: 'u2', username: 'bob' }, accessToken: 'tok-2' }),
    );

    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.register({ username: 'bob', password: 'hunter2hunter2' });
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/register');
    expect(result.current.user).toEqual({ id: 'u2', username: 'bob' });
    expect(getAccessToken()).toBe('tok-2');
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

    expect(result.current.user).toBeNull();
    expect(result.current.status).toBe('unauthenticated');
    expect(getAccessToken()).toBeNull();
  });

  it('logout() clears the session even if the network call fails', async () => {
    useSessionStore.getState().setSession({ id: 'u1', username: 'alice' }, 'tok-1');
    fetchMock.mockRejectedValueOnce(new TypeError('network down'));

    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.logout().catch(() => undefined);
    });

    expect(result.current.user).toBeNull();
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
});
