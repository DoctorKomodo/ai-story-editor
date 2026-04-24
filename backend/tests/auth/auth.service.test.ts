import * as argon2 from 'argon2';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuthService, UsernameUnavailableError } from '../../src/services/auth.service';
import { prisma } from '../setup';

const authService = createAuthService(prisma);

describe('auth.service register()', () => {
  beforeEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  it('creates a user with an argon2id password hash (post-[AU14])', async () => {
    const { user, recoveryCode } = await authService.register({
      name: 'New User',
      username: 'new-user',
      password: 'correct-horse-battery',
    });

    expect(user.id).toMatch(/^c[a-z0-9]+$/);
    expect(user.username).toBe('new-user');
    expect(user.name).toBe('New User');
    // [E3] — the plaintext recovery code is surfaced exactly once at signup.
    expect(recoveryCode).toMatch(
      /^[0-9A-HJKMNP-TV-Z]{8}-[0-9A-HJKMNP-TV-Z]{8}-[0-9A-HJKMNP-TV-Z]{8}-[0-9A-HJKMNP-TV-Z]{8}$/,
    );

    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    expect(stored).not.toBeNull();
    expect(stored!.passwordHash).not.toBe('correct-horse-battery');
    expect(stored!.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(await argon2.verify(stored!.passwordHash, 'correct-horse-battery')).toBe(true);
  });

  it('omits passwordHash from the returned user record', async () => {
    const { user } = await authService.register({
      name: 'Hidden',
      username: 'hide-hash',
      password: 'at-least-four',
    });
    expect(user).not.toHaveProperty('passwordHash');
    expect(Object.keys(user).sort()).toEqual(
      ['createdAt', 'email', 'id', 'name', 'updatedAt', 'username'].sort(),
    );
  });

  it('normalises username to lowercase and trims whitespace', async () => {
    const { user } = await authService.register({
      name: 'Mixed',
      username: '  MixedCase  ',
      password: 'another-good-one',
    });
    expect(user.username).toBe('mixedcase');
  });

  it('rejects duplicate usernames with UsernameUnavailableError', async () => {
    await authService.register({
      name: 'One',
      username: 'dup',
      password: 'first-password',
    });
    await expect(
      authService.register({ name: 'Two', username: 'dup', password: 'second-password' }),
    ).rejects.toBeInstanceOf(UsernameUnavailableError);
  });

  it('treats duplicates via the unique constraint as UsernameUnavailableError (no find-then-insert probe)', async () => {
    // Pre-seed the row directly so the service cannot observe it via a probe —
    // the only signal is the Prisma P2002 thrown from create().
    await prisma.user.create({
      data: {
        username: 'race',
        passwordHash: await argon2.hash('seeded-password'),
      },
    });
    await expect(
      authService.register({ name: 'Racer', username: 'race', password: 'another-password' }),
    ).rejects.toBeInstanceOf(UsernameUnavailableError);
  });

  it('rejects invalid username format', async () => {
    await expect(
      authService.register({ name: 'Bad', username: 'has spaces', password: 'valid' }),
    ).rejects.toThrow();
    await expect(
      authService.register({ name: 'Bad', username: 'a', password: 'valid' }),
    ).rejects.toThrow();
  });

  it('rejects missing name', async () => {
    await expect(
      authService.register({ name: '   ', username: 'noname', password: 'valid' }),
    ).rejects.toThrow(/name/i);
  });

  it('rejects passwords shorter than the env-gated minimum (test env → 4)', async () => {
    await expect(
      authService.register({ name: 'Short', username: 'short', password: 'abc' }),
    ).rejects.toThrow(/at least 4/i);
  });
});
