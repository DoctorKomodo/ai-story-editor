// [B3] Integration tests for chapter CRUD under /api/stories/:storyId/chapters.
//
// Covers:
//   - All endpoints 401 when unauthenticated
//   - POST 403 when :storyId is not the caller's story
//   - POST 400 when body fails Zod (unknown key, empty title, wordCount passed)
//   - POST 201 with bodyJson — wordCount derived from the TipTap tree,
//     orderIndex auto-assigned (0 for first, 1 for second, …)
//   - POST 201 without bodyJson — wordCount = 0, orderIndex still assigned
//   - GET /:chapterId 200 decrypted, no ciphertext, body parsed to a tree
//   - GET /:chapterId 404 when chapter belongs to a different story (path integrity)
//   - GET /:chapterId 403 when chapter belongs to another user
//   - GET list 200 sorted by orderIndex asc, no ciphertext
//   - PATCH /:chapterId title-only doesn't touch body/wordCount [9wk.4: body
//     writes moved to PATCH /api/drafts/:draftId]
//   - PATCH /:chapterId 400 on unknown key
//   - DELETE /:chapterId 204, follow-up GET 403

import type { Request } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/index';
import { prisma as appPrisma } from '../../src/lib/prisma';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { attachDekToRequest } from '../../src/services/content-crypto.service';
import { _resetSessionStore, getSession } from '../../src/services/session-store';
import { registerAndLogin } from '../helpers/auth';
import { resetDb } from '../helpers/db';
import { prisma } from '../setup';

const TEST_ORIGIN = 'http://localhost:3000';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFakeReq(sessionId: string): Request {
  const session = getSession(sessionId);
  expect(session).not.toBeNull();
  const req = { user: { id: session!.userId, sessionId } } as unknown as Request;
  attachDekToRequest(req, session!.dek);
  return req;
}

const FAKE_ID = '00000000-0000-0000-0000-000000000000';

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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Chapter routes [B3]', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetDb();
  });

  afterEach(async () => {
    _resetSessionStore();
    await resetDb();
  });

  // ── Auth gates ────────────────────────────────────────────────────────────

  it('GET /api/stories/:storyId/chapters returns 401 when unauthenticated', async () => {
    const res = await request(app).get(`/api/stories/${FAKE_ID}/chapters`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('POST /api/stories/:storyId/chapters returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .post(`/api/stories/${FAKE_ID}/chapters`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'Ch 1' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('GET /api/stories/:storyId/chapters/:chapterId returns 401 when unauthenticated', async () => {
    const res = await request(app).get(`/api/stories/${FAKE_ID}/chapters/${FAKE_ID}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('PATCH /api/stories/:storyId/chapters/:chapterId returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .patch(`/api/stories/${FAKE_ID}/chapters/${FAKE_ID}`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('DELETE /api/stories/:storyId/chapters/:chapterId returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .delete(`/api/stories/${FAKE_ID}/chapters/${FAKE_ID}`)
      .set('Origin', TEST_ORIGIN);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  // ── POST ownership / Zod ──────────────────────────────────────────────────

  it('POST returns 403 when :storyId does not belong to the caller', async () => {
    const { sessionId: sessionIdA } = await registerAndLogin({ username: 'chapters-owner-a' });
    const { agent: agentB } = await registerAndLogin({ username: 'chapters-owner-b' });
    const reqA = makeFakeReq(sessionIdA);
    const story = await createStoryRepo(reqA).create({ title: 'A only' });

    const res = await agentB
      .post(`/api/stories/${story.id as string}/chapters`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'hijack' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('POST returns 400 on empty title', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'chapters-empty-title' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'My Story' });

    const res = await agent
      .post(`/api/stories/${story.id as string}/chapters`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('POST returns 400 when an unknown key (wordCount) is passed', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'chapters-strict-post' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'Strict Story' });

    const res = await agent
      .post(`/api/stories/${story.id as string}/chapters`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'Ch 1', wordCount: 9999 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('POST returns 400 when an unknown key (orderIndex) is passed', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'chapters-strict-order' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'Strict Story' });

    const res = await agent
      .post(`/api/stories/${story.id as string}/chapters`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'Ch 1', orderIndex: 7 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  // ── POST happy path: wordCount + orderIndex ───────────────────────────────

  it('POST with bodyJson computes wordCount from the tree and auto-assigns orderIndex', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'chapters-body' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'Has Chapters' });
    const storyId = story.id as string;

    const text1 = 'The quick brown fox jumps over the lazy dog.'; // 9 words
    const res1 = await agent
      .post(`/api/stories/${storyId}/chapters`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'Ch 1', bodyJson: paragraphDoc(text1) });
    expect(res1.status).toBe(201);
    expect(res1.body.chapter.title).toBe('Ch 1');
    expect(res1.body.chapter.wordCount).toBe(9);
    expect(res1.body.chapter.orderIndex).toBe(0);
    expect(res1.body.chapter.storyId).toBe(storyId);
    assertNoCiphertextKeys(res1.body.chapter);

    const text2 = 'Two roads diverged in a wood.'; // 6 words
    const res2 = await agent
      .post(`/api/stories/${storyId}/chapters`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'Ch 2', bodyJson: paragraphDoc(text2) });
    expect(res2.status).toBe(201);
    expect(res2.body.chapter.wordCount).toBe(6);
    expect(res2.body.chapter.orderIndex).toBe(1);

    const res3 = await agent
      .post(`/api/stories/${storyId}/chapters`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'Ch 3', bodyJson: paragraphDoc('Three words here.') });
    expect(res3.status).toBe(201);
    expect(res3.body.chapter.orderIndex).toBe(2);
  });

  it('POST without bodyJson sets wordCount to 0 and still auto-assigns orderIndex', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'chapters-no-body' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'Bare Chapters' });
    const storyId = story.id as string;

    const res1 = await agent
      .post(`/api/stories/${storyId}/chapters`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'Empty 1' });
    expect(res1.status).toBe(201);
    expect(res1.body.chapter.wordCount).toBe(0);
    expect(res1.body.chapter.orderIndex).toBe(0);

    const res2 = await agent
      .post(`/api/stories/${storyId}/chapters`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'Empty 2' });
    expect(res2.status).toBe(201);
    expect(res2.body.chapter.wordCount).toBe(0);
    expect(res2.body.chapter.orderIndex).toBe(1);
  });

  // ── [D16] POST race: aggregate+insert must retry on unique-constraint P2002

  it('POST retries on P2002 when the aggregate returns a stale _max (race simulation)', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'chapters-race' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'Racing' });
    const storyId = story.id as string;

    // Seed chapter at orderIndex=0 so the next POST's _max aggregate will
    // legitimately return 0 (so its first attempt picks 1 — no collision yet).
    await createChapterRepo(req).create({ storyId, title: 'seed-0', orderIndex: 0 });

    // Simulate a racing writer: the first aggregate reads a STALE _max that
    // still shows 0, but between aggregate and insert another request wins
    // slot 1. Model that by (a) inserting a real row at orderIndex=1 mid-race,
    // and (b) forcing the first aggregate to report { _max: { orderIndex: 0 } }
    // so the handler tries `0+1=1`, hits P2002, and retries.
    await createChapterRepo(req).create({ storyId, title: 'racer-1', orderIndex: 1 });

    const aggSpy = vi.spyOn(appPrisma.chapter, 'aggregate');
    // First call → pretend _max is still 0 (the losing side of the race).
    // Subsequent calls → real aggregate (now returns 1, so handler picks 2).
    aggSpy.mockImplementationOnce(
      // Promise satisfies PrismaPromise at runtime; cast bridges the type-only gap
      () =>
        Promise.resolve({ _max: { orderIndex: 0 } }) as unknown as ReturnType<
          typeof appPrisma.chapter.aggregate
        >,
    );

    try {
      const res = await agent
        .post(`/api/stories/${storyId}/chapters`)
        .set('Origin', TEST_ORIGIN)
        .send({ title: 'after-race' });
      expect(res.status).toBe(201);
      // After retry, the new chapter lands at slot 2 (seed took 0, racer took 1).
      expect(res.body.chapter.orderIndex).toBe(2);
      expect(res.body.chapter.title).toBe('after-race');
      // The spy must have been called at least twice: once for the losing
      // attempt, once for the retry that succeeded.
      expect(aggSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      aggSpy.mockRestore();
    }
  });

  it('POST surfaces a non-P2002 error without retrying indefinitely', async () => {
    // Defence-in-depth: the retry loop only catches P2002. Any other error
    // must propagate out of the first attempt unchanged.
    const { agent, sessionId } = await registerAndLogin({ username: 'chapters-nonp2002' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'Boom' });
    const storyId = story.id as string;

    const aggSpy = vi.spyOn(appPrisma.chapter, 'aggregate').mockRejectedValue(new Error('boom'));
    try {
      const res = await agent
        .post(`/api/stories/${storyId}/chapters`)
        .set('Origin', TEST_ORIGIN)
        .send({ title: 'never-lands' });
      expect(res.status).toBe(500);
      // Exactly one call — no silent retry on non-unique errors.
      expect(aggSpy).toHaveBeenCalledTimes(1);
    } finally {
      aggSpy.mockRestore();
    }
  });

  // ── GET /:chapterId ───────────────────────────────────────────────────────

  it('GET /:chapterId returns 200 with decrypted fields and body parsed as a tree', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'chapters-get-one' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'Readable' });
    const storyId = story.id as string;

    const tree = paragraphDoc('Hello world.');
    const created = await createChapterRepo(req).create({
      storyId,
      title: 'Readable Chapter',
      orderIndex: 0,
      bodyJson: tree,
      wordCount: 2,
    });

    const res = await agent.get(`/api/stories/${storyId}/chapters/${created.id as string}`);
    expect(res.status).toBe(200);
    expect(res.body.chapter.title).toBe('Readable Chapter');
    // Body should come back as a parsed JSON tree, not a string.
    expect(typeof res.body.chapter.bodyJson).toBe('object');
    expect(res.body.chapter.bodyJson.type).toBe('doc');
    expect(res.body.chapter.wordCount).toBe(2);
    expect(res.body.chapter.orderIndex).toBe(0);
    expect(res.body.chapter.storyId).toBe(storyId);
    expect(res.body.chapter.draftCount).toBe(1);
    expect(res.body.chapter.activeDraftId).toBe(created.activeDraftId);
    assertNoCiphertextKeys(res.body.chapter);
  });

  it('GET /:chapterId returns 404 when chapterId is under a different story (path integrity)', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'chapters-path-integrity' });
    const req = makeFakeReq(sessionId);
    const storyA = await createStoryRepo(req).create({ title: 'A' });
    const storyB = await createStoryRepo(req).create({ title: 'B' });

    const chapterA = await createChapterRepo(req).create({
      storyId: storyA.id as string,
      title: 'Ch in A',
      orderIndex: 0,
    });

    // Request A's chapter under B's story URL. Both owned by the same user,
    // so ownership middleware passes; the handler's storyId guard should 404.
    const res = await agent.get(
      `/api/stories/${storyB.id as string}/chapters/${chapterA.id as string}`,
    );
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('GET /:chapterId returns 403 when chapter belongs to another user', async () => {
    const { sessionId: sessionIdA } = await registerAndLogin({ username: 'chapters-xuser-a' });
    const { agent: agentB } = await registerAndLogin({ username: 'chapters-xuser-b' });

    const reqA = makeFakeReq(sessionIdA);
    const story = await createStoryRepo(reqA).create({ title: 'A only' });
    const chapter = await createChapterRepo(reqA).create({
      storyId: story.id as string,
      title: 'A chapter',
      orderIndex: 0,
    });

    const res = await agentB.get(
      `/api/stories/${story.id as string}/chapters/${chapter.id as string}`,
    );
    expect(res.status).toBe(403);
  });

  // ── GET list ──────────────────────────────────────────────────────────────

  it('GET list returns 200 sorted by orderIndex asc with no ciphertext', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'chapters-list' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'Ordered' });
    const storyId = story.id as string;

    // Insert out-of-order; the list endpoint must sort by orderIndex asc.
    await createChapterRepo(req).create({ storyId, title: 'Second', orderIndex: 1 });
    await createChapterRepo(req).create({ storyId, title: 'Third', orderIndex: 2 });
    await createChapterRepo(req).create({ storyId, title: 'First', orderIndex: 0 });

    const res = await agent.get(`/api/stories/${storyId}/chapters`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.chapters)).toBe(true);
    expect(res.body.chapters).toHaveLength(3);
    expect(res.body.chapters.map((c: { title: string }) => c.title)).toEqual([
      'First',
      'Second',
      'Third',
    ]);
    for (const ch of res.body.chapters) {
      assertNoCiphertextKeys(ch);
      // List endpoint is metadata-only (docs/api-contract.md:102) — no body
      // is shipped over the wire. Single-chapter GET is the body authority.
      expect(Object.keys(ch)).not.toContain('bodyJson');
      expect(Object.keys(ch)).not.toContain('body');
      // [9wk.4] draft-tree wire fields.
      expect(typeof ch.draftCount).toBe('number');
      expect(typeof ch.activeDraftId).toBe('string');
    }
  });

  it("GET list returns 403 when storyId is not the caller's", async () => {
    const { sessionId: sessionIdA } = await registerAndLogin({ username: 'chapters-list-a' });
    const { agent: agentB } = await registerAndLogin({ username: 'chapters-list-b' });
    const reqA = makeFakeReq(sessionIdA);
    const story = await createStoryRepo(reqA).create({ title: 'A' });

    const res = await agentB.get(`/api/stories/${story.id as string}/chapters`);
    expect(res.status).toBe(403);
  });

  // ── PATCH /:chapterId ─────────────────────────────────────────────────────

  it('PATCH title-only does not touch body or wordCount [9wk.4]', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'chapters-patch' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'Patchable' });
    const storyId = story.id as string;

    const originalTree = paragraphDoc('One two three.'); // 3 words
    const created = await createChapterRepo(req).create({
      storyId,
      title: 'Original Title',
      orderIndex: 0,
      bodyJson: originalTree,
      wordCount: 3,
    });
    const chapterId = created.id as string;

    // Title-only patch — body and wordCount should remain unchanged (they
    // are sourced from the active draft, which this PATCH never touches).
    const r1 = await agent
      .patch(`/api/stories/${storyId}/chapters/${chapterId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'New Title' });
    expect(r1.status).toBe(200);
    expect(r1.body.chapter.title).toBe('New Title');
    expect(r1.body.chapter.wordCount).toBe(3);
    expect(r1.body.chapter.bodyJson.type).toBe('doc');
    const p = (r1.body.chapter.bodyJson.content as Array<{ content: Array<{ text: string }> }>)[0];
    expect(p.content[0].text).toBe('One two three.');
    assertNoCiphertextKeys(r1.body.chapter);
  });

  // [9wk.4] Body writes moved to PATCH /api/drafts/:draftId. Response-shape
  // coverage for the null-clear lives in chapters-body-json.test.ts; this
  // case additionally proves the DRAFT row's ciphertext triple goes to SQL
  // NULL (not ciphertext of the literal string "null").
  it('PATCH /api/drafts/:draftId with bodyJson: null clears the body and sets wordCount to 0', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'chapters-patch-null-body' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'Clearable' });
    const storyId = story.id as string;

    const originalTree = paragraphDoc('some words to clear later'); // 5 words
    const created = await createChapterRepo(req).create({
      storyId,
      title: 'To Clear',
      orderIndex: 0,
      bodyJson: originalTree,
      wordCount: 5,
    });
    const chapterId = created.id as string;
    const draftId = created.activeDraftId as string;

    const r = await agent
      .patch(`/api/drafts/${draftId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ bodyJson: null });
    expect(r.status).toBe(200);
    expect(r.body.draft.wordCount).toBe(0);
    expect(r.body.draft.bodyJson).toBeNull();

    const follow = await agent.get(`/api/stories/${storyId}/chapters/${chapterId}`);
    expect(follow.status).toBe(200);
    expect(follow.body.chapter.wordCount).toBe(0);
    expect(follow.body.chapter.bodyJson).toBeNull();

    // Row-level assertion: body triple is SQL NULL, not ciphertext of "null".
    const row = await prisma.draft.findUnique({
      where: { id: draftId },
      select: { bodyCiphertext: true, bodyIv: true, bodyAuthTag: true },
    });
    expect(row).not.toBeNull();
    expect(row!.bodyCiphertext).toBeNull();
    expect(row!.bodyIv).toBeNull();
    expect(row!.bodyAuthTag).toBeNull();
  });

  it('PATCH returns 400 on an unknown key', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'chapters-patch-strict' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'Strict' });
    const storyId = story.id as string;
    const created = await createChapterRepo(req).create({
      storyId,
      title: 'Ch',
      orderIndex: 0,
    });

    const res = await agent
      .patch(`/api/stories/${storyId}/chapters/${created.id as string}`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'ok', wordCount: 9999 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('PATCH returns 400 on unknown key (foo)', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'chapters-patch-strict-foo' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'Strict' });
    const storyId = story.id as string;
    const created = await createChapterRepo(req).create({
      storyId,
      title: 'Ch',
      orderIndex: 0,
    });

    const res = await agent
      .patch(`/api/stories/${storyId}/chapters/${created.id as string}`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'ok', foo: 'bar' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  // ── DELETE /:chapterId ────────────────────────────────────────────────────

  it('DELETE /:chapterId returns 204 and follow-up GET is 403', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'chapters-delete' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'Doomed Parent' });
    const storyId = story.id as string;
    const created = await createChapterRepo(req).create({
      storyId,
      title: 'Doomed',
      orderIndex: 0,
    });
    const chapterId = created.id as string;

    const del = await agent
      .delete(`/api/stories/${storyId}/chapters/${chapterId}`)
      .set('Origin', TEST_ORIGIN);
    expect(del.status).toBe(204);
    expect(del.body).toEqual({});

    const get = await agent.get(`/api/stories/${storyId}/chapters/${chapterId}`);
    // Ownership middleware conflates missing with not-owned → 403.
    expect(get.status).toBe(403);
  });

  it('DELETE /:chapterId reassigns sequential orderIndex 0..N-1 on the remaining list', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'chapters-delete-reseq' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'Reseq' });
    const storyId = story.id as string;
    const a = await createChapterRepo(req).create({ storyId, title: 'a', orderIndex: 0 });
    const b = await createChapterRepo(req).create({ storyId, title: 'b', orderIndex: 1 });
    const c = await createChapterRepo(req).create({ storyId, title: 'c', orderIndex: 2 });
    const d = await createChapterRepo(req).create({ storyId, title: 'd', orderIndex: 3 });

    // Sanity-check the seed.
    const before = await agent.get(`/api/stories/${storyId}/chapters`);
    expect(before.status).toBe(200);
    expect(
      (before.body.chapters as Array<{ id: string; orderIndex: number }>).map((c) => c.orderIndex),
    ).toEqual([0, 1, 2, 3]);

    // Delete the middle row.
    const del = await agent
      .delete(`/api/stories/${storyId}/chapters/${b.id as string}`)
      .set('Origin', TEST_ORIGIN);
    expect(del.status).toBe(204);

    // Remaining list must be sequential 0..N-1, with `b` gone.
    const after = await agent.get(`/api/stories/${storyId}/chapters`);
    expect(after.status).toBe(200);
    const remaining = after.body.chapters as Array<{ id: string; orderIndex: number }>;
    expect(remaining).toHaveLength(3);
    expect(remaining.map((ch) => ch.orderIndex)).toEqual([0, 1, 2]);
    expect(remaining.find((ch) => ch.id === (b.id as string))).toBeUndefined();
    // Verify the surviving order is preserved (a, c, d).
    expect(remaining.map((ch) => ch.id)).toEqual([a.id, c.id, d.id]);
  });
});
