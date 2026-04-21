import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../setup';

async function makeStory(email = 'char-author@example.com') {
  const user = await prisma.user.create({ data: { email, passwordHash: 'h' } });
  return prisma.story.create({ data: { title: 'Host Story', userId: user.id } });
}

describe('Character model', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await prisma.user.deleteMany();
  });

  it('creates a character with a name and nullable detail fields', async () => {
    const story = await makeStory();
    const character = await prisma.character.create({
      data: { name: 'Aria', storyId: story.id },
    });
    expect(character.id).toMatch(/^c[a-z0-9]+$/);
    expect(character.name).toBe('Aria');
    expect(character.role).toBeNull();
    expect(character.physicalDescription).toBeNull();
    expect(character.personality).toBeNull();
    expect(character.backstory).toBeNull();
    expect(character.notes).toBeNull();
    expect(character.storyId).toBe(story.id);
    expect(character.createdAt).toBeInstanceOf(Date);
    expect(character.updatedAt).toBeInstanceOf(Date);
  });

  it('stores all descriptive fields', async () => {
    const story = await makeStory('char-b@example.com');
    const character = await prisma.character.create({
      data: {
        name: 'Kestrel',
        role: 'protagonist',
        physicalDescription: 'Tall, dark hair, grey eyes.',
        personality: 'Quiet, observant, dry humour.',
        backstory: 'Orphaned at twelve, raised by a guild.',
        notes: 'Favours short blades.',
        storyId: story.id,
      },
    });
    expect(character.role).toBe('protagonist');
    expect(character.physicalDescription).toContain('grey eyes');
    expect(character.personality).toContain('dry humour');
    expect(character.backstory).toContain('Orphaned');
    expect(character.notes).toContain('short blades');
  });

  it('allows multiple characters per story', async () => {
    const story = await makeStory('char-c@example.com');
    await prisma.character.createMany({
      data: [
        { name: 'One', storyId: story.id },
        { name: 'Two', storyId: story.id },
        { name: 'Three', storyId: story.id },
      ],
    });
    expect(await prisma.character.count({ where: { storyId: story.id } })).toBe(3);
  });

  it('cascades character deletes when the story is deleted', async () => {
    const story = await makeStory('char-d@example.com');
    await prisma.character.create({ data: { name: 'Vanishes', storyId: story.id } });
    await prisma.story.delete({ where: { id: story.id } });
    expect(await prisma.character.count({ where: { storyId: story.id } })).toBe(0);
  });
});
