import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import { sessionCookieName } from '../../src/lib/session-cookie';
import { _resetSessionStore } from '../../src/services/session-store';
import { prisma } from '../setup';

const NAME = 'Routes User';
const USERNAME = 'routes-user';
const PASSWORD = 'correct-horse-battery';

function getSessionCookie(setCookieHeader: string[] | undefined): string | undefined {
  const name = sessionCookieName();
  return setCookieHeader?.find((c) => c.startsWith(`${name}=`));
}

async function registerAndLogin(): Promise<{
  agent: ReturnType<typeof request.agent>;
  sessionCookie: string | undefined;
}> {
  const agent = request.agent(app);
  await agent
    .post('/api/auth/register')
    .set('Origin', 'http://localhost:3000')
    .send({ name: NAME, username: USERNAME, password: PASSWORD });
  const loginRes = await agent
    .post('/api/auth/login')
    .set('Origin', 'http://localhost:3000')
    .send({ username: USERNAME, password: PASSWORD });
  expect(loginRes.status).toBe(200);
  return {
    agent,
    sessionCookie: getSessionCookie(
      loginRes.headers['set-cookie'] as unknown as string[] | undefined,
    ),
  };
}

describe('auth routes', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    _resetSessionStore();
    await prisma.user.deleteMany();
  });

  describe('POST /api/auth/register', () => {
    it('creates a user and returns 201 with the public user record plus recoveryCode field', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .set('Origin', 'http://localhost:3000')
        .send({ name: NAME, username: USERNAME, password: PASSWORD });

      expect(res.status).toBe(201);
      expect(res.body.user.username).toBe(USERNAME);
      expect(res.body.user.name).toBe(NAME);
      expect(res.body.user).not.toHaveProperty('passwordHash');
      // Pre-E3 the recovery code is null but the field exists so the frontend
      // signup flow can key off its presence without probing for E3-readiness.
      expect(res.body).toHaveProperty('recoveryCode');
      expect(await prisma.user.count()).toBe(1);
    });

    it('returns 409 with a generic message on duplicate username and does not echo the username', async () => {
      await request(app)
        .post('/api/auth/register')
        .set('Origin', 'http://localhost:3000')
        .send({ name: NAME, username: USERNAME, password: PASSWORD });

      const res = await request(app)
        .post('/api/auth/register')
        .set('Origin', 'http://localhost:3000')
        .send({ name: 'Second', username: USERNAME, password: 'another-password' });

      expect(res.status).toBe(409);
      expect(res.body.error.message).toBe('Username unavailable');
      expect(JSON.stringify(res.body)).not.toContain(USERNAME);
    });

    it('returns 400 on invalid input (malformed username)', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .set('Origin', 'http://localhost:3000')
        .send({ name: NAME, username: 'has spaces', password: PASSWORD });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
    });

    it('returns 400 on short password (test env minimum is 4)', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .set('Origin', 'http://localhost:3000')
        .send({ name: NAME, username: USERNAME, password: 'a' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/auth/login', () => {
    it('returns 200 with user and sets an httpOnly session cookie', async () => {
      await request(app)
        .post('/api/auth/register')
        .set('Origin', 'http://localhost:3000')
        .send({ name: NAME, username: USERNAME, password: PASSWORD });

      const res = await request(app)
        .post('/api/auth/login')
        .set('Origin', 'http://localhost:3000')
        .send({ username: USERNAME, password: PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.user.username).toBe(USERNAME);
      expect(res.body.user).not.toHaveProperty('passwordHash');
      expect(res.body).not.toHaveProperty('accessToken');

      const cookie = getSessionCookie(res.headers['set-cookie'] as unknown as string[] | undefined);
      expect(cookie).toBeDefined();
      expect(cookie!.toLowerCase()).toContain('httponly');
      expect(cookie!.toLowerCase()).toContain('samesite=lax');
    });

    it('returns 401 with identical body for wrong password and unknown username', async () => {
      await request(app)
        .post('/api/auth/register')
        .set('Origin', 'http://localhost:3000')
        .send({ name: NAME, username: USERNAME, password: PASSWORD });

      const wrongPassword = await request(app)
        .post('/api/auth/login')
        .set('Origin', 'http://localhost:3000')
        .send({ username: USERNAME, password: 'wrong' });
      const unknownUser = await request(app)
        .post('/api/auth/login')
        .set('Origin', 'http://localhost:3000')
        .send({ username: 'nobody', password: PASSWORD });

      expect(wrongPassword.status).toBe(401);
      expect(unknownUser.status).toBe(401);
      expect(wrongPassword.body).toEqual(unknownUser.body);
      expect(wrongPassword.body.error.message).toBe('Invalid credentials');
    });

    it('returns 400 on malformed input', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .set('Origin', 'http://localhost:3000')
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('clears the session cookie and evicts the session', async () => {
      const { agent, sessionCookie } = await registerAndLogin();
      expect(sessionCookie).toBeDefined();

      const res = await agent.post('/api/auth/logout').set('Origin', 'http://localhost:3000');

      expect(res.status).toBe(204);

      const clearCookie = getSessionCookie(
        res.headers['set-cookie'] as unknown as string[] | undefined,
      );
      expect(clearCookie).toBeDefined();
      expect(clearCookie!.toLowerCase()).toMatch(/max-age=0|expires=thu, 01 jan 1970/);

      // Prove the session was actually evicted server-side, not just that the
      // browser was told to drop the cookie: a follow-up authed request 401s.
      const followUp = await agent.get('/api/auth/me');
      expect(followUp.status).toBe(401);
    });

    it('returns 204 even when no cookie is present (idempotent)', async () => {
      const res = await request(app)
        .post('/api/auth/logout')
        .set('Origin', 'http://localhost:3000');
      expect(res.status).toBe(204);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('returns 404 — endpoint has been removed', async () => {
      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Origin', 'http://localhost:3000');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/auth/change-password', () => {
    it('returns 204 and re-sets the session cookie with a fresh session id', async () => {
      const { agent, sessionCookie } = await registerAndLogin();
      expect(sessionCookie).toBeDefined();

      const res = await agent
        .post('/api/auth/change-password')
        .set('Origin', 'http://localhost:3000')
        .send({ oldPassword: PASSWORD, newPassword: 'new-correct-horse' });

      expect(res.status).toBe(204);

      const freshCookie = getSessionCookie(
        res.headers['set-cookie'] as unknown as string[] | undefined,
      );
      expect(freshCookie).toBeDefined();
      expect(freshCookie!.toLowerCase()).toContain('httponly');
      // The new session cookie must differ from the original (session was re-minted).
      const oldValue = sessionCookie!.split(';')[0];
      const newValue = freshCookie!.split(';')[0];
      expect(newValue).not.toBe(oldValue);
    });

    it('returns 401 on wrong old password', async () => {
      const { agent } = await registerAndLogin();

      const res = await agent
        .post('/api/auth/change-password')
        .set('Origin', 'http://localhost:3000')
        .send({ oldPassword: 'wrong-old', newPassword: 'new-correct-horse' });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('invalid_credentials');
    });

    it('returns 401 without a session cookie', async () => {
      const res = await request(app)
        .post('/api/auth/change-password')
        .set('Origin', 'http://localhost:3000')
        .send({ oldPassword: PASSWORD, newPassword: 'new-correct-horse' });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns 401 without a session cookie', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('unauthorized');
    });

    it('returns 401 when the session id is not in the store', async () => {
      const name = sessionCookieName();
      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', `${name}=not-a-real-session-id`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('session_expired');
    });

    it('returns the user record with a valid session cookie', async () => {
      const { agent } = await registerAndLogin();
      const res = await agent.get('/api/auth/me');

      expect(res.status).toBe(200);
      expect(res.body.user.username).toBe(USERNAME);
      expect(res.body.user.name).toBe(NAME);
      expect(res.body.user).not.toHaveProperty('passwordHash');
    });

    it('returns 401 when the referenced user has been deleted', async () => {
      const { agent } = await registerAndLogin();
      // Delete the user from the DB; the in-memory session still exists, so
      // requireAuth passes, but the /me handler finds no user row and 401s.
      await prisma.user.deleteMany();

      const res = await agent.get('/api/auth/me');
      expect(res.status).toBe(401);
    });
  });
});
