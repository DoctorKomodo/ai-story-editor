import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../setup';

async function makeUser(email = 'author@example.com') {
  return prisma.user.create({ data: { email, passwordHash: 'h' } });
}

describe('Story model', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await prisma.user.deleteMany();
  });

  it('creates a story owned by a user', async () => {
    const user = await makeUser();
    const story = await prisma.story.create({
      data: {
        title: 'The Long Road',
        synopsis: 'An epic journey.',
        genre: 'fantasy',
        worldNotes: 'Two moons.',
        userId: user.id,
      },
    });
    expect(story.id).toMatch(/^c[a-z0-9]+$/);
    expect(story.title).toBe('The Long Road');
    expect(story.genre).toBe('fantasy');
    expect(story.userId).toBe(user.id);
    expect(story.createdAt).toBeInstanceOf(Date);
    expect(story.updatedAt).toBeInstanceOf(Date);
  });

  it('allows nullable narrative fields', async () => {
    const user = await makeUser('b@example.com');
    const story = await prisma.story.create({
      data: { title: 'Untitled', userId: user.id },
    });
    expect(story.synopsis).toBeNull();
    expect(story.genre).toBeNull();
    expect(story.worldNotes).toBeNull();
  });

  it('cascades chapter and character deletes when the story is deleted', async () => {
    const user = await makeUser('c@example.com');
    const story = await prisma.story.create({ data: { title: 'S', userId: user.id } });
    await prisma.chapter.create({
      data: { title: 'Ch 1', content: 'hi', orderIndex: 0, storyId: story.id },
    });
    await prisma.character.create({
      data: { name: 'Hero', storyId: story.id },
    });

    await prisma.story.delete({ where: { id: story.id } });

    expect(await prisma.chapter.count({ where: { storyId: story.id } })).toBe(0);
    expect(await prisma.character.count({ where: { storyId: story.id } })).toBe(0);
  });

  it('cascades story deletes when the user is deleted', async () => {
    const user = await makeUser('d@example.com');
    await prisma.story.create({ data: { title: 'A', userId: user.id } });
    await prisma.story.create({ data: { title: 'B', userId: user.id } });

    await prisma.user.delete({ where: { id: user.id } });

    expect(await prisma.story.count({ where: { userId: user.id } })).toBe(0);
  });
});
