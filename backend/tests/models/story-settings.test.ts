import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../setup';

// Post-[E11] Story.systemPrompt is ciphertext-only. This file keeps coverage
// of the surviving plaintext setting — targetWords. systemPrompt round-trip
// is in tests/repos/story.repo.test.ts.

async function makeUser(email = 'settings-user@example.com') {
  const username = email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
  return prisma.user.create({ data: { email, username, passwordHash: 'h' } });
}

describe('Story settings (targetWords plaintext)', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await prisma.user.deleteMany();
  });

  it('defaults targetWords to null when omitted', async () => {
    const user = await makeUser();
    const story = await prisma.story.create({ data: { userId: user.id } });
    expect(story.targetWords).toBeNull();
    expect(story.systemPromptCiphertext).toBeNull();
  });

  it('persists targetWords when provided', async () => {
    const user = await makeUser('set@example.com');
    const story = await prisma.story.create({
      data: { userId: user.id, targetWords: 90000 },
    });
    expect(story.targetWords).toBe(90000);
  });

  it('allows updating targetWords independently', async () => {
    const user = await makeUser('upd@example.com');
    const story = await prisma.story.create({ data: { userId: user.id } });
    const withTarget = await prisma.story.update({
      where: { id: story.id },
      data: { targetWords: 50000 },
    });
    expect(withTarget.targetWords).toBe(50000);

    const cleared = await prisma.story.update({
      where: { id: story.id },
      data: { targetWords: null },
    });
    expect(cleared.targetWords).toBeNull();
  });
});
