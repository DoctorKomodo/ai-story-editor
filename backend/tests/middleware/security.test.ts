import express from 'express';
import rateLimit from 'express-rate-limit';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import '../setup';

describe('security middleware', () => {
  describe('helmet', () => {
    it('sets core security headers on every response', async () => {
      const res = await request(app).get('/api/health');

      expect(res.status).toBe(200);
      // A handful of the headers helmet adds by default.
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-dns-prefetch-control']).toBeDefined();
      expect(res.headers['x-frame-options']).toBeDefined();
      // helmet removes Express's default x-powered-by fingerprint.
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('CORS', () => {
    it('echoes the FRONTEND_URL origin for same-origin credentialed requests', async () => {
      const res = await request(app)
        .get('/api/health')
        .set('Origin', process.env.FRONTEND_URL ?? 'http://localhost:3000');

      expect(res.headers['access-control-allow-origin']).toBe(
        process.env.FRONTEND_URL ?? 'http://localhost:3000',
      );
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('does not set Access-Control-Allow-Origin for a non-matching origin', async () => {
      const res = await request(app).get('/api/health').set('Origin', 'http://evil.example.com');

      // Strict: the header must be absent — not echoed, not wildcarded, not null.
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('rate limit on /api/ai/*', () => {
    // Build a mirror of the production limiter in an isolated app so we don't
    // exhaust the singleton limiter baked into src/index.ts's app and poison
    // other tests that hit /api/ai.
    function makeLimiterApp() {
      const mini = express();
      mini.use(
        '/api/ai',
        rateLimit({
          windowMs: 60_000,
          limit: 20,
          standardHeaders: 'draft-7',
          legacyHeaders: false,
        }),
      );
      // Express 5 / path-to-regexp@8 requires named splat: `/api/ai/{*rest}`.
      mini.all('/api/ai/{*rest}', (_req, res) => res.json({ ok: true }));
      mini.all('/api/health', (_req, res) => res.json({ ok: true }));
      return mini;
    }

    it('allows the first 20 requests and 429s the 21st', async () => {
      const mini = makeLimiterApp();

      for (let i = 0; i < 20; i += 1) {
        const ok = await request(mini).get('/api/ai/anything');
        expect(ok.status).toBe(200);
      }

      const blocked = await request(mini).get('/api/ai/anything');
      expect(blocked.status).toBe(429);
    });

    it('emits draft-7 RateLimit-* headers', async () => {
      const mini = makeLimiterApp();
      const res = await request(mini).get('/api/ai/anything');

      // standardHeaders: 'draft-7' produces headers like `RateLimit` and `RateLimit-Policy`.
      expect(res.headers.ratelimit).toBeDefined();
      expect(res.headers['ratelimit-policy']).toBeDefined();
      // Legacy headers must be off per config.
      expect(res.headers['x-ratelimit-limit']).toBeUndefined();
    });

    it('does not apply the /api/ai limiter to unrelated routes', async () => {
      const mini = makeLimiterApp();

      // Hammer the health route; limiter is scoped to /api/ai only.
      for (let i = 0; i < 40; i += 1) {
        const res = await request(mini).get('/api/health');
        expect(res.status).toBe(200);
      }
    });
  });
});
