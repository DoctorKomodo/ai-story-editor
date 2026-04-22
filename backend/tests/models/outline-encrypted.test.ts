import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../setup';
import { SENTINEL, createStoryRow, createUser, resetNarrativeTables } from './_helpers';

describe('[E7] OutlineItem — ciphertext columns', () => {
  beforeEach(resetNarrativeTables);
  afterEach(resetNarrativeTables);

  it('persists title + sub ciphertext triples', async () => {
    const user = await createUser();
    const story = await createStoryRow(user.id);
    const created = await prisma.outlineItem.create({
      data: {
        storyId: story.id,
        order: 0,
        status: 'done',
        titleCiphertext: SENTINEL.ciphertext,
        titleIv: SENTINEL.iv,
        titleAuthTag: SENTINEL.authTag,
        subCiphertext: SENTINEL.ciphertext,
        subIv: SENTINEL.iv,
        subAuthTag: SENTINEL.authTag,
      },
    });
    const read = await prisma.outlineItem.findUniqueOrThrow({ where: { id: created.id } });
    expect(read.titleCiphertext).toBe(SENTINEL.ciphertext);
    expect(read.subCiphertext).toBe(SENTINEL.ciphertext);
  });

  it('keeps order, status, storyId plaintext (sort/filter + FK)', async () => {
    const user = await createUser();
    const story = await createStoryRow(user.id);
    const created = await prisma.outlineItem.create({
      data: { storyId: story.id, order: 3, status: 'active' },
    });
    expect(created.order).toBe(3);
    expect(created.status).toBe('active');
    expect(created.storyId).toBe(story.id);
  });
});
