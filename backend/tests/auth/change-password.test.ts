// [AU15] POST /api/auth/change-password — authenticated password change that
// rewraps the content DEK under the new password, invalidates all sessions,
// and never touches narrative ciphertext.
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import { unwrapDekWithPassword } from '../../src/services/content-crypto.service';
import { _resetSessionStore, _sessionCount } from '../../src/services/session-store';
import { prisma } from '../setup';

const NAME = 'Change Password User';
const USERNAME = 'change-pw-user';
const PASSWORD = 'correct-horse-battery';
const NEW_PASSWORD = 'new-horse-battery-staple';
const TEST_ORIGIN = 'http://localhost:3000';

async function registerAndLogin(): Promise<{
  agent: ReturnType<typeof request.agent>;
  sessionId: string;
  userId: string;
}> {
  const agent = request.agent(app);
  const reg = await agent
    .post('/api/auth/register')
    .set('Origin', TEST_ORIGIN)
    .send({ name: NAME, username: USERNAME, password: PASSWORD });
  expect(reg.status).toBe(201);
  const login = await agent
    .post('/api/auth/login')
    .set('Origin', TEST_ORIGIN)
    .send({ username: USERNAME, password: PASSWORD });
  expect(login.status).toBe(200);
  const raw = login.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = (raw ?? []).find((c) => c.startsWith('session='));
  expect(cookie).toBeDefined();
  const sessionId = decodeURIComponent(cookie!.split(';')[0].split('=')[1]);
  return { agent, sessionId, userId: login.body.user.id as string };
}

describe('[AU15] POST /api/auth/change-password', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    _resetSessionStore();
    await prisma.user.deleteMany();
  });

  it('returns 401 without a bearer token', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Origin', TEST_ORIGIN)
      .send({ oldPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(401);
  });

  it('returns 400 on missing or malformed body', async () => {
    const { agent } = await registerAndLogin();
    const missing = await agent
      .post('/api/auth/change-password')
      .set('Origin', TEST_ORIGIN)
      .send({});
    expect(missing.status).toBe(400);

    const tooShort = await agent
      .post('/api/auth/change-password')
      .set('Origin', TEST_ORIGIN)
      .send({ oldPassword: PASSWORD, newPassword: 'a' });
    expect(tooShort.status).toBe(400);
  });

  it('returns 401 on wrong old password', async () => {
    const { agent } = await registerAndLogin();
    const res = await agent
      .post('/api/auth/change-password')
      .set('Origin', TEST_ORIGIN)
      .send({ oldPassword: 'not-my-password', newPassword: NEW_PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_credentials');
  });

  it('happy path: 204, passwordHash + password wrap rotate, new password unwraps DEK, old does not', async () => {
    const { agent } = await registerAndLogin();

    const before = await prisma.user.findUniqueOrThrow({ where: { username: USERNAME } });
    const originalDek = await unwrapDekWithPassword(before, PASSWORD);

    const res = await agent
      .post('/api/auth/change-password')
      .set('Origin', TEST_ORIGIN)
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
    const { agent } = await registerAndLogin();
    const before = await prisma.user.findUniqueOrThrow({ where: { username: USERNAME } });

    const res = await agent
      .post('/api/auth/change-password')
      .set('Origin', TEST_ORIGIN)
      .send({ oldPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(204);

    const after = await prisma.user.findUniqueOrThrow({ where: { username: USERNAME } });
    expect(after.contentDekRecoveryEnc).toBe(before.contentDekRecoveryEnc);
    expect(after.contentDekRecoveryIv).toBe(before.contentDekRecoveryIv);
    expect(after.contentDekRecoveryAuthTag).toBe(before.contentDekRecoveryAuthTag);
    expect(after.contentDekRecoverySalt).toBe(before.contentDekRecoverySalt);
  });

  it('evicts all other sessions and opens exactly one new session for the user', async () => {
    const { agent } = await registerAndLogin();
    // Open a second session from a different "device".
    const agent2 = request.agent(app);
    const login2 = await agent2
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ username: USERNAME, password: PASSWORD });
    expect(login2.status).toBe(200);

    // Two sessions exist before change-password.
    expect(_sessionCount()).toBeGreaterThanOrEqual(2);

    const res = await agent
      .post('/api/auth/change-password')
      .set('Origin', TEST_ORIGIN)
      .send({ oldPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(204);

    // change-password evicts all sessions and mints exactly one new one.
    expect(_sessionCount()).toBe(1);
  });

  it('does not echo either password in the body', async () => {
    const { agent } = await registerAndLogin();
    const res = await agent
      .post('/api/auth/change-password')
      .set('Origin', TEST_ORIGIN)
      .send({ oldPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(204);
    const bodyText =
      typeof res.body === 'object' ? JSON.stringify(res.body) : String(res.body ?? '');
    expect(bodyText).not.toContain(PASSWORD);
    expect(bodyText).not.toContain(NEW_PASSWORD);
    expect(res.text).not.toContain(PASSWORD);
    expect(res.text).not.toContain(NEW_PASSWORD);
    // The route re-mints the session cookie after a successful password change.
    const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
    const sessionCookie = (cookies ?? []).find((c) => c.startsWith('session='));
    expect(sessionCookie).toBeDefined();
  });

  it('does not touch any narrative ciphertext on other rows for the user', async () => {
    const { agent, userId } = await registerAndLogin();

    // Insert a Story row with sentinel ciphertext values. The repo layer is
    // not used here intentionally — we want to assert the raw bytes are
    // untouched by the password-change path.
    const story = await prisma.story.create({
      data: {
        userId,
        titleCiphertext: 'FAKE_CIPHER_TITLE',
        titleIv: 'FAKE_IV_TITLE',
        titleAuthTag: 'FAKE_TAG_TITLE',
        synopsisCiphertext: 'FAKE_CIPHER_SYN',
        synopsisIv: 'FAKE_IV_SYN',
        synopsisAuthTag: 'FAKE_TAG_SYN',
      },
    });

    const res = await agent
      .post('/api/auth/change-password')
      .set('Origin', TEST_ORIGIN)
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
