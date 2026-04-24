import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../setup';

// Post-[E11] the mockup-card narrative fields (name, role, age, appearance,
// voice, arc, physicalDescription, personality, backstory, notes) are
// ciphertext-only. Only `initial` + `color` (UI hints) remain plaintext
// on Character. Round-trip of the narrative fields is covered by
// tests/repos/character.repo.test.ts.

async function makeStory(email = 'char-mockup-author@example.com') {
  const username = email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
  const user = await prisma.user.create({ data: { email, username, passwordHash: 'h' } });
  return prisma.story.create({ data: { userId: user.id } });
}

describe('Character plaintext shape (post-E11)', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await prisma.user.deleteMany();
  });

  it('defaults initial + color to null', async () => {
    const story = await makeStory();
    const c = await prisma.character.create({
      data: { storyId: story.id },
    });
    expect(c.initial).toBeNull();
    expect(c.color).toBeNull();
  });

  it('persists initial + color (UI-hint columns)', async () => {
    const story = await makeStory('card@example.com');
    const c = await prisma.character.create({
      data: {
        storyId: story.id,
        initial: 'E',
        color: '#a88b4c',
      },
    });
    expect(c.initial).toBe('E');
    expect(c.color).toBe('#a88b4c');
  });
});
