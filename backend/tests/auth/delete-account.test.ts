// [X3] DELETE /api/auth/delete-account — authenticated destructive endpoint
// that re-verifies the user's password, deletes the user (cascading to all
// narrative entities, refresh tokens, sessions, DEK wraps), and clears the
// caller's refresh cookie.
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import { REFRESH_COOKIE_NAME } from '../../src/routes/auth.routes';
import { _resetSessionStore } from '../../src/services/session-store';
import { prisma } from '../setup';

const PASSWORD = 'correct-horse-battery';

async function registerAndLogin(username: string): Promise<{
  accessToken: string;
  refreshCookie: string;
  userId: string;
}> {
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ name: username, username, password: PASSWORD });
  expect(reg.status).toBe(201);

  const login = await request(app).post('/api/auth/login').send({ username, password: PASSWORD });
  expect(login.status).toBe(200);
  const cookies = login.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = cookies?.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
  expect(cookie).toBeDefined();
  return {
    accessToken: login.body.accessToken as string,
    refreshCookie: cookie!,
    userId: login.body.user.id as string,
  };
}

describe('[X3] DELETE /api/auth/delete-account', () => {
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
    const res = await request(app).delete('/api/auth/delete-account').send({ password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it('returns 400 when the password is missing from the body', async () => {
    const alice = await registerAndLogin('alice');
    const res = await request(app)
      .delete('/api/auth/delete-account')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({});
    expect(res.status).toBe(400);
    expect(await prisma.user.count({ where: { id: alice.userId } })).toBe(1);
  });

  it('returns 401 with the same body shape as change-password on wrong password', async () => {
    const alice = await registerAndLogin('alice');
    const res = await request(app)
      .delete('/api/auth/delete-account')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ password: 'not-the-right-password' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { message: 'Invalid credentials', code: 'invalid_credentials' },
    });
    // User still exists.
    expect(await prisma.user.count({ where: { id: alice.userId } })).toBe(1);
  });

  it('204 on success — deletes the user, cascades to stories/chapters/characters/outline/chats/messages, drops refresh tokens + sessions, leaves other users untouched, and clears the cookie', async () => {
    const alice = await registerAndLogin('alice');
    const bob = await registerAndLogin('bob');

    // Seed alice with one of every narrative entity to confirm the cascade.
    // Post-[E11]: narrative columns are nullable ciphertext-only — minimal
    // rows with just the structural plaintext fields are sufficient. The
    // delete path doesn't read them; we only need enough of a row to count.
    const story = await prisma.story.create({
      data: { userId: alice.userId },
    });
    const chapter = await prisma.chapter.create({
      data: { storyId: story.id, orderIndex: 0 },
    });
    await prisma.character.create({
      data: { storyId: story.id, orderIndex: 0 },
    });
    await prisma.outlineItem.create({
      data: { storyId: story.id, order: 0, status: 'pending' },
    });
    const chat = await prisma.chat.create({
      data: { chapterId: chapter.id },
    });
    await prisma.message.create({
      data: { chatId: chat.id, role: 'user' },
    });

    // Bob seeds a story so we can prove his rows are not touched.
    const bobStory = await prisma.story.create({
      data: { userId: bob.userId },
    });

    // Sanity: registerAndLogin creates a Session + RefreshToken; confirm before
    // asserting the cascade dropped them, so the test fails loudly if the seed
    // stops producing them in some future change.
    const preAliceSessions = await prisma.session.count({ where: { userId: alice.userId } });
    const preAliceRefreshTokens = await prisma.refreshToken.count({
      where: { userId: alice.userId },
    });
    expect(preAliceSessions).toBeGreaterThan(0);
    expect(preAliceRefreshTokens).toBeGreaterThan(0);

    const res = await request(app)
      .delete('/api/auth/delete-account')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .set('Cookie', alice.refreshCookie)
      .send({ password: PASSWORD });

    expect(res.status).toBe(204);

    // Alice and her cascade are gone.
    expect(await prisma.user.count({ where: { id: alice.userId } })).toBe(0);
    expect(await prisma.story.count({ where: { userId: alice.userId } })).toBe(0);
    expect(await prisma.chapter.count({ where: { storyId: story.id } })).toBe(0);
    expect(await prisma.character.count({ where: { storyId: story.id } })).toBe(0);
    expect(await prisma.outlineItem.count({ where: { storyId: story.id } })).toBe(0);
    expect(await prisma.chat.count({ where: { chapterId: chapter.id } })).toBe(0);
    expect(await prisma.message.count({ where: { chatId: chat.id } })).toBe(0);
    expect(await prisma.refreshToken.count({ where: { userId: alice.userId } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: alice.userId } })).toBe(0);

    // Bob is untouched.
    expect(await prisma.user.count({ where: { id: bob.userId } })).toBe(1);
    expect(await prisma.story.count({ where: { id: bobStory.id } })).toBe(1);
    expect(await prisma.session.count({ where: { userId: bob.userId } })).toBeGreaterThan(0);
    expect(await prisma.refreshToken.count({ where: { userId: bob.userId } })).toBeGreaterThan(0);

    // Cookie cleared.
    const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
    const cleared = setCookie?.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(/Max-Age=0|Expires=/i);
  });
});
