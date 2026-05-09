import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createChatRepo } from '../../src/repos/chat.repo';
import { createMessageRepo } from '../../src/repos/message.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { prisma } from '../setup';
import { makeUserContext, resetAllTables } from './_req';

async function createUserWithChapter() {
  const ctx = await makeUserContext();
  const story = await createStoryRepo(ctx.req).create({ title: 's' });
  const chapter = await createChapterRepo(ctx.req).create({
    storyId: story.id as string,
    title: 'ch',
    orderIndex: 0,
  });
  return { user: ctx, chapterId: chapter.id as string };
}

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
    await repo.create({
      chatId: chat.id as string,
      role: 'assistant',
      contentJson: { parts: ['a1'] },
    });

    const list = await repo.findManyForChat(chat.id as string);
    expect(list).toHaveLength(2);
    expect((list[0]!.contentJson as { parts: string[] }).parts).toEqual(['q1']);
    expect((list[1]!.contentJson as { parts: string[] }).parts).toEqual(['a1']);
  });
});

describe('MessageRepo.deleteAllAfter', () => {
  beforeEach(resetAllTables);
  afterEach(resetAllTables);

  it('deletes only rows whose createdAt > reference.createdAt', async () => {
    const { user, chapterId } = await createUserWithChapter();
    const repo = createMessageRepo(user.req);
    const chatRepo = createChatRepo(user.req);
    const chat = await chatRepo.create({ chapterId, kind: 'ask', title: null });

    const userMsg = await repo.create({
      chatId: chat.id as string,
      role: 'user',
      contentJson: 'first',
    });
    // Force later createdAt by sleeping 2ms (Prisma's createdAt has ms precision).
    await new Promise((r) => setTimeout(r, 2));
    await repo.create({
      chatId: chat.id as string,
      role: 'assistant',
      contentJson: 'reply',
    });

    const result = await repo.deleteAllAfter(chat.id as string, userMsg.id as string);

    expect(result.count).toBe(1);
    const remaining = await repo.findManyForChat(chat.id as string);
    expect(remaining.map((m) => m.id)).toEqual([userMsg.id]);
  });

  it('deletes same-millisecond sibling with different id', async () => {
    const { user, chapterId } = await createUserWithChapter();
    const repo = createMessageRepo(user.req);
    const chatRepo = createChatRepo(user.req);
    const chat = await chatRepo.create({ chapterId, kind: 'ask', title: null });

    // Two messages at exactly the same instant via raw Prisma to construct the
    // same-millisecond collision case. Post-[E11] there is no plaintext
    // `contentJson` column — only ciphertext triples, which we leave null here
    // since we are only testing the deletion predicate, not content round-trips.
    const ts = new Date();
    const userMsg = await prisma.message.create({
      data: {
        chatId: chat.id as string,
        role: 'user',
        createdAt: ts,
      },
    });
    await prisma.message.create({
      data: {
        chatId: chat.id as string,
        role: 'assistant',
        createdAt: ts, // same millisecond
      },
    });

    const result = await repo.deleteAllAfter(chat.id as string, userMsg.id);

    expect(result.count).toBe(1);
    const remaining = await repo.findManyForChat(chat.id as string);
    expect(remaining.map((m) => m.id)).toEqual([userMsg.id]);
  });

  it('returns count 0 when reference message does not exist', async () => {
    const { user, chapterId } = await createUserWithChapter();
    const repo = createMessageRepo(user.req);
    const chatRepo = createChatRepo(user.req);
    const chat = await chatRepo.create({ chapterId, kind: 'ask', title: null });

    const result = await repo.deleteAllAfter(chat.id as string, 'nonexistent-id');
    expect(result.count).toBe(0);
  });

  it("does not delete messages from another user's chat", async () => {
    const { user: userA } = await createUserWithChapter();
    const { user: userB, chapterId: chapterBId } = await createUserWithChapter();
    const repoA = createMessageRepo(userA.req);
    const chatRepoB = createChatRepo(userB.req);
    const chatB = await chatRepoB.create({ chapterId: chapterBId, kind: 'ask', title: null });
    const repoBviaB = createMessageRepo(userB.req);
    const userMsgB = await repoBviaB.create({
      chatId: chatB.id as string,
      role: 'user',
      contentJson: 'b',
    });
    await new Promise((r) => setTimeout(r, 2));
    await repoBviaB.create({
      chatId: chatB.id as string,
      role: 'assistant',
      contentJson: 'reply',
    });

    // userA's repo asked to delete after userMsgB — ensureChatOwned throws (consistent with siblings).
    await expect(repoA.deleteAllAfter(chatB.id as string, userMsgB.id as string)).rejects.toThrow(
      'message.repo: chat not owned by caller',
    );
    const stillThere = await repoBviaB.findManyForChat(chatB.id as string);
    expect(stillThere.length).toBe(2);
  });

  it('does not delete when afterMessageId belongs to a different chat owned by same user', async () => {
    const { user, chapterId } = await createUserWithChapter();
    const chatRepo = createChatRepo(user.req);
    const repo = createMessageRepo(user.req);
    const chatA = await chatRepo.create({ chapterId, kind: 'ask', title: null });
    const chatB = await chatRepo.create({ chapterId, kind: 'ask', title: null });

    // Two messages in chat A — they should survive. The user-msg ref is
    // unused; we only need to assert chat A's row count post-call.
    const _userMsgA = await repo.create({
      chatId: chatA.id as string,
      role: 'user',
      contentJson: 'A user',
    });
    await new Promise((r) => setTimeout(r, 2));
    await repo.create({
      chatId: chatA.id as string,
      role: 'assistant',
      contentJson: 'A assistant',
    });

    // One message in chat B.
    const userMsgB = await repo.create({
      chatId: chatB.id as string,
      role: 'user',
      contentJson: 'B user',
    });

    // Asking to delete in chat A with a ref id from chat B → no-op.
    const result = await repo.deleteAllAfter(chatA.id as string, userMsgB.id as string);

    expect(result.count).toBe(0);
    const stillThereA = await repo.findManyForChat(chatA.id as string);
    expect(stillThereA.length).toBe(2);
  });
});
