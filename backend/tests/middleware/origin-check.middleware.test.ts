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

  it('blocks POST when neither Origin nor Referer is present (default-deny)', async () => {
    // Per OWASP CSRF Cheat Sheet: if neither Origin nor Referer is present on a
    // state-changing request, block it. Real browsers always send Origin on
    // POST/PUT/PATCH/DELETE; non-browser automation must now supply it explicitly.
    const res = await supertest(makeApp()).post('/protected').send({});
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: { message: 'Origin not allowed', code: 'csrf_block' },
    });
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

  describe('with a list of allowed origins', () => {
    const ALLOWED_LIST = ['http://localhost:3000', 'http://192.168.0.41:3000'] as const;

    function makeListApp() {
      const app = express();
      app.use(express.json());
      app.post('/protected', requireAllowedOrigin(ALLOWED_LIST), (_req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });
      return app;
    }

    it('allows POST with an Origin matching the first list entry', async () => {
      const res = await supertest(makeListApp())
        .post('/protected')
        .set('Origin', ALLOWED_LIST[0])
        .send({});
      expect(res.status).toBe(200);
    });

    it('allows POST with an Origin matching a non-first list entry', async () => {
      const res = await supertest(makeListApp())
        .post('/protected')
        .set('Origin', ALLOWED_LIST[1])
        .send({});
      expect(res.status).toBe(200);
    });

    it('blocks POST with an Origin not in the list', async () => {
      const res = await supertest(makeListApp())
        .post('/protected')
        .set('Origin', 'https://evil.example')
        .send({});
      expect(res.status).toBe(403);
    });

    it('allows POST with a Referer matching any list entry + /', async () => {
      const res = await supertest(makeListApp())
        .post('/protected')
        .set('Referer', `${ALLOWED_LIST[1]}/login`)
        .send({});
      expect(res.status).toBe(200);
    });

    it('blocks POST with a Referer that subdomain-prefixes a list entry', async () => {
      // Same subdomain-substring guard as the single-string case: the Referer
      // must start with `${entry}/`, not just `${entry}`. Verified for every
      // list entry, not only the first.
      const res = await supertest(makeListApp())
        .post('/protected')
        .set('Referer', `${ALLOWED_LIST[1]}.evil.example/page`)
        .send({});
      expect(res.status).toBe(403);
    });
  });
});
