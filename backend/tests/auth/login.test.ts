import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('argon2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('argon2')>();
  return {
    ...actual,
    hash: vi.fn(actual.hash),
    verify: vi.fn(actual.verify),
  };
});

import * as argon2 from 'argon2';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  createAuthService,
  InvalidCredentialsError,
  type AccessTokenPayload,
  type RefreshTokenPayload,
} from '../../src/services/auth.service';
import { prisma } from '../setup';

const authService = createAuthService(prisma);

const NAME = 'Login User';
const USERNAME = 'login-user';
const PASSWORD = 'correct-horse-battery';

async function registerDefault(): Promise<void> {
  await authService.register({ name: NAME, username: USERNAME, password: PASSWORD });
}

describe('auth.service login()', () => {
  beforeEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  it('returns a public user plus access + refresh tokens on valid credentials', async () => {
    await registerDefault();

    const result = await authService.login({ username: USERNAME, password: PASSWORD });

    expect(result.user.username).toBe(USERNAME);
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(typeof result.accessToken).toBe('string');
    expect(result.accessToken.length).toBeGreaterThan(10);
    expect(typeof result.refreshToken).toBe('string');
    expect(result.refreshToken.length).toBeGreaterThan(10);
  });

  it('signs an access token with JWT_SECRET that contains the user id and expires in ~15 minutes', async () => {
    await registerDefault();
    const result = await authService.login({ username: USERNAME, password: PASSWORD });

    const decoded = jwt.verify(
      result.accessToken,
      process.env.JWT_SECRET!,
    ) as AccessTokenPayload & { iat: number; exp: number };

    expect(decoded.sub).toBe(result.user.id);
    expect(decoded.username).toBe(USERNAME);
    expect(decoded.exp - decoded.iat).toBe(ACCESS_TOKEN_TTL_SECONDS);

    // accessTokenExpiresAt reported by the service lines up with the JWT exp
    // within a second (accounts for elapsed time during the call).
    const reportedExp = Math.floor(result.accessTokenExpiresAt.getTime() / 1000);
    expect(Math.abs(reportedExp - decoded.exp)).toBeLessThanOrEqual(2);
  });

  it('signs a refresh token with REFRESH_TOKEN_SECRET, marks it type=refresh, and uses a random jti', async () => {
    await registerDefault();

    const a = await authService.login({ username: USERNAME, password: PASSWORD });
    const b = await authService.login({ username: USERNAME, password: PASSWORD });

    const payloadA = jwt.verify(
      a.refreshToken,
      process.env.REFRESH_TOKEN_SECRET!,
    ) as RefreshTokenPayload & { iat: number; exp: number };
    const payloadB = jwt.verify(
      b.refreshToken,
      process.env.REFRESH_TOKEN_SECRET!,
    ) as RefreshTokenPayload & { iat: number; exp: number };

    expect(payloadA.type).toBe('refresh');
    expect(payloadB.type).toBe('refresh');
    expect(payloadA.sub).toBe(a.user.id);
    expect(payloadA.jti).not.toBe(payloadB.jti);
    expect(payloadA.exp - payloadA.iat).toBe(REFRESH_TOKEN_TTL_SECONDS);
  });

  it('persists the refresh token in the RefreshToken table with a ~7 day expiry', async () => {
    await registerDefault();
    const result = await authService.login({ username: USERNAME, password: PASSWORD });

    const stored = await prisma.refreshToken.findUnique({
      where: { token: result.refreshToken },
    });
    expect(stored).not.toBeNull();
    expect(stored!.userId).toBe(result.user.id);

    const sevenDaysMs = REFRESH_TOKEN_TTL_SECONDS * 1000;
    const delta = Math.abs(stored!.expiresAt.getTime() - (Date.now() + sevenDaysMs));
    expect(delta).toBeLessThanOrEqual(5_000);
  });

  it('never rejects the refresh token as a duplicate — each login issues a fresh row', async () => {
    await registerDefault();
    await authService.login({ username: USERNAME, password: PASSWORD });
    await authService.login({ username: USERNAME, password: PASSWORD });

    const count = await prisma.refreshToken.count();
    expect(count).toBe(2);
  });

  it('normalises the username (trim + lowercase) before lookup', async () => {
    await registerDefault();

    const result = await authService.login({
      username: `  ${USERNAME.toUpperCase()}  `,
      password: PASSWORD,
    });

    expect(result.user.username).toBe(USERNAME);
  });

  it('throws InvalidCredentialsError when the password is wrong', async () => {
    await registerDefault();

    await expect(
      authService.login({ username: USERNAME, password: 'totally-wrong' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    expect(await prisma.refreshToken.count()).toBe(0);
  });

  it('throws InvalidCredentialsError when the username is not registered', async () => {
    await expect(
      authService.login({ username: 'nobody', password: PASSWORD }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    expect(await prisma.refreshToken.count()).toBe(0);
  });

  it('uses the same error message for "unknown username" and "wrong password" (no enumeration)', async () => {
    await registerDefault();

    const wrongUser = await authService
      .login({ username: 'nobody', password: PASSWORD })
      .catch((err: unknown) => err);
    const wrongPassword = await authService
      .login({ username: USERNAME, password: 'incorrect' })
      .catch((err: unknown) => err);

    expect(wrongUser).toBeInstanceOf(InvalidCredentialsError);
    expect(wrongPassword).toBeInstanceOf(InvalidCredentialsError);
    expect((wrongUser as Error).message).toBe((wrongPassword as Error).message);
  });

  it('runs argon2.verify against a dummy argon2id hash when the username is unknown (timing-equalisation)', async () => {
    const verifyMock = vi.mocked(argon2.verify);
    verifyMock.mockClear();

    await authService
      .login({ username: 'ghost', password: PASSWORD })
      .catch(() => undefined);

    expect(verifyMock).toHaveBeenCalledTimes(1);
    const [hashArg] = verifyMock.mock.calls[0]!;
    expect(typeof hashArg).toBe('string');
    expect((hashArg as string).startsWith('$argon2id$')).toBe(true);
  });

  it('rejects a missing password with a zod validation error (not InvalidCredentialsError)', async () => {
    await expect(
      authService.login({ username: USERNAME, password: '' }),
    ).rejects.toThrow(/password is required/i);
  });

  it('rejects a malformed username with a zod validation error', async () => {
    await expect(
      authService.login({ username: 'has spaces', password: PASSWORD }),
    ).rejects.toThrow();
  });
});
