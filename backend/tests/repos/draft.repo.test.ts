import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeEncrypted } from '../../src/repos/_narrative';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import {
  createDraftRepo,
  DraftDeleteActiveError,
  DraftVersionConflictError,
} from '../../src/repos/draft.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { computeWordCount } from '../../src/services/tiptap-text';
import { resetDb } from '../helpers/db';
import { prisma } from '../setup';
import { makeUserContext, rawCiphertextMustNotEqual } from './_req';

function paragraphDoc(text: string): unknown {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

describe('[9wk.2] draft.repo — encrypt on write / decrypt on read', () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(async () => {
    await resetDb();
  });

  it('round-trips body, summary, and label through the DEK', async () => {
    const ctx = await makeUserContext('draft-repo');
    const story = await createStoryRepo(ctx.req).create({
      title: 'S',
      genre: null,
      targetWords: null,
    });
    const chapter = await createChapterRepo(ctx.req).create({
      storyId: story.id as string,
      title: 'C',
      orderIndex: 0,
    });

    // [9wk.3] chapter.repo.create already minted a draft at orderIndex 0 for
    // this chapter — this test exercises draft.repo directly, so the
    // second draft it creates must take the next slot.
    const draftRepo = createDraftRepo(ctx.req);
    const created = await draftRepo.create({
      chapterId: chapter.id,
      bodyJson: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello drafts' }] }],
      },
      summaryJson: { events: 'e', stateAtEnd: 's', openThreads: 'o' },
      label: 'darker take',
      wordCount: 2,
      orderIndex: 1,
    });

    // Decrypted shape is correct, and carries no ciphertext columns.
    expect(created.label).toBe('darker take');
    expect(created.wordCount).toBe(2);
    expect(created.summary).toEqual({ events: 'e', stateAtEnd: 's', openThreads: 'o' });
    expect(JSON.stringify(created.bodyJson)).toContain('hello drafts');
    expect(
      Object.keys(created as Record<string, unknown>).some(
        (k) => k.endsWith('Ciphertext') || k.endsWith('Iv') || k.endsWith('AuthTag'),
      ),
    ).toBe(false);

    // Re-read decrypts identically.
    const read = await draftRepo.findById(created.id);
    expect(read?.label).toBe('darker take');
    expect(read?.summary).toEqual({ events: 'e', stateAtEnd: 's', openThreads: 'o' });

    // Raw columns are actually ciphertext (not naive base64 of plaintext) and
    // contain no plaintext. Prisma returns the ciphertext columns un-decrypted
    // (decryption lives in the repo layer), same pattern as chapter.repo.test.
    const raw = await prisma.draft.findUniqueOrThrow({ where: { id: created.id } });
    rawCiphertextMustNotEqual(raw.labelCiphertext as string, 'darker take');
    expect(raw.bodyCiphertext).not.toContain('hello drafts');
  });

  it('stores null triples for an absent body/summary/label', async () => {
    const ctx = await makeUserContext('draft-repo-null');
    const story = await createStoryRepo(ctx.req).create({
      title: 'S',
      genre: null,
      targetWords: null,
    });
    const chapter = await createChapterRepo(ctx.req).create({
      storyId: story.id as string,
      title: 'C',
      orderIndex: 0,
    });
    // [9wk.3] orderIndex 0 is already taken by the chapter's minted draft.
    const created = await createDraftRepo(ctx.req).create({ chapterId: chapter.id, orderIndex: 1 });
    expect(created.bodyJson).toBeNull();
    expect(created.summary).toBeNull();
    expect(created.label).toBeNull();
  });

  it('[9wk.4] update writes body + recomputed fields and label; null label clears', async () => {
    const ctx = await makeUserContext('draft-repo-update');
    const story = await createStoryRepo(ctx.req).create({
      title: 'S',
      genre: null,
      targetWords: null,
    });
    const chapter = await createChapterRepo(ctx.req).create({
      storyId: story.id as string,
      title: 'C',
      orderIndex: 0,
    });
    const draftRepo = createDraftRepo(ctx.req);
    const draftId = chapter.activeDraftId as string;

    const updated = await draftRepo.update(draftId, {
      bodyJson: paragraphDoc('updated body text'),
      wordCount: 3,
    });
    expect(updated).not.toBeNull();
    expect(updated!.updatedAt.getTime()).toBeGreaterThan(chapter.updatedAt.getTime());

    const reread = await draftRepo.findById(draftId);
    expect(JSON.stringify(reread!.bodyJson)).toContain('updated body text');
    expect(reread!.wordCount).toBe(3);

    const labeled = await draftRepo.update(draftId, { label: 'darker take' });
    expect(labeled!.label).toBe('darker take');

    const cleared = await draftRepo.update(draftId, { label: null });
    expect(cleared!.label).toBeNull();
  });

  it('[9wk.4] update summary sets summaryUpdatedAt == updatedAt (same-instant, not stale)', async () => {
    const ctx = await makeUserContext('draft-repo-summary');
    const story = await createStoryRepo(ctx.req).create({
      title: 'S',
      genre: null,
      targetWords: null,
    });
    const chapter = await createChapterRepo(ctx.req).create({
      storyId: story.id as string,
      title: 'C',
      orderIndex: 0,
    });
    const draftRepo = createDraftRepo(ctx.req);
    const draftId = chapter.activeDraftId as string;

    const updated = await draftRepo.update(draftId, {
      summaryJson: { events: 'e', stateAtEnd: 's', openThreads: 'o' },
    });
    expect(updated!.summary).toEqual({ events: 'e', stateAtEnd: 's', openThreads: 'o' });
    expect(updated!.summaryUpdatedAt).not.toBeNull();
    expect(updated!.summaryUpdatedAt!.getTime()).toBe(updated!.updatedAt.getTime());
  });

  it('[9wk.4] update({ summaryJson: null }) clears summary + summaryUpdatedAt', async () => {
    const ctx = await makeUserContext('draft-repo-summary-clear');
    const story = await createStoryRepo(ctx.req).create({
      title: 'S',
      genre: null,
      targetWords: null,
    });
    const chapter = await createChapterRepo(ctx.req).create({
      storyId: story.id as string,
      title: 'C',
      orderIndex: 0,
    });
    const draftRepo = createDraftRepo(ctx.req);
    const draftId = chapter.activeDraftId as string;

    await draftRepo.update(draftId, {
      summaryJson: { events: 'e', stateAtEnd: 's', openThreads: 'o' },
    });
    const cleared = await draftRepo.update(draftId, { summaryJson: null });
    expect(cleared!.summary).toBeNull();
    expect(cleared!.summaryUpdatedAt).toBeNull();
  });

  it('[9wk.4] corrupted summary ciphertext: hasSummary=true but summary=null (findById/findManyMetaForChapter report corrupted state)', async () => {
    const ctx = await makeUserContext('draft-repo-summary-corrupt');
    const story = await createStoryRepo(ctx.req).create({
      title: 'S',
      genre: null,
      targetWords: null,
    });
    const chapter = await createChapterRepo(ctx.req).create({
      storyId: story.id as string,
      title: 'C',
      orderIndex: 0,
    });
    const draftRepo = createDraftRepo(ctx.req);
    const draftId = chapter.activeDraftId as string;

    // Write a valid summary first so summaryJsonCiphertext is non-null.
    await draftRepo.update(draftId, {
      summaryJson: { events: 'x', stateAtEnd: 'y', openThreads: 'z' },
    });
    // Overwrite the stored ciphertext with a validly-encrypted blob that
    // decrypts to non-JSON plaintext. writeEncrypted produces a real AES-GCM
    // triple (decryptable, no auth error), but JSON.parse will fail, so
    // summary must come back null. hasSummary must still be true because
    // summaryJsonCiphertext is non-null — it reflects ciphertext presence,
    // not parse outcome.
    const corruptTriple = writeEncrypted(ctx.req, 'summaryJson', 'not-valid-json');
    await prisma.draft.update({
      where: { id: draftId },
      data: {
        summaryJsonCiphertext: corruptTriple.summaryJsonCiphertext,
        summaryJsonIv: corruptTriple.summaryJsonIv,
        summaryJsonAuthTag: corruptTriple.summaryJsonAuthTag,
      },
    });
    const fetched = await draftRepo.findById(draftId);
    expect(fetched?.summary).toBeNull();

    const metas = await draftRepo.findManyMetaForChapter(chapter.id);
    const active = metas.find((m) => m.id === draftId);
    expect(active!.hasSummary).toBe(true);
    // The raw prisma.draft.update() bump above advances `updatedAt` (Prisma's
    // @updatedAt) without touching `summaryJsonUpdatedAt` — genuinely stale,
    // unlike a draftRepo.update() summary write (same-instant, not stale).
    expect(active!.summaryIsStale).toBe(true);
  });

  it('[9wk.4] setActive swaps the chapter pointer; rejects a draft of another chapter', async () => {
    const ctx = await makeUserContext('draft-repo-setactive');
    const story = await createStoryRepo(ctx.req).create({
      title: 'S',
      genre: null,
      targetWords: null,
    });
    const chapterRepo = createChapterRepo(ctx.req);
    const draftRepo = createDraftRepo(ctx.req);
    const chapterA = await chapterRepo.create({
      storyId: story.id as string,
      title: 'A',
      orderIndex: 0,
    });
    const chapterB = await chapterRepo.create({
      storyId: story.id as string,
      title: 'B',
      orderIndex: 1,
    });

    const blank = await draftRepo.createBlank(chapterA.id);
    const swapped = await draftRepo.setActive(chapterA.id, blank.id);
    expect(swapped).toBe(true);
    const rereadA = await chapterRepo.findById(chapterA.id);
    expect(rereadA!.activeDraftId).toBe(blank.id);

    const mismatched = await draftRepo.setActive(chapterA.id, chapterB.activeDraftId as string);
    expect(mismatched).toBe(false);
    const rereadA2 = await chapterRepo.findById(chapterA.id);
    expect(rereadA2!.activeDraftId).toBe(blank.id);
  });

  it('[9wk.4] remove: 409-guard errors on active and on last; deletes + reindexes otherwise', async () => {
    const ctx = await makeUserContext('draft-repo-remove');
    const story = await createStoryRepo(ctx.req).create({
      title: 'S',
      genre: null,
      targetWords: null,
    });
    const chapterRepo = createChapterRepo(ctx.req);
    const draftRepo = createDraftRepo(ctx.req);
    const chapter = await chapterRepo.create({
      storyId: story.id as string,
      title: 'C',
      orderIndex: 0,
    });
    const activeDraftId = chapter.activeDraftId as string;

    // Single-draft chapter: the sole draft is always active — active guard
    // fires first (DraftDeleteLastError is unreachable here by construction).
    await expect(draftRepo.remove(activeDraftId)).rejects.toThrow(DraftDeleteActiveError);

    // Add two more drafts (orderIndex 1, 2). orderIndex 0 stays active.
    const draft1 = await draftRepo.createBlank(chapter.id);
    const draft2 = await draftRepo.createBlank(chapter.id);
    expect(draft1.orderIndex).toBe(1);
    expect(draft2.orderIndex).toBe(2);

    // Removing the still-active draft is refused even with siblings present.
    await expect(draftRepo.remove(activeDraftId)).rejects.toThrow(DraftDeleteActiveError);

    // Remove the middle (non-active) draft → survivors reindex to 0, 1.
    const removed = await draftRepo.remove(draft1.id);
    expect(removed).toBe(true);
    const remaining = await draftRepo.findManyForChapter(chapter.id);
    expect(remaining.map((d) => d.id).sort()).toEqual([activeDraftId, draft2.id].sort());
    const byId = new Map(remaining.map((d) => [d.id, d]));
    expect(byId.get(activeDraftId)!.orderIndex).toBe(0);
    expect(byId.get(draft2.id)!.orderIndex).toBe(1);
  });

  it('[9wk.4] createFork copies body plaintext (fresh ciphertext), recomputes wordCount, no summary', async () => {
    const ctx = await makeUserContext('draft-repo-fork');
    const story = await createStoryRepo(ctx.req).create({
      title: 'S',
      genre: null,
      targetWords: null,
    });
    const chapter = await createChapterRepo(ctx.req).create({
      storyId: story.id as string,
      title: 'C',
      orderIndex: 0,
      bodyJson: paragraphDoc('fork source text here'),
      wordCount: 4,
    });
    const draftRepo = createDraftRepo(ctx.req);
    const source = await draftRepo.findById(chapter.activeDraftId as string);

    const forked = await draftRepo.createFork(chapter.id, 'fork label');
    expect(forked.bodyJson).toEqual(source!.bodyJson);
    expect(forked.wordCount).toBe(computeWordCount(source!.bodyJson));
    expect(forked.summary).toBeNull();
    expect(forked.label).toBe('fork label');
    expect(forked.orderIndex).toBe(1);

    const sourceRaw = await prisma.draft.findUniqueOrThrow({ where: { id: source!.id } });
    const forkedRaw = await prisma.draft.findUniqueOrThrow({ where: { id: forked.id } });
    expect(forkedRaw.bodyCiphertext).not.toBe(sourceRaw.bodyCiphertext);
  });

  it('[9wk.4] createBlank: empty body, wordCount 0, next orderIndex', async () => {
    const ctx = await makeUserContext('draft-repo-blank');
    const story = await createStoryRepo(ctx.req).create({
      title: 'S',
      genre: null,
      targetWords: null,
    });
    const chapter = await createChapterRepo(ctx.req).create({
      storyId: story.id as string,
      title: 'C',
      orderIndex: 0,
    });
    const draftRepo = createDraftRepo(ctx.req);

    const blank = await draftRepo.createBlank(chapter.id);
    expect(blank.bodyJson).toBeNull();
    expect(blank.wordCount).toBe(0);
    expect(blank.orderIndex).toBe(1);
  });

  it('[9wk.4] findManyMetaForChapter returns isActive + staleness, no bodyJson, no ciphertext keys', async () => {
    const ctx = await makeUserContext('draft-repo-meta');
    const story = await createStoryRepo(ctx.req).create({
      title: 'S',
      genre: null,
      targetWords: null,
    });
    const chapter = await createChapterRepo(ctx.req).create({
      storyId: story.id as string,
      title: 'C',
      orderIndex: 0,
    });
    const draftRepo = createDraftRepo(ctx.req);
    await draftRepo.createBlank(chapter.id);
    await draftRepo.update(chapter.activeDraftId as string, {
      summaryJson: { events: 'e', stateAtEnd: 's', openThreads: 'o' },
    });

    const metas = await draftRepo.findManyMetaForChapter(chapter.id);
    expect(metas).toHaveLength(2);

    for (const meta of metas) {
      expect(Object.keys(meta).sort()).toEqual(
        [
          'id',
          'chapterId',
          'label',
          'wordCount',
          'orderIndex',
          'isActive',
          'hasSummary',
          'summaryIsStale',
          'createdAt',
          'updatedAt',
        ].sort(),
      );
      expect(
        Object.keys(meta).some(
          (k) => k.endsWith('Ciphertext') || k.endsWith('Iv') || k.endsWith('AuthTag'),
        ),
      ).toBe(false);
      expect('bodyJson' in meta).toBe(false);
    }

    const active = metas.find((m) => m.id === chapter.activeDraftId);
    expect(active!.isActive).toBe(true);
    expect(active!.hasSummary).toBe(true);
    expect(active!.summaryIsStale).toBe(false);

    const other = metas.find((m) => m.id !== chapter.activeDraftId);
    expect(other!.isActive).toBe(false);
    expect(other!.hasSummary).toBe(false);
  });

  it('[9wk.4 fix] isActive: true for the active draft, false for a non-active sibling and for another user', async () => {
    const ctx = await makeUserContext('draft-repo-isactive');
    const story = await createStoryRepo(ctx.req).create({
      title: 'S',
      genre: null,
      targetWords: null,
    });
    const chapter = await createChapterRepo(ctx.req).create({
      storyId: story.id as string,
      title: 'C',
      orderIndex: 0,
    });
    const draftRepo = createDraftRepo(ctx.req);
    const sibling = await draftRepo.createBlank(chapter.id);

    expect(await draftRepo.isActive(chapter.activeDraftId as string)).toBe(true);
    expect(await draftRepo.isActive(sibling.id)).toBe(false);

    const other = await makeUserContext('draft-repo-isactive-other');
    expect(await createDraftRepo(other.req).isActive(chapter.activeDraftId as string)).toBe(false);
  });

  it('[9wk.4 fix] update(id, {}) is a no-op: does not bump updatedAt and does not stale a fresh summary', async () => {
    const ctx = await makeUserContext('draft-repo-empty-patch');
    const story = await createStoryRepo(ctx.req).create({
      title: 'S',
      genre: null,
      targetWords: null,
    });
    const chapter = await createChapterRepo(ctx.req).create({
      storyId: story.id as string,
      title: 'C',
      orderIndex: 0,
    });
    const draftRepo = createDraftRepo(ctx.req);
    const draftId = chapter.activeDraftId as string;

    const withSummary = await draftRepo.update(draftId, {
      summaryJson: { events: 'e', stateAtEnd: 's', openThreads: 'o' },
    });
    expect(withSummary!.summaryUpdatedAt!.getTime()).toBe(withSummary!.updatedAt.getTime());

    const noop = await draftRepo.update(draftId, {});
    expect(noop).not.toBeNull();
    expect(noop!.updatedAt.getTime()).toBe(withSummary!.updatedAt.getTime());
    expect(noop!.summaryUpdatedAt!.getTime()).toBe(withSummary!.summaryUpdatedAt!.getTime());
    // Not stale: summaryUpdatedAt still equals updatedAt after the no-op.
    expect(noop!.summaryUpdatedAt!.getTime()).toBe(noop!.updatedAt.getTime());
  });

  it('[9wk.4 fix] update(id, {}, { expectedUpdatedAt: stale }) still throws DraftVersionConflictError', async () => {
    const ctx = await makeUserContext('draft-repo-empty-patch-conflict');
    const story = await createStoryRepo(ctx.req).create({
      title: 'S',
      genre: null,
      targetWords: null,
    });
    const chapter = await createChapterRepo(ctx.req).create({
      storyId: story.id as string,
      title: 'C',
      orderIndex: 0,
    });
    const draftRepo = createDraftRepo(ctx.req);
    const draftId = chapter.activeDraftId as string;
    const staleUpdatedAt = (await draftRepo.findById(draftId))!.updatedAt;

    // Advance updatedAt with a real write so the captured timestamp goes stale.
    await draftRepo.update(draftId, { label: 'renamed' });

    await expect(
      draftRepo.update(draftId, {}, { expectedUpdatedAt: staleUpdatedAt }),
    ).rejects.toThrow(DraftVersionConflictError);
  });

  it('[9wk.5] create with summaryJson stamps summaryUpdatedAt === updatedAt (same-instant, not stale)', async () => {
    const ctx = await makeUserContext('draft-repo-create-summary');
    const story = await createStoryRepo(ctx.req).create({
      title: 'S',
      genre: null,
      targetWords: null,
    });
    const chapter = await createChapterRepo(ctx.req).create({
      storyId: story.id as string,
      title: 'C',
      orderIndex: 0,
    });
    const draftRepo = createDraftRepo(ctx.req);

    const created = await draftRepo.create({
      chapterId: chapter.id,
      bodyJson: paragraphDoc('two words'),
      wordCount: 2,
      summaryJson: { events: 'e', stateAtEnd: 's', openThreads: 'o' },
      orderIndex: 1,
    });

    expect(created.summaryUpdatedAt).not.toBeNull();
    expect(created.summaryUpdatedAt!.getTime()).toBe(created.updatedAt.getTime());

    const reread = await draftRepo.findById(created.id);
    expect(reread!.summaryUpdatedAt).not.toBeNull();
    expect(reread!.summaryUpdatedAt!.getTime()).toBe(reread!.updatedAt.getTime());

    const metas = await draftRepo.findManyMetaForChapter(chapter.id);
    const meta = metas.find((m) => m.id === created.id);
    expect(meta!.hasSummary).toBe(true);
    expect(meta!.summaryIsStale).toBe(false);
  });

  it('[9wk.6] findById carries the same hasSummary/summaryIsStale booleans as the meta list', async () => {
    const ctx = await makeUserContext('draft-repo-summary-parity');
    const story = await createStoryRepo(ctx.req).create({
      title: 'S',
      genre: null,
      targetWords: null,
    });
    const chapter = await createChapterRepo(ctx.req).create({
      storyId: story.id as string,
      title: 'C',
      orderIndex: 0,
    });
    const draftRepo = createDraftRepo(ctx.req);
    const draftId = chapter.activeDraftId as string;

    // No-summary case: a brand-new blank draft — both booleans false.
    const blankMetas = await draftRepo.findManyMetaForChapter(chapter.id);
    const blankMeta = blankMetas.find((m) => m.id === draftId)!;
    const blankDetail = await draftRepo.findById(draftId);
    expect(blankDetail!.hasSummary).toBe(false);
    expect(blankDetail!.summaryIsStale).toBe(false);
    expect({
      hasSummary: blankDetail!.hasSummary,
      summaryIsStale: blankDetail!.summaryIsStale,
    }).toEqual({ hasSummary: blankMeta.hasSummary, summaryIsStale: blankMeta.summaryIsStale });

    // Fresh case: summary just written, same-instant as updatedAt — not stale.
    await draftRepo.update(draftId, {
      summaryJson: { events: 'e', stateAtEnd: 's', openThreads: 'o' },
    });
    const freshDetail = await draftRepo.findById(draftId);
    const freshMeta = (await draftRepo.findManyMetaForChapter(chapter.id)).find(
      (m) => m.id === draftId,
    )!;
    expect(freshDetail!.hasSummary).toBe(true);
    expect(freshDetail!.summaryIsStale).toBe(false);
    expect({
      hasSummary: freshDetail!.hasSummary,
      summaryIsStale: freshDetail!.summaryIsStale,
    }).toEqual({ hasSummary: freshMeta.hasSummary, summaryIsStale: freshMeta.summaryIsStale });

    // Stale case: a bodyJson-only update bumps updatedAt past summaryUpdatedAt.
    await new Promise((r) => setTimeout(r, 10));
    await draftRepo.update(draftId, {
      bodyJson: { type: 'doc', content: [] },
      wordCount: 0,
    });
    const detail = await draftRepo.findById(draftId);
    const meta = (await draftRepo.findManyMetaForChapter(chapter.id)).find(
      (d) => d.id === draftId,
    )!;
    expect(detail!.hasSummary).toBe(true);
    expect(detail!.summaryIsStale).toBe(true);
    expect({ hasSummary: detail!.hasSummary, summaryIsStale: detail!.summaryIsStale }).toEqual({
      hasSummary: meta.hasSummary,
      summaryIsStale: meta.summaryIsStale,
    });
  });
});
