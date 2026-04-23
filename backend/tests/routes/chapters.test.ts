// [B3] Integration tests for chapter CRUD under /api/stories/:storyId/chapters.
//
// Covers:
//   - All endpoints 401 without Bearer
//   - POST 403 when :storyId is not the caller's story
//   - POST 400 when body fails Zod (unknown key, empty title, wordCount passed)
//   - POST 201 with bodyJson — wordCount derived from the TipTap tree,
//     orderIndex auto-assigned (0 for first, 1 for second, …)
//   - POST 201 without bodyJson — wordCount = 0, orderIndex still assigned
//   - GET /:chapterId 200 decrypted, no ciphertext, body parsed to a tree
//   - GET /:chapterId 404 when chapter belongs to a different story (path integrity)
//   - GET /:chapterId 403 when chapter belongs to another user
//   - GET list 200 sorted by orderIndex asc, no ciphertext
//   - PATCH /:chapterId title-only doesn't touch body; bodyJson recomputes wordCount
//   - PATCH /:chapterId 400 on unknown key
//   - DELETE /:chapterId 204, follow-up GET 403

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import { getSession, _resetSessionStore } from '../../src/services/session-store';
import { attachDekToRequest } from '../../src/services/content-crypto.service';
import { createStoryRepo } from '../../src/repos/story.repo';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import type { AccessTokenPayload } from '../../src/services/auth.service';
import type { Request } from 'express';
import { prisma } from '../setup';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function registerAndLogin(
  username: string,
  password = 'chapters-pw',
  name = 'Chapter Route User',
): Promise<string> {
  await request(app)
    .post('/api/auth/register')
    .send({ name, username, password });
  const login = await request(app)
    .post('/api/auth/login')
    .send({ username, password });
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
    await resetAll();
  });

  afterEach(async () => {
    _resetSessionStore();
    await resetAll();
  });

  // ── Auth gates ────────────────────────────────────────────────────────────

  it('GET /api/stories/:storyId/chapters returns 401 without Bearer', async () => {
    const res = await request(app).get(`/api/stories/${FAKE_ID}/chapters`);
    expect(res.status).toBe(401);
  });

  it('POST /api/stories/:storyId/chapters returns 401 without Bearer', async () => {
    const res = await request(app)
      .post(`/api/stories/${FAKE_ID}/chapters`)
      .send({ title: 'Ch 1' });
    expect(res.status).toBe(401);
  });

  it('GET /api/stories/:storyId/chapters/:chapterId returns 401 without Bearer', async () => {
    const res = await request(app).get(`/api/stories/${FAKE_ID}/chapters/${FAKE_ID}`);
    expect(res.status).toBe(401);
  });

  it('PATCH /api/stories/:storyId/chapters/:chapterId returns 401 without Bearer', async () => {
    const res = await request(app)
      .patch(`/api/stories/${FAKE_ID}/chapters/${FAKE_ID}`)
      .send({ title: 'nope' });
    expect(res.status).toBe(401);
  });

  it('DELETE /api/stories/:storyId/chapters/:chapterId returns 401 without Bearer', async () => {
    const res = await request(app).delete(`/api/stories/${FAKE_ID}/chapters/${FAKE_ID}`);
    expect(res.status).toBe(401);
  });

  // ── POST ownership / Zod ──────────────────────────────────────────────────

  it('POST returns 403 when :storyId does not belong to the caller', async () => {
    const tokenA = await registerAndLogin('chapters-owner-a');
    const tokenB = await registerAndLogin('chapters-owner-b');
    const reqA = makeFakeReq(tokenA);
    const story = await createStoryRepo(reqA).create({ title: 'A only' });

    const res = await request(app)
      .post(`/api/stories/${story.id as string}/chapters`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ title: 'hijack' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('POST returns 400 on empty title', async () => {
    const accessToken = await registerAndLogin('chapters-empty-title');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'My Story' });

    const res = await request(app)
      .post(`/api/stories/${story.id as string}/chapters`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
  });

  it('POST returns 400 when an unknown key (wordCount) is passed', async () => {
    const accessToken = await registerAndLogin('chapters-strict-post');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'Strict Story' });

    const res = await request(app)
      .post(`/api/stories/${story.id as string}/chapters`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Ch 1', wordCount: 9999 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
  });

  it('POST returns 400 when an unknown key (orderIndex) is passed', async () => {
    const accessToken = await registerAndLogin('chapters-strict-order');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'Strict Story' });

    const res = await request(app)
      .post(`/api/stories/${story.id as string}/chapters`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Ch 1', orderIndex: 7 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
  });

  // ── POST happy path: wordCount + orderIndex ───────────────────────────────

  it('POST with bodyJson computes wordCount from the tree and auto-assigns orderIndex', async () => {
    const accessToken = await registerAndLogin('chapters-body');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'Has Chapters' });
    const storyId = story.id as string;

    const text1 = 'The quick brown fox jumps over the lazy dog.'; // 9 words
    const res1 = await request(app)
      .post(`/api/stories/${storyId}/chapters`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Ch 1', bodyJson: paragraphDoc(text1) });
    expect(res1.status).toBe(201);
    expect(res1.body.chapter.title).toBe('Ch 1');
    expect(res1.body.chapter.wordCount).toBe(9);
    expect(res1.body.chapter.orderIndex).toBe(0);
    expect(res1.body.chapter.storyId).toBe(storyId);
    assertNoCiphertextKeys(res1.body.chapter);

    const text2 = 'Two roads diverged in a wood.'; // 6 words
    const res2 = await request(app)
      .post(`/api/stories/${storyId}/chapters`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Ch 2', bodyJson: paragraphDoc(text2) });
    expect(res2.status).toBe(201);
    expect(res2.body.chapter.wordCount).toBe(6);
    expect(res2.body.chapter.orderIndex).toBe(1);

    const res3 = await request(app)
      .post(`/api/stories/${storyId}/chapters`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Ch 3', bodyJson: paragraphDoc('Three words here.') });
    expect(res3.status).toBe(201);
    expect(res3.body.chapter.orderIndex).toBe(2);
  });

  it('POST without bodyJson sets wordCount to 0 and still auto-assigns orderIndex', async () => {
    const accessToken = await registerAndLogin('chapters-no-body');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'Bare Chapters' });
    const storyId = story.id as string;

    const res1 = await request(app)
      .post(`/api/stories/${storyId}/chapters`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Empty 1' });
    expect(res1.status).toBe(201);
    expect(res1.body.chapter.wordCount).toBe(0);
    expect(res1.body.chapter.orderIndex).toBe(0);

    const res2 = await request(app)
      .post(`/api/stories/${storyId}/chapters`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Empty 2' });
    expect(res2.status).toBe(201);
    expect(res2.body.chapter.wordCount).toBe(0);
    expect(res2.body.chapter.orderIndex).toBe(1);
  });

  // ── GET /:chapterId ───────────────────────────────────────────────────────

  it('GET /:chapterId returns 200 with decrypted fields and body parsed as a tree', async () => {
    const accessToken = await registerAndLogin('chapters-get-one');
    const req = makeFakeReq(accessToken);
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

    const res = await request(app)
      .get(`/api/stories/${storyId}/chapters/${created.id as string}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.chapter.title).toBe('Readable Chapter');
    // Body should come back as a parsed JSON tree, not a string.
    expect(typeof res.body.chapter.body).toBe('object');
    expect(res.body.chapter.body.type).toBe('doc');
    expect(res.body.chapter.wordCount).toBe(2);
    expect(res.body.chapter.orderIndex).toBe(0);
    expect(res.body.chapter.storyId).toBe(storyId);
    assertNoCiphertextKeys(res.body.chapter);
  });

  it('GET /:chapterId returns 404 when chapterId is under a different story (path integrity)', async () => {
    const accessToken = await registerAndLogin('chapters-path-integrity');
    const req = makeFakeReq(accessToken);
    const storyA = await createStoryRepo(req).create({ title: 'A' });
    const storyB = await createStoryRepo(req).create({ title: 'B' });

    const chapterA = await createChapterRepo(req).create({
      storyId: storyA.id as string,
      title: 'Ch in A',
      orderIndex: 0,
    });

    // Request A's chapter under B's story URL. Both owned by the same user,
    // so ownership middleware passes; the handler's storyId guard should 404.
    const res = await request(app)
      .get(`/api/stories/${storyB.id as string}/chapters/${chapterA.id as string}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('GET /:chapterId returns 403 when chapter belongs to another user', async () => {
    const tokenA = await registerAndLogin('chapters-xuser-a');
    const tokenB = await registerAndLogin('chapters-xuser-b');

    const reqA = makeFakeReq(tokenA);
    const story = await createStoryRepo(reqA).create({ title: 'A only' });
    const chapter = await createChapterRepo(reqA).create({
      storyId: story.id as string,
      title: 'A chapter',
      orderIndex: 0,
    });

    const res = await request(app)
      .get(`/api/stories/${story.id as string}/chapters/${chapter.id as string}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(403);
  });

  // ── GET list ──────────────────────────────────────────────────────────────

  it('GET list returns 200 sorted by orderIndex asc with no ciphertext', async () => {
    const accessToken = await registerAndLogin('chapters-list');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'Ordered' });
    const storyId = story.id as string;

    // Insert out-of-order; the list endpoint must sort by orderIndex asc.
    await createChapterRepo(req).create({ storyId, title: 'Second', orderIndex: 1 });
    await createChapterRepo(req).create({ storyId, title: 'Third', orderIndex: 2 });
    await createChapterRepo(req).create({ storyId, title: 'First', orderIndex: 0 });

    const res = await request(app)
      .get(`/api/stories/${storyId}/chapters`)
      .set('Authorization', `Bearer ${accessToken}`);
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
    }
  });

  it('GET list returns 403 when storyId is not the caller\'s', async () => {
    const tokenA = await registerAndLogin('chapters-list-a');
    const tokenB = await registerAndLogin('chapters-list-b');
    const reqA = makeFakeReq(tokenA);
    const story = await createStoryRepo(reqA).create({ title: 'A' });

    const res = await request(app)
      .get(`/api/stories/${story.id as string}/chapters`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(403);
  });

  // ── PATCH /:chapterId ─────────────────────────────────────────────────────

  it('PATCH title-only does not touch body; bodyJson recomputes wordCount', async () => {
    const accessToken = await registerAndLogin('chapters-patch');
    const req = makeFakeReq(accessToken);
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

    // Title-only patch — body and wordCount should remain unchanged.
    const r1 = await request(app)
      .patch(`/api/stories/${storyId}/chapters/${chapterId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'New Title' });
    expect(r1.status).toBe(200);
    expect(r1.body.chapter.title).toBe('New Title');
    expect(r1.body.chapter.wordCount).toBe(3);
    expect(r1.body.chapter.body.type).toBe('doc');
    const p = (r1.body.chapter.body.content as Array<{ content: Array<{ text: string }> }>)[0];
    expect(p.content[0].text).toBe('One two three.');
    assertNoCiphertextKeys(r1.body.chapter);

    // bodyJson patch — wordCount recomputed from the new tree.
    const newTree = paragraphDoc('four five six seven eight'); // 5 words
    const r2 = await request(app)
      .patch(`/api/stories/${storyId}/chapters/${chapterId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ bodyJson: newTree });
    expect(r2.status).toBe(200);
    expect(r2.body.chapter.wordCount).toBe(5);
    expect(r2.body.chapter.title).toBe('New Title');
  });

  it('PATCH with bodyJson: null clears the body and sets wordCount to 0', async () => {
    const accessToken = await registerAndLogin('chapters-patch-null-body');
    const req = makeFakeReq(accessToken);
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

    const r = await request(app)
      .patch(`/api/stories/${storyId}/chapters/${chapterId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ bodyJson: null });
    expect(r.status).toBe(200);
    expect(r.body.chapter.wordCount).toBe(0);
    expect(r.body.chapter.body).toBeNull();

    const follow = await request(app)
      .get(`/api/stories/${storyId}/chapters/${chapterId}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(follow.status).toBe(200);
    expect(follow.body.chapter.wordCount).toBe(0);
    expect(follow.body.chapter.body).toBeNull();

    // Row-level assertion: body triple is SQL NULL, not ciphertext of "null".
    const row = await prisma.chapter.findUnique({
      where: { id: chapterId },
      select: { bodyCiphertext: true, bodyIv: true, bodyAuthTag: true },
    });
    expect(row).not.toBeNull();
    expect(row!.bodyCiphertext).toBeNull();
    expect(row!.bodyIv).toBeNull();
    expect(row!.bodyAuthTag).toBeNull();
  });

  it('PATCH returns 400 on an unknown key', async () => {
    const accessToken = await registerAndLogin('chapters-patch-strict');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'Strict' });
    const storyId = story.id as string;
    const created = await createChapterRepo(req).create({
      storyId,
      title: 'Ch',
      orderIndex: 0,
    });

    const res = await request(app)
      .patch(`/api/stories/${storyId}/chapters/${created.id as string}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'ok', wordCount: 9999 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
  });

  it('PATCH returns 400 on unknown key (foo)', async () => {
    const accessToken = await registerAndLogin('chapters-patch-strict-foo');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'Strict' });
    const storyId = story.id as string;
    const created = await createChapterRepo(req).create({
      storyId,
      title: 'Ch',
      orderIndex: 0,
    });

    const res = await request(app)
      .patch(`/api/stories/${storyId}/chapters/${created.id as string}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'ok', foo: 'bar' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
  });

  // ── DELETE /:chapterId ────────────────────────────────────────────────────

  it('DELETE /:chapterId returns 204 and follow-up GET is 403', async () => {
    const accessToken = await registerAndLogin('chapters-delete');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'Doomed Parent' });
    const storyId = story.id as string;
    const created = await createChapterRepo(req).create({
      storyId,
      title: 'Doomed',
      orderIndex: 0,
    });
    const chapterId = created.id as string;

    const del = await request(app)
      .delete(`/api/stories/${storyId}/chapters/${chapterId}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(del.status).toBe(204);
    expect(del.body).toEqual({});

    const get = await request(app)
      .get(`/api/stories/${storyId}/chapters/${chapterId}`)
      .set('Authorization', `Bearer ${accessToken}`);
    // Ownership middleware conflates missing with not-owned → 403.
    expect(get.status).toBe(403);
  });
});
