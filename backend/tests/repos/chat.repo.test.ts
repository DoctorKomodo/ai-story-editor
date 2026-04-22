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
