import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCharacterRepo } from '../../src/repos/character.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { makeUserContext, resetAllTables } from './_req';

describe('character.repo — orderIndex', () => {
  beforeEach(resetAllTables);
  afterEach(resetAllTables);

  describe('create()', () => {
    it('assigns orderIndex starting at 0 for the first character in a story', async () => {
      const ctx = await makeUserContext('co-first');
      const story = await createStoryRepo(ctx.req).create({ title: 's' });
      const repo = createCharacterRepo(ctx.req);

      const a = await repo.create({ storyId: story.id as string, name: 'A', orderIndex: 0 });
      expect(a.orderIndex).toBe(0);
    });

    it('starts at maxOrderIndex + 1 in stories that already have characters', async () => {
      const ctx = await makeUserContext('co-next');
      const story = await createStoryRepo(ctx.req).create({ title: 's' });
      const repo = createCharacterRepo(ctx.req);

      await repo.create({ storyId: story.id as string, name: 'A', orderIndex: 0 });
      await repo.create({ storyId: story.id as string, name: 'B', orderIndex: 1 });
      const max = await repo.maxOrderIndex(story.id as string);
      expect(max).toBe(1);
    });

    it('maxOrderIndex returns null for an empty story', async () => {
      const ctx = await makeUserContext('co-empty');
      const story = await createStoryRepo(ctx.req).create({ title: 's' });
      const repo = createCharacterRepo(ctx.req);
      const max = await repo.maxOrderIndex(story.id as string);
      expect(max).toBeNull();
    });
  });

  describe('findManyForStory()', () => {
    it('orders by (orderIndex asc, createdAt asc)', async () => {
      const ctx = await makeUserContext('co-order');
      const story = await createStoryRepo(ctx.req).create({ title: 's' });
      const repo = createCharacterRepo(ctx.req);
      const a = await repo.create({ storyId: story.id as string, name: 'A', orderIndex: 2 });
      const b = await repo.create({ storyId: story.id as string, name: 'B', orderIndex: 0 });
      const c = await repo.create({ storyId: story.id as string, name: 'C', orderIndex: 1 });
      const list = await repo.findManyForStory(story.id as string);
      expect(list.map((ch) => ch.id)).toEqual([b.id, c.id, a.id]);
    });
  });
});
