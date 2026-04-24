import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../setup';

// Post-[E11] chapter narrative fields (title, bodyJson, content) are
// ciphertext-only. Schema-shape + cascade tests only.

async function makeStory(email = 'ch-author@example.com') {
  const username = email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
  const user = await prisma.user.create({ data: { email, username, passwordHash: 'h' } });
  return prisma.story.create({ data: { userId: user.id } });
}

describe('Chapter model', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await prisma.user.deleteMany();
  });

  it('creates a chapter with defaults', async () => {
    const story = await makeStory();
    const chapter = await prisma.chapter.create({
      data: { orderIndex: 0, storyId: story.id },
    });
    expect(chapter.id).toMatch(/^c[a-z0-9]+$/);
    expect(chapter.wordCount).toBe(0);
    expect(chapter.status).toBe('draft');
    expect(chapter.orderIndex).toBe(0);
    expect(chapter.storyId).toBe(story.id);
    expect(chapter.createdAt).toBeInstanceOf(Date);
    expect(chapter.updatedAt).toBeInstanceOf(Date);
  });

  it('stores wordCount as plaintext (derived from bodyJson before encryption)', async () => {
    const story = await makeStory('ch-b@example.com');
    const chapter = await prisma.chapter.create({
      data: {
        orderIndex: 1,
        wordCount: 9,
        storyId: story.id,
      },
    });
    expect(chapter.wordCount).toBe(9);
  });

  it('orders chapters by orderIndex within a story', async () => {
    const story = await makeStory('ch-c@example.com');
    await prisma.chapter.createMany({
      data: [
        { orderIndex: 2, storyId: story.id },
        { orderIndex: 0, storyId: story.id },
        { orderIndex: 1, storyId: story.id },
      ],
    });
    const ordered = await prisma.chapter.findMany({
      where: { storyId: story.id },
      orderBy: { orderIndex: 'asc' },
    });
    expect(ordered.map((c) => c.orderIndex)).toEqual([0, 1, 2]);
  });

  it('cascades chapter deletes when the story is deleted', async () => {
    const story = await makeStory('ch-d@example.com');
    await prisma.chapter.create({
      data: { orderIndex: 0, storyId: story.id },
    });
    await prisma.story.delete({ where: { id: story.id } });
    expect(await prisma.chapter.count({ where: { storyId: story.id } })).toBe(0);
  });
});
