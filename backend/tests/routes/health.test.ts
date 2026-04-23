// [B6] Integration tests for GET /api/health.
//
// Covers:
//   - 200 happy path: `{ status: 'ok', db: 'connected' }` and real DB probe.
//   - 503 DB-down path: $queryRaw throws → `{ status: 'degraded', db: 'unreachable' }`.
//
// We spy on the exact prisma singleton the app imports from `src/lib/prisma.ts`.
// The ./setup export is a *different* PrismaClient (pinned to the test DB), so
// mocking that one wouldn't affect the route. `mockRejectedValueOnce` ensures
// subsequent calls (in other tests) fall through to the real implementation.

import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/index';
import { prisma as appPrisma } from '../../src/lib/prisma';

describe('GET /api/health', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 200 with status=ok and db=connected on healthy DB', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'connected' });
  });

  it('returns 503 with status=degraded and db=unreachable when DB is unreachable', async () => {
    const spy = vi
      .spyOn(appPrisma, '$queryRaw')
      .mockRejectedValueOnce(new Error('connection refused'));

    const res = await request(app).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'degraded', db: 'unreachable' });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('recovers to 200 on the next call after a transient DB error', async () => {
    vi.spyOn(appPrisma, '$queryRaw').mockRejectedValueOnce(new Error('blip'));

    const first = await request(app).get('/api/health');
    expect(first.status).toBe(503);

    const second = await request(app).get('/api/health');
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ status: 'ok', db: 'connected' });
  });
});
