import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/index';
import { DEFAULT_VENICE_ENDPOINT } from '../../src/services/venice-key.service';
import { prisma } from '../setup';

const NAME = 'BYOK User';
const USERNAME = 'byok-user';
const PASSWORD = 'byok-password';
const VALID_KEY = 'sk-venice-abcdefghijklmnopqrstuvwxyz-LAST';

async function registerAndLogin(): Promise<string> {
  await request(app)
    .post('/api/auth/register')
    .send({ name: NAME, username: USERNAME, password: PASSWORD });
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ username: USERNAME, password: PASSWORD });
  expect(loginRes.status).toBe(200);
  return loginRes.body.accessToken as string;
}

function mockFetchResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : 'err',
    headers: { 'content-type': 'application/json' },
  });
}

describe('BYOK Venice-key endpoints ([AU12])', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();

    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  describe('authentication', () => {
    it('GET /api/users/me/venice-key returns 401 without a Bearer token', async () => {
      const res = await request(app).get('/api/users/me/venice-key');
      expect(res.status).toBe(401);
    });

    it('PUT /api/users/me/venice-key returns 401 without a Bearer token', async () => {
      const res = await request(app)
        .put('/api/users/me/venice-key')
        .send({ apiKey: VALID_KEY });
      expect(res.status).toBe(401);
    });

    it('DELETE /api/users/me/venice-key returns 401 without a Bearer token', async () => {
      const res = await request(app).delete('/api/users/me/venice-key');
      expect(res.status).toBe(401);
    });
  });

  describe('GET — returns only { hasKey, lastFour, endpoint } and never the key', () => {
    it('returns { hasKey: false } when no key is stored', async () => {
      const accessToken = await registerAndLogin();

      const res = await request(app)
        .get('/api/users/me/venice-key')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ hasKey: false, lastFour: null, endpoint: null });
    });

    it('returns { hasKey: true, lastFour, endpoint } after storing, and never returns the key', async () => {
      const accessToken = await registerAndLogin();
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { data: [] }));

      await request(app)
        .put('/api/users/me/venice-key')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ apiKey: VALID_KEY });

      const res = await request(app)
        .get('/api/users/me/venice-key')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.hasKey).toBe(true);
      expect(res.body.lastFour).toBe('LAST');
      expect(res.body.endpoint).toBe(DEFAULT_VENICE_ENDPOINT);

      // Body must never expose the full key or any of the ciphertext fields.
      const bodyStr = JSON.stringify(res.body);
      expect(bodyStr).not.toContain(VALID_KEY);
      expect(bodyStr).not.toContain('veniceApiKeyEnc');
      expect(bodyStr).not.toContain('veniceApiKeyIv');
      expect(bodyStr).not.toContain('veniceApiKeyAuthTag');
    });
  });

  describe('PUT — validates key against Venice before storing', () => {
    it('calls Venice GET /models with the Bearer key and stores on 200', async () => {
      const accessToken = await registerAndLogin();
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { data: [] }));

      const res = await request(app)
        .put('/api/users/me/venice-key')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ apiKey: VALID_KEY });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'saved', lastFour: 'LAST', endpoint: DEFAULT_VENICE_ENDPOINT });

      // Exactly one fetch call was made, with the correct URL + Bearer auth header.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(url).toBe(`${DEFAULT_VENICE_ENDPOINT}/models`);
      expect(init.headers.Authorization).toBe(`Bearer ${VALID_KEY}`);

      const row = await prisma.user.findFirst({ where: { username: USERNAME } });
      expect(row?.veniceApiKeyEnc).toBeTruthy();
      expect(row?.veniceApiKeyIv).toBeTruthy();
      expect(row?.veniceApiKeyAuthTag).toBeTruthy();
    });

    it('accepts a custom endpoint override, uses it for validation, and stores it', async () => {
      const accessToken = await registerAndLogin();
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { data: [] }));

      const customEndpoint = 'https://proxy.example.com/venice/v1';
      const res = await request(app)
        .put('/api/users/me/venice-key')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ apiKey: VALID_KEY, endpoint: customEndpoint });

      expect(res.status).toBe(200);
      expect(res.body.endpoint).toBe(customEndpoint);

      const [url] = fetchSpy.mock.calls[0]!;
      expect(url).toBe(`${customEndpoint}/models`);
    });

    it('returns 400 { error.code: "venice_key_invalid" } on a 401 from Venice and does NOT store', async () => {
      const accessToken = await registerAndLogin();
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(401, { error: 'invalid' }));

      const res = await request(app)
        .put('/api/users/me/venice-key')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ apiKey: VALID_KEY });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('venice_key_invalid');

      const row = await prisma.user.findFirst({ where: { username: USERNAME } });
      expect(row?.veniceApiKeyEnc).toBeNull();
      expect(row?.veniceApiKeyIv).toBeNull();
      expect(row?.veniceApiKeyAuthTag).toBeNull();
    });

    it('returns 502 when Venice is unreachable', async () => {
      const accessToken = await registerAndLogin();
      fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const res = await request(app)
        .put('/api/users/me/venice-key')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ apiKey: VALID_KEY });

      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('venice_unreachable');
    });

    it('returns 400 on empty apiKey', async () => {
      const accessToken = await registerAndLogin();

      const res = await request(app)
        .put('/api/users/me/venice-key')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ apiKey: '   ' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('returns 400 on malformed endpoint URL', async () => {
      const accessToken = await registerAndLogin();

      const res = await request(app)
        .put('/api/users/me/venice-key')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ apiKey: VALID_KEY, endpoint: 'not-a-url' });

      expect(res.status).toBe(400);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('DELETE — nulls all BYOK columns', () => {
    it('returns { status: "removed" } and clears all four BYOK columns', async () => {
      const accessToken = await registerAndLogin();
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { data: [] }));

      await request(app)
        .put('/api/users/me/venice-key')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ apiKey: VALID_KEY, endpoint: 'https://proxy.example.com/venice/v1' });

      const res = await request(app)
        .delete('/api/users/me/venice-key')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'removed' });

      const row = await prisma.user.findFirst({ where: { username: USERNAME } });
      expect(row?.veniceApiKeyEnc).toBeNull();
      expect(row?.veniceApiKeyIv).toBeNull();
      expect(row?.veniceApiKeyAuthTag).toBeNull();
      expect(row?.veniceEndpoint).toBeNull();
    });

    it('is idempotent — DELETE with no stored key still returns 200', async () => {
      const accessToken = await registerAndLogin();
      const res = await request(app)
        .delete('/api/users/me/venice-key')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(200);
    });
  });

  describe('key leakage through endpoints', () => {
    it('encrypted ciphertext in the DB is unrelated to the plaintext key', async () => {
      const accessToken = await registerAndLogin();
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, { data: [] }));

      await request(app)
        .put('/api/users/me/venice-key')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ apiKey: VALID_KEY });

      const row = await prisma.user.findFirst({ where: { username: USERNAME } });
      const serialised = JSON.stringify(row);
      // Plaintext key must not appear anywhere in the raw DB row.
      expect(serialised).not.toContain(VALID_KEY);
    });
  });
});
