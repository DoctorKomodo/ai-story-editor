import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../setup';

async function makeStory(email = 'char-mockup-author@example.com') {
  const username = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const user = await prisma.user.create({ data: { email, username, passwordHash: 'h' } });
  return prisma.story.create({ data: { title: 'Host', userId: user.id } });
}

describe('Character mockup card fields', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await prisma.user.deleteMany();
  });

  it('defaults the new mockup fields to null', async () => {
    const story = await makeStory();
    const c = await prisma.character.create({
      data: { name: 'Eira', storyId: story.id },
    });
    expect(c.age).toBeNull();
    expect(c.appearance).toBeNull();
    expect(c.voice).toBeNull();
    expect(c.arc).toBeNull();
    expect(c.initial).toBeNull();
    expect(c.color).toBeNull();
  });

  it('persists all mockup-card fields', async () => {
    const story = await makeStory('card@example.com');
    const c = await prisma.character.create({
      data: {
        name: 'Eira Vale',
        storyId: story.id,
        role: 'protagonist',
        age: '24',
        appearance: 'Grey-eyed, left-handed, nails bitten short.',
        voice: 'Dry, clipped, economical.',
        arc: 'From cautious archivist to reckless heretic.',
        initial: 'E',
        color: '#a88b4c',
      },
    });
    expect(c.name).toBe('Eira Vale');
    expect(c.role).toBe('protagonist');
    expect(c.age).toBe('24');
    expect(c.appearance).toContain('Grey-eyed');
    expect(c.voice).toContain('clipped');
    expect(c.arc).toContain('archivist');
    expect(c.initial).toBe('E');
    expect(c.color).toBe('#a88b4c');
  });

  it('retains legacy narrative fields alongside the new ones', async () => {
    const story = await makeStory('legacy@example.com');
    const c = await prisma.character.create({
      data: {
        name: 'Ward',
        storyId: story.id,
        physicalDescription: 'Tall, broad-shouldered.',
        personality: 'Taciturn.',
        backstory: 'Former smith, disappeared after the fire.',
        notes: 'Never mentions his sister.',
        appearance: 'Soot still under the nails.',
      },
    });
    expect(c.physicalDescription).toBe('Tall, broad-shouldered.');
    expect(c.personality).toBe('Taciturn.');
    expect(c.backstory).toContain('Former smith');
    expect(c.notes).toContain('sister');
    expect(c.appearance).toContain('Soot');
  });
});
