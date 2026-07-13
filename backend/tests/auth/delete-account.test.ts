// [X3] DELETE /api/auth/delete-account — authenticated destructive endpoint
// that re-verifies the user's password, deletes the user (cascading to all
// narrative entities, sessions, DEK wraps), and clears the caller's session cookie.
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import { sessionCookieName } from '../../src/lib/session-cookie';
import { _sessionCount } from '../../src/services/session-store';
import { registerAndLogin } from '../helpers/auth';
import { resetUsers } from '../helpers/db';
import { prisma } from '../setup';

const PASSWORD = 'correct-horse-battery';
const TEST_ORIGIN = 'http://localhost:3000';

describe('[X3] DELETE /api/auth/delete-account', () => {
  beforeEach(async () => {
    await resetUsers();
  });

  afterEach(async () => {
    await resetUsers();
  });

  it('returns 401 without a session cookie', async () => {
    const res = await request(app)
      .delete('/api/auth/delete-account')
      .set('Origin', TEST_ORIGIN)
      .send({ password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it('returns 400 when the password is missing from the body', async () => {
    const alice = await registerAndLogin({ username: 'alice', password: PASSWORD });
    const res = await alice.agent
      .delete('/api/auth/delete-account')
      .set('Origin', TEST_ORIGIN)
      .send({});
    expect(res.status).toBe(400);
    expect(await prisma.user.count({ where: { id: alice.userId } })).toBe(1);
  });

  it('returns 401 with the same body shape as change-password on wrong password', async () => {
    const alice = await registerAndLogin({ username: 'alice', password: PASSWORD });
    const res = await alice.agent
      .delete('/api/auth/delete-account')
      .set('Origin', TEST_ORIGIN)
      .send({ password: 'not-the-right-password' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { message: 'Invalid credentials', code: 'invalid_credentials' },
    });
    // User still exists.
    expect(await prisma.user.count({ where: { id: alice.userId } })).toBe(1);
  });

  it('204 on success — deletes the user, cascades to stories/chapters/characters/outline/chats/messages, drops sessions, leaves other users untouched, and clears the cookie', async () => {
    const alice = await registerAndLogin({ username: 'alice', password: PASSWORD });
    const bob = await registerAndLogin({ username: 'bob', password: PASSWORD });

    // Seed alice with one of every narrative entity to confirm the cascade.
    // Post-[E11]: narrative columns are nullable ciphertext-only — minimal
    // rows with just the structural plaintext fields are sufficient. The
    // delete path doesn't read them; we only need enough of a row to count.
    const story = await prisma.story.create({
      data: { userId: alice.userId },
    });
    const chapter = await prisma.chapter.create({
      data: { storyId: story.id, orderIndex: 0, userId: alice.userId },
    });
    await prisma.character.create({
      data: { storyId: story.id, orderIndex: 0, userId: alice.userId },
    });
    await prisma.outlineItem.create({
      data: { storyId: story.id, order: 0, status: 'pending', userId: alice.userId },
    });
    const draft = await prisma.draft.create({
      data: { chapterId: chapter.id, orderIndex: 0, userId: alice.userId },
    });
    const chat = await prisma.chat.create({
      data: { draftId: draft.id, userId: alice.userId },
    });
    await prisma.message.create({
      data: { chatId: chat.id, role: 'user', userId: alice.userId },
    });

    // Bob seeds a story so we can prove his rows are not touched.
    const bobStory = await prisma.story.create({
      data: { userId: bob.userId },
    });

    // Sanity: alice just logged in so there is at least one active session.
    expect(_sessionCount()).toBeGreaterThan(0);

    const res = await alice.agent
      .delete('/api/auth/delete-account')
      .set('Origin', TEST_ORIGIN)
      .send({ password: PASSWORD });

    expect(res.status).toBe(204);

    // Alice and her cascade are gone.
    expect(await prisma.user.count({ where: { id: alice.userId } })).toBe(0);
    expect(await prisma.story.count({ where: { userId: alice.userId } })).toBe(0);
    expect(await prisma.chapter.count({ where: { storyId: story.id } })).toBe(0);
    expect(await prisma.character.count({ where: { storyId: story.id } })).toBe(0);
    expect(await prisma.outlineItem.count({ where: { storyId: story.id } })).toBe(0);
    expect(await prisma.chat.count({ where: { draftId: draft.id } })).toBe(0);
    expect(await prisma.message.count({ where: { chatId: chat.id } })).toBe(0);

    // Alice's agent gets 401 on any subsequent authenticated request.
    const afterRes = await alice.agent
      .delete('/api/auth/delete-account')
      .set('Origin', TEST_ORIGIN)
      .send({ password: PASSWORD });
    expect(afterRes.status).toBe(401);

    // Bob is untouched.
    expect(await prisma.user.count({ where: { id: bob.userId } })).toBe(1);
    expect(await prisma.story.count({ where: { id: bobStory.id } })).toBe(1);

    // Cookie cleared.
    const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
    const cleared = (setCookie ?? []).find((c) => c.startsWith(`${sessionCookieName()}=`));
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(/Max-Age=0|Expires=/i);
  });
});
