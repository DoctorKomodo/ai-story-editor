// [V18] POST /api/users/me/venice-key/verify — integration tests.
//
// Tests the verify endpoint that re-validates the stored Venice key by calling
// GET /v1/models and reading x-venice-balance-usd / x-venice-balance-diem
// headers from the response. Rate-limited at 6 req/min per user.
//
// Venice HTTP responses are simulated via vi.stubGlobal('fetch', …). The openai
// SDK maps HTTP status codes to APIError subclasses (AuthenticationError,
// RateLimitError, etc.) internally — so we return a Response object, not a
// rejected promise. Rejecting fetch causes the SDK to produce APIConnectionError
// (status: undefined), which bypasses the instanceof checks.

import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, globalErrorHandler } from '../../src/index';
import { createAuthRouter } from '../../src/routes/auth.routes';
import { createVeniceKeyRouter } from '../../src/routes/venice-key.routes';
import { DEFAULT_VENICE_ENDPOINT } from '../../src/services/venice-key.service';
import { prisma } from '../setup';

// ─── Constants ────────────────────────────────────────────────────────────────

const NAME = 'Verify Test User';
const USERNAME = 'venice-verify-user';
const PASSWORD = 'venice-verify-password';
// Sentinel key — must never appear in response bodies or logs.
const VALID_KEY = 'sk-venice-verify-SENTINEL-KEY-LAST';

const NAME_B = 'Verify Test User B';
const USERNAME_B = 'venice-verify-user-b';
const PASSWORD_B = 'venice-verify-password-b';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a Response that includes optional balance headers.
 * Used to simulate a successful Venice models.list() call.
 */
function modelsResponse(status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ object: 'list', data: [] }), {
    status,
    statusText: status === 200 ? 'OK' : 'err',
    headers: { 'content-type': 'application/json', ...extraHeaders },
  });
}

/**
 * Build a Response that will cause the openai SDK to throw an APIError subclass.
 * MUST return a Response (not reject) so the SDK picks the right subclass.
 */
function errorResponse(
  status: number,
  message = 'error',
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  });
}

async function registerAndLogin(
  appUnderTest: Express.Application,
  name: string,
  username: string,
  password: string,
): Promise<string> {
  await request(appUnderTest).post('/api/auth/register').send({ name, username, password });
  const login = await request(appUnderTest).post('/api/auth/login').send({ username, password });
  expect(login.status).toBe(200);
  return login.body.accessToken as string;
}

/**
 * Store a Venice key for the user, consuming one fetch mock slot for the
 * validation call that PUT /venice-key performs.
 */
async function storeKey(
  appUnderTest: Express.Application,
  accessToken: string,
  fetchSpy: ReturnType<typeof vi.fn>,
): Promise<void> {
  fetchSpy.mockResolvedValueOnce(modelsResponse(200));
  const res = await request(appUnderTest)
    .put('/api/users/me/venice-key')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ apiKey: VALID_KEY });
  expect(res.status).toBe(200);
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('POST /api/users/me/venice-key/verify [V18]', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();

    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await prisma.session.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  // ── 1. Auth guard ──────────────────────────────────────────────────────────

  it('returns 401 without a Bearer token', async () => {
    const res = await request(app).post('/api/users/me/venice-key/verify');
    expect(res.status).toBe(401);
  });

  // ── 2. No stored key ───────────────────────────────────────────────────────

  it('returns verified:false when no key is stored', async () => {
    const accessToken = await registerAndLogin(app, NAME, USERNAME, PASSWORD);

    const res = await request(app)
      .post('/api/users/me/venice-key/verify')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      verified: false,
      credits: null,
      diem: null,
      endpoint: null,
      lastFour: null,
    });
    // No Venice call should have been made (there's no key to probe with).
    // The only fetch calls were in registerAndLogin (none) and storeKey (none).
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // ── 3. Key present + both balance headers ─────────────────────────────────

  it('returns verified:true with credits and diem when both headers are present', async () => {
    const accessToken = await registerAndLogin(app, NAME, USERNAME, PASSWORD);
    await storeKey(app, accessToken, fetchSpy);

    fetchSpy.mockResolvedValueOnce(
      modelsResponse(200, {
        'x-venice-balance-usd': '2.25',
        'x-venice-balance-diem': '1800',
      }),
    );

    const res = await request(app)
      .post('/api/users/me/venice-key/verify')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      verified: true,
      credits: 2.25,
      diem: 1800,
      endpoint: DEFAULT_VENICE_ENDPOINT,
      lastFour: 'LAST',
    });
  });

  // ── 4. One balance header missing ─────────────────────────────────────────

  it('returns credits:null when x-venice-balance-usd header is absent', async () => {
    const accessToken = await registerAndLogin(app, NAME, USERNAME, PASSWORD);
    await storeKey(app, accessToken, fetchSpy);

    fetchSpy.mockResolvedValueOnce(modelsResponse(200, { 'x-venice-balance-diem': '500' }));

    const res = await request(app)
      .post('/api/users/me/venice-key/verify')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.credits).toBeNull();
    expect(res.body.diem).toBe(500);
  });

  it('returns diem:null when x-venice-balance-diem header is absent', async () => {
    const accessToken = await registerAndLogin(app, NAME, USERNAME, PASSWORD);
    await storeKey(app, accessToken, fetchSpy);

    fetchSpy.mockResolvedValueOnce(modelsResponse(200, { 'x-venice-balance-usd': '1.50' }));

    const res = await request(app)
      .post('/api/users/me/venice-key/verify')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.credits).toBe(1.5);
    expect(res.body.diem).toBeNull();
  });

  // ── 5. No balance headers at all ──────────────────────────────────────────

  it('returns credits:null and diem:null when no balance headers are present', async () => {
    const accessToken = await registerAndLogin(app, NAME, USERNAME, PASSWORD);
    await storeKey(app, accessToken, fetchSpy);

    fetchSpy.mockResolvedValueOnce(modelsResponse(200));

    const res = await request(app)
      .post('/api/users/me/venice-key/verify')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.credits).toBeNull();
    expect(res.body.diem).toBeNull();
  });

  // ── 6. Venice returns 401 (stored key is bad) ─────────────────────────────

  it('returns verified:false with endpoint/lastFour echoed when Venice returns 401', async () => {
    const accessToken = await registerAndLogin(app, NAME, USERNAME, PASSWORD);
    await storeKey(app, accessToken, fetchSpy);

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    // Return a 401 Response so the SDK throws AuthenticationError.
    fetchSpy.mockResolvedValueOnce(errorResponse(401, 'Invalid API key'));

    const res = await request(app)
      .post('/api/users/me/venice-key/verify')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      verified: false,
      credits: null,
      diem: null,
      endpoint: DEFAULT_VENICE_ENDPOINT,
      lastFour: 'LAST',
    });

    const logged = [errSpy, warnSpy, logSpy, infoSpy]
      .flatMap((s) => s.mock.calls)
      .map((c) => c.map(String).join(' '))
      .join('\n');
    expect(logged).not.toContain(VALID_KEY);
    errSpy.mockRestore();
    warnSpy.mockRestore();
    logSpy.mockRestore();
    infoSpy.mockRestore();
  });

  // ── 7. Venice returns 429 → our 429 venice_rate_limited ───────────────────

  it('returns 429 venice_rate_limited when Venice rate-limits the probe', async () => {
    const accessToken = await registerAndLogin(app, NAME, USERNAME, PASSWORD);
    await storeKey(app, accessToken, fetchSpy);

    fetchSpy.mockResolvedValueOnce(errorResponse(429, 'rate limited', { 'retry-after': '30' }));

    const res = await request(app)
      .post('/api/users/me/venice-key/verify')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('venice_rate_limited');
  });

  // ── 8. Venice returns 503 → our 502 ───────────────────────────────────────

  it('returns 502 when Venice returns 503', async () => {
    const accessToken = await registerAndLogin(app, NAME, USERNAME, PASSWORD);
    await storeKey(app, accessToken, fetchSpy);

    fetchSpy.mockResolvedValueOnce(errorResponse(503, 'Service Unavailable'));

    const res = await request(app)
      .post('/api/users/me/venice-key/verify')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('venice_unavailable');
  });

  // ── 9. No plaintext key leak ───────────────────────────────────────────────

  it('never exposes the plaintext Venice key in the response or logs', async () => {
    const accessToken = await registerAndLogin(app, NAME, USERNAME, PASSWORD);
    await storeKey(app, accessToken, fetchSpy);

    fetchSpy.mockResolvedValueOnce(
      modelsResponse(200, {
        'x-venice-balance-usd': '5.00',
        'x-venice-balance-diem': '2000',
      }),
    );

    // Install console spies BEFORE the request.
    const errorSpy = vi.spyOn(console, 'error');
    const warnSpy = vi.spyOn(console, 'warn');
    const logSpy = vi.spyOn(console, 'log');
    const infoSpy = vi.spyOn(console, 'info');

    const res = await request(app)
      .post('/api/users/me/venice-key/verify')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);

    // Sentinel must not appear in the response body.
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain(VALID_KEY);

    // Sentinel must not appear in any response headers.
    const headersStr = JSON.stringify(res.headers);
    expect(headersStr).not.toContain(VALID_KEY);

    // Sentinel must not appear in any console channel.
    const allLogged = [
      ...errorSpy.mock.calls,
      ...warnSpy.mock.calls,
      ...logSpy.mock.calls,
      ...infoSpy.mock.calls,
    ]
      .flat()
      .map(String)
      .join(' ');
    expect(allLogged).not.toContain(VALID_KEY);
  });

  // ── 10. Per-user rate limit ────────────────────────────────────────────────
  //
  // Strategy: build a test-specific Express app that mounts the venice-key
  // router with a very short windowMs (200 ms) so the 7-call burst will hit
  // the 6 req/min limit without requiring fake timers or long sleeps.
  // User B, with a separate userId, should not be blocked in the same window.

  it('rate-limits by user (6 req/min); user B is unaffected by user A exhausting the limit', async () => {
    // Build a minimal test app with a 200 ms rate-limit window so the burst
    // completes within a normal test timeout without advancing fake timers.
    const testApp = express();
    testApp.use(helmet());
    testApp.use(cors({ origin: true, credentials: true }));
    testApp.use(express.json());
    testApp.use(cookieParser());
    testApp.use('/api/auth', createAuthRouter());
    testApp.use(
      '/api/users/me/venice-key',
      createVeniceKeyRouter({ verifyRateLimitWindowMs: 200 }),
    );
    testApp.use(globalErrorHandler);

    // Register and log in both users.
    const tokenA = await registerAndLogin(testApp, NAME, USERNAME, PASSWORD);
    const tokenB = await registerAndLogin(testApp, NAME_B, USERNAME_B, PASSWORD_B);

    // Give user A a stored key.
    await storeKey(testApp, tokenA, fetchSpy);

    // Give user B a stored key as well (so verify actually hits Venice).
    await storeKey(testApp, tokenB, fetchSpy);

    // Provide enough fetch mocks for user A's 6 successful probes + 1 blocked
    // attempt + user B's probe. The blocked call doesn't reach fetch, and
    // user B needs 1 slot.
    for (let i = 0; i < 6; i++) {
      fetchSpy.mockResolvedValueOnce(modelsResponse(200));
    }
    // User B's probe — one more slot.
    fetchSpy.mockResolvedValueOnce(modelsResponse(200));

    // User A fires 6 requests — all should succeed.
    for (let i = 0; i < 6; i++) {
      const r = await request(testApp)
        .post('/api/users/me/venice-key/verify')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(r.status).toBe(200);
    }

    // 7th request from user A — should be rate-limited.
    const blocked = await request(testApp)
      .post('/api/users/me/venice-key/verify')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('verify_rate_limited');

    // User B should still be able to verify in the same window.
    const userBRes = await request(testApp)
      .post('/api/users/me/venice-key/verify')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(userBRes.status).toBe(200);
  }, 10_000); // Generous timeout; the burst is fast but auth hashing takes time.
});
