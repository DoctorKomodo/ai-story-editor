import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../setup';

// Post-[E11] the narrative columns (title, synopsis, worldNotes, systemPrompt)
// are ciphertext-only. This file tests only model SHAPE + cascade behaviour —
// repo-layer encrypt/decrypt is covered by tests/repos/story.repo.test.ts.

async function makeUser(email = 'author@example.com') {
  const username = email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
  return prisma.user.create({ data: { email, username, passwordHash: 'h' } });
}

describe('Story model', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await prisma.user.deleteMany();
  });

  it('creates a story owned by a user (plaintext non-narrative fields only)', async () => {
    const user = await makeUser();
    const story = await prisma.story.create({
      data: {
        genre: 'fantasy',
        targetWords: 80000,
        userId: user.id,
      },
    });
    expect(story.id).toMatch(/^c[a-z0-9]+$/);
    expect(story.genre).toBe('fantasy');
    expect(story.targetWords).toBe(80000);
    expect(story.userId).toBe(user.id);
    expect(story.createdAt).toBeInstanceOf(Date);
    expect(story.updatedAt).toBeInstanceOf(Date);
  });

  it('allows nullable non-narrative fields', async () => {
    const user = await makeUser('b@example.com');
    const story = await prisma.story.create({ data: { userId: user.id } });
    expect(story.genre).toBeNull();
    expect(story.targetWords).toBeNull();
    // Ciphertext triples are nullable too.
    expect(story.titleCiphertext).toBeNull();
    expect(story.synopsisCiphertext).toBeNull();
    expect(story.worldNotesCiphertext).toBeNull();
    expect(story.systemPromptCiphertext).toBeNull();
  });

  it('cascades chapter and character deletes when the story is deleted', async () => {
    const user = await makeUser('c@example.com');
    const story = await prisma.story.create({ data: { userId: user.id } });
    await prisma.chapter.create({ data: { orderIndex: 0, storyId: story.id } });
    await prisma.character.create({ data: { storyId: story.id, orderIndex: 0 } });

    await prisma.story.delete({ where: { id: story.id } });

    expect(await prisma.chapter.count({ where: { storyId: story.id } })).toBe(0);
    expect(await prisma.character.count({ where: { storyId: story.id } })).toBe(0);
  });

  it('cascades story deletes when the user is deleted', async () => {
    const user = await makeUser('d@example.com');
    await prisma.story.create({ data: { userId: user.id } });
    await prisma.story.create({ data: { userId: user.id } });

    await prisma.user.delete({ where: { id: user.id } });

    expect(await prisma.story.count({ where: { userId: user.id } })).toBe(0);
  });
});
