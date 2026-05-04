// [X32] GET /api/users/me/venice-account — integration tests.
//
// Tests the unified account-info endpoint that replaces the old POST /verify
// and GET /api/ai/balance. Calls Venice GET /api_keys/rate_limits and reads
// `data.balances.{USD,DIEM}` from the JSON body. Per-user rate-limited at
// 30 req/min.

import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, globalErrorHandler } from '../../src/index';
import { createAuthRouter } from '../../src/routes/auth.routes';
import { createVeniceAccountRouter } from '../../src/routes/venice-account.routes';
import { createVeniceKeyRouter } from '../../src/routes/venice-key.routes';
import * as cryptoService from '../../src/services/crypto.service';
import { DEFAULT_VENICE_ENDPOINT } from '../../src/services/venice-key.service';
import { prisma } from '../setup';

// ─── Constants ────────────────────────────────────────────────────────────────

const NAME = 'Account Test User';
const USERNAME = 'venice-account-user';
const PASSWORD = 'venice-account-password';
// Sentinel — must never appear in response bodies, headers, or logs.
const VALID_KEY = 'sk-venice-account-SENTINEL-KEY-LAST6';

const NAME_B = 'Account Test User B';
const USERNAME_B = 'venice-account-user-b';
const PASSWORD_B = 'venice-account-password-b';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function modelsResponse(status: number): Response {
  return new Response(JSON.stringify({ object: 'list', data: [] }), {
    status,
    statusText: status === 200 ? 'OK' : 'err',
    headers: { 'content-type': 'application/json' },
  });
}

function rateLimitsResponse(opts: { usd?: number | null; diem?: number | null } = {}): Response {
  const balances: Record<string, number> = {};
  if (opts.usd !== undefined && opts.usd !== null) balances.USD = opts.usd;
  if (opts.diem !== undefined && opts.diem !== null) balances.DIEM = opts.diem;
  return new Response(
    JSON.stringify({
      data: {
        balances,
        accessPermitted: true,
        apiTier: { id: 'paid', isCharged: true },
        rateLimits: [],
      },
    }),
    { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' } },
  );
}

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
  appUnderTest: express.Express,
  name: string,
  username: string,
  password: string,
): Promise<string> {
  await request(appUnderTest).post('/api/auth/register').send({ name, username, password });
  const login = await request(appUnderTest).post('/api/auth/login').send({ username, password });
  expect(login.status).toBe(200);
  return login.body.accessToken as string;
}

async function storeKey(
  appUnderTest: express.Express,
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

describe('GET /api/users/me/venice-account [X32]', () => {
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
    const res = await request(app).get('/api/users/me/venice-account');
    expect(res.status).toBe(401);
  });

  // ── 2. No stored key ───────────────────────────────────────────────────────
  it('returns verified:false when no key is stored', async () => {
    const accessToken = await registerAndLogin(app, NAME, USERNAME, PASSWORD);
    const res = await request(app)
      .get('/api/users/me/venice-account')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      verified: false,
      balanceUsd: null,
      diem: null,
      endpoint: null,
      lastSix: null,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // ── 3. Both balances present ──────────────────────────────────────────────
  it('returns verified:true with balanceUsd and diem when both present', async () => {
    const accessToken = await registerAndLogin(app, NAME, USERNAME, PASSWORD);
    await storeKey(app, accessToken, fetchSpy);
    fetchSpy.mockResolvedValueOnce(rateLimitsResponse({ usd: 2.25, diem: 1800 }));

    const res = await request(app)
      .get('/api/users/me/venice-account')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      verified: true,
      balanceUsd: 2.25,
      diem: 1800,
      endpoint: DEFAULT_VENICE_ENDPOINT,
      lastSix: '-LAST6',
    });
  });

  // ── 4. USD missing ─────────────────────────────────────────────────────────
  it('returns balanceUsd:null when data.balances.USD is missing', async () => {
    const accessToken = await registerAndLogin(app, NAME, USERNAME, PASSWORD);
    await storeKey(app, accessToken, fetchSpy);
    fetchSpy.mockResolvedValueOnce(rateLimitsResponse({ diem: 500 }));
    const res = await request(app)
      .get('/api/users/me/venice-account')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.balanceUsd).toBeNull();
    expect(res.body.diem).toBe(500);
  });

  // ── 5. DIEM missing ────────────────────────────────────────────────────────
  it('returns diem:null when data.balances.DIEM is missing', async () => {
    const accessToken = await registerAndLogin(app, NAME, USERNAME, PASSWORD);
    await storeKey(app, accessToken, fetchSpy);
    fetchSpy.mockResolvedValueOnce(rateLimitsResponse({ usd: 1.5 }));
    const res = await request(app)
      .get('/api/users/me/venice-account')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.balanceUsd).toBe(1.5);
    expect(res.body.diem).toBeNull();
  });

  // ── 6. Empty balances ──────────────────────────────────────────────────────
  it('returns balanceUsd:null and diem:null when data.balances is empty', async () => {
    const accessToken = await registerAndLogin(app, NAME, USERNAME, PASSWORD);
    await storeKey(app, accessToken, fetchSpy);
    fetchSpy.mockResolvedValueOnce(rateLimitsResponse({}));
    const res = await request(app)
      .get('/api/users/me/venice-account')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.balanceUsd).toBeNull();
    expect(res.body.diem).toBeNull();
  });

  // ── 7. Venice 401 → app 200 verified:false ────────────────────────────────
  it('returns verified:false with endpoint/lastSix echoed when Venice returns 401', async () => {
    const accessToken = await registerAndLogin(app, NAME, USERNAME, PASSWORD);
    await storeKey(app, accessToken, fetchSpy);

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchSpy.mockResolvedValueOnce(errorResponse(401, 'Invalid API key'));

    const res = await request(app)
      .get('/api/users/me/venice-account')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      verified: false,
      balanceUsd: null,
      diem: null,
      endpoint: DEFAULT_VENICE_ENDPOINT,
      lastSix: '-LAST6',
    });

    const allLogged = errSpy.mock.calls.flat().map(String).join(' ');
    expect(allLogged).not.toContain(VALID_KEY);
    errSpy.mockRestore();
  });

  // ── 8. Venice 429 → app 429 venice_rate_limited (with upstreamStatus) ─────
  it('returns 429 venice_rate_limited with upstreamStatus when Venice rate-limits', async () => {
    const accessToken = await registerAndLogin(app, NAME, USERNAME, PASSWORD);
    await storeKey(app, accessToken, fetchSpy);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    fetchSpy.mockResolvedValueOnce(errorResponse(429, 'rate limited', { 'retry-after': '30' }));

    const res = await request(app)
      .get('/api/users/me/venice-account')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('venice_rate_limited');
    expect(res.body.error.upstreamStatus).toBe(429);
    expect(res.body.error.retryAfterSeconds).toBe(30);

    const allLogged = errSpy.mock.calls.flat().map(String).join(' ');
    expect(allLogged).toContain('[X32]');
    errSpy.mockRestore();
  });

  // ── 9. Venice 503 → app 502 venice_unavailable (with upstreamStatus) ──────
  it('returns 502 venice_unavailable with upstreamStatus:503 when Venice returns 503', async () => {
    const accessToken = await registerAndLogin(app, NAME, USERNAME, PASSWORD);
    await storeKey(app, accessToken, fetchSpy);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    fetchSpy.mockResolvedValueOnce(errorResponse(503, 'Service Unavailable'));

    const res = await request(app)
      .get('/api/users/me/venice-account')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('venice_unavailable');
    expect(res.body.error.upstreamStatus).toBe(503);

    const allLogged = errSpy.mock.calls.flat().map(String).join(' ');
    expect(allLogged).toContain('[X32]');
    errSpy.mockRestore();
  });

  // ── 10. Fetch reject → 502 with upstreamStatus:null ───────────────────────
  it('returns 502 venice_unavailable with upstreamStatus:null on transport failure', async () => {
    const accessToken = await registerAndLogin(app, NAME, USERNAME, PASSWORD);
    await storeKey(app, accessToken, fetchSpy);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const res = await request(app)
      .get('/api/users/me/venice-account')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('venice_unavailable');
    expect(res.body.error.upstreamStatus).toBeNull();

    const allLogged = errSpy.mock.calls.flat().map(String).join(' ');
    expect(allLogged).toContain('[X32]');
    expect(allLogged).toContain('transport');
    errSpy.mockRestore();
  });

  // ── 11. Plaintext key never in response body / headers / logs ─────────────
  it('never exposes the plaintext Venice key in the response or logs', async () => {
    const accessToken = await registerAndLogin(app, NAME, USERNAME, PASSWORD);
    await storeKey(app, accessToken, fetchSpy);

    fetchSpy.mockResolvedValueOnce(rateLimitsResponse({ usd: 5, diem: 2000 }));

    const errorSpy = vi.spyOn(console, 'error');
    const warnSpy = vi.spyOn(console, 'warn');
    const logSpy = vi.spyOn(console, 'log');
    const infoSpy = vi.spyOn(console, 'info');

    const res = await request(app)
      .get('/api/users/me/venice-account')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);

    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain(VALID_KEY);

    const headersStr = JSON.stringify(res.headers);
    expect(headersStr).not.toContain(VALID_KEY);

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

  // ── 12. URL pin: hits /api_keys/rate_limits ────────────────────────────────
  it('hits Venice GET /api_keys/rate_limits (not /v1/models)', async () => {
    const accessToken = await registerAndLogin(app, NAME, USERNAME, PASSWORD);
    await storeKey(app, accessToken, fetchSpy);

    fetchSpy.mockResolvedValueOnce(rateLimitsResponse({ usd: 1, diem: 1 }));

    await request(app)
      .get('/api/users/me/venice-account')
      .set('Authorization', `Bearer ${accessToken}`);

    // The first fetch (index 0) was storeKey's validate-against-/models call.
    // The probe call (index 1) is what we're asserting.
    const probeCall = fetchSpy.mock.calls[1];
    expect(probeCall).toBeDefined();
    const probeUrl = String(probeCall![0]);
    expect(probeUrl).toContain('/api_keys/rate_limits');
    expect(probeUrl).not.toContain('/models');
  });

  // ── 13. Single decrypt per request ─────────────────────────────────────────
  it('decrypts the stored key exactly once per request', async () => {
    const accessToken = await registerAndLogin(app, NAME, USERNAME, PASSWORD);
    await storeKey(app, accessToken, fetchSpy);

    fetchSpy.mockResolvedValueOnce(rateLimitsResponse({ usd: 1, diem: 1 }));

    const decryptSpy = vi.spyOn(cryptoService, 'decrypt');
    const beforeCount = decryptSpy.mock.calls.length;

    await request(app)
      .get('/api/users/me/venice-account')
      .set('Authorization', `Bearer ${accessToken}`);

    const decryptsForThisRequest = decryptSpy.mock.calls.length - beforeCount;
    expect(decryptsForThisRequest).toBe(1);
    decryptSpy.mockRestore();
  });

  // ── 14. Per-user 30/min rate limit (account_rate_limited) ─────────────────
  it('rate-limits at 30/min per user; user B unaffected; emits account_rate_limited code', async () => {
    const testApp = express();
    testApp.use(helmet());
    testApp.use(cors({ origin: true, credentials: true }));
    testApp.use(express.json());
    testApp.use(cookieParser());
    testApp.use('/api/auth', createAuthRouter());
    testApp.use('/api/users/me/venice-key', createVeniceKeyRouter());
    testApp.use(
      '/api/users/me/venice-account',
      createVeniceAccountRouter({ accountRateLimitWindowMs: 200 }),
    );
    testApp.use(globalErrorHandler);

    const tokenA = await registerAndLogin(testApp, NAME, USERNAME, PASSWORD);
    const tokenB = await registerAndLogin(testApp, NAME_B, USERNAME_B, PASSWORD_B);
    await storeKey(testApp, tokenA, fetchSpy);
    await storeKey(testApp, tokenB, fetchSpy);

    // 30 successes for user A + 1 for user B = 31 fetch slots needed.
    for (let i = 0; i < 31; i++) {
      fetchSpy.mockResolvedValueOnce(rateLimitsResponse({ usd: 1, diem: 1 }));
    }

    for (let i = 0; i < 30; i++) {
      const r = await request(testApp)
        .get('/api/users/me/venice-account')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(r.status).toBe(200);
    }

    // 31st request from user A should be rate-limited with the router's own code.
    const blocked = await request(testApp)
      .get('/api/users/me/venice-account')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('account_rate_limited');
    // CRITICAL: this is OUR limit (chatty client), distinct from `venice_rate_limited` (Venice's limit).
    expect(blocked.body.error.code).not.toBe('venice_rate_limited');

    // User B not blocked.
    const userBRes = await request(testApp)
      .get('/api/users/me/venice-account')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(userBRes.status).toBe(200);
  }, 15_000);
});
