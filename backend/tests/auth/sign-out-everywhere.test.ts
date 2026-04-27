// [B12] POST /api/auth/sign-out-everywhere — authenticated endpoint that
// deletes every refresh token belonging to the caller and clears the caller's
// refresh cookie. Used by F61 Account & Privacy.
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import { REFRESH_COOKIE_NAME } from '../../src/routes/auth.routes';
import { _resetSessionStore } from '../../src/services/session-store';
import { prisma } from '../setup';

const PASSWORD = 'correct-horse-battery';

async function registerAndLoginTwice(username: string): Promise<{
  firstAccessToken: string;
  firstRefreshCookie: string;
}> {
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ name: username, username, password: PASSWORD });
  expect(reg.status).toBe(201);

  const login1 = await request(app).post('/api/auth/login').send({ username, password: PASSWORD });
  expect(login1.status).toBe(200);
  const cookies1 = login1.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie1 = cookies1?.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
  expect(cookie1).toBeDefined();

  // Second login simulates a second tab/device.
  const login2 = await request(app).post('/api/auth/login').send({ username, password: PASSWORD });
  expect(login2.status).toBe(200);

  return {
    firstAccessToken: login1.body.accessToken as string,
    firstRefreshCookie: cookie1!,
  };
}

describe('[B12] POST /api/auth/sign-out-everywhere', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await prisma.session.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    _resetSessionStore();
    await prisma.session.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  it('returns 401 without a bearer token', async () => {
    const res = await request(app).post('/api/auth/sign-out-everywhere');
    expect(res.status).toBe(401);
  });

  it("204 on success — deletes all of the caller's refresh tokens, clears the cookie, leaves other users untouched", async () => {
    const alice = await registerAndLoginTwice('alice');
    await registerAndLoginTwice('bob');

    expect(await prisma.refreshToken.count({ where: { user: { username: 'alice' } } })).toBe(2);
    expect(await prisma.refreshToken.count({ where: { user: { username: 'bob' } } })).toBe(2);

    const res = await request(app)
      .post('/api/auth/sign-out-everywhere')
      .set('Authorization', `Bearer ${alice.firstAccessToken}`)
      .set('Cookie', alice.firstRefreshCookie);

    expect(res.status).toBe(204);
    expect(await prisma.refreshToken.count({ where: { user: { username: 'alice' } } })).toBe(0);
    expect(await prisma.refreshToken.count({ where: { user: { username: 'bob' } } })).toBe(2);

    // The response must clear the caller's refresh cookie.
    const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
    const cleared = setCookie?.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(/Max-Age=0|Expires=/i);
  });

  it('idempotent at the DB level: deleteMany on an already-empty refresh-token set is safe', async () => {
    const carol = await registerAndLoginTwice('carol');

    const first = await request(app)
      .post('/api/auth/sign-out-everywhere')
      .set('Authorization', `Bearer ${carol.firstAccessToken}`);
    expect(first.status).toBe(204);

    expect(await prisma.refreshToken.count({ where: { user: { username: 'carol' } } })).toBe(0);

    // The caller's session was closed by sign-out-everywhere, so the same
    // bearer token can no longer reach the route — it returns 401 from the
    // session-revoked branch in requireAuth, NOT a 500 from a hypothetical
    // double-delete. That's the externally observable property worth testing.
    const second = await request(app)
      .post('/api/auth/sign-out-everywhere')
      .set('Authorization', `Bearer ${carol.firstAccessToken}`);
    expect(second.status).toBe(401);
  });

  it("after sign-out-everywhere, refresh with the caller's old cookie returns 401", async () => {
    const dave = await registerAndLoginTwice('dave');

    const res = await request(app)
      .post('/api/auth/sign-out-everywhere')
      .set('Authorization', `Bearer ${dave.firstAccessToken}`)
      .set('Cookie', dave.firstRefreshCookie);
    expect(res.status).toBe(204);

    const refresh = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', dave.firstRefreshCookie);
    expect(refresh.status).toBe(401);
  });
});
