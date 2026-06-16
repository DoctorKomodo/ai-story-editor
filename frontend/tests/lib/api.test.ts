import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  api,
  apiStream,
  resetApiClientForTests,
  setUnauthorizedHandler,
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientForTests();
    vi.restoreAllMocks();
  });

  it('never sets an Authorization header', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    await api<{ ok: boolean }>('/stories');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.has('Authorization')).toBe(false);
  });

  it('always includes credentials: include', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    await api('/public');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe('include');
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

  it('on 401: fires onUnauthorized once, throws ApiError(401), makes NO /auth/refresh call', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { message: 'session expired', code: 'unauthorized' } }),
    );

    const err = await api('/me').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect((err as ApiError).code).toBe('unauthorized');

    // Exactly one fetch — no /auth/refresh retry.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain('/auth/refresh');

    // Handler fired exactly once.
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('on 401 with no onUnauthorized handler: still throws ApiError(401) without refresh', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: { message: 'nope' } }));
    const err = await api('/me').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('prefixes paths with the default /api base', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    await api('/auth/login', { method: 'POST', body: { username: 'u', password: 'p' } });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/login');
  });

  it('apiStream returns the raw Response so callers can read res.body', async () => {
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

    // Request shape: JSON-encoded body, no Authorization, credentials included.
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({ foo: 'bar' }));
    const headers = new Headers(init.headers);
    expect(headers.has('Authorization')).toBe(false);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(init.credentials).toBe('include');
  });

  it('apiStream on 401: fires onUnauthorized, throws ApiError, makes no /auth/refresh call', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: { message: 'expired' } }));

    await expect(
      apiStream('/ai/complete', { method: 'POST', body: { x: 1 } }),
    ).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
