import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock must come before the service import so the service's `argon2.hash`
// calls route through the spy.
vi.mock('argon2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('argon2')>();
  return {
    ...actual,
    hash: vi.fn(actual.hash),
    verify: vi.fn(actual.verify),
  };
});

import * as argon2 from 'argon2';
import { app } from '../../src/index';
import { createAuthService, UsernameUnavailableError } from '../../src/services/auth.service';
import { prisma } from '../setup';

const authService = createAuthService(prisma);

describe('[AU9] register() — username-based signup supersede', () => {
  beforeEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  describe('input contract', () => {
    it('accepts { name, username, password } and persists the row', async () => {
      const { user, recoveryCode } = await authService.register({
        name: 'Quill Ashford',
        username: 'quill',
        password: 'strong-enough',
      });

      expect(user.name).toBe('Quill Ashford');
      expect(user.username).toBe('quill');
      expect(user.email).toBeNull();
      // [E3] the response carries the one-time recovery code.
      expect(recoveryCode).toMatch(
        /^[0-9A-HJKMNP-TV-Z]{8}-[0-9A-HJKMNP-TV-Z]{8}-[0-9A-HJKMNP-TV-Z]{8}-[0-9A-HJKMNP-TV-Z]{8}$/,
      );

      const stored = await prisma.user.findUnique({ where: { id: user.id } });
      expect(stored).not.toBeNull();
      expect(stored!.username).toBe('quill');
      expect(stored!.name).toBe('Quill Ashford');
      expect(stored!.email).toBeNull();
      // DEK wraps are persisted.
      expect(stored!.contentDekPasswordEnc).toBeTruthy();
      expect(stored!.contentDekPasswordSalt).toBeTruthy();
      expect(stored!.contentDekRecoveryEnc).toBeTruthy();
      expect(stored!.contentDekRecoverySalt).toBeTruthy();
    });

    it('trims + lowercases the username before storage', async () => {
      const { user } = await authService.register({
        name: 'Mixed',
        username: '  Mixed_Case-99  ',
        password: 'goodpass',
      });
      expect(user.username).toBe('mixed_case-99');
    });

    it('rejects usernames shorter than 3 chars', async () => {
      await expect(
        authService.register({ name: 'x', username: 'ab', password: 'goodpass' }),
      ).rejects.toThrow();
    });

    it('rejects usernames longer than 32 chars', async () => {
      await expect(
        authService.register({
          name: 'x',
          username: 'a'.repeat(33),
          password: 'goodpass',
        }),
      ).rejects.toThrow();
    });

    it('rejects usernames with disallowed characters', async () => {
      await expect(
        authService.register({ name: 'x', username: 'has.dot', password: 'goodpass' }),
      ).rejects.toThrow();
      await expect(
        authService.register({ name: 'x', username: 'has space', password: 'goodpass' }),
      ).rejects.toThrow();
      await expect(
        authService.register({ name: 'x', username: 'Hash#bang', password: 'goodpass' }),
      ).rejects.toThrow();
    });

    it('requires a non-empty name (trimmed)', async () => {
      await expect(
        authService.register({ name: '', username: 'nameless', password: 'goodpass' }),
      ).rejects.toThrow();
      await expect(
        authService.register({ name: '   ', username: 'nameless', password: 'goodpass' }),
      ).rejects.toThrow();
    });

    it('rejects names longer than 80 chars', async () => {
      await expect(
        authService.register({ name: 'a'.repeat(81), username: 'longname', password: 'goodpass' }),
      ).rejects.toThrow(/80/);
    });

    it('enforces password >= 4 chars in test env (production tightens to >= 8)', async () => {
      // Test env: accepts 4-char pw
      await expect(
        authService.register({ name: 'x', username: 'short-pw', password: '1234' }),
      ).resolves.toMatchObject({ user: { username: 'short-pw' } });

      // Production: rejects 4-char pw
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        await expect(
          authService.register({ name: 'x', username: 'prod-short', password: '1234' }),
        ).rejects.toThrow(/at least 8/i);
      } finally {
        process.env.NODE_ENV = prev;
      }
    });
  });

  describe('uniqueness + timing defence', () => {
    it('throws UsernameUnavailableError on duplicate username', async () => {
      await authService.register({ name: 'A', username: 'taken', password: 'goodpass' });

      await expect(
        authService.register({ name: 'B', username: 'taken', password: 'goodpass' }),
      ).rejects.toBeInstanceOf(UsernameUnavailableError);
    });

    it('runs argon2.hash the same number of times on happy + duplicate branches (timing defence)', async () => {
      // Each branch runs: 1× passwordHash + 2× wrap-key derivation (password
      // wrap + recovery wrap) in parallel, for a total of 3 argon2.hash calls.
      // The timing invariant is: happyCount === duplicateCount, regardless of
      // the exact number.
      const hashMock = vi.mocked(argon2.hash);
      hashMock.mockClear();

      await authService.register({ name: 'A', username: 'collide', password: 'goodpass' });
      const happyCount = hashMock.mock.calls.length;
      expect(happyCount).toBeGreaterThanOrEqual(1);

      hashMock.mockClear();
      await authService
        .register({ name: 'B', username: 'collide', password: 'goodpass' })
        .catch(() => undefined);

      expect(hashMock.mock.calls.length).toBe(happyCount);
    });

    it('does not leak the username in the error message (generic text only)', async () => {
      await authService.register({ name: 'A', username: 'secret-user', password: 'goodpass' });

      const err = await authService
        .register({ name: 'B', username: 'secret-user', password: 'goodpass' })
        .catch((e) => e);

      expect(err).toBeInstanceOf(UsernameUnavailableError);
      expect((err as Error).message).toBe('Username unavailable');
      expect((err as Error).message).not.toContain('secret-user');
    });
  });

  describe('POST /api/auth/register route contract', () => {
    it('returns 201 with { user, recoveryCode } on success', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Linnet', username: 'linnet', password: 'goodpass' });

      expect(res.status).toBe(201);
      expect(res.body.user.username).toBe('linnet');
      expect(res.body.user.name).toBe('Linnet');
      expect(res.body).toHaveProperty('recoveryCode');
      // [E3] — the plaintext recovery code is surfaced exactly once.
      expect(res.body.recoveryCode).toMatch(
        /^[0-9A-HJKMNP-TV-Z]{8}-[0-9A-HJKMNP-TV-Z]{8}-[0-9A-HJKMNP-TV-Z]{8}-[0-9A-HJKMNP-TV-Z]{8}$/,
      );
      expect(res.body.user).not.toHaveProperty('passwordHash');
    });

    it('returns 409 { error: { code: "username_unavailable" } } on duplicate username', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({ name: 'A', username: 'routes-dup', password: 'goodpass' });

      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'B', username: 'routes-dup', password: 'goodpass' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('username_unavailable');
      expect(res.body.error.message).toBe('Username unavailable');
      // Generic body must not echo the username
      expect(JSON.stringify(res.body)).not.toContain('routes-dup');
    });

    it('returns 400 with validation_error code on bad input', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: '', username: 'ok', password: 'ok' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
    });
  });
});
