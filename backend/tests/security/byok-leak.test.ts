import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/index';
import { prisma } from '../setup';

const NAME = 'Leak Proof';
const USERNAME = 'leak-proof';
const PASSWORD = 'leak-proof-password';
// Use a string that embeds a recognisable sentinel so a single `includes()`
// check reliably catches any accidental leak.
const VENICE_KEY = 'sk-venice-SENTINEL-LEAK-TEST-MARKER-LAST';

function mockResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : 'err',
    headers: { 'content-type': 'application/json' },
  });
}

describe('[AU13] BYOK no-leak proof', () => {
  let logCalls: string[];
  let consoleSpy: ReturnType<typeof vi.spyOn>[];

  beforeEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();

    // Attach a fetch stub so Venice validation succeeds without network IO.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => mockResponse(200, { data: [] })),
    );

    logCalls = [];
    // Capture every line that would have been written by the process to any
    // of the standard console channels during the BYOK flow.
    const capture = (...args: unknown[]) => {
      logCalls.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };
    consoleSpy = [
      vi.spyOn(console, 'log').mockImplementation(capture),
      vi.spyOn(console, 'info').mockImplementation(capture),
      vi.spyOn(console, 'warn').mockImplementation(capture),
      vi.spyOn(console, 'error').mockImplementation(capture),
      vi.spyOn(console, 'debug').mockImplementation(capture),
    ];
  });

  afterEach(async () => {
    for (const spy of consoleSpy) spy.mockRestore();
    vi.unstubAllGlobals();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  async function registerAndLogin(): Promise<string> {
    await request(app)
      .post('/api/auth/register')
      .send({ name: NAME, username: USERNAME, password: PASSWORD });
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: USERNAME, password: PASSWORD });
    return loginRes.body.accessToken as string;
  }

  it('(a) never logs the raw Venice key during the full PUT → GET → DELETE cycle', async () => {
    const accessToken = await registerAndLogin();

    await request(app)
      .put('/api/users/me/venice-key')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ apiKey: VENICE_KEY });

    await request(app)
      .get('/api/users/me/venice-key')
      .set('Authorization', `Bearer ${accessToken}`);

    await request(app)
      .delete('/api/users/me/venice-key')
      .set('Authorization', `Bearer ${accessToken}`);

    const combined = logCalls.join('\n');
    expect(combined).not.toContain(VENICE_KEY);
    // Also sanity-check: no substring of the key longer than the last-four
    // leaks. A leaked full key or middle chunk would still contain
    // 'SENTINEL-LEAK-TEST-MARKER' so this is a belt-and-braces check.
    expect(combined).not.toContain('SENTINEL-LEAK-TEST-MARKER');
  });

  it('(b) never leaks the key via any route response (PUT success, GET, DELETE, error paths)', async () => {
    const accessToken = await registerAndLogin();

    const putRes = await request(app)
      .put('/api/users/me/venice-key')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ apiKey: VENICE_KEY });
    const getRes = await request(app)
      .get('/api/users/me/venice-key')
      .set('Authorization', `Bearer ${accessToken}`);
    const deleteRes = await request(app)
      .delete('/api/users/me/venice-key')
      .set('Authorization', `Bearer ${accessToken}`);

    const bodies = [
      JSON.stringify(putRes.body),
      JSON.stringify(getRes.body),
      JSON.stringify(deleteRes.body),
    ].join('\n');

    expect(bodies).not.toContain(VENICE_KEY);
    expect(bodies).not.toContain('SENTINEL-LEAK-TEST-MARKER');
  });

  it('(c) never returns ciphertext field names in any response', async () => {
    const accessToken = await registerAndLogin();

    await request(app)
      .put('/api/users/me/venice-key')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ apiKey: VENICE_KEY });

    const getRes = await request(app)
      .get('/api/users/me/venice-key')
      .set('Authorization', `Bearer ${accessToken}`);

    const asText = JSON.stringify(getRes.body);
    for (const forbidden of [
      'veniceApiKeyEnc',
      'veniceApiKeyIv',
      'veniceApiKeyAuthTag',
      'passwordHash',
    ]) {
      expect(asText).not.toContain(forbidden);
    }
  });

  it('(d) the stored ciphertext in the DB is unrelated to the plaintext key', async () => {
    const accessToken = await registerAndLogin();

    await request(app)
      .put('/api/users/me/venice-key')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ apiKey: VENICE_KEY });

    const row = await prisma.user.findFirst({ where: { username: USERNAME } });
    const asText = JSON.stringify(row);
    expect(asText).not.toContain(VENICE_KEY);
    expect(asText).not.toContain('SENTINEL-LEAK-TEST-MARKER');
    // The ciphertext column is populated (we're proving it was encrypted, not
    // omitted).
    expect(row?.veniceApiKeyEnc).toBeTruthy();
  });

  it('(e) the key is never included in a thrown error object on Venice 401', async () => {
    // Swap the fetch stub to return 401 so the PUT path throws
    // VeniceKeyInvalidError internally.
    vi.unstubAllGlobals();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => mockResponse(401, { error: 'invalid' })),
    );

    const accessToken = await registerAndLogin();

    const res = await request(app)
      .put('/api/users/me/venice-key')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ apiKey: VENICE_KEY });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain(VENICE_KEY);
    expect(JSON.stringify(res.body)).not.toContain('SENTINEL-LEAK-TEST-MARKER');
    expect(logCalls.join('\n')).not.toContain(VENICE_KEY);
  });
});
