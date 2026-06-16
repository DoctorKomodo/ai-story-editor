import * as argon2 from 'argon2';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createAuthService,
  InvalidCredentialsError,
  UsernameUnavailableError,
} from '../../src/services/auth.service';
import { _resetSessionStore, _sessionCount, getSession } from '../../src/services/session-store';
import { prisma } from '../setup';

const authService = createAuthService(prisma);

describe('auth.service register()', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
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

describe('auth.service login()', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    _resetSessionStore();
    await prisma.user.deleteMany();
  });

  it('login opens an in-memory session and returns only the user + sessionId', async () => {
    const { user: registered } = await authService.register({
      name: 'Session User',
      username: 'session-user',
      password: 'testpass',
    });

    const result = await authService.login({ username: 'session-user', password: 'testpass' });

    expect(result.user).toEqual(expect.objectContaining({ username: 'session-user' }));
    expect(typeof result.sessionId).toBe('string');
    expect(result.sessionId.length).toBeGreaterThan(0);
    // No JWT fields in the result
    expect(result).not.toHaveProperty('accessToken');
    expect(result).not.toHaveProperty('refreshToken');

    // A live session must exist in the in-memory store
    const session = getSession(result.sessionId);
    expect(session).not.toBeNull();
    expect(session!.userId).toBe(registered.id);
    expect(session!.dek).toBeInstanceOf(Buffer);
  });

  it('login throws InvalidCredentialsError for wrong password', async () => {
    await authService.register({
      name: 'User',
      username: 'wrong-pw-user',
      password: 'correct-pass',
    });
    await expect(
      authService.login({ username: 'wrong-pw-user', password: 'wrong-pass' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('login throws InvalidCredentialsError for unknown username', async () => {
    await expect(
      authService.login({ username: 'no-such-user', password: 'any-pass' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });
});

describe('auth.service changePassword()', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    _resetSessionStore();
    await prisma.user.deleteMany();
  });

  it('changePassword evicts all sessions then opens exactly one fresh session for the caller', async () => {
    const { user: registered } = await authService.register({
      name: 'Change PW',
      username: 'change-pw-user',
      password: 'old-password',
    });

    // Simulate two concurrent device logins
    const { sessionId: oldSession1 } = await authService.login({
      username: 'change-pw-user',
      password: 'old-password',
    });
    const { sessionId: oldSession2 } = await authService.login({
      username: 'change-pw-user',
      password: 'old-password',
    });

    const newSessionId = await authService.changePassword({
      userId: registered.id,
      oldPassword: 'old-password',
      newPassword: 'new-password',
    });

    // Both old sessions must be evicted
    expect(getSession(oldSession1)).toBeNull();
    expect(getSession(oldSession2)).toBeNull();

    // The fresh session must be live and owned by this user
    const newSession = getSession(newSessionId);
    expect(newSession).not.toBeNull();
    expect(newSession!.userId).toBe(registered.id);
    expect(newSession!.dek).toBeInstanceOf(Buffer);

    // It must be the ONLY live session (exactly one total in the store)
    expect(_sessionCount()).toBe(1);
  });

  it('changePassword returns the new sessionId as a string', async () => {
    const { user } = await authService.register({
      name: 'Return Check',
      username: 'return-check-user',
      password: 'old-pw',
    });

    const result = await authService.changePassword({
      userId: user.id,
      oldPassword: 'old-pw',
      newPassword: 'new-pw',
    });

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(getSession(result)).not.toBeNull();
  });

  it('changePassword throws InvalidCredentialsError for wrong old password', async () => {
    const { user } = await authService.register({
      name: 'Wrong PW',
      username: 'wrong-old-pw-user',
      password: 'correct-old',
    });

    await expect(
      authService.changePassword({
        userId: user.id,
        oldPassword: 'wrong-old',
        newPassword: 'new-pw',
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('changePassword preserves the DEK — new session can decrypt what the old session encrypted', async () => {
    // The unwrapped DEK is the same bytes before and after rewrap; verify by
    // checking that the new session's dek matches the one the old session held.
    const { user } = await authService.register({
      name: 'DEK Stable',
      username: 'dek-stable-user',
      password: 'old-dek-pw',
    });

    const { sessionId: oldId } = await authService.login({
      username: 'dek-stable-user',
      password: 'old-dek-pw',
    });
    const oldDek = getSession(oldId)!.dek;

    const newId = await authService.changePassword({
      userId: user.id,
      oldPassword: 'old-dek-pw',
      newPassword: 'new-dek-pw',
    });
    const newDek = getSession(newId)!.dek;

    // Same plaintext DEK — only the password-wrap changed
    expect(newDek.equals(oldDek)).toBe(true);
  });
});
