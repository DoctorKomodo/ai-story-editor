import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, setAccessToken, getAccessToken } from '@/lib/api';

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
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setAccessToken(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setAccessToken(null);
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
});
