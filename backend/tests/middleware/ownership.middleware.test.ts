import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type OwnedResource, requireOwnership } from '../../src/middleware/ownership.middleware';
import { makeUser } from '../helpers/makeUser';
import { prisma } from '../setup';

function mountProtected(resource: OwnedResource, idParam: string, userId: string) {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: userId, email: null };
    next();
  });
  app.get(`/:${idParam}`, requireOwnership(resource, { idParam, client: prisma }), (_req, res) =>
    res.json({ ok: true }),
  );
  return app;
}

function mountAnonymous(resource: OwnedResource, idParam: string) {
  const app = express();
  app.get(`/:${idParam}`, requireOwnership(resource, { idParam, client: prisma }), (_req, res) =>
    res.json({ ok: true }),
  );
  return app;
}

async function seedTwoUsersAndAStory(): Promise<{
  ownerId: string;
  strangerId: string;
  storyId: string;
  chapterId: string;
  characterId: string;
  outlineId: string;
  chatId: string;
  messageId: string;
}> {
  const owner = await makeUser(prisma, { email: 'owner@example.com', username: 'owner' });
  const stranger = await makeUser(prisma, { email: 'stranger@example.com', username: 'stranger' });

  // Post-[E11]: narrative fields are ciphertext-only — the middleware
  // doesn't read them, so we seed minimal rows with just the plaintext
  // structural fields (FKs, order/status indexes).
  const story = await prisma.story.create({ data: { userId: owner.id } });
  const chapter = await prisma.chapter.create({
    data: { orderIndex: 0, storyId: story.id },
  });
  const character = await prisma.character.create({ data: { storyId: story.id, orderIndex: 0 } });
  const outline = await prisma.outlineItem.create({
    data: { order: 0, status: 'pending', storyId: story.id },
  });
  const chat = await prisma.chat.create({ data: { chapterId: chapter.id } });
  const message = await prisma.message.create({
    data: { chatId: chat.id, role: 'user' },
  });

  return {
    ownerId: owner.id,
    strangerId: stranger.id,
    storyId: story.id,
    chapterId: chapter.id,
    characterId: character.id,
    outlineId: outline.id,
    chatId: chat.id,
    messageId: message.id,
  };
}

describe('requireOwnership middleware', () => {
  beforeEach(async () => {
    await prisma.message.deleteMany();
    await prisma.chat.deleteMany();
    await prisma.outlineItem.deleteMany();
    await prisma.character.deleteMany();
    await prisma.chapter.deleteMany();
    await prisma.story.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await prisma.message.deleteMany();
    await prisma.chat.deleteMany();
    await prisma.outlineItem.deleteMany();
    await prisma.character.deleteMany();
    await prisma.chapter.deleteMany();
    await prisma.story.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  it('returns 401 when req.user is absent', async () => {
    const { storyId } = await seedTwoUsersAndAStory();
    const res = await request(mountAnonymous('story', 'storyId')).get(`/${storyId}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('returns 400 when the id param is missing (empty string)', async () => {
    const { ownerId } = await seedTwoUsersAndAStory();
    const app = express();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.user = { id: ownerId, email: null };
      next();
    });
    // Mount without a param segment — Express gives an empty string at req.params.storyId.
    // Express 5 / path-to-regexp@8 dropped `:storyId?` optional-param syntax; register
    // both `/` and `/:storyId` explicitly to reach the empty-id case.
    const handler = (
      ...args: Parameters<ReturnType<typeof requireOwnership>>
    ): ReturnType<ReturnType<typeof requireOwnership>> =>
      requireOwnership('story', { idParam: 'storyId', client: prisma })(...args);
    app.get('/', handler, (_req, res) => res.json({ ok: true }));
    app.get('/:storyId', handler, (_req, res) => res.json({ ok: true }));
    const res = await request(app).get('/');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('missing_resource_id');
  });

  it('passes through when the owner accesses their story', async () => {
    const { ownerId, storyId } = await seedTwoUsersAndAStory();
    const res = await request(mountProtected('story', 'storyId', ownerId)).get(`/${storyId}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('returns 403 when a stranger accesses a story they do not own', async () => {
    const { strangerId, storyId } = await seedTwoUsersAndAStory();
    const res = await request(mountProtected('story', 'storyId', strangerId)).get(`/${storyId}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('returns 403 (not 404) for an unknown id — no enumeration oracle', async () => {
    const { ownerId } = await seedTwoUsersAndAStory();
    const res = await request(mountProtected('story', 'storyId', ownerId)).get(
      '/cm-definitely-not-real',
    );
    expect(res.status).toBe(403);
  });

  it('traverses Chapter → Story → User', async () => {
    const { ownerId, strangerId, chapterId } = await seedTwoUsersAndAStory();
    const okRes = await request(mountProtected('chapter', 'chapterId', ownerId)).get(
      `/${chapterId}`,
    );
    expect(okRes.status).toBe(200);
    const denyRes = await request(mountProtected('chapter', 'chapterId', strangerId)).get(
      `/${chapterId}`,
    );
    expect(denyRes.status).toBe(403);
  });

  it('traverses Character → Story → User', async () => {
    const { ownerId, strangerId, characterId } = await seedTwoUsersAndAStory();
    const okRes = await request(mountProtected('character', 'characterId', ownerId)).get(
      `/${characterId}`,
    );
    expect(okRes.status).toBe(200);
    const denyRes = await request(mountProtected('character', 'characterId', strangerId)).get(
      `/${characterId}`,
    );
    expect(denyRes.status).toBe(403);
  });

  it('traverses OutlineItem → Story → User', async () => {
    const { ownerId, strangerId, outlineId } = await seedTwoUsersAndAStory();
    const okRes = await request(mountProtected('outline', 'outlineId', ownerId)).get(
      `/${outlineId}`,
    );
    expect(okRes.status).toBe(200);
    const denyRes = await request(mountProtected('outline', 'outlineId', strangerId)).get(
      `/${outlineId}`,
    );
    expect(denyRes.status).toBe(403);
  });

  it('traverses Chat → Chapter → Story → User', async () => {
    const { ownerId, strangerId, chatId } = await seedTwoUsersAndAStory();
    const okRes = await request(mountProtected('chat', 'chatId', ownerId)).get(`/${chatId}`);
    expect(okRes.status).toBe(200);
    const denyRes = await request(mountProtected('chat', 'chatId', strangerId)).get(`/${chatId}`);
    expect(denyRes.status).toBe(403);
  });

  it('traverses Message → Chat → Chapter → Story → User', async () => {
    const { ownerId, strangerId, messageId } = await seedTwoUsersAndAStory();
    const okRes = await request(mountProtected('message', 'messageId', ownerId)).get(
      `/${messageId}`,
    );
    expect(okRes.status).toBe(200);
    const denyRes = await request(mountProtected('message', 'messageId', strangerId)).get(
      `/${messageId}`,
    );
    expect(denyRes.status).toBe(403);
  });
});
