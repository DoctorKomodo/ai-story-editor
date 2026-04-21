import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../setup';

async function makeStory(email = 'outline-author@example.com') {
  const username = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const user = await prisma.user.create({ data: { email, username, passwordHash: 'h' } });
  return prisma.story.create({ data: { title: 'Host', userId: user.id } });
}

describe('OutlineItem model', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await prisma.user.deleteMany();
  });

  it('creates an outline item with required fields', async () => {
    const story = await makeStory();
    const item = await prisma.outlineItem.create({
      data: {
        storyId: story.id,
        order: 0,
        title: 'The archivist meets the stranger',
        status: 'current',
      },
    });
    expect(item.id).toMatch(/^c[a-z0-9]+$/);
    expect(item.storyId).toBe(story.id);
    expect(item.order).toBe(0);
    expect(item.title).toContain('archivist');
    expect(item.sub).toBeNull();
    expect(item.status).toBe('current');
    expect(item.createdAt).toBeInstanceOf(Date);
    expect(item.updatedAt).toBeInstanceOf(Date);
  });

  it('supports sub + known status values', async () => {
    const story = await makeStory('st@example.com');
    for (const [i, status] of ['done', 'current', 'pending'].entries()) {
      const item = await prisma.outlineItem.create({
        data: {
          storyId: story.id,
          order: i,
          title: `Beat ${i}`,
          sub: `Sub ${i}`,
          status,
        },
      });
      expect(item.status).toBe(status);
      expect(item.sub).toBe(`Sub ${i}`);
    }
  });

  it('orders items by order within a story', async () => {
    const story = await makeStory('ord@example.com');
    await prisma.outlineItem.createMany({
      data: [
        { storyId: story.id, order: 2, title: 'C', status: 'pending' },
        { storyId: story.id, order: 0, title: 'A', status: 'done' },
        { storyId: story.id, order: 1, title: 'B', status: 'current' },
      ],
    });
    const ordered = await prisma.outlineItem.findMany({
      where: { storyId: story.id },
      orderBy: { order: 'asc' },
    });
    expect(ordered.map((o) => o.title)).toEqual(['A', 'B', 'C']);
  });

  it('cascades deletion when the parent story is deleted', async () => {
    const story = await makeStory('casc@example.com');
    await prisma.outlineItem.create({
      data: { storyId: story.id, order: 0, title: 'X', status: 'pending' },
    });
    await prisma.story.delete({ where: { id: story.id } });
    expect(await prisma.outlineItem.count({ where: { storyId: story.id } })).toBe(0);
  });
});
