import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetUsers } from '../helpers/db';
import { prisma } from '../setup';

// Lane note: this file uses raw Prisma deliberately. It asserts SCHEMA
// invariants (nullable ciphertext columns, multi-row insert, ON DELETE
// CASCADE on the storyId FK), not narrative data round-trips. The repo
// layer is the right boundary for app code and for content tests
// (tests/repos/character.repo.test.ts); raw Prisma is the right boundary
// for "does the database enforce this constraint" tests, which is what
// these are. Do not migrate to the repo — the repo's encrypt-on-write
// path can't express "create a row with all-null ciphertext columns" or
// "trigger an FK cascade."

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
    await resetUsers();
  });

  afterEach(async () => {
    await resetUsers();
  });

  it('creates a character with nullable ciphertext fields', async () => {
    const story = await makeStory();
    const character = await prisma.character.create({
      data: {
        storyId: story.id,
        orderIndex: 0,
        userId: story.userId,
        color: '#abcdef',
        initial: 'A',
      },
    });
    expect(character.id).toMatch(/^c[a-z0-9]+$/);
    expect(character.color).toBe('#abcdef');
    expect(character.initial).toBe('A');
    // Every narrative field is ciphertext-only and nullable.
    expect(character.nameCiphertext).toBeNull();
    expect(character.roleCiphertext).toBeNull();
    expect(character.relationshipsCiphertext).toBeNull();
    expect(character.personalityCiphertext).toBeNull();
    expect(character.backstoryCiphertext).toBeNull();
    expect(character.storyId).toBe(story.id);
    expect(character.createdAt).toBeInstanceOf(Date);
    expect(character.updatedAt).toBeInstanceOf(Date);
  });

  it('allows multiple characters per story', async () => {
    const story = await makeStory('char-c@example.com');
    await prisma.character.createMany({
      data: [
        { storyId: story.id, orderIndex: 0, userId: story.userId },
        { storyId: story.id, orderIndex: 1, userId: story.userId },
        { storyId: story.id, orderIndex: 2, userId: story.userId },
      ],
    });
    expect(await prisma.character.count({ where: { storyId: story.id } })).toBe(3);
  });

  it('cascades character deletes when the story is deleted', async () => {
    const story = await makeStory('char-d@example.com');
    await prisma.character.create({
      data: { storyId: story.id, orderIndex: 0, userId: story.userId },
    });
    await prisma.story.delete({ where: { id: story.id } });
    expect(await prisma.character.count({ where: { storyId: story.id } })).toBe(0);
  });
});
