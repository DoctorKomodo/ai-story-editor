// [B9] Integration tests for GET /api/stories/:id/progress.
//
// Covers:
//   - 401 without Bearer
//   - 403 when the story belongs to another user (ownership collapses unknown +
//     unowned to 403, no id-enumeration oracle)
//   - 200 with targetWords null → percent 0
//   - 200 with zero chapters → wordCount 0, chapters [], percent 0
//   - 200 with 3 chapters wordCounts [100, 200, 50] + targetWords 1000 →
//     wordCount 350, percent 35, chapters returned in orderIndex asc order
//   - 200 over-target (wordCount > targetWords) → percent > 100, not clamped

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
  password = 'story-progress-pw',
  name = 'Story Progress User',
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

describe('Story progress route [B9]', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetAll();
  });

  afterEach(async () => {
    _resetSessionStore();
    await resetAll();
  });

  it('returns 401 without Bearer', async () => {
    const res = await request(app).get(`/api/stories/${FAKE_ID}/progress`);
    expect(res.status).toBe(401);
  });

  it('returns 403 when the story belongs to another user', async () => {
    const tokenA = await registerAndLogin('story-progress-owner-a');
    const tokenB = await registerAndLogin('story-progress-owner-b');

    const reqA = makeFakeReq(tokenA);
    const created = await createStoryRepo(reqA).create({ title: 'A-only' });

    const res = await request(app)
      .get(`/api/stories/${created.id as string}/progress`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('returns 200 with targetWords null → percent 0', async () => {
    const accessToken = await registerAndLogin('story-progress-null-target');
    const req = makeFakeReq(accessToken);
    const created = await createStoryRepo(req).create({
      title: 'No target yet',
      targetWords: null,
    });

    const res = await request(app)
      .get(`/api/stories/${created.id as string}/progress`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      wordCount: 0,
      targetWords: null,
      percent: 0,
      chapters: [],
    });
  });

  it('returns 200 with zero chapters → wordCount 0, chapters [], percent 0', async () => {
    const accessToken = await registerAndLogin('story-progress-no-chapters');
    const req = makeFakeReq(accessToken);
    const created = await createStoryRepo(req).create({
      title: 'Chapters none',
      targetWords: 50000,
    });

    const res = await request(app)
      .get(`/api/stories/${created.id as string}/progress`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.wordCount).toBe(0);
    expect(res.body.targetWords).toBe(50000);
    expect(res.body.percent).toBe(0);
    expect(res.body.chapters).toEqual([]);
  });

  it('returns 200 with wordCount sum, percent floor, chapters in orderIndex asc', async () => {
    const accessToken = await registerAndLogin('story-progress-sum');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({
      title: 'Progressing story',
      targetWords: 1000,
    });
    const storyId = story.id as string;

    // Create chapters out of order so the test confirms the sort at response
    // time, not just the insertion order.
    const chapterRepo = createChapterRepo(req);
    const c1 = await chapterRepo.create({
      storyId,
      title: 'Middle',
      orderIndex: 1,
      wordCount: 200,
    });
    const c0 = await chapterRepo.create({
      storyId,
      title: 'First',
      orderIndex: 0,
      wordCount: 100,
    });
    const c2 = await chapterRepo.create({
      storyId,
      title: 'Last',
      orderIndex: 2,
      wordCount: 50,
    });

    const res = await request(app)
      .get(`/api/stories/${storyId}/progress`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.wordCount).toBe(350);
    expect(res.body.targetWords).toBe(1000);
    expect(res.body.percent).toBe(35);
    expect(res.body.chapters).toEqual([
      { id: c0.id, wordCount: 100 },
      { id: c1.id, wordCount: 200 },
      { id: c2.id, wordCount: 50 },
    ]);
  });

  it('returns percent > 100 when over-target (not clamped)', async () => {
    const accessToken = await registerAndLogin('story-progress-over');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({
      title: 'Overachiever',
      targetWords: 1000,
    });
    const storyId = story.id as string;

    await createChapterRepo(req).create({
      storyId,
      title: 'Huge chapter',
      orderIndex: 0,
      wordCount: 1200,
    });

    const res = await request(app)
      .get(`/api/stories/${storyId}/progress`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.wordCount).toBe(1200);
    expect(res.body.targetWords).toBe(1000);
    expect(res.body.percent).toBe(120);
  });
});
