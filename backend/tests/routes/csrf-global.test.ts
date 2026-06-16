// Integration tests for global CSRF origin-check and no-store middleware.
//
// Self-contained: does not depend on shared test helpers (those become
// cookie-aware in a later task). Imports `app` directly.
//
// Covers:
//   - POST with a forged Origin → 403 csrf_block (rejected before requireAuth)
//   - POST with no Origin → 403 csrf_block
//   - GET /api/health carries Cache-Control: no-store

import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../../src/index';

describe('global CSRF origin-check (requireAllowedOrigin on /api)', () => {
  it('blocks a POST from a foreign Origin with 403 csrf_block', async () => {
    const res = await request(app)
      .post('/api/stories')
      .set('Origin', 'https://evil.example')
      .send({ title: 'Pwn attempt' });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: { code: 'csrf_block' } });
  });

  it('blocks a POST with no Origin header with 403 csrf_block', async () => {
    const res = await request(app).post('/api/stories').send({ title: 'No origin' });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: { code: 'csrf_block' } });
  });
});

describe('no-store Cache-Control on /api responses', () => {
  it('GET /api/health carries Cache-Control: no-store', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
