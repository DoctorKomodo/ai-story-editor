// [AU16] POST /api/auth/reset-password — unauthenticated recovery-code flow
// that rewraps the content DEK under a new password. Timing and response
// body are identical for "unknown user" and "wrong recovery code" so the
// endpoint isn't a username-enumeration oracle.
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import {
  unwrapDekWithPassword,
  unwrapDekWithRecoveryCode,
} from '../../src/services/content-crypto.service';
import { _resetSessionStore } from '../../src/services/session-store';
import { prisma } from '../setup';

const NAME = 'Reset User';
const USERNAME = 'reset-user';
const PASSWORD = 'correct-horse-battery';
const NEW_PASSWORD = 'new-horse-battery-staple';

async function registerAndCaptureRecovery(): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: NAME, username: USERNAME, password: PASSWORD });
  expect(res.status).toBe(201);
  expect(typeof res.body.recoveryCode).toBe('string');
  return res.body.recoveryCode as string;
}

describe('[AU16] POST /api/auth/reset-password', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await prisma.session.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    _resetSessionStore();
    await prisma.session.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  it('returns 400 on missing or malformed body', async () => {
    const empty = await request(app).post('/api/auth/reset-password').send({});
    expect(empty.status).toBe(400);

    await registerAndCaptureRecovery();
    const shortPw = await request(app)
      .post('/api/auth/reset-password')
      .send({ username: USERNAME, recoveryCode: 'anything', newPassword: 'a' });
    expect(shortPw.status).toBe(400);
  });

  it('returns 401 for an unknown username AND for a wrong recovery code with identical body', async () => {
    await registerAndCaptureRecovery();
    const unknownUser = await request(app)
      .post('/api/auth/reset-password')
      .send({ username: 'does-not-exist', recoveryCode: 'WRONG-CODE-HERE', newPassword: NEW_PASSWORD });
    const wrongCode = await request(app)
      .post('/api/auth/reset-password')
      .send({ username: USERNAME, recoveryCode: 'WRONG-CODE-HERE', newPassword: NEW_PASSWORD });

    expect(unknownUser.status).toBe(401);
    expect(wrongCode.status).toBe(401);
    expect(unknownUser.body).toEqual(wrongCode.body);
    expect(wrongCode.body.error.code).toBe('invalid_credentials');
  });

  it('happy path: 204, password hash + password wrap rotate, DEK preserved, old password fails', async () => {
    const recoveryCode = await registerAndCaptureRecovery();
    const before = await prisma.user.findUniqueOrThrow({ where: { username: USERNAME } });
    const originalDek = await unwrapDekWithRecoveryCode(before, recoveryCode);

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ username: USERNAME, recoveryCode, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(204);

    const after = await prisma.user.findUniqueOrThrow({ where: { username: USERNAME } });
    expect(after.passwordHash).not.toBe(before.passwordHash);
    expect(after.contentDekPasswordEnc).not.toBe(before.contentDekPasswordEnc);

    // The DEK itself is unchanged — the new password unwraps to the same bytes.
    const unwrapped = await unwrapDekWithPassword(after, NEW_PASSWORD);
    expect(unwrapped.equals(originalDek)).toBe(true);

    // Old password no longer unwraps.
    await expect(unwrapDekWithPassword(after, PASSWORD)).rejects.toThrow();
  });

  it('leaves the recovery wrap unchanged (the old recovery code still works after reset)', async () => {
    const recoveryCode = await registerAndCaptureRecovery();
    const before = await prisma.user.findUniqueOrThrow({ where: { username: USERNAME } });

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ username: USERNAME, recoveryCode, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(204);

    const after = await prisma.user.findUniqueOrThrow({ where: { username: USERNAME } });
    expect(after.contentDekRecoveryEnc).toBe(before.contentDekRecoveryEnc);
    expect(after.contentDekRecoveryIv).toBe(before.contentDekRecoveryIv);
    expect(after.contentDekRecoveryAuthTag).toBe(before.contentDekRecoveryAuthTag);
    expect(after.contentDekRecoverySalt).toBe(before.contentDekRecoverySalt);
  });

  it('deletes all refresh tokens and sessions for the user', async () => {
    const recoveryCode = await registerAndCaptureRecovery();
    await request(app).post('/api/auth/login').send({ username: USERNAME, password: PASSWORD });
    await request(app).post('/api/auth/login').send({ username: USERNAME, password: PASSWORD });

    const user = await prisma.user.findUniqueOrThrow({ where: { username: USERNAME } });
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBeGreaterThanOrEqual(2);

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ username: USERNAME, recoveryCode, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(204);

    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it('empty / idempotent response body — neither password nor recovery code is echoed', async () => {
    const recoveryCode = await registerAndCaptureRecovery();
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ username: USERNAME, recoveryCode, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(204);
    expect(res.text).not.toContain(NEW_PASSWORD);
    expect(res.text).not.toContain(recoveryCode);
  });

  it('accepts lowercased-only username lookup (input is normalised before lookup)', async () => {
    const recoveryCode = await registerAndCaptureRecovery();
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ username: USERNAME.toUpperCase(), recoveryCode, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(204);
  });

  it('does not touch narrative ciphertext on existing story rows for the user', async () => {
    const recoveryCode = await registerAndCaptureRecovery();
    const user = await prisma.user.findUniqueOrThrow({ where: { username: USERNAME } });
    const story = await prisma.story.create({
      data: {
        userId: user.id,
        title: 'plaintext-title',
        titleCiphertext: 'FAKE_CIPHER',
        titleIv: 'FAKE_IV',
        titleAuthTag: 'FAKE_TAG',
      },
    });

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ username: USERNAME, recoveryCode, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(204);

    const after = await prisma.story.findUniqueOrThrow({ where: { id: story.id } });
    expect(after.titleCiphertext).toBe(story.titleCiphertext);
    expect(after.titleIv).toBe(story.titleIv);
    expect(after.titleAuthTag).toBe(story.titleAuthTag);
  });

  it('timing is within an order of magnitude across unknown-user and wrong-code branches', async () => {
    // Two populations must be timing-indistinguishable: caller-unknown and
    // caller-known-but-wrong-code. Distinct usernames per sample keep each
    // call in a fresh per-username rate-limit bucket — otherwise a 429
    // short-circuit would measure the limiter instead of the crypto path.
    const samples = 3;
    const knownUsernames: string[] = [];
    for (let i = 0; i < samples + 1; i += 1) {
      const u = `timing-known-${i}`;
      await request(app).post('/api/auth/register').send({ name: 'T', username: u, password: PASSWORD });
      knownUsernames.push(u);
    }

    async function timedCall(username: string): Promise<number> {
      const start = process.hrtime.bigint();
      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ username, recoveryCode: 'DEFINITELY-NOT-THE-CODE', newPassword: NEW_PASSWORD });
      const end = process.hrtime.bigint();
      // A 429 would short-circuit well before argon2id runs and silently
      // skew this test toward a false pass. Surface any limiter interference
      // as a hard failure instead.
      expect(res.status).not.toBe(429);
      return Number(end - start) / 1_000_000;
    }

    // Warm — one of each branch so the dummy-wrap cache, argon2 workers,
    // and JIT are all primed.
    await timedCall('timing-unknown-warm');
    await timedCall(knownUsernames[0]);

    const unknowns: number[] = [];
    const knowns: number[] = [];
    for (let i = 0; i < samples; i += 1) {
      unknowns.push(await timedCall(`timing-unknown-${i}`));
      knowns.push(await timedCall(knownUsernames[i + 1]));
    }
    const median = (xs: number[]): number => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const mU = median(unknowns);
    const mK = median(knowns);
    const ratio = Math.max(mU, mK) / Math.max(1, Math.min(mU, mK));
    if (ratio >= 5) {
      console.log('unknowns ms:', unknowns, 'median', mU);
      console.log('knowns   ms:', knowns, 'median', mK);
    }
    expect(ratio).toBeLessThan(5);
  }, 45_000);
});
