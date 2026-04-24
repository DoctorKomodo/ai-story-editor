// [B8] Integration tests for outline CRUD + reorder under
// /api/stories/:storyId/outline.
//
// Covers:
//   - All endpoints 401 without Bearer
//   - POST 403 when :storyId is not the caller's story
//   - POST 400 on Zod failures (empty title, missing status, unknown key)
//   - POST 201 with decrypted title/sub; auto-assigned order (0 then 1)
//   - GET list 200 sorted by order asc; no ciphertext
//   - GET /:outlineId 404 cross-story same-user; 403 cross-user
//   - PATCH 200 partial updates; null clears sub; 400 on unknown key
//   - DELETE 204 and follow-up GET 403
//   - Reorder 400 on Zod failures (empty, negative order, unknown key, >500)
//   - Reorder 400 on duplicate id / duplicate order
//   - Reorder 403 on cross-story same-user id; cross-user id
//   - Reorder 204 — full 3-item reorder; follow-up list confirms new order
//   - Reorder 204 — partial reorder; non-listed items unchanged

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/index';
import { getSession, _resetSessionStore } from '../../src/services/session-store';
import { attachDekToRequest } from '../../src/services/content-crypto.service';
import { createStoryRepo } from '../../src/repos/story.repo';
import { createOutlineRepo } from '../../src/repos/outline.repo';
import type { AccessTokenPayload } from '../../src/services/auth.service';
import type { Request } from 'express';
import { prisma } from '../setup';
import { prisma as appPrisma } from '../../src/lib/prisma';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function registerAndLogin(
  username: string,
  password = 'outline-pw',
  name = 'Outline Route User',
): Promise<string> {
  await request(app).post('/api/auth/register').send({ name, username, password });
  const login = await request(app).post('/api/auth/login').send({ username, password });
  expect(login.status).toBe(200);
  return login.body.accessToken as string;
}

function makeFakeReq(accessToken: string): Request {
  const decoded = jwt.decode(accessToken) as AccessTokenPayload;
  const sessionId = decoded.sessionId!;
  const session = getSession(sessionId);
  expect(session).not.toBeNull();
  const req = { user: { id: decoded.sub, email: null } } as unknown as Request;
  attachDekToRequest(req, session!.dek);
  return req;
}

async function resetAll(): Promise<void> {
  await prisma.message.deleteMany();
  await prisma.chat.deleteMany();
  await prisma.outlineItem.deleteMany();
  await prisma.character.deleteMany();
  await prisma.chapter.deleteMany();
  await prisma.story.deleteMany();
  await prisma.session.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
}

const FAKE_ID = '00000000-0000-0000-0000-000000000000';

function assertNoCiphertextKeys(obj: Record<string, unknown>): void {
  for (const key of Object.keys(obj)) {
    expect(key.endsWith('Ciphertext')).toBe(false);
    expect(key.endsWith('Iv')).toBe(false);
    expect(key.endsWith('AuthTag')).toBe(false);
  }
}

interface CreatedOutlineItem {
  id: string;
  order: number;
  title: string;
}

async function createThreeOutlineItems(
  accessToken: string,
  storyId: string,
): Promise<{ A: CreatedOutlineItem; B: CreatedOutlineItem; C: CreatedOutlineItem }> {
  const req = makeFakeReq(accessToken);
  const repo = createOutlineRepo(req);
  const A = (await repo.create({
    storyId,
    title: 'A',
    status: 'queued',
    order: 0,
  })) as unknown as CreatedOutlineItem;
  const B = (await repo.create({
    storyId,
    title: 'B',
    status: 'queued',
    order: 1,
  })) as unknown as CreatedOutlineItem;
  const C = (await repo.create({
    storyId,
    title: 'C',
    status: 'queued',
    order: 2,
  })) as unknown as CreatedOutlineItem;
  return { A, B, C };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Outline routes [B8]', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetAll();
  });

  afterEach(async () => {
    _resetSessionStore();
    await resetAll();
  });

  // ── Auth gates ────────────────────────────────────────────────────────────

  it('GET list returns 401 without Bearer', async () => {
    const res = await request(app).get(`/api/stories/${FAKE_ID}/outline`);
    expect(res.status).toBe(401);
  });

  it('POST returns 401 without Bearer', async () => {
    const res = await request(app)
      .post(`/api/stories/${FAKE_ID}/outline`)
      .send({ title: 'X', status: 'queued' });
    expect(res.status).toBe(401);
  });

  it('PATCH /reorder returns 401 without Bearer', async () => {
    const res = await request(app)
      .patch(`/api/stories/${FAKE_ID}/outline/reorder`)
      .send({ items: [{ id: FAKE_ID, order: 0 }] });
    expect(res.status).toBe(401);
  });

  it('GET /:outlineId returns 401 without Bearer', async () => {
    const res = await request(app).get(`/api/stories/${FAKE_ID}/outline/${FAKE_ID}`);
    expect(res.status).toBe(401);
  });

  it('PATCH /:outlineId returns 401 without Bearer', async () => {
    const res = await request(app)
      .patch(`/api/stories/${FAKE_ID}/outline/${FAKE_ID}`)
      .send({ title: 'X' });
    expect(res.status).toBe(401);
  });

  it('DELETE /:outlineId returns 401 without Bearer', async () => {
    const res = await request(app).delete(`/api/stories/${FAKE_ID}/outline/${FAKE_ID}`);
    expect(res.status).toBe(401);
  });

  // ── POST ownership / Zod ──────────────────────────────────────────────────

  it('POST returns 403 when :storyId does not belong to the caller', async () => {
    const tokenA = await registerAndLogin('outline-owner-a');
    const tokenB = await registerAndLogin('outline-owner-b');
    const reqA = makeFakeReq(tokenA);
    const story = await createStoryRepo(reqA).create({ title: 'A only' });

    const res = await request(app)
      .post(`/api/stories/${story.id as string}/outline`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ title: 'hijack', status: 'queued' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('POST returns 400 on empty title', async () => {
    const accessToken = await registerAndLogin('outline-empty-title');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'My Story' });

    const res = await request(app)
      .post(`/api/stories/${story.id as string}/outline`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: '', status: 'queued' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('POST returns 400 on missing status', async () => {
    const accessToken = await registerAndLogin('outline-missing-status');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'My Story' });

    const res = await request(app)
      .post(`/api/stories/${story.id as string}/outline`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Intro' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('POST returns 400 when an unknown key is passed', async () => {
    const accessToken = await registerAndLogin('outline-strict-post');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'Strict' });

    const res = await request(app)
      .post(`/api/stories/${story.id as string}/outline`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Act I', status: 'queued', extraField: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('POST returns 400 when order is included (server assigns)', async () => {
    const accessToken = await registerAndLogin('outline-post-order');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'Strict' });

    const res = await request(app)
      .post(`/api/stories/${story.id as string}/outline`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Act I', status: 'queued', order: 7 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  // ── POST happy path ───────────────────────────────────────────────────────

  it('POST 201 auto-assigns order=0 for first item and 1 for second', async () => {
    const accessToken = await registerAndLogin('outline-create');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'Outline Home' });
    const storyId = story.id as string;

    const r1 = await request(app)
      .post(`/api/stories/${storyId}/outline`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Act I', sub: 'Setup', status: 'queued' });
    expect(r1.status).toBe(201);
    expect(r1.body.outlineItem.title).toBe('Act I');
    expect(r1.body.outlineItem.sub).toBe('Setup');
    expect(r1.body.outlineItem.status).toBe('queued');
    expect(r1.body.outlineItem.order).toBe(0);
    expect(r1.body.outlineItem.storyId).toBe(storyId);
    assertNoCiphertextKeys(r1.body.outlineItem);

    const r2 = await request(app)
      .post(`/api/stories/${storyId}/outline`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Act II', status: 'active' });
    expect(r2.status).toBe(201);
    expect(r2.body.outlineItem.order).toBe(1);
    expect(r2.body.outlineItem.sub).toBeNull();
    assertNoCiphertextKeys(r2.body.outlineItem);
  });

  // ── [D16] POST race: aggregate+insert must retry on P2002 ────────────────

  it('POST retries on P2002 when the aggregate returns a stale _max', async () => {
    const accessToken = await registerAndLogin('outline-race');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'Racing outline' });
    const storyId = story.id as string;

    // Seed order=0, then the "winning racer" at order=1.
    await createOutlineRepo(req).create({ storyId, title: 's0', status: 'queued', order: 0 });
    await createOutlineRepo(req).create({ storyId, title: 'r1', status: 'queued', order: 1 });

    // Force the first aggregate to claim _max is still 0 — handler picks
    // 0+1=1, collides with the seeded racer, hits P2002, and retries.
    const aggSpy = vi.spyOn(appPrisma.outlineItem, 'aggregate');
    aggSpy.mockImplementationOnce(
      async () =>
        ({ _max: { order: 0 } }) as unknown as Awaited<
          ReturnType<typeof appPrisma.outlineItem.aggregate>
        >,
    );

    try {
      const res = await request(app)
        .post(`/api/stories/${storyId}/outline`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ title: 'after-race', status: 'queued' });
      expect(res.status).toBe(201);
      expect(res.body.outlineItem.order).toBe(2);
      expect(res.body.outlineItem.title).toBe('after-race');
      expect(aggSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      aggSpy.mockRestore();
    }
  });

  it('POST surfaces a non-P2002 error without retrying', async () => {
    const accessToken = await registerAndLogin('outline-nonp2002');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'Boom' });
    const storyId = story.id as string;

    const aggSpy = vi
      .spyOn(appPrisma.outlineItem, 'aggregate')
      .mockRejectedValue(new Error('boom'));
    try {
      const res = await request(app)
        .post(`/api/stories/${storyId}/outline`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ title: 'never', status: 'queued' });
      expect(res.status).toBe(500);
      expect(aggSpy).toHaveBeenCalledTimes(1);
    } finally {
      aggSpy.mockRestore();
    }
  });

  // ── GET list ──────────────────────────────────────────────────────────────

  it('GET list returns 200 ordered by order asc, no ciphertext', async () => {
    const accessToken = await registerAndLogin('outline-list');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'Ordered' });
    const storyId = story.id as string;

    // Create out of order to confirm sort works.
    await createOutlineRepo(req).create({
      storyId,
      title: 'Third',
      status: 'queued',
      order: 2,
    });
    await createOutlineRepo(req).create({
      storyId,
      title: 'First',
      status: 'queued',
      order: 0,
    });
    await createOutlineRepo(req).create({
      storyId,
      title: 'Second',
      status: 'queued',
      order: 1,
    });

    const res = await request(app)
      .get(`/api/stories/${storyId}/outline`)
      .set('Authorization', `Bearer ${accessToken}`)
      ;
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.outline)).toBe(true);
    expect(res.body.outline).toHaveLength(3);
    expect(res.body.outline.map((o: { title: string }) => o.title)).toEqual([
      'First',
      'Second',
      'Third',
    ]);
    for (const item of res.body.outline) {
      assertNoCiphertextKeys(item);
    }
  });

  it("GET list returns 403 when :storyId is not the caller's", async () => {
    const tokenA = await registerAndLogin('outline-list-a');
    const tokenB = await registerAndLogin('outline-list-b');
    const reqA = makeFakeReq(tokenA);
    const story = await createStoryRepo(reqA).create({ title: 'A' });

    const res = await request(app)
      .get(`/api/stories/${story.id as string}/outline`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(403);
  });

  // ── GET /:outlineId ───────────────────────────────────────────────────────

  it('GET /:outlineId returns 404 when outlineId is under a different story (same user)', async () => {
    const accessToken = await registerAndLogin('outline-path-integrity');
    const req = makeFakeReq(accessToken);
    const storyA = await createStoryRepo(req).create({ title: 'A' });
    const storyB = await createStoryRepo(req).create({ title: 'B' });

    const itemA = await createOutlineRepo(req).create({
      storyId: storyA.id as string,
      title: 'Item in A',
      status: 'queued',
      order: 0,
    });

    const res = await request(app)
      .get(`/api/stories/${storyB.id as string}/outline/${itemA.id as string}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('GET /:outlineId returns 403 when item belongs to another user', async () => {
    const tokenA = await registerAndLogin('outline-xuser-a');
    const tokenB = await registerAndLogin('outline-xuser-b');

    const reqA = makeFakeReq(tokenA);
    const story = await createStoryRepo(reqA).create({ title: 'A only' });
    const item = await createOutlineRepo(reqA).create({
      storyId: story.id as string,
      title: 'A item',
      status: 'queued',
      order: 0,
    });

    const res = await request(app)
      .get(`/api/stories/${story.id as string}/outline/${item.id as string}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(403);
  });

  // ── PATCH /:outlineId ─────────────────────────────────────────────────────

  it('PATCH 200 partial update; null clears sub; leaves others unchanged', async () => {
    const accessToken = await registerAndLogin('outline-patch');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'Patchable' });
    const storyId = story.id as string;

    const created = await createOutlineRepo(req).create({
      storyId,
      title: 'Original',
      sub: 'original sub',
      status: 'queued',
      order: 0,
    });
    const id = created.id as string;

    // Update title only.
    const r1 = await request(app)
      .patch(`/api/stories/${storyId}/outline/${id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Updated' });
    expect(r1.status).toBe(200);
    expect(r1.body.outlineItem.title).toBe('Updated');
    expect(r1.body.outlineItem.sub).toBe('original sub');
    expect(r1.body.outlineItem.status).toBe('queued');
    expect(r1.body.outlineItem.order).toBe(0);
    assertNoCiphertextKeys(r1.body.outlineItem);

    // Update status and clear sub via null.
    const r2 = await request(app)
      .patch(`/api/stories/${storyId}/outline/${id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'done', sub: null });
    expect(r2.status).toBe(200);
    expect(r2.body.outlineItem.sub).toBeNull();
    expect(r2.body.outlineItem.status).toBe('done');
    expect(r2.body.outlineItem.title).toBe('Updated');
  });

  it('PATCH returns 400 on an unknown key', async () => {
    const accessToken = await registerAndLogin('outline-patch-strict');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'Strict' });
    const storyId = story.id as string;
    const created = await createOutlineRepo(req).create({
      storyId,
      title: 'Item',
      status: 'queued',
      order: 0,
    });

    const res = await request(app)
      .patch(`/api/stories/${storyId}/outline/${created.id as string}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'ok', mystery: 'field' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('PATCH returns 404 when outlineId belongs to a different story (path integrity)', async () => {
    const accessToken = await registerAndLogin('outline-patch-path');
    const req = makeFakeReq(accessToken);
    const storyA = await createStoryRepo(req).create({ title: 'A' });
    const storyB = await createStoryRepo(req).create({ title: 'B' });
    const itemA = await createOutlineRepo(req).create({
      storyId: storyA.id as string,
      title: 'A',
      status: 'queued',
      order: 0,
    });

    const res = await request(app)
      .patch(`/api/stories/${storyB.id as string}/outline/${itemA.id as string}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'hijack' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  // ── DELETE /:outlineId ────────────────────────────────────────────────────

  it('DELETE /:outlineId returns 204 and follow-up GET is 403', async () => {
    const accessToken = await registerAndLogin('outline-delete');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'Home' });
    const storyId = story.id as string;
    const created = await createOutlineRepo(req).create({
      storyId,
      title: 'Doomed',
      status: 'queued',
      order: 0,
    });
    const id = created.id as string;

    const del = await request(app)
      .delete(`/api/stories/${storyId}/outline/${id}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(del.status).toBe(204);
    expect(del.body).toEqual({});

    const get = await request(app)
      .get(`/api/stories/${storyId}/outline/${id}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(get.status).toBe(403);
  });

  // ── PATCH /reorder ────────────────────────────────────────────────────────

  it('reorder returns 400 when items array is empty', async () => {
    const accessToken = await registerAndLogin('outline-reorder-empty');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'S' });

    const res = await request(app)
      .patch(`/api/stories/${story.id as string}/outline/reorder`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ items: [] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('reorder returns 400 on negative order', async () => {
    const accessToken = await registerAndLogin('outline-reorder-neg');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'S' });

    const res = await request(app)
      .patch(`/api/stories/${story.id as string}/outline/reorder`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ items: [{ id: FAKE_ID, order: -1 }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('reorder returns 400 on unknown key inside item', async () => {
    const accessToken = await registerAndLogin('outline-reorder-unknown');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'S' });

    const res = await request(app)
      .patch(`/api/stories/${story.id as string}/outline/reorder`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ items: [{ id: FAKE_ID, order: 0, extra: 'no' }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('reorder returns 400 when items exceed max length', async () => {
    const accessToken = await registerAndLogin('outline-reorder-max');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'S' });

    const res = await request(app)
      .patch(`/api/stories/${story.id as string}/outline/reorder`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        items: Array.from({ length: 501 }, (_, i) => ({ id: 'x' + i, order: i })),
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('reorder returns 400 on duplicate id in payload', async () => {
    const accessToken = await registerAndLogin('outline-reorder-dup-id');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'Dup' });
    const storyId = story.id as string;
    const { A } = await createThreeOutlineItems(accessToken, storyId);

    const res = await request(app)
      .patch(`/api/stories/${storyId}/outline/reorder`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        items: [
          { id: A.id, order: 0 },
          { id: A.id, order: 1 },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('reorder returns 400 on duplicate order in payload', async () => {
    const accessToken = await registerAndLogin('outline-reorder-dup-order');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'Dup Order' });
    const storyId = story.id as string;
    const { A, B } = await createThreeOutlineItems(accessToken, storyId);

    const res = await request(app)
      .patch(`/api/stories/${storyId}/outline/reorder`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        items: [
          { id: A.id, order: 1 },
          { id: B.id, order: 1 },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('reorder returns 403 when an id belongs to a different story (same user)', async () => {
    const accessToken = await registerAndLogin('outline-reorder-cross-story');
    const req = makeFakeReq(accessToken);
    const storyA = await createStoryRepo(req).create({ title: 'A' });
    const storyB = await createStoryRepo(req).create({ title: 'B' });

    const itemB = await createOutlineRepo(req).create({
      storyId: storyB.id as string,
      title: 'from B',
      status: 'queued',
      order: 0,
    });
    const itemA = await createOutlineRepo(req).create({
      storyId: storyA.id as string,
      title: 'from A',
      status: 'queued',
      order: 0,
    });

    const res = await request(app)
      .patch(`/api/stories/${storyA.id as string}/outline/reorder`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        items: [
          { id: itemA.id as string, order: 1 },
          { id: itemB.id as string, order: 0 },
        ],
      });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('reorder returns 403 when an id belongs to another user', async () => {
    const tokenA = await registerAndLogin('outline-reorder-xuser-a');
    const tokenB = await registerAndLogin('outline-reorder-xuser-b');
    const reqA = makeFakeReq(tokenA);
    const reqB = makeFakeReq(tokenB);

    const storyA = await createStoryRepo(reqA).create({ title: "A's story" });
    const storyB = await createStoryRepo(reqB).create({ title: "B's story" });

    const itemB = await createOutlineRepo(reqB).create({
      storyId: storyB.id as string,
      title: "B's item",
      status: 'queued',
      order: 0,
    });

    const res = await request(app)
      .patch(`/api/stories/${storyA.id as string}/outline/reorder`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        items: [{ id: itemB.id as string, order: 0 }],
      });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('reorder returns 204 on a full 3-item reorder; follow-up list reflects new order', async () => {
    const accessToken = await registerAndLogin('outline-reorder-happy');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'Happy' });
    const storyId = story.id as string;
    const { A, B, C } = await createThreeOutlineItems(accessToken, storyId);

    // [A=0, B=1, C=2]  →  [A=2, B=0, C=1]
    const res = await request(app)
      .patch(`/api/stories/${storyId}/outline/reorder`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        items: [
          { id: A.id, order: 2 },
          { id: B.id, order: 0 },
          { id: C.id, order: 1 },
        ],
      });
    expect(res.status).toBe(204);
    expect(res.body).toEqual({});

    const list = await request(app)
      .get(`/api/stories/${storyId}/outline`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(list.status).toBe(200);
    const titles = list.body.outline.map((o: { title: string }) => o.title);
    expect(titles).toEqual(['B', 'C', 'A']);
    const byId = new Map<string, number>(
      list.body.outline.map((o: { id: string; order: number }) => [o.id, o.order]),
    );
    expect(byId.get(A.id)).toBe(2);
    expect(byId.get(B.id)).toBe(0);
    expect(byId.get(C.id)).toBe(1);
  });

  it('reorder returns 204 on a partial reorder; non-listed items unchanged', async () => {
    const accessToken = await registerAndLogin('outline-reorder-partial');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'Partial' });
    const storyId = story.id as string;
    const { A, B, C } = await createThreeOutlineItems(accessToken, storyId);

    // Swap A and B; leave C alone.
    const res = await request(app)
      .patch(`/api/stories/${storyId}/outline/reorder`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        items: [
          { id: A.id, order: 1 },
          { id: B.id, order: 0 },
        ],
      });
    expect(res.status).toBe(204);

    const list = await request(app)
      .get(`/api/stories/${storyId}/outline`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(list.status).toBe(200);
    const byId = new Map<string, number>(
      list.body.outline.map((o: { id: string; order: number }) => [o.id, o.order]),
    );
    expect(byId.get(A.id)).toBe(1);
    expect(byId.get(B.id)).toBe(0);
    expect(byId.get(C.id)).toBe(2); // unchanged
  });
});
