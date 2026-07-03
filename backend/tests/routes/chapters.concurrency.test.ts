// [story-editor-tyh] Optimistic-concurrency precondition on chapter PATCH.
//
// Covers:
//   - PATCH with matching expectedUpdatedAt succeeds
//   - PATCH with stale expectedUpdatedAt returns 409 conflict, does not write
//   - PATCH without expectedUpdatedAt keeps last-write-wins (back-compat)
//   - PATCH with expectedUpdatedAt on a chapter deleted mid-flight: not 409
//   - the 409 response never contains ciphertext keys

import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { attachDekToRequest } from '../../src/services/content-crypto.service';
import { _resetSessionStore, getSession } from '../../src/services/session-store';
import { registerAndLogin } from '../helpers/auth';
import { resetDb } from '../helpers/db';

const TEST_ORIGIN = 'http://localhost:3000';

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

describe('Chapter PATCH optimistic-concurrency [story-editor-tyh]', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetDb();
  });

  afterEach(async () => {
    _resetSessionStore();
    await resetDb();
  });

  it('PATCH with matching expectedUpdatedAt succeeds and returns the new updatedAt', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'concurrency-match' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'Concurrency Match' });
    const storyId = story.id as string;
    const created = await createChapterRepo(req).create({
      storyId,
      title: 'Ch',
      orderIndex: 0,
      bodyJson: paragraphDoc('one two three'),
      wordCount: 3,
    });
    const chapterId = created.id;

    const res = await agent
      .patch(`/api/stories/${storyId}/chapters/${chapterId}`)
      .set('Origin', TEST_ORIGIN)
      .send({
        bodyJson: paragraphDoc('four five six seven'),
        expectedUpdatedAt: created.updatedAt.toISOString(),
      });

    expect(res.status).toBe(200);
    expect(res.body.chapter.updatedAt).not.toBe(created.updatedAt.toISOString());
    expect(res.body.chapter.wordCount).toBe(4);

    const row = await createChapterRepo(req).findById(chapterId);
    expect(
      (row!.bodyJson as { content: Array<{ content: Array<{ text: string }> }> }).content[0]
        .content[0].text,
    ).toBe('four five six seven');
  });

  it('PATCH with stale expectedUpdatedAt returns 409 conflict and does not write', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'concurrency-stale' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'Concurrency Stale' });
    const storyId = story.id as string;
    const created = await createChapterRepo(req).create({
      storyId,
      title: 'Ch',
      orderIndex: 0,
      bodyJson: paragraphDoc('original text'),
      wordCount: 2,
    });
    const chapterId = created.id;
    const originalUpdatedAt = created.updatedAt.toISOString();

    // PATCH#1 (no precondition) bumps updatedAt.
    const first = await agent
      .patch(`/api/stories/${storyId}/chapters/${chapterId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ bodyJson: paragraphDoc('first writer wins') });
    expect(first.status).toBe(200);

    // PATCH#2 with the ORIGINAL (now-stale) updatedAt.
    const second = await agent
      .patch(`/api/stories/${storyId}/chapters/${chapterId}`)
      .set('Origin', TEST_ORIGIN)
      .send({
        bodyJson: paragraphDoc('second writer loses'),
        expectedUpdatedAt: originalUpdatedAt,
      });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('conflict');

    const row = await createChapterRepo(req).findById(chapterId);
    expect(
      (row!.bodyJson as { content: Array<{ content: Array<{ text: string }> }> }).content[0]
        .content[0].text,
    ).toBe('first writer wins');
  });

  it('PATCH without expectedUpdatedAt keeps last-write-wins (back-compat)', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'concurrency-backcompat' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'Back Compat' });
    const storyId = story.id as string;
    const created = await createChapterRepo(req).create({
      storyId,
      title: 'Ch',
      orderIndex: 0,
    });
    const chapterId = created.id;

    const r1 = await agent
      .patch(`/api/stories/${storyId}/chapters/${chapterId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ bodyJson: paragraphDoc('first') });
    expect(r1.status).toBe(200);

    const r2 = await agent
      .patch(`/api/stories/${storyId}/chapters/${chapterId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ bodyJson: paragraphDoc('second') });
    expect(r2.status).toBe(200);
  });

  it('PATCH with expectedUpdatedAt on a chapter deleted mid-flight returns 404, not 409', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'concurrency-deleted' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'Deleted Mid Flight' });
    const storyId = story.id as string;
    const created = await createChapterRepo(req).create({
      storyId,
      title: 'Ch',
      orderIndex: 0,
    });
    const chapterId = created.id;
    const capturedUpdatedAt = created.updatedAt.toISOString();

    await createChapterRepo(req).remove(chapterId);

    const res = await agent
      .patch(`/api/stories/${storyId}/chapters/${chapterId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ bodyJson: paragraphDoc('too late'), expectedUpdatedAt: capturedUpdatedAt });

    // Ownership middleware conflates "gone" with "not owned" — invariant
    // under test is "not 409", whichever of 403/404 the stack yields.
    expect(res.status).not.toBe(409);
    expect([403, 404]).toContain(res.status);
  });

  it('the 409 conflict response never contains ciphertext keys', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'concurrency-no-ciphertext' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'No Ciphertext' });
    const storyId = story.id as string;
    const created = await createChapterRepo(req).create({
      storyId,
      title: 'Ch',
      orderIndex: 0,
      bodyJson: paragraphDoc('original'),
      wordCount: 1,
    });
    const chapterId = created.id;
    const originalUpdatedAt = created.updatedAt.toISOString();

    await agent
      .patch(`/api/stories/${storyId}/chapters/${chapterId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ bodyJson: paragraphDoc('bump it') });

    const res = await agent
      .patch(`/api/stories/${storyId}/chapters/${chapterId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ bodyJson: paragraphDoc('conflict'), expectedUpdatedAt: originalUpdatedAt });

    expect(res.status).toBe(409);
    assertNoCiphertextKeys(res.body);
    assertNoCiphertextKeys(res.body.error ?? {});
  });
});
