import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import { REFRESH_COOKIE_NAME } from '../../src/routes/auth.routes';
import {
  type AccessTokenPayload,
  createAuthService,
  InvalidRefreshTokenError,
  REFRESH_TOKEN_TTL_SECONDS,
  type RefreshTokenPayload,
} from '../../src/services/auth.service';
import { prisma } from '../setup';

const authService = createAuthService(prisma);
const NAME = 'Refresh User';
const USERNAME = 'refresh-user';
const PASSWORD = 'correct-horse-battery';

function parseCookieValue(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const eq = header.indexOf('=');
  const semi = header.indexOf(';');
  return header.slice(eq + 1, semi === -1 ? header.length : semi);
}

function getCookie(headers: Record<string, unknown>): string | undefined {
  const raw = headers['set-cookie'] as string[] | undefined;
  return raw?.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
}

async function registerAndLogin(): Promise<{
  accessToken: string;
  cookie: string;
  token: string;
  userId: string;
}> {
  const reg = await authService.register({ name: NAME, username: USERNAME, password: PASSWORD });
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ username: USERNAME, password: PASSWORD });
  const cookie = getCookie(loginRes.headers as Record<string, unknown>);
  expect(cookie).toBeDefined();
  return {
    accessToken: loginRes.body.accessToken,
    cookie: cookie!,
    token: parseCookieValue(cookie)!,
    userId: reg.user.id,
  };
}

describe('auth.service refresh()', () => {
  beforeEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  it('issues a new access + refresh token, and rotates the refresh row atomically', async () => {
    const { token, userId } = await registerAndLogin();

    const result = await authService.refresh(token);

    // new access token verifies and encodes the user id
    const accessPayload = jwt.verify(
      result.accessToken,
      process.env.JWT_SECRET!,
    ) as AccessTokenPayload;
    expect(accessPayload.sub).toBe(userId);

    // new refresh token is different from the old one
    expect(result.refreshToken).not.toBe(token);

    // rotation: exactly one refresh row left, pointing at the new token
    const rows = await prisma.refreshToken.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token).toBe(result.refreshToken);
    expect(rows[0]!.userId).toBe(userId);

    const refreshPayload = jwt.verify(
      result.refreshToken,
      process.env.REFRESH_TOKEN_SECRET!,
    ) as RefreshTokenPayload & { iat: number; exp: number };
    expect(refreshPayload.type).toBe('refresh');
    expect(refreshPayload.exp - refreshPayload.iat).toBe(REFRESH_TOKEN_TTL_SECONDS);
  });

  it('rejects a tampered JWT with InvalidRefreshTokenError', async () => {
    await registerAndLogin();
    await expect(authService.refresh('not-a-jwt')).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });

  it('rejects a refresh token that is valid JWT but not in the DB (revoked / already rotated)', async () => {
    const { token } = await registerAndLogin();

    // Rotate once — the original token row is now gone.
    await authService.refresh(token);

    // Replaying the original token must fail, even though its JWT signature is valid.
    await expect(authService.refresh(token)).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });

  it('rejects an expired refresh row even if the JWT signature is valid', async () => {
    const { token } = await registerAndLogin();

    await prisma.refreshToken.updateMany({
      where: { token },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    await expect(authService.refresh(token)).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });

  it('rejects a JWT signed with the wrong secret', async () => {
    const forged = jwt.sign({ sub: 'cxxx', type: 'refresh', jti: 'x' }, 'wrong-secret');
    await expect(authService.refresh(forged)).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });

  it('rejects a token with alg:none (algorithm-confusion defence)', async () => {
    // Hand-craft an unsigned JWT and assert verify() refuses it thanks to the
    // algorithms: ['HS256'] pin.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: 'cxxx', type: 'refresh', jti: 'x' }),
    ).toString('base64url');
    const unsigned = `${header}.${payload}.`;

    await expect(authService.refresh(unsigned)).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });

  it('rejects an empty / non-string input', async () => {
    await expect(authService.refresh('')).rejects.toBeInstanceOf(InvalidRefreshTokenError);
    await expect(authService.refresh(undefined)).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });
});

describe('POST /api/auth/refresh', () => {
  beforeEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  it('returns a new access token and sets a new refresh cookie', async () => {
    const { cookie } = await registerAndLogin();

    const res = await request(app).post('/api/auth/refresh').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe('string');

    const newCookie = getCookie(res.headers as Record<string, unknown>);
    expect(newCookie).toBeDefined();
    expect(parseCookieValue(newCookie)).not.toBe(parseCookieValue(cookie));
  });

  it('returns 401 without a refresh cookie', async () => {
    const res = await request(app).post('/api/auth/refresh');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_refresh');
  });

  it('returns 401 and clears the cookie on a replayed / revoked refresh token', async () => {
    const { cookie } = await registerAndLogin();
    // Use once, rotate.
    await request(app).post('/api/auth/refresh').set('Cookie', cookie);

    const res = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(res.status).toBe(401);

    const clearCookie = getCookie(res.headers as Record<string, unknown>);
    expect(clearCookie).toBeDefined();
    expect(clearCookie!.toLowerCase()).toMatch(/max-age=0|expires=thu, 01 jan 1970/);
  });
});
