import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../setup';

// Post-[E11] character narrative fields are ciphertext-only. Schema-shape +
// cascade tests only; repo-layer encrypt/decrypt is covered in
// tests/repos/character.repo.test.ts.

async function makeStory(email = 'char-author@example.com') {
  const username = email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
  const user = await prisma.user.create({ data: { email, username, passwordHash: 'h' } });
  return prisma.story.create({ data: { userId: user.id } });
}

describe('Character model', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await prisma.user.deleteMany();
  });

  it('creates a character with nullable ciphertext fields', async () => {
    const story = await makeStory();
    const character = await prisma.character.create({
      data: { storyId: story.id, color: '#abcdef', initial: 'A' },
    });
    expect(character.id).toMatch(/^c[a-z0-9]+$/);
    expect(character.color).toBe('#abcdef');
    expect(character.initial).toBe('A');
    // Every narrative field is ciphertext-only and nullable.
    expect(character.nameCiphertext).toBeNull();
    expect(character.roleCiphertext).toBeNull();
    expect(character.physicalDescriptionCiphertext).toBeNull();
    expect(character.personalityCiphertext).toBeNull();
    expect(character.backstoryCiphertext).toBeNull();
    expect(character.notesCiphertext).toBeNull();
    expect(character.storyId).toBe(story.id);
    expect(character.createdAt).toBeInstanceOf(Date);
    expect(character.updatedAt).toBeInstanceOf(Date);
  });

  it('allows multiple characters per story', async () => {
    const story = await makeStory('char-c@example.com');
    await prisma.character.createMany({
      data: [{ storyId: story.id }, { storyId: story.id }, { storyId: story.id }],
    });
    expect(await prisma.character.count({ where: { storyId: story.id } })).toBe(3);
  });

  it('cascades character deletes when the story is deleted', async () => {
    const story = await makeStory('char-d@example.com');
    await prisma.character.create({ data: { storyId: story.id } });
    await prisma.story.delete({ where: { id: story.id } });
    expect(await prisma.character.count({ where: { storyId: story.id } })).toBe(0);
  });
});
