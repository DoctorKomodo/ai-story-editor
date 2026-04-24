import express, { type Request, type Response } from 'express';
import supertest from 'supertest';
import { describe, expect, it } from 'vitest';
import { requireAllowedOrigin } from '../../src/middleware/origin-check.middleware';

const ALLOWED = 'https://allowed.example';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.post('/protected', requireAllowedOrigin(ALLOWED), (_req: Request, res: Response) => {
    res.status(200).json({ ok: true });
  });
  app.get('/protected', requireAllowedOrigin(ALLOWED), (_req: Request, res: Response) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

describe('requireAllowedOrigin middleware', () => {
  it('allows POST with matching Origin header', async () => {
    const res = await supertest(makeApp()).post('/protected').set('Origin', ALLOWED).send({});
    expect(res.status).toBe(200);
  });

  it('blocks POST with a different Origin header', async () => {
    const res = await supertest(makeApp())
      .post('/protected')
      .set('Origin', 'https://evil.example')
      .send({});
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: { message: 'Origin not allowed', code: 'csrf_block' },
    });
  });

  it('allows POST when neither Origin nor Referer is present (non-browser client)', async () => {
    // Supertest doesn't set Origin by default — this is the path taken by
    // every test in the existing auth suite, which is why `requireAuth` +
    // cookie flows keep working after adding the middleware.
    const res = await supertest(makeApp()).post('/protected').send({});
    expect(res.status).toBe(200);
  });

  it('allows POST when Referer matches allowedOrigin prefix + /', async () => {
    const res = await supertest(makeApp())
      .post('/protected')
      .set('Referer', `${ALLOWED}/app/login`)
      .send({});
    expect(res.status).toBe(200);
  });

  it('blocks POST with a Referer that only prefix-matches without /', async () => {
    // Guards against `https://evil.example?victim=https://allowed.example`
    // style tricks: the Referer must start with `${allowed}/`, not just
    // `${allowed}` (which could be a query string or subdomain substring).
    const res = await supertest(makeApp())
      .post('/protected')
      .set('Referer', `${ALLOWED}.evil.example/page`)
      .send({});
    expect(res.status).toBe(403);
  });

  it('blocks POST when only Referer is present and it does not match', async () => {
    const res = await supertest(makeApp())
      .post('/protected')
      .set('Referer', 'https://evil.example/page')
      .send({});
    expect(res.status).toBe(403);
  });

  it('lets GET through even with a bad Origin (safe methods exempt)', async () => {
    const res = await supertest(makeApp()).get('/protected').set('Origin', 'https://evil.example');
    expect(res.status).toBe(200);
  });
});
