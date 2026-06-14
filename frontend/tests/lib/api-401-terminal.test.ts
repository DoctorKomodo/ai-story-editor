import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import {
  ApiError,
  api,
  resetApiClientForTests,
  setAccessToken,
  setUnauthorizedHandler,
} from '@/lib/api';

/**
 * F65 — Terminal-401 unauthorized handler invocation.
 *
 * These tests sit alongside `api.test.ts` (which already covers token state +
 * thrown errors on 401-after-refresh-fail) and add the missing assertion that
 * the registered `setUnauthorizedHandler` callback fires exactly when the
 * client gives up. The handler is the bridge that lets the session store
 * flip to `unauthenticated` + `sessionExpired: true` so RequireAuth can
 * redirect and LoginPage can show the "Session expired" banner.
 */

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('api client — terminal 401 handler invocation (F65)', () => {
  let fetchMock: FetchMock;
  let onUnauthorized: Mock<() => void>;

  beforeEach(() => {
    resetApiClientForTests();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    onUnauthorized = vi.fn<() => void>();
    setUnauthorizedHandler(onUnauthorized);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    vi.restoreAllMocks();
  });

  it('invokes the handler when refresh itself returns 401 (terminal)', async () => {
    setAccessToken('old-tok');
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: { message: 'expired' } })) // original
      .mockResolvedValueOnce(jsonResponse(401, { error: { message: 'no session' } })); // refresh

    const err = await api('/me').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('invokes the handler when the post-refresh retry returns 401', async () => {
    setAccessToken('old-tok');
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: { message: 'expired' } })) // original
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: 'new-tok' })) // refresh OK
      .mockResolvedValueOnce(jsonResponse(401, { error: { message: 'still expired' } })); // retry

    const err = await api('/me').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('does NOT invoke the handler on non-401 errors', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: { message: 'boom' } }));

    await expect(api('/me')).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('does NOT invoke the handler when refresh succeeds and retry succeeds', async () => {
    setAccessToken('old-tok');
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: { message: 'expired' } })) // original
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: 'new-tok' })) // refresh OK
      .mockResolvedValueOnce(jsonResponse(200, { ok: true })); // retry OK

    const result = await api<{ ok: boolean }>('/me');
    expect(result).toEqual({ ok: true });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('respects unregistration: handler is not called after setUnauthorizedHandler(null)', async () => {
    setAccessToken('old-tok');
    setUnauthorizedHandler(null);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, {})) // original
      .mockResolvedValueOnce(jsonResponse(401, {})); // refresh

    await expect(api('/me')).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
