import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createChatRepo } from '../../src/repos/chat.repo';
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
