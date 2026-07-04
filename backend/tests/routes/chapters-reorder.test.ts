// [B4] Integration tests for PATCH /api/stories/:storyId/chapters/reorder.
//
// Covers:
//   - 401 without session cookie
//   - 403 when :storyId is another user's
//   - 400 on Zod failures (empty array, missing orderIndex, negative orderIndex, unknown key)
//   - 400 on duplicate id in payload
//   - 400 on duplicate orderIndex in payload
//   - 403 when an id in the payload is not a chapter of :storyId
//   - 403 when an id in the payload belongs to another user
//   - 204 success — reorders 3 chapters, follow-up GET confirms new order
//   - 204 for partial reorder (subset of chapters); non-included keep their orderIndex

import type { Request } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { attachDekToRequest } from '../../src/services/content-crypto.service';
import { _resetSessionStore, getSession } from '../../src/services/session-store';
import { registerAndLogin } from '../helpers/auth';
import { resetDb } from '../helpers/db';

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

interface CreatedChapter {
  id: string;
  orderIndex: number;
  title: string;
}

async function createThreeChapters(
  sessionId: string,
  storyId: string,
): Promise<{ A: CreatedChapter; B: CreatedChapter; C: CreatedChapter }> {
  const req = makeFakeReq(sessionId);
  const repo = createChapterRepo(req);
  const A = (await repo.create({
    storyId,
    title: 'A',
    orderIndex: 0,
  })) as unknown as CreatedChapter;
  const B = (await repo.create({
    storyId,
    title: 'B',
    orderIndex: 1,
  })) as unknown as CreatedChapter;
  const C = (await repo.create({
    storyId,
    title: 'C',
    orderIndex: 2,
  })) as unknown as CreatedChapter;
  return { A, B, C };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Chapter reorder route [B4]', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetDb();
  });

  afterEach(async () => {
    _resetSessionStore();
    await resetDb();
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .patch(`/api/stories/${FAKE_ID}/chapters/reorder`)
      .set('Origin', TEST_ORIGIN)
      .send({ chapters: [{ id: FAKE_ID, orderIndex: 0 }] });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('returns 403 when :storyId belongs to another user', async () => {
    const { sessionId: sessionIdA } = await registerAndLogin({ username: 'reorder-owner-a' });
    const { agent: agentB } = await registerAndLogin({ username: 'reorder-owner-b' });
    const reqA = makeFakeReq(sessionIdA);
    const story = await createStoryRepo(reqA).create({ title: 'A only' });

    const res = await agentB
      .patch(`/api/stories/${story.id as string}/chapters/reorder`)
      .set('Origin', TEST_ORIGIN)
      .send({ chapters: [{ id: FAKE_ID, orderIndex: 0 }] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('returns 400 when chapters array is empty', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'reorder-empty' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'S' });

    const res = await agent
      .patch(`/api/stories/${story.id as string}/chapters/reorder`)
      .set('Origin', TEST_ORIGIN)
      .send({ chapters: [] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('returns 400 when an entry is missing orderIndex', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'reorder-missing-order' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'S' });

    const res = await agent
      .patch(`/api/stories/${story.id as string}/chapters/reorder`)
      .set('Origin', TEST_ORIGIN)
      .send({ chapters: [{ id: FAKE_ID }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('returns 400 on a negative orderIndex', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'reorder-neg' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'S' });

    const res = await agent
      .patch(`/api/stories/${story.id as string}/chapters/reorder`)
      .set('Origin', TEST_ORIGIN)
      .send({ chapters: [{ id: FAKE_ID, orderIndex: -1 }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('returns 400 on an unknown root key', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'reorder-unknown-root' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'S' });

    const res = await agent
      .patch(`/api/stories/${story.id as string}/chapters/reorder`)
      .set('Origin', TEST_ORIGIN)
      .send({ chapters: [{ id: FAKE_ID, orderIndex: 0 }], foo: 'bar' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('returns 400 on an unknown key inside a chapter entry', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'reorder-unknown-entry' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'S' });

    const res = await agent
      .patch(`/api/stories/${story.id as string}/chapters/reorder`)
      .set('Origin', TEST_ORIGIN)
      .send({ chapters: [{ id: FAKE_ID, orderIndex: 0, extra: 'nope' }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('returns 400 when chapters array exceeds max length', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'reorder-too-many' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'S' });

    const res = await agent
      .patch(`/api/stories/${story.id as string}/chapters/reorder`)
      .set('Origin', TEST_ORIGIN)
      .send({
        chapters: Array.from({ length: 501 }, (_, i) => ({ id: `x${i}`, orderIndex: i })),
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('returns 400 on duplicate id in payload', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'reorder-dup-id' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'Dup' });
    const storyId = story.id as string;
    const { A } = await createThreeChapters(sessionId, storyId);

    const res = await agent
      .patch(`/api/stories/${storyId}/chapters/reorder`)
      .set('Origin', TEST_ORIGIN)
      .send({
        chapters: [
          { id: A.id, orderIndex: 0 },
          { id: A.id, orderIndex: 1 },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(Array.isArray(res.body.error.issues)).toBe(true);
    expect(res.body.error.issues).toHaveLength(1);
    expect(res.body.error.issues[0].path).toEqual(['chapters', 1, 'id']);
    expect(res.body.error.issues[0].message).toContain('Duplicate chapter id');
  });

  it('returns 400 on duplicate orderIndex in payload', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'reorder-dup-order' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'Dup Order' });
    const storyId = story.id as string;
    const { A, B } = await createThreeChapters(sessionId, storyId);

    const res = await agent
      .patch(`/api/stories/${storyId}/chapters/reorder`)
      .set('Origin', TEST_ORIGIN)
      .send({
        chapters: [
          { id: A.id, orderIndex: 1 },
          { id: B.id, orderIndex: 1 },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(Array.isArray(res.body.error.issues)).toBe(true);
    expect(res.body.error.issues).toHaveLength(1);
    expect(res.body.error.issues[0].path).toEqual(['chapters', 1, 'orderIndex']);
    expect(res.body.error.issues[0].message).toContain('Duplicate orderIndex');
  });

  it('returns 403 when an id belongs to a different story (same user)', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'reorder-cross-story' });
    const req = makeFakeReq(sessionId);
    const storyA = await createStoryRepo(req).create({ title: 'A' });
    const storyB = await createStoryRepo(req).create({ title: 'B' });

    // Create a chapter in story B
    const chB = await createChapterRepo(req).create({
      storyId: storyB.id as string,
      title: 'from B',
      orderIndex: 0,
    });

    // Create a chapter in story A
    const chA = await createChapterRepo(req).create({
      storyId: storyA.id as string,
      title: 'from A',
      orderIndex: 0,
    });

    // Submit story B's chapter to story A's reorder endpoint.
    const res = await agent
      .patch(`/api/stories/${storyA.id as string}/chapters/reorder`)
      .set('Origin', TEST_ORIGIN)
      .send({
        chapters: [
          { id: chA.id as string, orderIndex: 1 },
          { id: chB.id as string, orderIndex: 0 },
        ],
      });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('returns 403 when an id belongs to another user', async () => {
    const { agent: agentA, sessionId: sessionIdA } = await registerAndLogin({
      username: 'reorder-xuser-a',
    });
    const { sessionId: sessionIdB } = await registerAndLogin({ username: 'reorder-xuser-b' });
    const reqA = makeFakeReq(sessionIdA);
    const reqB = makeFakeReq(sessionIdB);

    const storyA = await createStoryRepo(reqA).create({ title: "A's story" });
    const storyB = await createStoryRepo(reqB).create({ title: "B's story" });

    const chB = await createChapterRepo(reqB).create({
      storyId: storyB.id as string,
      title: "B's chapter",
      orderIndex: 0,
    });

    // Caller A tries to reorder B's chapter under A's story.
    const res = await agentA
      .patch(`/api/stories/${storyA.id as string}/chapters/reorder`)
      .set('Origin', TEST_ORIGIN)
      .send({
        chapters: [{ id: chB.id as string, orderIndex: 0 }],
      });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('returns 204 on success and reorders 3 chapters', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'reorder-happy' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'Happy' });
    const storyId = story.id as string;
    const { A, B, C } = await createThreeChapters(sessionId, storyId);

    // [A=0, B=1, C=2]  →  [A=2, B=0, C=1]
    const res = await agent
      .patch(`/api/stories/${storyId}/chapters/reorder`)
      .set('Origin', TEST_ORIGIN)
      .send({
        chapters: [
          { id: A.id, orderIndex: 2 },
          { id: B.id, orderIndex: 0 },
          { id: C.id, orderIndex: 1 },
        ],
      });
    expect(res.status).toBe(204);
    expect(res.body).toEqual({});

    const list = await agent.get(`/api/stories/${storyId}/chapters`);
    expect(list.status).toBe(200);
    const titles = list.body.chapters.map((c: { title: string }) => c.title);
    expect(titles).toEqual(['B', 'C', 'A']);
    const byId = new Map<string, number>(
      list.body.chapters.map((c: { id: string; orderIndex: number }) => [c.id, c.orderIndex]),
    );
    expect(byId.get(A.id)).toBe(2);
    expect(byId.get(B.id)).toBe(0);
    expect(byId.get(C.id)).toBe(1);
  });

  // [D16] Regression test: without the two-phase swap, a direct two-row swap
  // under @@unique([storyId, orderIndex]) raises P2002 mid-transaction as
  // soon as the first UPDATE tries to set A.orderIndex=1 (still held by B).
  it('handles a direct two-chapter swap without tripping the unique constraint [D16]', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'reorder-swap-d16' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'Swap' });
    const storyId = story.id as string;

    const repo = createChapterRepo(req);
    const A = (await repo.create({ storyId, title: 'A', orderIndex: 0 })) as unknown as {
      id: string;
    };
    const B = (await repo.create({ storyId, title: 'B', orderIndex: 1 })) as unknown as {
      id: string;
    };

    const res = await agent
      .patch(`/api/stories/${storyId}/chapters/reorder`)
      .set('Origin', TEST_ORIGIN)
      .send({
        chapters: [
          { id: A.id, orderIndex: 1 },
          { id: B.id, orderIndex: 0 },
        ],
      });
    expect(res.status).toBe(204);

    const list = await agent.get(`/api/stories/${storyId}/chapters`);
    const byId = new Map<string, number>(
      list.body.chapters.map((c: { id: string; orderIndex: number }) => [c.id, c.orderIndex]),
    );
    expect(byId.get(A.id)).toBe(1);
    expect(byId.get(B.id)).toBe(0);
  });

  it('returns 204 for a partial reorder — non-included chapter keeps its orderIndex', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'reorder-partial' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'Partial' });
    const storyId = story.id as string;
    const { A, B, C } = await createThreeChapters(sessionId, storyId);

    // Swap A and B; leave C alone.
    const res = await agent
      .patch(`/api/stories/${storyId}/chapters/reorder`)
      .set('Origin', TEST_ORIGIN)
      .send({
        chapters: [
          { id: A.id, orderIndex: 1 },
          { id: B.id, orderIndex: 0 },
        ],
      });
    expect(res.status).toBe(204);

    const list = await agent.get(`/api/stories/${storyId}/chapters`);
    expect(list.status).toBe(200);
    const byId = new Map<string, number>(
      list.body.chapters.map((c: { id: string; orderIndex: number }) => [c.id, c.orderIndex]),
    );
    expect(byId.get(A.id)).toBe(1);
    expect(byId.get(B.id)).toBe(0);
    expect(byId.get(C.id)).toBe(2); // unchanged
  });
});
