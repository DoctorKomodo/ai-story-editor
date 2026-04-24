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

  it('round-trips contentJson + attachmentJson + citationsJson as JSON objects', async () => {
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
    const citations = [{ title: 'Source', url: 'https://example.test/s', content: null }];
    const m = await repo.create({
      chatId: chat.id as string,
      role: 'user',
      contentJson: content,
      attachmentJson: attachment,
      citationsJson: citations,
      model: 'venice-m1',
      tokens: 3,
      latencyMs: 12,
    });

    expect(m.contentJson).toEqual(content);
    expect(m.attachmentJson).toEqual(attachment);
    expect(m.citationsJson).toEqual(citations);
    expect(m.role).toBe('user');
    expect(m.model).toBe('venice-m1');
    expect(m.tokens).toBe(3);

    const raw = await prisma.message.findUniqueOrThrow({ where: { id: m.id as string } });
    expect(raw.contentJsonCiphertext).toBeTruthy();
    expect(raw.attachmentJsonCiphertext).toBeTruthy();
    // [V26] citationsJson must also land as ciphertext, not plaintext.
    expect(raw.citationsJsonCiphertext).toBeTruthy();
  });

  it('countForChat returns the number of messages in an owned chat', async () => {
    const ctx = await makeUserContext();
    const story = await createStoryRepo(ctx.req).create({ title: 's' });
    const chapter = await createChapterRepo(ctx.req).create({
      storyId: story.id as string,
      title: 'ch',
      orderIndex: 0,
    });
    const chat = await createChatRepo(ctx.req).create({ chapterId: chapter.id as string });
    const repo = createMessageRepo(ctx.req);

    expect(await repo.countForChat(chat.id as string)).toBe(0);

    await repo.create({ chatId: chat.id as string, role: 'user', contentJson: 'q1' });
    await repo.create({ chatId: chat.id as string, role: 'assistant', contentJson: 'a1' });

    expect(await repo.countForChat(chat.id as string)).toBe(2);
  });

  it('countForChat returns 0 for a chat belonging to another user (no throw)', async () => {
    // Create a chat owned by user A.
    const ctxA = await makeUserContext();
    const story = await createStoryRepo(ctxA.req).create({ title: 'story-a' });
    const chapter = await createChapterRepo(ctxA.req).create({
      storyId: story.id as string,
      title: 'ch-a',
      orderIndex: 0,
    });
    const chat = await createChatRepo(ctxA.req).create({ chapterId: chapter.id as string });
    await createMessageRepo(ctxA.req).create({
      chatId: chat.id as string,
      role: 'user',
      contentJson: 'secret message',
    });

    // User B tries to count messages for that chat — should get 0, not throw.
    const ctxB = await makeUserContext();
    const repoB = createMessageRepo(ctxB.req);
    const count = await repoB.countForChat(chat.id as string);
    expect(count).toBe(0);
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
