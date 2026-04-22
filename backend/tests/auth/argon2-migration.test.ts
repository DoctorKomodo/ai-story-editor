import * as argon2 from 'argon2';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import {
  BCRYPT_ROUNDS,
  createAuthService,
  hashPassword,
  verifyPassword,
} from '../../src/services/auth.service';
import { prisma } from '../setup';

const authService = createAuthService(prisma);

const NAME = 'Migration Test';
const USERNAME = 'migrate-me';
const PASSWORD = 'legacy-password';

describe('[AU14] argon2id migration path', () => {
  beforeEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  describe('hashPassword / verifyPassword primitives', () => {
    it('hashPassword produces an argon2id string', async () => {
      const hash = await hashPassword('some-password');
      expect(hash.startsWith('$argon2id$')).toBe(true);
    });

    it('verifyPassword returns ok=true for matching argon2id hash', async () => {
      const hash = await hashPassword('some-password');
      const result = await verifyPassword(hash, 'some-password');
      expect(result).toEqual({ ok: true, needsRehash: false });
    });

    it('verifyPassword returns ok=false for mismatching argon2id hash', async () => {
      const hash = await hashPassword('some-password');
      const result = await verifyPassword(hash, 'wrong-password');
      expect(result.ok).toBe(false);
      expect(result.needsRehash).toBe(false);
    });

    it('verifyPassword returns needsRehash=true for a legacy bcrypt hash (correct password)', async () => {
      const legacyHash = await bcrypt.hash('legacy-password', BCRYPT_ROUNDS);
      expect(legacyHash.startsWith('$2')).toBe(true);

      const result = await verifyPassword(legacyHash, 'legacy-password');
      expect(result).toEqual({ ok: true, needsRehash: true });
    });

    it('verifyPassword returns needsRehash=false for a legacy bcrypt hash (wrong password)', async () => {
      const legacyHash = await bcrypt.hash('legacy-password', BCRYPT_ROUNDS);
      const result = await verifyPassword(legacyHash, 'wrong-password');
      expect(result).toEqual({ ok: false, needsRehash: false });
    });

    it('verifyPassword fails closed on an unknown hash format', async () => {
      const result = await verifyPassword('plaintext-not-a-hash', 'anything');
      expect(result).toEqual({ ok: false, needsRehash: false });
    });
  });

  describe('new registrations always use argon2id', () => {
    it('register() persists an argon2id hash', async () => {
      const { user } = await authService.register({
        name: NAME,
        username: USERNAME,
        password: PASSWORD,
      });

      const stored = await prisma.user.findUnique({ where: { id: user.id } });
      expect(stored!.passwordHash.startsWith('$argon2id$')).toBe(true);
      expect(await argon2.verify(stored!.passwordHash, PASSWORD)).toBe(true);
    });
  });

  describe('login-time bcrypt → argon2id migration', () => {
    async function seedLegacyBcryptUser(): Promise<string> {
      const legacyHash = await bcrypt.hash(PASSWORD, BCRYPT_ROUNDS);
      const user = await prisma.user.create({
        data: {
          name: NAME,
          username: USERNAME,
          passwordHash: legacyHash,
        },
      });
      return user.id;
    }

    it('a user with a bcrypt hash can still log in', async () => {
      await seedLegacyBcryptUser();

      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: USERNAME, password: PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
    });

    it('after a successful bcrypt-login, the stored hash is silently upgraded to argon2id', async () => {
      const userId = await seedLegacyBcryptUser();

      const before = await prisma.user.findUnique({ where: { id: userId } });
      expect(before!.passwordHash.startsWith('$2')).toBe(true);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: USERNAME, password: PASSWORD });
      expect(res.status).toBe(200);

      const after = await prisma.user.findUnique({ where: { id: userId } });
      expect(after!.passwordHash).not.toBe(before!.passwordHash);
      expect(after!.passwordHash.startsWith('$argon2id$')).toBe(true);
      // And argon2 can verify the new hash against the same password.
      expect(await argon2.verify(after!.passwordHash, PASSWORD)).toBe(true);
    });

    it('a failed bcrypt-login does NOT upgrade the hash (only successful logins migrate)', async () => {
      const userId = await seedLegacyBcryptUser();
      const before = await prisma.user.findUnique({ where: { id: userId } });

      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: USERNAME, password: 'wrong-password' });
      expect(res.status).toBe(401);

      const after = await prisma.user.findUnique({ where: { id: userId } });
      expect(after!.passwordHash).toBe(before!.passwordHash);
      expect(after!.passwordHash.startsWith('$2')).toBe(true);
    });

    it('an argon2id-hashed user logging in does NOT trigger a rehash', async () => {
      const { user } = await authService.register({
        name: NAME,
        username: USERNAME,
        password: PASSWORD,
      });
      const before = await prisma.user.findUnique({ where: { id: user.id } });

      await request(app).post('/api/auth/login').send({ username: USERNAME, password: PASSWORD });

      const after = await prisma.user.findUnique({ where: { id: user.id } });
      // Hash remains byte-identical since re-hashing would produce a different
      // salt and therefore a different hash string.
      expect(after!.passwordHash).toBe(before!.passwordHash);
    });
  });
});
