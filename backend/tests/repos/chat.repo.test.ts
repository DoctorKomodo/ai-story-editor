import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createChatRepo } from '../../src/repos/chat.repo';
import { createMessageRepo } from '../../src/repos/message.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { prisma } from '../setup';
import { makeUserContext, resetAllTables } from './_req';

describe('[E9] chat.repo', () => {
  beforeEach(resetAllTables);
  afterEach(resetAllTables);

  it('round-trips title; enforces chapter.story.userId ownership', async () => {
    const alice = await makeUserContext('a-chat');
    const bob = await makeUserContext('b-chat');

    const story = await createStoryRepo(alice.req).create({ title: 's' });
    const ch = await createChapterRepo(alice.req).create({
      storyId: story.id as string,
      title: 'ch1',
      orderIndex: 0,
    });
    const aliceChats = createChatRepo(alice.req);
    const chat = await aliceChats.create({ chapterId: ch.id as string, title: 'Brainstorm' });
    expect(chat.title).toBe('Brainstorm');

    const raw = await prisma.chat.findUniqueOrThrow({ where: { id: chat.id as string } });
    expect(raw.titleCiphertext).toBeTruthy();

    const bobChats = createChatRepo(bob.req);
    await expect(bobChats.findManyForChapter(ch.id as string)).rejects.toThrow();
  });
});

describe('[SC3] chat.repo — kind support', () => {
  beforeEach(resetAllTables);
  afterEach(resetAllTables);

  it('creates a chat with kind="scene" when specified', async () => {
    const u = await makeUserContext('sc3-1');
    const s = await createStoryRepo(u.req).create({ title: 's' });
    const ch = await createChapterRepo(u.req).create({
      storyId: s.id as string,
      title: 'ch1',
      orderIndex: 0,
    });
    const repo = createChatRepo(u.req);
    const chat = await repo.create({
      chapterId: ch.id as string,
      title: 'first scene',
      kind: 'scene',
    });
    expect(chat.kind).toBe('scene');

    const fetched = await repo.findById(chat.id as string);
    expect(fetched?.kind).toBe('scene');
  });

  it('defaults kind to "ask" when not specified', async () => {
    const u = await makeUserContext('sc3-2');
    const s = await createStoryRepo(u.req).create({ title: 's' });
    const ch = await createChapterRepo(u.req).create({
      storyId: s.id as string,
      title: 'ch1',
      orderIndex: 0,
    });
    const repo = createChatRepo(u.req);
    const chat = await repo.create({ chapterId: ch.id as string, title: 'first chat' });
    expect(chat.kind).toBe('ask');
  });

  it('filters by kind in findManyForChapter', async () => {
    const u = await makeUserContext('sc3-3');
    const s = await createStoryRepo(u.req).create({ title: 's' });
    const ch = await createChapterRepo(u.req).create({
      storyId: s.id as string,
      title: 'ch1',
      orderIndex: 0,
    });
    const repo = createChatRepo(u.req);
    await repo.create({ chapterId: ch.id as string, title: 'a1', kind: 'ask' });
    await repo.create({ chapterId: ch.id as string, title: 'a2', kind: 'ask' });
    await repo.create({ chapterId: ch.id as string, title: 's1', kind: 'scene' });

    const all = await repo.findManyForChapter(ch.id as string);
    const scenesOnly = await repo.findManyForChapter(ch.id as string, { kind: 'scene' });
    const asksOnly = await repo.findManyForChapter(ch.id as string, { kind: 'ask' });

    expect(all.length).toBe(3);
    expect(scenesOnly.length).toBe(1);
    expect(scenesOnly[0].kind).toBe('scene');
    expect(asksOnly.length).toBe(2);
    expect(asksOnly.every((c) => c.kind === 'ask')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Shared fixture for the ordering tests below
// ---------------------------------------------------------------------------

async function setupTwoChatsFixture(username: string) {
  const u = await makeUserContext(username);
  const story = await createStoryRepo(u.req).create({ title: 's' });
  const chapter = await createChapterRepo(u.req).create({
    storyId: story.id as string,
    title: 'ch1',
    orderIndex: 0,
  });
  const chapterId = chapter.id as string;
  const repo = createChatRepo(u.req);

  // Chat A created first
  const chatA = await repo.create({ chapterId, title: 'chat-a' });
  // Small delay so createdAt timestamps differ meaningfully
  await new Promise((r) => setTimeout(r, 20));
  // Chat B created second (newer createdAt)
  const chatB = await repo.create({ chapterId, title: 'chat-b' });

  return { req: u.req, chapterId, chatAId: chatA.id as string, chatBId: chatB.id as string };
}

describe('chatRepo.findManyForChapter — most-recent-activity ordering (story-editor-loj)', () => {
  beforeEach(resetAllTables);
  afterEach(resetAllTables);

  it('returns chats ordered by lastActivityAt desc — chat with newer message activity comes first', async () => {
    const { req, chapterId, chatAId, chatBId } = await setupTwoChatsFixture('loj-ordering-active');

    // A was created first, B second. Send a message into A (so its
    // lastActivityAt > B's), then a message into B (so B's > A's). Final
    // order should be [B, A] — most-recently-active first.
    await new Promise((r) => setTimeout(r, 15));
    const messageRepo = createMessageRepo(req);
    await messageRepo.create({
      chatId: chatAId,
      role: 'user',
      content: 'a',
    });
    await new Promise((r) => setTimeout(r, 15));
    await messageRepo.create({
      chatId: chatBId,
      role: 'user',
      content: 'b',
    });

    const list = await createChatRepo(req).findManyForChapter(chapterId);

    expect(list).toHaveLength(2);
    expect(list[0]?.id).toBe(chatBId);
    expect(list[1]?.id).toBe(chatAId);
  });

  it('uses createdAt desc as the tie-breaker when both chats are dormant (lastActivityAt === createdAt)', async () => {
    // Two fresh chats, no messages. lastActivityAt defaults to createdAt for
    // both (and they may even share the same lastActivityAt timestamp).
    const { req, chapterId, chatAId, chatBId } = await setupTwoChatsFixture('loj-ordering-dormant');
    // A was created first → older createdAt. Under [lastActivityAt desc,
    // createdAt desc], B (newer createdAt) should land first.

    const list = await createChatRepo(req).findManyForChapter(chapterId);

    expect(list).toHaveLength(2);
    expect(list[0]?.id).toBe(chatBId);
    expect(list[1]?.id).toBe(chatAId);
  });
});
