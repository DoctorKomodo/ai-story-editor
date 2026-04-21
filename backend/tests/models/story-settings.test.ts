import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../setup';

async function makeUser(email = 'settings-user@example.com') {
  const username = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return prisma.user.create({ data: { email, username, passwordHash: 'h' } });
}

describe('Story settings (targetWords, systemPrompt)', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await prisma.user.deleteMany();
  });

  it('defaults targetWords and systemPrompt to null when omitted', async () => {
    const user = await makeUser();
    const story = await prisma.story.create({
      data: { title: 'Untitled', userId: user.id },
    });
    expect(story.targetWords).toBeNull();
    expect(story.systemPrompt).toBeNull();
  });

  it('persists targetWords and systemPrompt when provided', async () => {
    const user = await makeUser('set@example.com');
    const story = await prisma.story.create({
      data: {
        title: 'Goaled Story',
        userId: user.id,
        targetWords: 90000,
        systemPrompt: 'You are a gothic-horror novelist.',
      },
    });
    expect(story.targetWords).toBe(90000);
    expect(story.systemPrompt).toBe('You are a gothic-horror novelist.');
  });

  it('allows updating targetWords and systemPrompt independently', async () => {
    const user = await makeUser('upd@example.com');
    const story = await prisma.story.create({
      data: { title: 'Mutable', userId: user.id },
    });
    const withTarget = await prisma.story.update({
      where: { id: story.id },
      data: { targetWords: 50000 },
    });
    expect(withTarget.targetWords).toBe(50000);
    expect(withTarget.systemPrompt).toBeNull();

    const cleared = await prisma.story.update({
      where: { id: story.id },
      data: { targetWords: null },
    });
    expect(cleared.targetWords).toBeNull();
  });
});
