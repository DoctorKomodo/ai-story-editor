// [AU15] POST /api/auth/change-password — authenticated password change that
// rewraps the content DEK under the new password, invalidates all sessions,
// and never touches narrative ciphertext.
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import { REFRESH_COOKIE_NAME } from '../../src/routes/auth.routes';
import { unwrapDekWithPassword } from '../../src/services/content-crypto.service';
import { _resetSessionStore } from '../../src/services/session-store';
import { prisma } from '../setup';

const NAME = 'Change Password User';
const USERNAME = 'change-pw-user';
const PASSWORD = 'correct-horse-battery';
const NEW_PASSWORD = 'new-horse-battery-staple';

async function registerAndLogin(): Promise<{ accessToken: string; refreshCookie: string }>
{
  await request(app)
    .post('/api/auth/register')
    .send({ name: NAME, username: USERNAME, password: PASSWORD });
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
  };
}

describe('[AU15] POST /api/auth/change-password', () => {
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
      .post('/api/auth/change-password')
      .send({ oldPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(401);
  });

  it('returns 400 on missing or malformed body', async () => {
    const { accessToken } = await registerAndLogin();
    const missing = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({});
    expect(missing.status).toBe(400);

    const tooShort = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ oldPassword: PASSWORD, newPassword: 'a' });
    expect(tooShort.status).toBe(400);
  });

  it('returns 401 on wrong old password', async () => {
    const { accessToken } = await registerAndLogin();
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ oldPassword: 'not-my-password', newPassword: NEW_PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_credentials');
  });

  it('happy path: 204, passwordHash + password wrap rotate, new password unwraps DEK, old does not', async () => {
    const { accessToken } = await registerAndLogin();

    const before = await prisma.user.findUniqueOrThrow({ where: { username: USERNAME } });
    const originalDek = await unwrapDekWithPassword(before, PASSWORD);

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ oldPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(204);

    const after = await prisma.user.findUniqueOrThrow({ where: { username: USERNAME } });
    expect(after.passwordHash).not.toBe(before.passwordHash);
    expect(after.contentDekPasswordEnc).not.toBe(before.contentDekPasswordEnc);
    expect(after.contentDekPasswordSalt).not.toBe(before.contentDekPasswordSalt);

    const unwrappedWithNew = await unwrapDekWithPassword(after, NEW_PASSWORD);
    expect(unwrappedWithNew.equals(originalDek)).toBe(true);

    await expect(unwrapDekWithPassword(after, PASSWORD)).rejects.toThrow();
  });

  it('leaves the recovery wrap unchanged (recovery code still unlocks the same DEK)', async () => {
    const { accessToken } = await registerAndLogin();
    const before = await prisma.user.findUniqueOrThrow({ where: { username: USERNAME } });

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ oldPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(204);

    const after = await prisma.user.findUniqueOrThrow({ where: { username: USERNAME } });
    expect(after.contentDekRecoveryEnc).toBe(before.contentDekRecoveryEnc);
    expect(after.contentDekRecoveryIv).toBe(before.contentDekRecoveryIv);
    expect(after.contentDekRecoveryAuthTag).toBe(before.contentDekRecoveryAuthTag);
    expect(after.contentDekRecoverySalt).toBe(before.contentDekRecoverySalt);
  });

  it('deletes all refresh tokens and sessions for the user (forces re-login elsewhere)', async () => {
    const { accessToken } = await registerAndLogin();
    // Open a second session from a different "device"
    await request(app)
      .post('/api/auth/login')
      .send({ username: USERNAME, password: PASSWORD });

    const rtBefore = await prisma.refreshToken.count();
    const sBefore = await prisma.session.count();
    expect(rtBefore).toBeGreaterThanOrEqual(2);
    expect(sBefore).toBeGreaterThanOrEqual(2);

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ oldPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(204);

    const user = await prisma.user.findUniqueOrThrow({ where: { username: USERNAME } });
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it('does not echo either password and returns an empty body', async () => {
    const { accessToken } = await registerAndLogin();
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ oldPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(204);
    const bodyText = typeof res.body === 'object' ? JSON.stringify(res.body) : String(res.body ?? '');
    expect(bodyText).not.toContain(PASSWORD);
    expect(bodyText).not.toContain(NEW_PASSWORD);
    expect(res.text).not.toContain(PASSWORD);
    expect(res.text).not.toContain(NEW_PASSWORD);
    // No new cookies set by change-password (user re-logs in separately).
    const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
    expect(cookies).toBeUndefined();
  });

  it('does not touch any narrative ciphertext on other rows for the user', async () => {
    const { accessToken } = await registerAndLogin();
    const user = await prisma.user.findUniqueOrThrow({ where: { username: USERNAME } });

    // Insert a Story row with sentinel ciphertext values. The repo layer is
    // not used here intentionally — we want to assert the raw bytes are
    // untouched by the password-change path.
    const story = await prisma.story.create({
      data: {
        userId: user.id,
        titleCiphertext: 'FAKE_CIPHER_TITLE',
        titleIv: 'FAKE_IV_TITLE',
        titleAuthTag: 'FAKE_TAG_TITLE',
        synopsisCiphertext: 'FAKE_CIPHER_SYN',
        synopsisIv: 'FAKE_IV_SYN',
        synopsisAuthTag: 'FAKE_TAG_SYN',
      },
    });

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ oldPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(204);

    const after = await prisma.story.findUniqueOrThrow({ where: { id: story.id } });
    expect(after.titleCiphertext).toBe(story.titleCiphertext);
    expect(after.titleIv).toBe(story.titleIv);
    expect(after.titleAuthTag).toBe(story.titleAuthTag);
    expect(after.synopsisCiphertext).toBe(story.synopsisCiphertext);
    expect(after.synopsisIv).toBe(story.synopsisIv);
    expect(after.synopsisAuthTag).toBe(story.synopsisAuthTag);
  });
});
