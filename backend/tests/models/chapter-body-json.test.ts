import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../setup';

async function makeStory(email = 'body-json-author@example.com') {
  const username = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const user = await prisma.user.create({ data: { email, username, passwordHash: 'h' } });
  return prisma.story.create({ data: { title: 'Host', userId: user.id } });
}

const sampleDoc = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'The lighthouse flickered once, then again.' }],
    },
  ],
};

describe('Chapter body-json + status', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await prisma.user.deleteMany();
  });

  it('defaults bodyJson to null and status to "draft"', async () => {
    const story = await makeStory();
    const chapter = await prisma.chapter.create({
      data: { title: 'Opening', orderIndex: 0, storyId: story.id },
    });
    expect(chapter.bodyJson).toBeNull();
    expect(chapter.status).toBe('draft');
  });

  it('round-trips TipTap JSON unchanged', async () => {
    const story = await makeStory('rt@example.com');
    const chapter = await prisma.chapter.create({
      data: {
        title: 'Two',
        orderIndex: 0,
        storyId: story.id,
        bodyJson: sampleDoc,
      },
    });
    const loaded = await prisma.chapter.findUniqueOrThrow({ where: { id: chapter.id } });
    expect(loaded.bodyJson).toEqual(sampleDoc);
  });

  it('accepts the three known status values', async () => {
    const story = await makeStory('st@example.com');
    for (const [i, status] of ['draft', 'revised', 'final'].entries()) {
      const c = await prisma.chapter.create({
        data: { title: `C${i}`, orderIndex: i, storyId: story.id, status },
      });
      expect(c.status).toBe(status);
    }
  });

  it('keeps the plaintext content mirror alongside bodyJson', async () => {
    const story = await makeStory('mirror@example.com');
    const chapter = await prisma.chapter.create({
      data: {
        title: 'Mirror',
        orderIndex: 0,
        storyId: story.id,
        content: 'The lighthouse flickered once, then again.',
        wordCount: 7,
        bodyJson: sampleDoc,
      },
    });
    expect(chapter.content).toBe('The lighthouse flickered once, then again.');
    expect(chapter.wordCount).toBe(7);
    expect(chapter.bodyJson).toEqual(sampleDoc);
  });
});
