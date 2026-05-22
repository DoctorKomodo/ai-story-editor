import { beforeEach, describe, expect, it } from 'vitest';
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
});
