import { beforeEach, describe, expect, it } from 'vitest';
import { writeEncrypted } from '../../src/repos/_narrative';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { prisma } from '../setup';
import { makeUserContext } from './_req';

describe('chapter.repo summary', () => {
  let ctx: Awaited<ReturnType<typeof makeUserContext>>;
  let storyId: string;
  let chapterId: string;

  beforeEach(async () => {
    ctx = await makeUserContext();
    const story = await prisma.story.create({ data: { userId: ctx.user.id } });
    storyId = story.id;
    const chapter = await createChapterRepo(ctx.req).create({
      storyId,
      title: 'Ch 1',
      orderIndex: 0,
      wordCount: 10,
    });
    chapterId = chapter.id as string;
  });

  it('update({ summaryJson }) persists encrypted blob + timestamp; findById round-trips', async () => {
    const repo = createChapterRepo(ctx.req);
    const summary = { events: 'A.', stateAtEnd: 'B.', openThreads: 'C?' };
    const updated = await repo.update(chapterId, { summaryJson: summary });
    expect(updated?.summary).toEqual(summary);
    expect(updated?.summaryUpdatedAt).toBeInstanceOf(Date);
    const fetched = await repo.findById(chapterId);
    expect(fetched?.summary).toEqual(summary);
  });

  it('findById returns summary: null when columns are null', async () => {
    const fetched = await createChapterRepo(ctx.req).findById(chapterId);
    expect(fetched?.summary).toBeNull();
    expect(fetched?.summaryUpdatedAt).toBeNull();
  });

  it('findManyForStory surfaces hasSummary + summaryIsStale without decrypting body', async () => {
    const repo = createChapterRepo(ctx.req);
    let list = await repo.findManyForStory(storyId);
    expect(list[0]!.hasSummary).toBe(false);
    expect(list[0]!.summaryIsStale).toBe(false);
    await repo.update(chapterId, {
      summaryJson: { events: 'a', stateAtEnd: 'b', openThreads: 'c' },
    });
    list = await repo.findManyForStory(storyId);
    expect(list[0]!.hasSummary).toBe(true);
    expect(list[0]!.summaryIsStale).toBe(false);
  });

  it('summaryIsStale becomes true after the chapter is updated', async () => {
    const repo = createChapterRepo(ctx.req);
    await repo.update(chapterId, {
      summaryJson: { events: 'a', stateAtEnd: 'b', openThreads: 'c' },
    });
    await new Promise((r) => setTimeout(r, 10));
    await repo.update(chapterId, { title: 'Ch 1 renamed' });
    const list = await repo.findManyForStory(storyId);
    expect(list[0]!.summaryIsStale).toBe(true);
  });

  it('update({ summaryJson: null }) clears all four summary columns', async () => {
    const repo = createChapterRepo(ctx.req);
    await repo.update(chapterId, {
      summaryJson: { events: 'a', stateAtEnd: 'b', openThreads: 'c' },
    });
    const cleared = await repo.update(chapterId, { summaryJson: null });
    expect(cleared?.summary).toBeNull();
    expect(cleared?.summaryUpdatedAt).toBeNull();
  });

  it('findManyForStory({ includeSummary: true }) decrypts title + summary, skips body', async () => {
    const repo = createChapterRepo(ctx.req);
    await repo.update(chapterId, {
      summaryJson: { events: 'x', stateAtEnd: 'y', openThreads: 'z' },
    });
    const rows = await repo.findManyForStory(storyId, { includeSummary: true });
    expect(rows[0]).toMatchObject({
      id: chapterId,
      title: 'Ch 1',
      orderIndex: 0,
      summary: { events: 'x', stateAtEnd: 'y', openThreads: 'z' },
    });
    expect((rows[0] as unknown as { bodyJson?: unknown }).bodyJson).toBeUndefined();
  });

  it('corrupted ciphertext: hasSummary=true but summary=null (findById reports corrupted state)', async () => {
    const repo = createChapterRepo(ctx.req);
    // Write a valid summary first so summaryJsonCiphertext is non-null.
    await repo.update(chapterId, {
      summaryJson: { events: 'x', stateAtEnd: 'y', openThreads: 'z' },
    });
    // Overwrite the stored ciphertext with a validly-encrypted blob that
    // decrypts to non-JSON plaintext. writeEncrypted produces a real AES-GCM
    // triple (decryptable, no auth error), but JSON.parse will fail, so
    // summary must come back null. hasSummary must still be true because
    // summaryJsonCiphertext is non-null — it reflects ciphertext presence,
    // not parse outcome. This is the frontend's "corrupted" state signal.
    const corruptTriple = writeEncrypted(ctx.req, 'summaryJson', 'not-valid-json');
    await prisma.chapter.update({
      where: { id: chapterId },
      data: {
        summaryJsonCiphertext: corruptTriple.summaryJsonCiphertext,
        summaryJsonIv: corruptTriple.summaryJsonIv,
        summaryJsonAuthTag: corruptTriple.summaryJsonAuthTag,
      },
    });
    const fetched = await repo.findById(chapterId);
    expect(fetched?.hasSummary).toBe(true);
    expect(fetched?.summary).toBeNull();
    // The includeSummary path has identical catch/warn logic — verify it
    // surfaces the corrupted state identically.
    const rows = await repo.findManyForStory(storyId, { includeSummary: true });
    expect(rows[0]?.hasSummary).toBe(true);
    expect(rows[0]?.summary).toBeNull();
  });

  it('summaryIsStale is false immediately after update({ summaryJson }) (same-timestamp write)', async () => {
    const repo = createChapterRepo(ctx.req);
    const updated = await repo.update(chapterId, {
      summaryJson: { events: 'a', stateAtEnd: 'b', openThreads: 'c' },
    });
    expect(updated?.summaryIsStale).toBe(false);
    const fetched = await repo.findById(chapterId);
    expect(fetched?.summaryIsStale).toBe(false);
  });
});
