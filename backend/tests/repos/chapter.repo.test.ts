import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeEncrypted } from '../../src/repos/_narrative';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createDraftRepo } from '../../src/repos/draft.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { resetDb } from '../helpers/db';
import { prisma } from '../setup';
import { makeUserContext } from './_req';

describe('[E9] chapter.repo — encrypt on write / decrypt on read', () => {
  beforeEach(resetDb);
  afterEach(resetDb);

  it('round-trips title + body (TipTap JSON tree) through encrypt/decrypt', async () => {
    const ctx = await makeUserContext();
    const story = await createStoryRepo(ctx.req).create({ title: 's' });
    const repo = createChapterRepo(ctx.req);

    const body = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The night was young.' }] }],
    };
    const created = await repo.create({
      storyId: story.id as string,
      title: 'Chapter One',
      bodyJson: body,
      wordCount: 4,
      orderIndex: 0,
    });

    expect(created.title).toBe('Chapter One');
    expect(created.bodyJson).toEqual(body);
    expect(created.wordCount).toBe(4);
    expect(created.orderIndex).toBe(0);

    // Ciphertext present in the DB.
    const raw = await prisma.chapter.findUniqueOrThrow({ where: { id: created.id as string } });
    expect(raw.titleCiphertext).toBeTruthy();
  });

  it('findById enforces ownership via nested story.userId', async () => {
    const alice = await makeUserContext('alice-ch');
    const bob = await makeUserContext('bob-ch');
    const story = await createStoryRepo(alice.req).create({ title: 's' });
    const ch = await createChapterRepo(alice.req).create({
      storyId: story.id as string,
      title: 't',
      orderIndex: 0,
    });
    const bobRepo = createChapterRepo(bob.req);
    expect(await bobRepo.findById(ch.id as string)).toBeNull();
  });

  it('findManyForStory returns metadata-only rows — title decrypted, no bodyJson', async () => {
    const ctx = await makeUserContext('many-meta');
    const story = await createStoryRepo(ctx.req).create({ title: 's' });
    const repo = createChapterRepo(ctx.req);
    const body = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'secret prose' }] }],
    };
    await repo.create({
      storyId: story.id as string,
      title: 'Encrypted Title',
      bodyJson: body,
      wordCount: 2,
      orderIndex: 0,
    });

    const list = await repo.findManyForStory(story.id as string);
    expect(list).toHaveLength(1);
    const ch = list[0]!;
    // Title is decrypted (otherwise the sidebar can't render).
    expect(ch.title).toBe('Encrypted Title');
    // Metadata is present.
    expect(ch.wordCount).toBe(2);
    expect(ch.orderIndex).toBe(0);
    // Body must NOT be present in the metadata projection — search the full
    // object so this fails loudly if a future change reintroduces it.
    expect(Object.keys(ch as Record<string, unknown>)).not.toContain('bodyJson');
    expect(Object.keys(ch as Record<string, unknown>)).not.toContain('body');
    // Ciphertext columns are stripped by `projectDecrypted` regardless.
    expect(Object.keys(ch as Record<string, unknown>)).not.toContain('bodyCiphertext');
    expect(Object.keys(ch as Record<string, unknown>)).not.toContain('titleCiphertext');
  });

  // [9wk.4] body/wordCount writes moved to draft.repo — narrowed
  // RepoChapterUpdateInput only accepts title/orderIndex now. Draft-side body
  // + wordCount round-trip (including raw-ciphertext assertions) is covered
  // by draft.repo.test.ts's "[9wk.4] update writes body + recomputed fields"
  // case.
  it('update replaces title ciphertext; orderIndex stays plaintext', async () => {
    const ctx = await makeUserContext();
    const story = await createStoryRepo(ctx.req).create({ title: 's' });
    const repo = createChapterRepo(ctx.req);
    const ch = await repo.create({
      storyId: story.id as string,
      title: 't',
      orderIndex: 0,
    });
    const updated = await repo.update(ch.id as string, { title: 'renamed', orderIndex: 1 });
    expect(updated?.title).toBe('renamed');
    expect(updated?.orderIndex).toBe(1);
  });

  it('[9wk.4] findById/findManyForStory source bodyJson/summary/wordCount from the ACTIVE DRAFT', async () => {
    const ctx = await makeUserContext('chapter-draft-backed');
    const story = await createStoryRepo(ctx.req).create({ title: 's' });
    const repo = createChapterRepo(ctx.req);
    const body = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'draft body' }] }],
    };
    const ch = await repo.create({
      storyId: story.id as string,
      title: 't',
      bodyJson: body,
      wordCount: 2,
      orderIndex: 0,
    });
    expect(ch.activeDraftId).not.toBeNull();
    expect(ch.draftCount).toBe(1);

    const draftRepo = createDraftRepo(ctx.req);
    const newBody = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'updated via draft' }] }],
    };
    await draftRepo.update(ch.activeDraftId as string, { bodyJson: newBody, wordCount: 5 });
    await draftRepo.update(ch.activeDraftId as string, {
      summaryJson: { events: 'e', stateAtEnd: 's', openThreads: 'o' },
    });

    const fetched = await repo.findById(ch.id as string);
    expect(fetched?.bodyJson).toEqual(newBody);
    expect(fetched?.wordCount).toBe(5);
    expect(fetched?.summary).toEqual({ events: 'e', stateAtEnd: 's', openThreads: 'o' });
    expect(fetched?.hasSummary).toBe(true);

    const list = await repo.findManyForStory(story.id as string);
    expect(list[0]!.wordCount).toBe(5);
    expect(list[0]!.hasSummary).toBe(true);
    expect(list[0]!.draftCount).toBe(1);
    expect(list[0]!.activeDraftId).toBe(ch.activeDraftId);
  });

  it('[9wk.4] findManyForStory({ includeSummary: true }) decrypts summary from the active draft, skips body', async () => {
    const ctx = await makeUserContext('chapter-draft-includesummary');
    const story = await createStoryRepo(ctx.req).create({ title: 's' });
    const repo = createChapterRepo(ctx.req);
    const ch = await repo.create({ storyId: story.id as string, title: 'Ch 1', orderIndex: 0 });

    await createDraftRepo(ctx.req).update(ch.activeDraftId as string, {
      summaryJson: { events: 'x', stateAtEnd: 'y', openThreads: 'z' },
    });

    const rows = await repo.findManyForStory(story.id as string, { includeSummary: true });
    expect(rows[0]).toMatchObject({
      id: ch.id,
      title: 'Ch 1',
      orderIndex: 0,
      summary: { events: 'x', stateAtEnd: 'y', openThreads: 'z' },
    });
    expect((rows[0] as unknown as { bodyJson?: unknown }).bodyJson).toBeUndefined();
  });

  it('[9wk.4] summaryIsStale becomes true once the active draft is updated after its summary', async () => {
    const ctx = await makeUserContext('chapter-draft-stale');
    const story = await createStoryRepo(ctx.req).create({ title: 's' });
    const repo = createChapterRepo(ctx.req);
    const ch = await repo.create({ storyId: story.id as string, title: 'Ch 1', orderIndex: 0 });
    const draftRepo = createDraftRepo(ctx.req);

    await draftRepo.update(ch.activeDraftId as string, {
      summaryJson: { events: 'a', stateAtEnd: 'b', openThreads: 'c' },
    });
    await new Promise((r) => setTimeout(r, 10));
    await draftRepo.update(ch.activeDraftId as string, {
      bodyJson: { type: 'doc', content: [] },
      wordCount: 0,
    });

    const list = await repo.findManyForStory(story.id as string);
    expect(list[0]!.summaryIsStale).toBe(true);
    const fetched = await repo.findById(ch.id as string);
    expect(fetched?.summaryIsStale).toBe(true);
  });

  it('[9wk.4] corrupted active-draft summary ciphertext: hasSummary=true but summary=null on chapter reads', async () => {
    const ctx = await makeUserContext('chapter-draft-corrupt');
    const story = await createStoryRepo(ctx.req).create({ title: 's' });
    const repo = createChapterRepo(ctx.req);
    const ch = await repo.create({ storyId: story.id as string, title: 'Ch 1', orderIndex: 0 });
    const draftId = ch.activeDraftId as string;

    await createDraftRepo(ctx.req).update(draftId, {
      summaryJson: { events: 'x', stateAtEnd: 'y', openThreads: 'z' },
    });
    // Same corrupt-but-decryptable technique as draft.repo.test.ts's
    // corrupted-summary case, applied to the DRAFT row (the source of truth
    // for chapter reads post-cutover).
    const corruptTriple = writeEncrypted(ctx.req, 'summaryJson', 'not-valid-json');
    await prisma.draft.update({
      where: { id: draftId },
      data: {
        summaryJsonCiphertext: corruptTriple.summaryJsonCiphertext,
        summaryJsonIv: corruptTriple.summaryJsonIv,
        summaryJsonAuthTag: corruptTriple.summaryJsonAuthTag,
      },
    });

    const fetched = await repo.findById(ch.id as string);
    expect(fetched?.hasSummary).toBe(true);
    expect(fetched?.summary).toBeNull();

    const rows = await repo.findManyForStory(story.id as string, { includeSummary: true });
    expect(rows[0]?.hasSummary).toBe(true);
    expect(rows[0]?.summary).toBeNull();
  });

  describe('remove() — orderIndex reassignment', () => {
    it('removes the chapter and reassigns sequential orderIndex 0..N-1 on the remainder', async () => {
      const ctx = await makeUserContext('rm-reseq');
      const story = await createStoryRepo(ctx.req).create({ title: 's' });
      const repo = createChapterRepo(ctx.req);

      const a = await repo.create({ storyId: story.id as string, title: 'a', orderIndex: 0 });
      const b = await repo.create({ storyId: story.id as string, title: 'b', orderIndex: 1 });
      const c = await repo.create({ storyId: story.id as string, title: 'c', orderIndex: 2 });
      const d = await repo.create({ storyId: story.id as string, title: 'd', orderIndex: 3 });

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
      const ctx = await makeUserContext('rm-noop');
      const story = await createStoryRepo(ctx.req).create({ title: 's' });
      const repo = createChapterRepo(ctx.req);
      await repo.create({ storyId: story.id as string, title: 'a', orderIndex: 0 });
      await repo.create({ storyId: story.id as string, title: 'b', orderIndex: 1 });

      const ok = await repo.remove('non-existent-id');
      expect(ok).toBe(false);

      const list = await repo.findManyForStory(story.id as string);
      expect(list.map((ch) => ch.orderIndex)).toEqual([0, 1]);
    });

    it("refuses to remove another user's chapter and leaves their list intact", async () => {
      const alice = await makeUserContext('rm-alice');
      const bob = await makeUserContext('rm-bob');
      const story = await createStoryRepo(alice.req).create({ title: 's' });
      const ch = await createChapterRepo(alice.req).create({
        storyId: story.id as string,
        title: 't',
        orderIndex: 0,
      });

      const ok = await createChapterRepo(bob.req).remove(ch.id as string);
      expect(ok).toBe(false);

      const list = await createChapterRepo(alice.req).findManyForStory(story.id as string);
      expect(list).toHaveLength(1);
      expect(list[0]?.id).toBe(ch.id);
    });
  });
});
