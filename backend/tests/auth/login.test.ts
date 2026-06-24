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
import { createAuthService, InvalidCredentialsError } from '../../src/services/auth.service';
import { _resetSessionStore, _sessionCount } from '../../src/services/session-store';
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
    _resetSessionStore();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    _resetSessionStore();
    await prisma.user.deleteMany();
  });

  it('returns a public user and a sessionId on valid credentials', async () => {
    await registerDefault();

    const result = await authService.login({ username: USERNAME, password: PASSWORD });

    expect(result.user.username).toBe(USERNAME);
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(typeof result.sessionId).toBe('string');
    expect(result.sessionId.length).toBeGreaterThan(10);
  });

  it('each login creates a distinct session in the in-memory store', async () => {
    await registerDefault();
    await authService.login({ username: USERNAME, password: PASSWORD });
    await authService.login({ username: USERNAME, password: PASSWORD });

    expect(_sessionCount()).toBe(2);
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
  });

  it('throws InvalidCredentialsError when the username is not registered', async () => {
    await expect(
      authService.login({ username: 'nobody', password: PASSWORD }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
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

    await authService.login({ username: 'ghost', password: PASSWORD }).catch(() => undefined);

    expect(verifyMock).toHaveBeenCalledTimes(1);
    const [hashArg] = verifyMock.mock.calls[0]!;
    expect(typeof hashArg).toBe('string');
    expect((hashArg as string).startsWith('$argon2id$')).toBe(true);
  });

  it('rejects a missing password with a zod validation error (not InvalidCredentialsError)', async () => {
    await expect(authService.login({ username: USERNAME, password: '' })).rejects.toThrow(
      /password is required/i,
    );
  });

  it('rejects a malformed username with a zod validation error', async () => {
    await expect(
      authService.login({ username: 'has spaces', password: PASSWORD }),
    ).rejects.toThrow();
  });
});
