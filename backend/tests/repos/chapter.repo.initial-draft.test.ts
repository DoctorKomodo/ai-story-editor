import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { resetDb } from '../helpers/db';
import { prisma } from '../setup';
import { makeUserContext } from './_req';

describe('[9wk.3] chapter.repo.create mints the initial draft', () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(async () => {
    await resetDb();
  });

  it('creates exactly one draft, points activeDraftId at it, mirrors body + wordCount', async () => {
    const ctx = await makeUserContext('mint');
    const story = await createStoryRepo(ctx.req).create({ title: 'S' });
    const chapter = await createChapterRepo(ctx.req).create({
      storyId: story.id as string,
      title: 'C',
      bodyJson: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'mint me now' }] }],
      },
      wordCount: 3,
      orderIndex: 0,
    });

    // Repo shape carries the pointer (wire schema unchanged — serialize picks explicitly).
    expect(chapter.activeDraftId).toEqual(expect.any(String));

    const drafts = await prisma.draft.findMany({ where: { chapterId: chapter.id as string } });
    expect(drafts).toHaveLength(1);
    const draft = drafts[0]!;
    expect(draft.id).toBe(chapter.activeDraftId);
    expect(draft.orderIndex).toBe(0);
    expect(draft.labelCiphertext).toBeNull();
    expect(draft.wordCount).toBe(3);
    // Body is encrypted into the draft too (fresh IV, same plaintext).
    expect(draft.bodyCiphertext).not.toBeNull();

    const chapterRow = await prisma.chapter.findUniqueOrThrow({
      where: { id: chapter.id as string },
    });
    expect(chapterRow.activeDraftId).toBe(draft.id);
  });

  it('bodyless chapter mints a bodyless draft (wordCount 0)', async () => {
    const ctx = await makeUserContext('mint-empty');
    const story = await createStoryRepo(ctx.req).create({ title: 'S' });
    const chapter = await createChapterRepo(ctx.req).create({
      storyId: story.id as string,
      title: 'Untitled',
      orderIndex: 0,
    });
    const draft = await prisma.draft.findFirstOrThrow({
      where: { chapterId: chapter.id as string },
    });
    expect(chapter.activeDraftId).toBe(draft.id);
    expect(draft.bodyCiphertext).toBeNull();
    expect(draft.wordCount).toBe(0);
  });
});
