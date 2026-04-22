import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../setup';
import { SENTINEL, createStoryRow, createUser, resetNarrativeTables } from './_helpers';

describe('[E5] Chapter — ciphertext columns', () => {
  beforeEach(resetNarrativeTables);
  afterEach(resetNarrativeTables);

  it('persists title + body ciphertext triples alongside the plaintext dual-write columns', async () => {
    const user = await createUser();
    const story = await createStoryRow(user.id);
    const created = await prisma.chapter.create({
      data: {
        storyId: story.id,
        title: 'Dual write title',
        content: 'Dual write content',
        orderIndex: 0,
        wordCount: 3,
        titleCiphertext: SENTINEL.ciphertext,
        titleIv: SENTINEL.iv,
        titleAuthTag: SENTINEL.authTag,
        bodyCiphertext: SENTINEL.ciphertext,
        bodyIv: SENTINEL.iv,
        bodyAuthTag: SENTINEL.authTag,
      },
    });
    const read = await prisma.chapter.findUniqueOrThrow({ where: { id: created.id } });
    expect(read.titleCiphertext).toBe(SENTINEL.ciphertext);
    expect(read.bodyCiphertext).toBe(SENTINEL.ciphertext);
    expect(read.bodyIv).toBe(SENTINEL.iv);
    expect(read.bodyAuthTag).toBe(SENTINEL.authTag);
  });

  it('keeps orderIndex, status, storyId, wordCount plaintext — needed for UI/progress', async () => {
    const user = await createUser();
    const story = await createStoryRow(user.id);
    const created = await prisma.chapter.create({
      data: {
        storyId: story.id,
        title: 'x',
        orderIndex: 7,
        status: 'draft',
        wordCount: 1234,
      },
    });
    expect(created.orderIndex).toBe(7);
    expect(created.status).toBe('draft');
    expect(created.wordCount).toBe(1234);
    expect(created.storyId).toBe(story.id);
  });

  it('ciphertext columns nullable during dual-write window', async () => {
    const user = await createUser();
    const story = await createStoryRow(user.id);
    const created = await prisma.chapter.create({
      data: { storyId: story.id, title: 'y', orderIndex: 0 },
    });
    expect(created.titleCiphertext).toBeNull();
    expect(created.bodyCiphertext).toBeNull();
  });
});
