import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import { REFRESH_COOKIE_NAME } from '../../src/routes/auth.routes';
import type { AccessTokenPayload } from '../../src/services/auth.service';
import { prisma } from '../setup';

const NAME = 'Routes User';
const USERNAME = 'routes-user';
const PASSWORD = 'correct-horse-battery';

function getRefreshCookie(setCookieHeader: string[] | undefined): string | undefined {
  return setCookieHeader?.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
}

async function registerAndLogin(): Promise<{
  accessToken: string;
  refreshCookie: string | undefined;
}> {
  await request(app)
    .post('/api/auth/register')
    .send({ name: NAME, username: USERNAME, password: PASSWORD });
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ username: USERNAME, password: PASSWORD });
  expect(loginRes.status).toBe(200);
  return {
    accessToken: loginRes.body.accessToken,
    refreshCookie: getRefreshCookie(
      loginRes.headers['set-cookie'] as unknown as string[] | undefined,
    ),
  };
}

describe('auth routes', () => {
  beforeEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  describe('POST /api/auth/register', () => {
    it('creates a user and returns 201 with the public user record plus recoveryCode field', async () => {
      const res = await request(app)
        .post('/api/auth/register')
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
        .send({ name: NAME, username: USERNAME, password: PASSWORD });

      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Second', username: USERNAME, password: 'another-password' });

      expect(res.status).toBe(409);
      expect(res.body.error.message).toBe('Username unavailable');
      expect(JSON.stringify(res.body)).not.toContain(USERNAME);
    });

    it('returns 400 on invalid input (malformed username)', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: NAME, username: 'has spaces', password: PASSWORD });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
    });

    it('returns 400 on short password (test env minimum is 4)', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: NAME, username: USERNAME, password: 'a' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/auth/login', () => {
    it('returns 200 with accessToken and sets an httpOnly refreshToken cookie', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({ name: NAME, username: USERNAME, password: PASSWORD });

      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: USERNAME, password: PASSWORD });

      expect(res.status).toBe(200);
      expect(typeof res.body.accessToken).toBe('string');
      expect(res.body.user.username).toBe(USERNAME);
      expect(res.body.user).not.toHaveProperty('passwordHash');

      const cookie = getRefreshCookie(res.headers['set-cookie'] as unknown as string[] | undefined);
      expect(cookie).toBeDefined();
      expect(cookie!.toLowerCase()).toContain('httponly');
      expect(cookie!.toLowerCase()).toContain('samesite=lax');

      const decoded = jwt.verify(
        res.body.accessToken,
        process.env.JWT_SECRET!,
      ) as AccessTokenPayload;
      expect(decoded.username).toBe(USERNAME);

      expect(await prisma.refreshToken.count()).toBe(1);
    });

    it('returns 401 with identical body for wrong password and unknown username', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({ name: NAME, username: USERNAME, password: PASSWORD });

      const wrongPassword = await request(app)
        .post('/api/auth/login')
        .send({ username: USERNAME, password: 'wrong' });
      const unknownUser = await request(app)
        .post('/api/auth/login')
        .send({ username: 'nobody', password: PASSWORD });

      expect(wrongPassword.status).toBe(401);
      expect(unknownUser.status).toBe(401);
      expect(wrongPassword.body).toEqual(unknownUser.body);
      expect(wrongPassword.body.error.message).toBe('Invalid credentials');
    });

    it('returns 400 on malformed input', async () => {
      const res = await request(app).post('/api/auth/login').send({});
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('clears the refresh cookie and deletes the refresh token row', async () => {
      const { refreshCookie } = await registerAndLogin();
      expect(refreshCookie).toBeDefined();
      expect(await prisma.refreshToken.count()).toBe(1);

      const res = await request(app).post('/api/auth/logout').set('Cookie', refreshCookie!);

      expect(res.status).toBe(204);
      expect(await prisma.refreshToken.count()).toBe(0);

      const clearCookie = getRefreshCookie(
        res.headers['set-cookie'] as unknown as string[] | undefined,
      );
      expect(clearCookie).toBeDefined();
      expect(clearCookie!.toLowerCase()).toMatch(/max-age=0|expires=thu, 01 jan 1970/);
    });

    it('returns 204 even when no cookie is present (idempotent)', async () => {
      const res = await request(app).post('/api/auth/logout');
      expect(res.status).toBe(204);
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns 401 without a Bearer token', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('unauthorized');
    });

    it('returns 401 with a malformed token', async () => {
      const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer not-a-jwt');
      expect(res.status).toBe(401);
    });

    it('returns 401 with a JWT signed by the wrong secret', async () => {
      await registerAndLogin();
      const rogueToken = jwt.sign(
        { sub: 'whatever', email: null, username: USERNAME },
        'totally-different-secret',
        {
          expiresIn: 60,
        },
      );
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${rogueToken}`);
      expect(res.status).toBe(401);
    });

    it('returns the user record with a valid access token', async () => {
      const { accessToken } = await registerAndLogin();
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.user.username).toBe(USERNAME);
      expect(res.body.user.name).toBe(NAME);
      expect(res.body.user).not.toHaveProperty('passwordHash');
    });

    it('returns 401 when the referenced user has been deleted', async () => {
      const { accessToken } = await registerAndLogin();
      await prisma.refreshToken.deleteMany();
      await prisma.user.deleteMany();

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(401);
    });
  });
});
