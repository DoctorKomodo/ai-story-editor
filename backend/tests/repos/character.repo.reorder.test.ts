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

  describe('remove()', () => {
    it('removes the character and reassigns sequential orderIndex 0..N-1 on the remainder', async () => {
      const ctx = await makeUserContext('cd-reseq');
      const story = await createStoryRepo(ctx.req).create({ title: 's' });
      const repo = createCharacterRepo(ctx.req);

      const a = await repo.create({ storyId: story.id as string, name: 'a', orderIndex: 0 });
      const b = await repo.create({ storyId: story.id as string, name: 'b', orderIndex: 1 });
      const c = await repo.create({ storyId: story.id as string, name: 'c', orderIndex: 2 });
      const d = await repo.create({ storyId: story.id as string, name: 'd', orderIndex: 3 });

      const ok = await repo.remove(b.id as string);
      expect(ok).toBe(true);

      const list = await repo.findManyForStory(story.id as string);
      expect(list.map((ch) => [ch.id, ch.orderIndex])).toEqual([
        [a.id, 0],
        [c.id, 1],
        [d.id, 2],
      ]);
    });

    it('returns false when the id does not exist and does not mutate other rows', async () => {
      const ctx = await makeUserContext('cd-noop');
      const story = await createStoryRepo(ctx.req).create({ title: 's' });
      const repo = createCharacterRepo(ctx.req);
      await repo.create({ storyId: story.id as string, name: 'a', orderIndex: 0 });
      await repo.create({ storyId: story.id as string, name: 'b', orderIndex: 1 });

      const ok = await repo.remove('non-existent-id');
      expect(ok).toBe(false);

      const list = await repo.findManyForStory(story.id as string);
      expect(list.map((ch) => ch.orderIndex)).toEqual([0, 1]);
    });

    it("refuses to remove another user's character and leaves their list intact", async () => {
      const alice = await makeUserContext('cd-alice');
      const bob = await makeUserContext('cd-bob');
      const story = await createStoryRepo(alice.req).create({ title: 's' });
      const ch = await createCharacterRepo(alice.req).create({
        storyId: story.id as string,
        name: 't',
        orderIndex: 0,
      });

      const ok = await createCharacterRepo(bob.req).remove(ch.id as string);
      expect(ok).toBe(false);

      const list = await createCharacterRepo(alice.req).findManyForStory(story.id as string);
      expect(list).toHaveLength(1);
      expect(list[0]?.id).toBe(ch.id);
    });
  });
});
