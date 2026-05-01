import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCharacterRepo } from '../../src/repos/character.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { prisma } from '../setup';
import { makeUserContext, resetAllTables } from './_req';

describe('[E9] character.repo', () => {
  beforeEach(resetAllTables);
  afterEach(resetAllTables);

  it('round-trips every narrative field; keeps color + initial plaintext', async () => {
    const ctx = await makeUserContext();
    const story = await createStoryRepo(ctx.req).create({ title: 's' });
    const repo = createCharacterRepo(ctx.req);

    const created = await repo.create({
      storyId: story.id as string,
      name: 'Astra',
      orderIndex: 0,
      role: 'deuteragonist',
      age: '27',
      appearance: 'tall, scar across left brow',
      voice: 'gravelly',
      arc: 'reluctance → conviction',
      color: '#abc123',
      initial: 'A',
      physicalDescription: 'lanky',
      personality: 'sharp, wary',
      backstory: 'raised in the coastal guild',
      notes: 'left-handed duelist',
    });

    expect(created.name).toBe('Astra');
    expect(created.role).toBe('deuteragonist');
    expect(created.backstory).toBe('raised in the coastal guild');
    expect(created.color).toBe('#abc123');
    expect(created.initial).toBe('A');

    const raw = await prisma.character.findUniqueOrThrow({ where: { id: created.id as string } });
    expect(raw.backstoryCiphertext).toBeTruthy();
    expect(raw.personalityCiphertext).toBeTruthy();
  });

  it('update only rewrites the fields the caller supplied', async () => {
    const ctx = await makeUserContext();
    const story = await createStoryRepo(ctx.req).create({ title: 's' });
    const repo = createCharacterRepo(ctx.req);
    const c = await repo.create({
      storyId: story.id as string,
      name: 'N',
      orderIndex: 0,
      role: 'antagonist',
    });
    const before = await prisma.character.findUniqueOrThrow({ where: { id: c.id as string } });

    const updated = await repo.update(c.id as string, { name: 'N2' });
    expect(updated?.name).toBe('N2');
    expect(updated?.role).toBe('antagonist');

    const after = await prisma.character.findUniqueOrThrow({ where: { id: c.id as string } });
    expect(after.nameCiphertext).not.toBe(before.nameCiphertext);
    expect(after.roleCiphertext).toBe(before.roleCiphertext);
  });
});
