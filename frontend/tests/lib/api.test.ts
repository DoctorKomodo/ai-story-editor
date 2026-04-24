import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  api,
  apiStream,
  ApiError,
  setAccessToken,
  getAccessToken,
  resetApiClientForTests,
} from '@/lib/api';

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

describe('api client', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    resetApiClientForTests();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setAccessToken(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientForTests();
    vi.restoreAllMocks();
  });

  it('attaches Bearer token when access token is set', async () => {
    setAccessToken('tok-abc');
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const result = await api<{ ok: boolean }>('/stories');

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer tok-abc');
    expect(init.credentials).toBe('include');
  });

  it('does not attach Authorization when no token is set', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    await api('/public');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.has('Authorization')).toBe(false);
  });

  it('serializes plain-object bodies as JSON with Content-Type', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    await api('/things', { method: 'POST', body: { name: 'x' } });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({ name: 'x' }));
    const headers = new Headers(init.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('resolves undefined for 204 responses', async () => {
    fetchMock.mockResolvedValueOnce(emptyResponse(204));
    const result = await api<void>('/logout', { method: 'POST' });
    expect(result).toBeUndefined();
  });

  it('throws ApiError parsed from { error: { message, code } }', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, { error: { message: 'bad stuff', code: 'validation_error' } }),
    );
    await expect(api('/bad')).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      code: 'validation_error',
      message: 'bad stuff',
    });
  });

  it('throws ApiError on non-2xx without error body', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }));
    const err = await api('/boom').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
  });

  it('on 401: refreshes and retries once, updating the stored token', async () => {
    setAccessToken('old-tok');
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: { message: 'expired' } })) // original
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: 'new-tok' })) // refresh
      .mockResolvedValueOnce(jsonResponse(200, { ok: true })); // retry

    const result = await api<{ ok: boolean }>('/me');
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Middle call hit /auth/refresh with no Authorization
    const [refreshUrl, refreshInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(refreshUrl).toContain('/auth/refresh');
    expect(refreshInit.method).toBe('POST');

    // Retry used the new token
    const [, retryInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    const retryHeaders = new Headers(retryInit.headers);
    expect(retryHeaders.get('Authorization')).toBe('Bearer new-tok');

    expect(getAccessToken()).toBe('new-tok');
  });

  it('on 401 when refresh also 401s: clears token and throws ApiError(401)', async () => {
    setAccessToken('old-tok');
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: { message: 'expired' } })) // original
      .mockResolvedValueOnce(jsonResponse(401, { error: { message: 'no session' } })); // refresh

    const err = await api('/me').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect(getAccessToken()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not infinite-loop: refresh call itself never triggers another refresh', async () => {
    setAccessToken('old-tok');
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, {})) // original
      .mockResolvedValueOnce(jsonResponse(401, {})); // refresh

    await expect(api('/anything')).rejects.toBeInstanceOf(ApiError);
    // Exactly 2 fetch calls — not 3+.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('prefixes paths with the default /api base', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    await api('/auth/login', { method: 'POST', body: { username: 'u', password: 'p' } });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/login');
  });

  it('dedupes concurrent refresh calls when two requests 401 simultaneously', async () => {
    setAccessToken('old-tok');

    // Slow refresh response so both 401 retries land while it's in flight.
    let resolveRefresh!: (value: Response) => void;
    const refreshPromise = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });

    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/auth/refresh')) {
        return refreshPromise;
      }
      // Return responses in order of original/retry calls.
      const callsSoFar = fetchMock.mock.calls.length;
      // First two non-refresh calls: 401 originals.
      if (callsSoFar <= 2) {
        return Promise.resolve(jsonResponse(401, { error: { message: 'expired' } }));
      }
      // After refresh resolves, retries get 200.
      return Promise.resolve(jsonResponse(200, { ok: true, n: callsSoFar }));
    });

    const p1 = api<{ ok: boolean }>('/a');
    const p2 = api<{ ok: boolean }>('/b');

    // Yield so both 401s land before refresh resolves.
    await Promise.resolve();
    await Promise.resolve();

    resolveRefresh(jsonResponse(200, { accessToken: 'new-tok' }));

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);

    // Exactly one refresh call across both concurrent flows.
    const refreshCalls = fetchMock.mock.calls.filter(([input]) => {
      const url = typeof input === 'string' ? input : (input as URL | Request).toString();
      return url.includes('/auth/refresh');
    });
    expect(refreshCalls).toHaveLength(1);

    expect(getAccessToken()).toBe('new-tok');
  });

  it('apiStream returns the raw Response so callers can read res.body', async () => {
    setAccessToken('tok-stream');
    const streamBody = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n';
    fetchMock.mockResolvedValueOnce(
      new Response(streamBody, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );

    const res = await apiStream('/ai/complete', {
      method: 'POST',
      body: { foo: 'bar' },
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe(streamBody);

    // Request shape: JSON-encoded body, Bearer token attached.
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({ foo: 'bar' }));
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer tok-stream');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('apiStream performs the 401 → refresh → retry flow and returns the retry Response', async () => {
    setAccessToken('old-tok');
    const retryBody = 'data: [DONE]\n\n';
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: { message: 'expired' } })) // original
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: 'new-tok' })) // refresh
      .mockResolvedValueOnce(
        new Response(retryBody, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ); // retry

    const res = await apiStream('/ai/complete', { method: 'POST', body: { x: 1 } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(retryBody);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [, retryInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    const retryHeaders = new Headers(retryInit.headers);
    expect(retryHeaders.get('Authorization')).toBe('Bearer new-tok');
    expect(getAccessToken()).toBe('new-tok');
  });
});
