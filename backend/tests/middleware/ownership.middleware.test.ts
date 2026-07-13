import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type OwnedResource, requireOwnership } from '../../src/middleware/ownership.middleware';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createCharacterRepo } from '../../src/repos/character.repo';
import { createChatRepo } from '../../src/repos/chat.repo';
import { createMessageRepo } from '../../src/repos/message.repo';
import { createOutlineRepo } from '../../src/repos/outline.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { resetDb } from '../helpers/db';
import { makeUser } from '../helpers/makeUser';
import { makeUserContext, type TestUserContext } from '../repos/_req';
import { prisma } from '../setup';

function mountProtected(resource: OwnedResource, idParam: string, userId: string) {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: userId, sessionId: 'test-session-id' };
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
  draftId: string;
}> {
  const owner = await makeUser(prisma, { email: 'owner@example.com', username: 'owner' });
  const stranger = await makeUser(prisma, { email: 'stranger@example.com', username: 'stranger' });

  // Post-[E11]: narrative fields are ciphertext-only — the middleware
  // doesn't read them, so we seed minimal rows with just the plaintext
  // structural fields (FKs, order/status indexes).
  const story = await prisma.story.create({ data: { userId: owner.id } });
  const chapter = await prisma.chapter.create({
    data: { orderIndex: 0, storyId: story.id, userId: owner.id },
  });
  const character = await prisma.character.create({
    data: { storyId: story.id, orderIndex: 0, userId: owner.id },
  });
  const outline = await prisma.outlineItem.create({
    data: { order: 0, status: 'pending', storyId: story.id, userId: owner.id },
  });
  const draft = await prisma.draft.create({
    data: { chapterId: chapter.id, orderIndex: 0, userId: owner.id },
  });
  await prisma.chapter.update({
    where: { id: chapter.id },
    data: { activeDraftId: draft.id },
  });
  const chat = await prisma.chat.create({ data: { draftId: draft.id, userId: owner.id } });
  const message = await prisma.message.create({
    data: { chatId: chat.id, role: 'user', userId: owner.id },
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
    draftId: draft.id,
  };
}

describe('requireOwnership middleware', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterEach(async () => {
    await resetDb();
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
      req.user = { id: ownerId, sessionId: 'test-session-id' };
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

  it('traverses Draft → Chapter → Story → User', async () => {
    const { ownerId, strangerId, draftId } = await seedTwoUsersAndAStory();
    const okRes = await request(mountProtected('draft', 'draftId', ownerId)).get(`/${draftId}`);
    expect(okRes.status).toBe(200);
    const denyRes = await request(mountProtected('draft', 'draftId', strangerId)).get(
      `/${draftId}`,
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

  it('[9wk.3] chat/message ownership resolves through draft.chapter.story — cross-user denied', async () => {
    const owner = await makeUserContext('own-draftchain');
    const attacker = await makeUserContext('atk-draftchain');
    const story = await createStoryRepo(owner.req).create({ title: 'S' });
    const chapter = await createChapterRepo(owner.req).create({
      storyId: story.id as string,
      title: 'C',
      orderIndex: 0,
    });
    const chat = await createChatRepo(owner.req).create({
      draftId: chapter.activeDraftId as string,
    });
    const message = await createMessageRepo(owner.req).create({
      chatId: chat.id as string,
      role: 'user',
      content: 'mine',
    });

    // Repo layer: attacker resolves nothing through the new chain.
    expect(await createChatRepo(attacker.req).findById(chat.id as string)).toBeNull();
    expect(await createMessageRepo(attacker.req).findById(message.id as string)).toBeNull();

    // Middleware layer: 403 for both resource types, owner passes.
    const chatOkRes = await request(mountProtected('chat', 'chatId', owner.user.id)).get(
      `/${chat.id}`,
    );
    expect(chatOkRes.status).toBe(200);
    const chatDenyRes = await request(mountProtected('chat', 'chatId', attacker.user.id)).get(
      `/${chat.id}`,
    );
    expect(chatDenyRes.status).toBe(403);

    const messageOkRes = await request(mountProtected('message', 'messageId', owner.user.id)).get(
      `/${message.id}`,
    );
    expect(messageOkRes.status).toBe(200);
    const messageDenyRes = await request(
      mountProtected('message', 'messageId', attacker.user.id),
    ).get(`/${message.id}`);
    expect(messageDenyRes.status).toBe(403);
  });
});

// ─── Exhaustive enumeration (the drift gate, story-editor-35u task 4) ──────
//
// `RESOURCE_FIXTURES` is typed `Record<OwnedResource, ResourceFixture>` — if a
// future resource joins the `OwnedResource` union without a matching entry
// here, this file fails to typecheck (a missing-property error on the object
// literal below), not a runtime assertion. No hardcoded resource list, no
// `satisfies`-only helper: the object literal itself is the exhaustiveness
// check.
type ResourceFixture = (
  owner: TestUserContext,
  stranger: TestUserContext,
) => Promise<{ ownedId: string; notOwnedId: string }>;

async function seedOwnedStory(ctx: TestUserContext) {
  return createStoryRepo(ctx.req).create({ title: 'S' });
}

async function seedOwnedChapter(ctx: TestUserContext) {
  const story = await seedOwnedStory(ctx);
  return createChapterRepo(ctx.req).create({ storyId: story.id, title: 'C', orderIndex: 0 });
}

async function seedOwnedChat(ctx: TestUserContext) {
  const chapter = await seedOwnedChapter(ctx);
  return createChatRepo(ctx.req).create({ draftId: chapter.activeDraftId as string });
}

const RESOURCE_FIXTURES: Record<OwnedResource, ResourceFixture> = {
  story: async (owner, stranger) => {
    const owned = await seedOwnedStory(owner);
    const notOwned = await seedOwnedStory(stranger);
    return { ownedId: owned.id, notOwnedId: notOwned.id };
  },
  chapter: async (owner, stranger) => {
    const owned = await seedOwnedChapter(owner);
    const notOwned = await seedOwnedChapter(stranger);
    return { ownedId: owned.id, notOwnedId: notOwned.id };
  },
  character: async (owner, stranger) => {
    const ownerStory = await seedOwnedStory(owner);
    const owned = await createCharacterRepo(owner.req).create({
      storyId: ownerStory.id,
      orderIndex: 0,
      name: 'Owner Char',
    });
    const strangerStory = await seedOwnedStory(stranger);
    const notOwned = await createCharacterRepo(stranger.req).create({
      storyId: strangerStory.id,
      orderIndex: 0,
      name: 'Stranger Char',
    });
    return { ownedId: owned.id, notOwnedId: notOwned.id };
  },
  outline: async (owner, stranger) => {
    const ownerStory = await seedOwnedStory(owner);
    const owned = await createOutlineRepo(owner.req).create({
      storyId: ownerStory.id,
      order: 0,
      status: 'pending',
      title: 'Beat',
    });
    const strangerStory = await seedOwnedStory(stranger);
    const notOwned = await createOutlineRepo(stranger.req).create({
      storyId: strangerStory.id,
      order: 0,
      status: 'pending',
      title: 'Beat',
    });
    return { ownedId: owned.id, notOwnedId: notOwned.id };
  },
  // Chapter creation already seeds the chapter's initial draft through
  // draft.repo (via chapter.repo internally) — reuse `activeDraftId` rather
  // than seeding a second draft per chapter.
  draft: async (owner, stranger) => {
    const ownedChapter = await seedOwnedChapter(owner);
    const notOwnedChapter = await seedOwnedChapter(stranger);
    return {
      ownedId: ownedChapter.activeDraftId as string,
      notOwnedId: notOwnedChapter.activeDraftId as string,
    };
  },
  chat: async (owner, stranger) => {
    const owned = await seedOwnedChat(owner);
    const notOwned = await seedOwnedChat(stranger);
    return { ownedId: owned.id, notOwnedId: notOwned.id };
  },
  message: async (owner, stranger) => {
    const ownedChat = await seedOwnedChat(owner);
    const owned = await createMessageRepo(owner.req).create({
      chatId: ownedChat.id,
      role: 'user',
      content: 'hi',
    });
    const notOwnedChat = await seedOwnedChat(stranger);
    const notOwned = await createMessageRepo(stranger.req).create({
      chatId: notOwnedChat.id,
      role: 'user',
      content: 'hi',
    });
    return { ownedId: owned.id, notOwnedId: notOwned.id };
  },
};

describe('requireOwnership — exhaustive resource enumeration (drift gate)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterEach(async () => {
    await resetDb();
  });

  for (const [resource, seed] of Object.entries(RESOURCE_FIXTURES) as Array<
    [OwnedResource, ResourceFixture]
  >) {
    const idParam = `${resource}Id`;

    it(`${resource}: owner passes; a stranger's row and a nonexistent id both 403`, async () => {
      const owner = await makeUserContext(`own-${resource}`);
      const stranger = await makeUserContext(`atk-${resource}`);
      const { ownedId, notOwnedId } = await seed(owner, stranger);

      const okRes = await request(mountProtected(resource, idParam, owner.user.id)).get(
        `/${ownedId}`,
      );
      expect(okRes.status).toBe(200);

      const notOwnedRes = await request(mountProtected(resource, idParam, owner.user.id)).get(
        `/${notOwnedId}`,
      );
      expect(notOwnedRes.status).toBe(403);
      expect(notOwnedRes.body.error.code).toBe('forbidden');

      const nonexistentRes = await request(mountProtected(resource, idParam, owner.user.id)).get(
        '/cm-definitely-not-real',
      );
      expect(nonexistentRes.status).toBe(403);
      expect(nonexistentRes.body.error.code).toBe('forbidden');
    });
  }
});
