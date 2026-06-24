import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { ApiError, api, resetApiClientForTests, setUnauthorizedHandler } from '@/lib/api';

/**
 * Terminal-401 unauthorized handler invocation.
 *
 * Verifies that the registered `setUnauthorizedHandler` callback fires
 * exactly when the server returns 401. With cookie-session auth a 401 is
 * terminal — there is no refresh dance.
 */

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('api client — terminal 401 handler invocation', () => {
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

  it('invokes the handler on a 401 response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: { message: 'expired' } }));

    const err = await api('/me').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('throws ApiError(401) even when no handler is registered', async () => {
    setUnauthorizedHandler(null);
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: { message: 'no session' } }));

    const err = await api('/me').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
  });

  it('does NOT invoke the handler on non-401 errors', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: { message: 'boom' } }));

    await expect(api('/me')).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('respects unregistration: handler is not called after setUnauthorizedHandler(null)', async () => {
    setUnauthorizedHandler(null);
    fetchMock.mockResolvedValueOnce(jsonResponse(401, {}));

    await expect(api('/me')).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('exactly one fetch call per request — no retry on 401', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: { message: 'expired' } }));

    await api('/me').catch(() => undefined);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
