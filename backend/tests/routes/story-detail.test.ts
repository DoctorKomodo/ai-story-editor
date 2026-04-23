// [B2] Integration tests for GET | PATCH | DELETE /api/stories/:id.
//
// Covers:
//   - GET /:id auth (401), ownership (403 for missing/other-user), 200 decrypted
//   - PATCH /:id auth (401), ownership (403), strict schema (400), partial +
//     nullable-clear behaviour on 200
//   - DELETE /:id auth (401), ownership (403), 204 on success + cascade to
//     chapters via the schema's onDelete: Cascade.

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
  password = 'story-detail-pw',
  name = 'Story Detail User',
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Story detail routes [B2]', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetAll();
  });

  afterEach(async () => {
    _resetSessionStore();
    await resetAll();
  });

  // ── GET /api/stories/:id ─────────────────────────────────────────────────

  it('GET /:id returns 401 without Bearer', async () => {
    const res = await request(app).get(`/api/stories/${FAKE_ID}`);
    expect(res.status).toBe(401);
  });

  it('GET /:id returns 403 when the story does not exist', async () => {
    const accessToken = await registerAndLogin('story-detail-get-missing');
    const res = await request(app)
      .get(`/api/stories/${FAKE_ID}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('GET /:id returns 403 when the story belongs to another user', async () => {
    const tokenA = await registerAndLogin('story-detail-owner-a');
    const tokenB = await registerAndLogin('story-detail-owner-b');

    const reqA = makeFakeReq(tokenA);
    const created = await createStoryRepo(reqA).create({ title: 'A-only' });

    const res = await request(app)
      .get(`/api/stories/${created.id as string}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('GET /:id returns 200 with decrypted story and no ciphertext fields', async () => {
    const accessToken = await registerAndLogin('story-detail-get-owner');
    const req = makeFakeReq(accessToken);
    const created = await createStoryRepo(req).create({
      title: 'Gettable Story',
      synopsis: 'A synopsis.',
      genre: 'sci-fi',
      worldNotes: 'Notes on the world.',
      targetWords: 80000,
      systemPrompt: null,
    });

    const res = await request(app)
      .get(`/api/stories/${created.id as string}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.story).toBeDefined();
    const story = res.body.story;
    expect(story.id).toBe(created.id);
    expect(story.title).toBe('Gettable Story');
    expect(story.synopsis).toBe('A synopsis.');
    expect(story.genre).toBe('sci-fi');
    expect(story.worldNotes).toBe('Notes on the world.');
    expect(story.targetWords).toBe(80000);
    expect(story.systemPrompt).toBeNull();

    for (const key of Object.keys(story)) {
      expect(key.endsWith('Ciphertext')).toBe(false);
      expect(key.endsWith('Iv')).toBe(false);
      expect(key.endsWith('AuthTag')).toBe(false);
    }
  });

  // ── PATCH /api/stories/:id ────────────────────────────────────────────────

  it('PATCH /:id returns 401 without Bearer', async () => {
    const res = await request(app)
      .patch(`/api/stories/${FAKE_ID}`)
      .send({ title: 'nope' });
    expect(res.status).toBe(401);
  });

  it('PATCH /:id returns 403 for a non-owner', async () => {
    const tokenA = await registerAndLogin('story-detail-patch-a');
    const tokenB = await registerAndLogin('story-detail-patch-b');

    const reqA = makeFakeReq(tokenA);
    const created = await createStoryRepo(reqA).create({ title: 'A-only' });

    const res = await request(app)
      .patch(`/api/stories/${created.id as string}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ title: 'hijack' });
    expect(res.status).toBe(403);
  });

  it('PATCH /:id returns 400 when an unknown key is present (strict schema)', async () => {
    const accessToken = await registerAndLogin('story-detail-patch-strict');
    const req = makeFakeReq(accessToken);
    const created = await createStoryRepo(req).create({ title: 'strict' });

    const res = await request(app)
      .patch(`/api/stories/${created.id as string}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'strict update', nope: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
  });

  it('PATCH /:id updates only the provided fields', async () => {
    const accessToken = await registerAndLogin('story-detail-patch-partial');
    const req = makeFakeReq(accessToken);
    const created = await createStoryRepo(req).create({
      title: 'Original',
      synopsis: 'Keep me',
      genre: 'drama',
      worldNotes: 'Unchanged notes',
      targetWords: 10000,
    });

    const patchRes = await request(app)
      .patch(`/api/stories/${created.id as string}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Updated Title' });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.story.title).toBe('Updated Title');
    expect(patchRes.body.story.synopsis).toBe('Keep me');
    expect(patchRes.body.story.genre).toBe('drama');
    expect(patchRes.body.story.worldNotes).toBe('Unchanged notes');
    expect(patchRes.body.story.targetWords).toBe(10000);

    // Confirm by a follow-up GET.
    const getRes = await request(app)
      .get(`/api/stories/${created.id as string}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.story.title).toBe('Updated Title');
    expect(getRes.body.story.synopsis).toBe('Keep me');
    expect(getRes.body.story.genre).toBe('drama');
    expect(getRes.body.story.worldNotes).toBe('Unchanged notes');
    expect(getRes.body.story.targetWords).toBe(10000);

    for (const key of Object.keys(patchRes.body.story)) {
      expect(key.endsWith('Ciphertext')).toBe(false);
      expect(key.endsWith('Iv')).toBe(false);
      expect(key.endsWith('AuthTag')).toBe(false);
    }
  });

  it('PATCH /:id clears a nullable field when null is passed', async () => {
    const accessToken = await registerAndLogin('story-detail-patch-null');
    const req = makeFakeReq(accessToken);
    const created = await createStoryRepo(req).create({
      title: 'Has Synopsis',
      synopsis: 'will be cleared',
      genre: 'mystery',
      targetWords: 20000,
    });

    const patchRes = await request(app)
      .patch(`/api/stories/${created.id as string}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ synopsis: null, genre: null, targetWords: null });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.story.synopsis).toBeNull();
    expect(patchRes.body.story.genre).toBeNull();
    expect(patchRes.body.story.targetWords).toBeNull();
    // Title should remain untouched.
    expect(patchRes.body.story.title).toBe('Has Synopsis');

    for (const key of Object.keys(patchRes.body.story)) {
      expect(key.endsWith('Ciphertext')).toBe(false);
      expect(key.endsWith('Iv')).toBe(false);
      expect(key.endsWith('AuthTag')).toBe(false);
    }
  });

  // ── DELETE /api/stories/:id ──────────────────────────────────────────────

  it('DELETE /:id returns 401 without Bearer', async () => {
    const res = await request(app).delete(`/api/stories/${FAKE_ID}`);
    expect(res.status).toBe(401);
  });

  it('DELETE /:id returns 403 for a non-owner', async () => {
    const tokenA = await registerAndLogin('story-detail-delete-a');
    const tokenB = await registerAndLogin('story-detail-delete-b');

    const reqA = makeFakeReq(tokenA);
    const created = await createStoryRepo(reqA).create({ title: 'A-only' });

    const res = await request(app)
      .delete(`/api/stories/${created.id as string}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(403);
  });

  it('DELETE /:id returns 204 and subsequent GET is 403', async () => {
    const accessToken = await registerAndLogin('story-detail-delete-owner');
    const req = makeFakeReq(accessToken);
    const created = await createStoryRepo(req).create({ title: 'Doomed' });

    const delRes = await request(app)
      .delete(`/api/stories/${created.id as string}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(delRes.status).toBe(204);
    expect(delRes.body).toEqual({});

    const getRes = await request(app)
      .get(`/api/stories/${created.id as string}`)
      .set('Authorization', `Bearer ${accessToken}`);
    // The row is gone; ownership middleware conflates missing with not-owned
    // and returns 403.
    expect(getRes.status).toBe(403);
  });

  it('DELETE /:id cascades chapters via schema onDelete: Cascade', async () => {
    const accessToken = await registerAndLogin('story-detail-delete-cascade');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'Parent' });
    const storyId = story.id as string;

    const chapter = await createChapterRepo(req).create({
      storyId,
      title: 'Child Chapter',
      orderIndex: 0,
      wordCount: 42,
    });
    const chapterId = chapter.id as string;

    const delRes = await request(app)
      .delete(`/api/stories/${storyId}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(delRes.status).toBe(204);

    // Direct Prisma lookup is legitimate here — we're verifying schema
    // cascade behaviour, not exercising the read path.
    const stillThere = await prisma.chapter.findUnique({ where: { id: chapterId } });
    expect(stillThere).toBeNull();
  });
});
