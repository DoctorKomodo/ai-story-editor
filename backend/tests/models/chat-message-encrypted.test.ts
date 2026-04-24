import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../setup';
import {
  createChapterRow,
  createChatRow,
  createStoryRow,
  createUser,
  resetNarrativeTables,
  SENTINEL,
} from './_helpers';

describe('[E8] Chat + Message — ciphertext columns', () => {
  beforeEach(resetNarrativeTables);
  afterEach(resetNarrativeTables);

  it('Chat persists title ciphertext triple', async () => {
    const user = await createUser();
    const story = await createStoryRow(user.id);
    const chapter = await createChapterRow(story.id);
    const created = await prisma.chat.create({
      data: {
        chapterId: chapter.id,
        titleCiphertext: SENTINEL.ciphertext,
        titleIv: SENTINEL.iv,
        titleAuthTag: SENTINEL.authTag,
      },
    });
    const read = await prisma.chat.findUniqueOrThrow({ where: { id: created.id } });
    expect(read.titleCiphertext).toBe(SENTINEL.ciphertext);
  });

  it('Message persists contentJson + attachmentJson ciphertext triples', async () => {
    const user = await createUser();
    const story = await createStoryRow(user.id);
    const chapter = await createChapterRow(story.id);
    const chat = await createChatRow(chapter.id);
    const created = await prisma.message.create({
      data: {
        chatId: chat.id,
        role: 'user',
        contentJsonCiphertext: SENTINEL.ciphertext,
        contentJsonIv: SENTINEL.iv,
        contentJsonAuthTag: SENTINEL.authTag,
        attachmentJsonCiphertext: SENTINEL.ciphertext,
        attachmentJsonIv: SENTINEL.iv,
        attachmentJsonAuthTag: SENTINEL.authTag,
      },
    });
    const read = await prisma.message.findUniqueOrThrow({ where: { id: created.id } });
    expect(read.contentJsonCiphertext).toBe(SENTINEL.ciphertext);
    expect(read.attachmentJsonCiphertext).toBe(SENTINEL.ciphertext);
  });

  it('Keeps role, model, tokens, latencyMs, timestamps plaintext (chat header + regen flow)', async () => {
    const user = await createUser();
    const story = await createStoryRow(user.id);
    const chapter = await createChapterRow(story.id);
    const chat = await createChatRow(chapter.id);
    const created = await prisma.message.create({
      data: {
        chatId: chat.id,
        role: 'assistant',
        model: 'venice-mini',
        tokens: 42,
        latencyMs: 1234,
      },
    });
    expect(created.role).toBe('assistant');
    expect(created.model).toBe('venice-mini');
    expect(created.tokens).toBe(42);
    expect(created.latencyMs).toBe(1234);
  });
});
