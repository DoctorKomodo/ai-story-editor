// [AU17] POST /api/auth/rotate-recovery-code — authenticated endpoint that
// issues a fresh recovery code and rewraps the recovery wrap of the user's
// content DEK. Password wrap, password hash, narrative ciphertext, and active
// sessions are all untouched.
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import { REFRESH_COOKIE_NAME } from '../../src/routes/auth.routes';
import {
  InvalidRecoveryCodeError,
  unwrapDekWithPassword,
  unwrapDekWithRecoveryCode,
} from '../../src/services/content-crypto.service';
import { _resetSessionStore } from '../../src/services/session-store';
import { prisma } from '../setup';

const NAME = 'Rotate Recovery User';
const USERNAME = 'rotate-recovery-user';
const PASSWORD = 'correct-horse-battery';

async function registerAndLogin(): Promise<{
  accessToken: string;
  refreshCookie: string;
  recoveryCode: string;
}> {
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ name: NAME, username: USERNAME, password: PASSWORD });
  expect(reg.status).toBe(201);
  const recoveryCode = reg.body.recoveryCode as string;
  expect(typeof recoveryCode).toBe('string');

  const login = await request(app)
    .post('/api/auth/login')
    .send({ username: USERNAME, password: PASSWORD });
  expect(login.status).toBe(200);
  const cookies = login.headers['set-cookie'] as unknown as string[] | undefined;
  const refreshCookie = cookies?.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
  expect(refreshCookie).toBeDefined();
  return {
    accessToken: login.body.accessToken as string,
    refreshCookie: refreshCookie!,
    recoveryCode,
  };
}

describe('[AU17] POST /api/auth/rotate-recovery-code', () => {
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

  it('returns 401 without a bearer token', async () => {
    const res = await request(app)
      .post('/api/auth/rotate-recovery-code')
      .send({ password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it('returns 400 on missing or malformed body', async () => {
    const { accessToken } = await registerAndLogin();
    const missing = await request(app)
      .post('/api/auth/rotate-recovery-code')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({});
    expect(missing.status).toBe(400);
  });

  it('returns 401 on wrong password', async () => {
    const { accessToken } = await registerAndLogin();
    const res = await request(app)
      .post('/api/auth/rotate-recovery-code')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ password: 'not-my-password' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_credentials');
  });

  it('happy path: 200, returns a fresh recoveryCode + warning, recovery wrap rotates, new code unwraps to the same DEK, old code no longer works', async () => {
    const { accessToken, recoveryCode: oldRecoveryCode } = await registerAndLogin();

    const before = await prisma.user.findUniqueOrThrow({ where: { username: USERNAME } });
    const dekBefore = await unwrapDekWithRecoveryCode(before, oldRecoveryCode);

    const res = await request(app)
      .post('/api/auth/rotate-recovery-code')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ password: PASSWORD });
    expect(res.status).toBe(200);

    const newRecoveryCode = res.body.recoveryCode as string;
    expect(typeof newRecoveryCode).toBe('string');
    expect(newRecoveryCode.length).toBeGreaterThan(0);
    expect(newRecoveryCode).not.toBe(oldRecoveryCode);
    // Body must warn that the code is shown exactly once.
    const envelopeText = JSON.stringify(res.body).toLowerCase();
    expect(envelopeText).toMatch(/shown|again|once|save/);

    const after = await prisma.user.findUniqueOrThrow({ where: { username: USERNAME } });
    expect(after.contentDekRecoveryEnc).not.toBe(before.contentDekRecoveryEnc);
    expect(after.contentDekRecoverySalt).not.toBe(before.contentDekRecoverySalt);

    // New code unwraps the same DEK.
    const dekAfter = await unwrapDekWithRecoveryCode(after, newRecoveryCode);
    expect(dekAfter.equals(dekBefore)).toBe(true);

    // Old code no longer unwraps.
    await expect(unwrapDekWithRecoveryCode(after, oldRecoveryCode)).rejects.toBeInstanceOf(
      InvalidRecoveryCodeError,
    );
  });

  it('leaves the password wrap and password hash untouched', async () => {
    const { accessToken } = await registerAndLogin();
    const before = await prisma.user.findUniqueOrThrow({ where: { username: USERNAME } });

    const res = await request(app)
      .post('/api/auth/rotate-recovery-code')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ password: PASSWORD });
    expect(res.status).toBe(200);

    const after = await prisma.user.findUniqueOrThrow({ where: { username: USERNAME } });
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.contentDekPasswordEnc).toBe(before.contentDekPasswordEnc);
    expect(after.contentDekPasswordIv).toBe(before.contentDekPasswordIv);
    expect(after.contentDekPasswordAuthTag).toBe(before.contentDekPasswordAuthTag);
    expect(after.contentDekPasswordSalt).toBe(before.contentDekPasswordSalt);
    // Current password still unwraps the DEK.
    await expect(unwrapDekWithPassword(after, PASSWORD)).resolves.toBeInstanceOf(Buffer);
  });

  it('does not log out the caller — refresh tokens and sessions for the user remain intact', async () => {
    const { accessToken } = await registerAndLogin();
    // Open a second session from a different "device" so we can assert both
    // survive the rotation.
    const secondLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: USERNAME, password: PASSWORD });
    expect(secondLogin.status).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { username: USERNAME } });
    const rtBefore = await prisma.refreshToken.count({ where: { userId: user.id } });
    const sBefore = await prisma.session.count({ where: { userId: user.id } });
    expect(rtBefore).toBeGreaterThanOrEqual(2);
    expect(sBefore).toBeGreaterThanOrEqual(2);

    const res = await request(app)
      .post('/api/auth/rotate-recovery-code')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ password: PASSWORD });
    expect(res.status).toBe(200);

    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(rtBefore);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(sBefore);
  });

  it('does not echo the password and does not set a new cookie', async () => {
    const { accessToken } = await registerAndLogin();
    const res = await request(app)
      .post('/api/auth/rotate-recovery-code')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(PASSWORD);
    const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
    expect(cookies).toBeUndefined();
  });

  it('does not touch narrative ciphertext on existing story rows for the user', async () => {
    const { accessToken } = await registerAndLogin();
    const user = await prisma.user.findUniqueOrThrow({ where: { username: USERNAME } });

    const story = await prisma.story.create({
      data: {
        userId: user.id,
        title: 'plaintext-title',
        titleCiphertext: 'FAKE_CIPHER_TITLE',
        titleIv: 'FAKE_IV_TITLE',
        titleAuthTag: 'FAKE_TAG_TITLE',
        synopsisCiphertext: 'FAKE_CIPHER_SYN',
        synopsisIv: 'FAKE_IV_SYN',
        synopsisAuthTag: 'FAKE_TAG_SYN',
      },
    });

    const res = await request(app)
      .post('/api/auth/rotate-recovery-code')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ password: PASSWORD });
    expect(res.status).toBe(200);

    const after = await prisma.story.findUniqueOrThrow({ where: { id: story.id } });
    expect(after.titleCiphertext).toBe(story.titleCiphertext);
    expect(after.titleIv).toBe(story.titleIv);
    expect(after.titleAuthTag).toBe(story.titleAuthTag);
    expect(after.synopsisCiphertext).toBe(story.synopsisCiphertext);
    expect(after.synopsisIv).toBe(story.synopsisIv);
    expect(after.synopsisAuthTag).toBe(story.synopsisAuthTag);
  });

  it('per-user rate limiter is wired — successful response carries RateLimit headers', async () => {
    // A functional smoke-test: we don't exhaust the limit (that would make the
    // test environment fragile), but we verify that the standard rate-limit
    // headers (draft-7) are present on a successful request, which confirms
    // the changePasswordLimiter() middleware is attached to the route.
    //
    // express-rate-limit with standardHeaders: 'draft-7' sets a combined
    // 'RateLimit' header (lowercase 'ratelimit' in supertest) and a
    // 'RateLimit-Policy' header ('ratelimit-policy' in supertest).
    const { accessToken } = await registerAndLogin();
    const res = await request(app)
      .post('/api/auth/rotate-recovery-code')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.headers).toHaveProperty('ratelimit-policy');
    expect(res.headers).toHaveProperty('ratelimit');
  });

  it('a second rotation invalidates the first freshly-issued code', async () => {
    const { accessToken } = await registerAndLogin();

    const first = await request(app)
      .post('/api/auth/rotate-recovery-code')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ password: PASSWORD });
    expect(first.status).toBe(200);
    const firstCode = first.body.recoveryCode as string;

    const second = await request(app)
      .post('/api/auth/rotate-recovery-code')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ password: PASSWORD });
    expect(second.status).toBe(200);
    const secondCode = second.body.recoveryCode as string;
    expect(secondCode).not.toBe(firstCode);

    const after = await prisma.user.findUniqueOrThrow({ where: { username: USERNAME } });
    await expect(unwrapDekWithRecoveryCode(after, firstCode)).rejects.toBeInstanceOf(
      InvalidRecoveryCodeError,
    );
    await expect(unwrapDekWithRecoveryCode(after, secondCode)).resolves.toBeInstanceOf(Buffer);
  });
});
