// [story-editor-9wk.4] Optimistic-concurrency precondition on draft.repo.update.
// Ported from tests/routes/chapters.concurrency.test.ts's five cases, retargeted
// at createDraftRepo(req).update(draftId, { bodyJson }, { expectedUpdatedAt }).
//
// Covers:
//   - matching expectedUpdatedAt succeeds and returns the new updatedAt
//   - stale expectedUpdatedAt throws DraftVersionConflictError, does not write
//   - no precondition keeps last-write-wins
//   - deleted-mid-flight: returns null, does NOT throw the conflict error
//   - the thrown error / returned shapes never contain ciphertext keys

import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createDraftRepo, DraftVersionConflictError } from '../../src/repos/draft.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { attachDekToRequest } from '../../src/services/content-crypto.service';
import { _resetSessionStore, getSession } from '../../src/services/session-store';
import { registerAndLogin } from '../helpers/auth';
import { resetDb } from '../helpers/db';
import { prisma } from '../setup';

function makeFakeReq(sessionId: string): Request {
  const session = getSession(sessionId);
  expect(session).not.toBeNull();
  const req = { user: { id: session!.userId, sessionId } } as unknown as Request;
  attachDekToRequest(req, session!.dek);
  return req;
}

function paragraphDoc(text: string): unknown {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text }],
      },
    ],
  };
}

function assertNoCiphertextKeys(obj: Record<string, unknown>): void {
  for (const key of Object.keys(obj)) {
    expect(key.endsWith('Ciphertext')).toBe(false);
    expect(key.endsWith('Iv')).toBe(false);
    expect(key.endsWith('AuthTag')).toBe(false);
  }
}

describe('draft.repo.update optimistic-concurrency [story-editor-9wk.4]', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetDb();
  });

  afterEach(async () => {
    _resetSessionStore();
    await resetDb();
  });

  it('matching expectedUpdatedAt succeeds and returns the new updatedAt', async () => {
    const { sessionId } = await registerAndLogin({ username: 'draft-concurrency-match' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'Concurrency Match' });
    const chapter = await createChapterRepo(req).create({
      storyId: story.id as string,
      title: 'Ch',
      orderIndex: 0,
      bodyJson: paragraphDoc('one two three'),
      wordCount: 3,
    });
    const draftRepo = createDraftRepo(req);
    const draftId = chapter.activeDraftId as string;
    const draft = await draftRepo.findById(draftId);

    const updated = await draftRepo.update(
      draftId,
      { bodyJson: paragraphDoc('four five six seven'), wordCount: 4 },
      { expectedUpdatedAt: draft!.updatedAt },
    );

    expect(updated).not.toBeNull();
    expect(updated!.updatedAt.getTime()).not.toBe(draft!.updatedAt.getTime());
    expect(updated!.wordCount).toBe(4);

    const reread = await draftRepo.findById(draftId);
    expect(
      (reread!.bodyJson as { content: Array<{ content: Array<{ text: string }> }> }).content[0]
        .content[0].text,
    ).toBe('four five six seven');
  });

  it('stale expectedUpdatedAt throws DraftVersionConflictError and does not write', async () => {
    const { sessionId } = await registerAndLogin({ username: 'draft-concurrency-stale' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'Concurrency Stale' });
    const chapter = await createChapterRepo(req).create({
      storyId: story.id as string,
      title: 'Ch',
      orderIndex: 0,
      bodyJson: paragraphDoc('original text'),
      wordCount: 2,
    });
    const draftRepo = createDraftRepo(req);
    const draftId = chapter.activeDraftId as string;
    const draft = await draftRepo.findById(draftId);
    const originalUpdatedAt = draft!.updatedAt;

    // Write #1 (no precondition) bumps updatedAt.
    const first = await draftRepo.update(draftId, { bodyJson: paragraphDoc('first writer wins') });
    expect(first).not.toBeNull();

    // Write #2 with the ORIGINAL (now-stale) updatedAt.
    await expect(
      draftRepo.update(
        draftId,
        { bodyJson: paragraphDoc('second writer loses') },
        { expectedUpdatedAt: originalUpdatedAt },
      ),
    ).rejects.toThrow(DraftVersionConflictError);

    const reread = await draftRepo.findById(draftId);
    expect(
      (reread!.bodyJson as { content: Array<{ content: Array<{ text: string }> }> }).content[0]
        .content[0].text,
    ).toBe('first writer wins');
  });

  it('no precondition keeps last-write-wins (back-compat)', async () => {
    const { sessionId } = await registerAndLogin({ username: 'draft-concurrency-backcompat' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'Back Compat' });
    const chapter = await createChapterRepo(req).create({
      storyId: story.id as string,
      title: 'Ch',
      orderIndex: 0,
    });
    const draftRepo = createDraftRepo(req);
    const draftId = chapter.activeDraftId as string;

    const r1 = await draftRepo.update(draftId, { bodyJson: paragraphDoc('first') });
    expect(r1).not.toBeNull();

    const r2 = await draftRepo.update(draftId, { bodyJson: paragraphDoc('second') });
    expect(r2).not.toBeNull();
  });

  it('expectedUpdatedAt on a draft deleted mid-flight returns null, not DraftVersionConflictError', async () => {
    const { sessionId } = await registerAndLogin({ username: 'draft-concurrency-deleted' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'Deleted Mid Flight' });
    const chapter = await createChapterRepo(req).create({
      storyId: story.id as string,
      title: 'Ch',
      orderIndex: 0,
    });
    const draftRepo = createDraftRepo(req);
    const draftId = chapter.activeDraftId as string;
    const draft = await draftRepo.findById(draftId);
    const capturedUpdatedAt = draft!.updatedAt;

    // Bypass the active-draft delete guard for this test — delete the row
    // directly via raw prisma to simulate a delete-mid-flight race.
    await prisma.draft.delete({ where: { id: draftId } });

    const result = await draftRepo.update(
      draftId,
      { bodyJson: paragraphDoc('too late') },
      { expectedUpdatedAt: capturedUpdatedAt },
    );

    expect(result).toBeNull();
  });

  it('the conflict error and returned shapes never contain ciphertext keys', async () => {
    const { sessionId } = await registerAndLogin({ username: 'draft-concurrency-no-ciphertext' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'No Ciphertext' });
    const chapter = await createChapterRepo(req).create({
      storyId: story.id as string,
      title: 'Ch',
      orderIndex: 0,
      bodyJson: paragraphDoc('original'),
      wordCount: 1,
    });
    const draftRepo = createDraftRepo(req);
    const draftId = chapter.activeDraftId as string;
    const draft = await draftRepo.findById(draftId);
    const originalUpdatedAt = draft!.updatedAt;

    const bumped = await draftRepo.update(draftId, { bodyJson: paragraphDoc('bump it') });
    assertNoCiphertextKeys(bumped as unknown as Record<string, unknown>);

    let caught: unknown;
    try {
      await draftRepo.update(
        draftId,
        { bodyJson: paragraphDoc('conflict') },
        { expectedUpdatedAt: originalUpdatedAt },
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DraftVersionConflictError);
    assertNoCiphertextKeys(caught as unknown as Record<string, unknown>);
  });
});
