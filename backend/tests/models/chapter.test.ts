import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../setup';

async function makeStory(email = 'ch-author@example.com') {
  const user = await prisma.user.create({ data: { email, passwordHash: 'h' } });
  return prisma.story.create({ data: { title: 'Host Story', userId: user.id } });
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
      data: { title: 'Opening', orderIndex: 0, storyId: story.id },
    });
    expect(chapter.id).toMatch(/^c[a-z0-9]+$/);
    expect(chapter.title).toBe('Opening');
    expect(chapter.content).toBe('');
    expect(chapter.wordCount).toBe(0);
    expect(chapter.orderIndex).toBe(0);
    expect(chapter.storyId).toBe(story.id);
    expect(chapter.createdAt).toBeInstanceOf(Date);
    expect(chapter.updatedAt).toBeInstanceOf(Date);
  });

  it('stores content and wordCount', async () => {
    const story = await makeStory('ch-b@example.com');
    const chapter = await prisma.chapter.create({
      data: {
        title: 'Two',
        content: 'Once upon a time there was a dog.',
        orderIndex: 1,
        wordCount: 9,
        storyId: story.id,
      },
    });
    expect(chapter.content).toContain('Once upon a time');
    expect(chapter.wordCount).toBe(9);
  });

  it('orders chapters by orderIndex within a story', async () => {
    const story = await makeStory('ch-c@example.com');
    await prisma.chapter.createMany({
      data: [
        { title: 'C', orderIndex: 2, storyId: story.id },
        { title: 'A', orderIndex: 0, storyId: story.id },
        { title: 'B', orderIndex: 1, storyId: story.id },
      ],
    });
    const ordered = await prisma.chapter.findMany({
      where: { storyId: story.id },
      orderBy: { orderIndex: 'asc' },
    });
    expect(ordered.map((c) => c.title)).toEqual(['A', 'B', 'C']);
  });

  it('cascades chapter deletes when the story is deleted', async () => {
    const story = await makeStory('ch-d@example.com');
    await prisma.chapter.create({
      data: { title: 'X', orderIndex: 0, storyId: story.id },
    });
    await prisma.story.delete({ where: { id: story.id } });
    expect(await prisma.chapter.count({ where: { storyId: story.id } })).toBe(0);
  });
});
