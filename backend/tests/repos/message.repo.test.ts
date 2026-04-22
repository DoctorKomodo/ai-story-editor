import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createChatRepo } from '../../src/repos/chat.repo';
import { createMessageRepo } from '../../src/repos/message.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { prisma } from '../setup';
import { makeUserContext, resetAllTables } from './_req';

describe('[E9] message.repo', () => {
  beforeEach(resetAllTables);
  afterEach(resetAllTables);

  it('round-trips contentJson + attachmentJson as JSON objects', async () => {
    const ctx = await makeUserContext();
    const story = await createStoryRepo(ctx.req).create({ title: 's' });
    const chapter = await createChapterRepo(ctx.req).create({
      storyId: story.id as string,
      title: 'ch',
      orderIndex: 0,
    });
    const chat = await createChatRepo(ctx.req).create({ chapterId: chapter.id as string });
    const repo = createMessageRepo(ctx.req);

    const content = { parts: ['Hello', 'world'] };
    const attachment = { selectionText: 'draft passage', chapterId: chapter.id };
    const m = await repo.create({
      chatId: chat.id as string,
      role: 'user',
      contentJson: content,
      attachmentJson: attachment,
      model: 'venice-m1',
      tokens: 3,
      latencyMs: 12,
    });

    expect(m.contentJson).toEqual(content);
    expect(m.attachmentJson).toEqual(attachment);
    expect(m.role).toBe('user');
    expect(m.model).toBe('venice-m1');
    expect(m.tokens).toBe(3);

    const raw = await prisma.message.findUniqueOrThrow({ where: { id: m.id as string } });
    expect(raw.contentJsonCiphertext).toBeTruthy();
    expect(raw.attachmentJsonCiphertext).toBeTruthy();
  });

  it('findManyForChat returns ordered messages with decrypted content', async () => {
    const ctx = await makeUserContext();
    const story = await createStoryRepo(ctx.req).create({ title: 's' });
    const chapter = await createChapterRepo(ctx.req).create({
      storyId: story.id as string,
      title: 'ch',
      orderIndex: 0,
    });
    const chat = await createChatRepo(ctx.req).create({ chapterId: chapter.id as string });
    const repo = createMessageRepo(ctx.req);

    await repo.create({ chatId: chat.id as string, role: 'user', contentJson: { parts: ['q1'] } });
    await repo.create({ chatId: chat.id as string, role: 'assistant', contentJson: { parts: ['a1'] } });

    const list = await repo.findManyForChat(chat.id as string);
    expect(list).toHaveLength(2);
    expect((list[0]!.contentJson as { parts: string[] }).parts).toEqual(['q1']);
    expect((list[1]!.contentJson as { parts: string[] }).parts).toEqual(['a1']);
  });
});
