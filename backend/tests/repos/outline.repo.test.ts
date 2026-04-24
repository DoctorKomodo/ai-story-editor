import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createOutlineRepo } from '../../src/repos/outline.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { prisma } from '../setup';
import { makeUserContext, resetAllTables } from './_req';

describe('[E9] outline.repo', () => {
  beforeEach(resetAllTables);
  afterEach(resetAllTables);

  it('round-trips title + sub; keeps order + status plaintext', async () => {
    const ctx = await makeUserContext();
    const story = await createStoryRepo(ctx.req).create({ title: 's' });
    const repo = createOutlineRepo(ctx.req);

    const a = await repo.create({
      storyId: story.id as string,
      order: 0,
      title: 'Act 1',
      sub: 'Setup',
      status: 'done',
    });
    const b = await repo.create({
      storyId: story.id as string,
      order: 1,
      title: 'Act 2',
      sub: 'Confrontation',
      status: 'active',
    });

    expect(a.title).toBe('Act 1');
    expect(a.sub).toBe('Setup');
    expect(b.order).toBe(1);

    const raw = await prisma.outlineItem.findUniqueOrThrow({ where: { id: a.id as string } });
    expect(raw.titleCiphertext).toBeTruthy();
    expect(raw.subCiphertext).toBeTruthy();

    const list = await repo.findManyForStory(story.id as string);
    expect(list.map((i) => i.title)).toEqual(['Act 1', 'Act 2']);
  });
});
