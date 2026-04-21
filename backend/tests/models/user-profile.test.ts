import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../setup';

describe('User profile (name, settingsJson)', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await prisma.user.deleteMany();
  });

  it('defaults name and settingsJson to null', async () => {
    const user = await prisma.user.create({
      data: { email: 'p1@example.com', username: 'p1', passwordHash: 'h' },
    });
    expect(user.name).toBeNull();
    expect(user.settingsJson).toBeNull();
  });

  it('persists a display name', async () => {
    const user = await prisma.user.create({
      data: { email: 'p2@example.com', username: 'p2', passwordHash: 'h', name: 'Eira V.' },
    });
    expect(user.name).toBe('Eira V.');
  });

  it('round-trips a structured settingsJson payload', async () => {
    const settings = {
      theme: 'sepia',
      proseFont: 'Iowan Old Style',
      proseSize: 18,
      lineHeight: 1.7,
      writing: { typewriter: true, focusParagraph: false, autosave: true },
      dailyGoal: 800,
      chat: { model: 'venice-dolphin-70b', temperature: 0.85, top_p: 0.95, max_tokens: 800 },
    };
    const user = await prisma.user.create({
      data: {
        email: 'p3@example.com',
        username: 'p3',
        passwordHash: 'h',
        settingsJson: settings,
      },
    });
    const loaded = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(loaded.settingsJson).toEqual(settings);
  });
});
