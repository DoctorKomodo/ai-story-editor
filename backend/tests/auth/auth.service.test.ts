import bcrypt from 'bcryptjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BCRYPT_ROUNDS,
  createAuthService,
  EmailAlreadyRegisteredError,
} from '../../src/services/auth.service';
import { prisma } from '../setup';

const authService = createAuthService(prisma);

describe('auth.service register()', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await prisma.user.deleteMany();
  });

  it('creates a user with a bcryptjs hash at 12 rounds', async () => {
    const user = await authService.register({
      email: 'new-user@example.com',
      password: 'correct-horse-battery',
    });
    expect(user.id).toMatch(/^c[a-z0-9]+$/);
    expect(user.email).toBe('new-user@example.com');

    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    expect(stored).not.toBeNull();
    expect(stored!.passwordHash).not.toBe('correct-horse-battery');
    expect(stored!.passwordHash.startsWith('$2')).toBe(true);
    // bcrypt rounds are encoded as the third $-segment e.g. "$2a$12$..."
    const parts = stored!.passwordHash.split('$');
    expect(Number(parts[2])).toBe(BCRYPT_ROUNDS);
    expect(await bcrypt.compare('correct-horse-battery', stored!.passwordHash)).toBe(true);
  });

  it('omits passwordHash from the returned record', async () => {
    const user = await authService.register({
      email: 'hide-hash@example.com',
      password: 'at-least-eight',
    });
    expect(user).not.toHaveProperty('passwordHash');
    expect(Object.keys(user).sort()).toEqual(
      ['createdAt', 'email', 'id', 'updatedAt'].sort(),
    );
  });

  it('normalises email to lowercase and trims whitespace', async () => {
    const user = await authService.register({
      email: '  MixedCase@Example.COM  ',
      password: 'another-good-one',
    });
    expect(user.email).toBe('mixedcase@example.com');
  });

  it('rejects duplicate emails with EmailAlreadyRegisteredError', async () => {
    await authService.register({
      email: 'dup@example.com',
      password: 'first-password',
    });
    await expect(
      authService.register({ email: 'dup@example.com', password: 'second-password' }),
    ).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);
  });

  it('treats duplicates via the unique constraint as EmailAlreadyRegisteredError (no find-then-insert probe)', async () => {
    // Pre-seed the row directly so the service cannot observe it via a probe —
    // the only signal is the Prisma P2002 thrown from create().
    await prisma.user.create({
      data: {
        email: 'race@example.com',
        passwordHash: await bcrypt.hash('seeded-password', BCRYPT_ROUNDS),
      },
    });
    await expect(
      authService.register({ email: 'race@example.com', password: 'another-password' }),
    ).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);
  });

  it('rejects invalid email format', async () => {
    await expect(
      authService.register({ email: 'not-an-email', password: 'valid-password' }),
    ).rejects.toThrow();
  });

  it('rejects passwords shorter than 8 characters', async () => {
    await expect(
      authService.register({ email: 'short@example.com', password: 'abc' }),
    ).rejects.toThrow(/at least 8/i);
  });
});
