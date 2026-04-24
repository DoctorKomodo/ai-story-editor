// [V10] GET /api/ai/balance — integration tests.
// Asserts that x-venice-balance-usd and x-venice-balance-diem are read from
// Venice response headers and returned as { credits, diem }.

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/index';
import { veniceModelsService } from '../../src/services/venice.models.service';
import { prisma } from '../setup';

// ─── Constants ────────────────────────────────────────────────────────────────

const NAME = 'Balance Test User';
const USERNAME = 'ai-balance-user';
const PASSWORD = 'ai-balance-password';
const VALID_KEY = 'sk-venice-balance-test-key-ZZZZ';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jsonResponse(
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : 'err',
    headers: { 'content-type': 'application/json', ...extraHeaders },
  });
}

async function registerAndLogin(): Promise<string> {
  await request(app)
    .post('/api/auth/register')
    .send({ name: NAME, username: USERNAME, password: PASSWORD });
  const login = await request(app)
    .post('/api/auth/login')
    .send({ username: USERNAME, password: PASSWORD });
  expect(login.status).toBe(200);
  return login.body.accessToken as string;
}

async function storeKey(accessToken: string, fetchSpy: ReturnType<typeof vi.fn>): Promise<void> {
  fetchSpy.mockResolvedValueOnce(jsonResponse(200, { data: [] }));
  const res = await request(app)
    .put('/api/users/me/venice-key')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ apiKey: VALID_KEY });
  expect(res.status).toBe(200);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/ai/balance [V10]', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
    veniceModelsService.resetCache();

    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await prisma.session.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  it('returns 401 without a Bearer token', async () => {
    const res = await request(app).get('/api/ai/balance');
    expect(res.status).toBe(401);
  });

  it('returns 409 venice_key_required when the user has no stored key', async () => {
    const accessToken = await registerAndLogin();
    const res = await request(app)
      .get('/api/ai/balance')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('venice_key_required');
  });

  it('returns { credits, diem } when both headers are present', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);

    fetchSpy.mockResolvedValueOnce(
      jsonResponse(
        200,
        { object: 'list', data: [] },
        {
          'x-venice-balance-usd': '2.25',
          'x-venice-balance-diem': '1800',
        },
      ),
    );

    const res = await request(app)
      .get('/api/ai/balance')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ credits: 2.25, diem: 1800 });
  });

  it('returns null for credits when x-venice-balance-usd is absent', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);

    fetchSpy.mockResolvedValueOnce(
      jsonResponse(
        200,
        { object: 'list', data: [] },
        {
          'x-venice-balance-diem': '500',
          // x-venice-balance-usd intentionally absent
        },
      ),
    );

    const res = await request(app)
      .get('/api/ai/balance')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.credits).toBeNull();
    expect(res.body.diem).toBe(500);
  });

  it('returns null for diem when x-venice-balance-diem is absent', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);

    fetchSpy.mockResolvedValueOnce(
      jsonResponse(
        200,
        { object: 'list', data: [] },
        {
          'x-venice-balance-usd': '1.50',
          // x-venice-balance-diem intentionally absent
        },
      ),
    );

    const res = await request(app)
      .get('/api/ai/balance')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.credits).toBe(1.5);
    expect(res.body.diem).toBeNull();
  });

  it('response body does not expose Venice model list content', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);

    const bodyContent = { object: 'list', data: [{ id: 'llama-secret-model', type: 'text' }] };
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, bodyContent, {
        'x-venice-balance-usd': '3.00',
        'x-venice-balance-diem': '900',
      }),
    );

    const res = await request(app)
      .get('/api/ai/balance')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    // The response body is headers-only; Venice body content is discarded.
    expect(JSON.stringify(res.body)).not.toContain('llama-secret-model');
    expect(res.body).toEqual({ credits: 3, diem: 900 });
  });
});
