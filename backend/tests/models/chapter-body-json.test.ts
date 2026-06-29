import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../setup';

// Post-[E11] chapter body (TipTap JSON) is ciphertext-only in
// `bodyCiphertext/Iv/AuthTag`. Body round-trip is covered by
// tests/repos/chapter.repo.test.ts — here we only exercise the model
// shape that remains plaintext (orderIndex, wordCount).

async function makeStory(email = 'body-json-author@example.com') {
  const username = email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
  const user = await prisma.user.create({ data: { email, username, passwordHash: 'h' } });
  return prisma.story.create({ data: { userId: user.id } });
}

describe('Chapter plaintext shape (post-E11)', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await prisma.user.deleteMany();
  });

  it('defaults wordCount to 0', async () => {
    const story = await makeStory();
    const chapter = await prisma.chapter.create({
      data: { orderIndex: 0, storyId: story.id },
    });
    expect(chapter.wordCount).toBe(0);
    // Ciphertext triples are nullable.
    expect(chapter.bodyCiphertext).toBeNull();
    expect(chapter.titleCiphertext).toBeNull();
  });

  it('persists wordCount plaintext (derived at save time before encryption)', async () => {
    const story = await makeStory('wc@example.com');
    const chapter = await prisma.chapter.create({
      data: { orderIndex: 0, storyId: story.id, wordCount: 7 },
    });
    expect(chapter.wordCount).toBe(7);
  });
});
