// [B1] Integration tests for GET /api/stories and POST /api/stories.
//
// Covers:
//   - GET /api/stories 401 without Bearer
//   - POST /api/stories 401 without Bearer
//   - POST /api/stories 400 on Zod failure (missing title)
//   - POST /api/stories 201 returns decrypted narrative, no ciphertext fields
//   - GET /api/stories returns only caller's stories (owner scoping)
//   - GET /api/stories aggregates chapterCount + totalWordCount correctly
//   - GET /api/stories orders by updatedAt desc

import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import type { AccessTokenPayload } from '../../src/services/auth.service';
import { attachDekToRequest } from '../../src/services/content-crypto.service';
import { _resetSessionStore, getSession } from '../../src/services/session-store';
import { prisma } from '../setup';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function registerAndLogin(
  username: string,
  password = 'story-route-pw',
  name = 'Story Route User',
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Stories routes [B1]', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetAll();
  });

  afterEach(async () => {
    _resetSessionStore();
    await resetAll();
  });

  // ── Auth gates ────────────────────────────────────────────────────────────

  it('GET /api/stories returns 401 without Bearer', async () => {
    const res = await request(app).get('/api/stories');
    expect(res.status).toBe(401);
  });

  it('POST /api/stories returns 401 without Bearer', async () => {
    const res = await request(app).post('/api/stories').send({ title: 'Nope' });
    expect(res.status).toBe(401);
  });

  // ── POST validation ──────────────────────────────────────────────────────

  it('POST /api/stories returns 400 when title is missing', async () => {
    const accessToken = await registerAndLogin('stories-zod-user');
    const res = await request(app)
      .post('/api/stories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ synopsis: 'a tale with no title' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(res.body.error.issues).toBeDefined();
  });

  it('POST /api/stories returns 400 when title is empty', async () => {
    const accessToken = await registerAndLogin('stories-empty-title-user');
    const res = await request(app)
      .post('/api/stories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  // ── POST happy path ──────────────────────────────────────────────────────

  it('POST /api/stories returns 201 with decrypted fields and no ciphertext', async () => {
    const accessToken = await registerAndLogin('stories-create-user');
    const res = await request(app)
      .post('/api/stories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: 'The First Draft',
        synopsis: 'A writer meets a deadline.',
        genre: 'literary',
        worldNotes: 'Set in a quiet town.',
        targetWords: 50000,
        systemPrompt: null,
      });

    expect(res.status).toBe(201);
    expect(res.body.story).toBeDefined();
    const story = res.body.story;
    expect(story.title).toBe('The First Draft');
    expect(story.synopsis).toBe('A writer meets a deadline.');
    expect(story.genre).toBe('literary');
    expect(story.worldNotes).toBe('Set in a quiet town.');
    expect(story.targetWords).toBe(50000);
    expect(story.systemPrompt).toBeNull();
    expect(typeof story.id).toBe('string');

    // No ciphertext fields leak through.
    for (const key of Object.keys(story)) {
      expect(key.endsWith('Ciphertext')).toBe(false);
      expect(key.endsWith('Iv')).toBe(false);
      expect(key.endsWith('AuthTag')).toBe(false);
    }
  });

  it('POST /api/stories accepts minimal body (title only)', async () => {
    const accessToken = await registerAndLogin('stories-minimal-user');
    const res = await request(app)
      .post('/api/stories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Just a Title' });

    expect(res.status).toBe(201);
    expect(res.body.story.title).toBe('Just a Title');
    expect(res.body.story.synopsis).toBeNull();
    expect(res.body.story.worldNotes).toBeNull();
    expect(res.body.story.systemPrompt).toBeNull();
    expect(res.body.story.genre).toBeNull();
    expect(res.body.story.targetWords).toBeNull();
  });

  // ── GET: owner scoping ───────────────────────────────────────────────────

  it("GET /api/stories returns only the caller's stories", async () => {
    const tokenA = await registerAndLogin('stories-owner-a');
    const tokenB = await registerAndLogin('stories-owner-b');

    const reqA = makeFakeReq(tokenA);
    const reqB = makeFakeReq(tokenB);

    await createStoryRepo(reqA).create({ title: 'A-Story-1' });
    await createStoryRepo(reqA).create({ title: 'A-Story-2' });
    await createStoryRepo(reqB).create({ title: 'B-Only-Story' });

    const res = await request(app).get('/api/stories').set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.stories)).toBe(true);
    expect(res.body.stories).toHaveLength(2);
    const titles = res.body.stories.map((s: { title: string }) => s.title).sort();
    expect(titles).toEqual(['A-Story-1', 'A-Story-2']);

    // Strictly: B's story must not leak in.
    for (const s of res.body.stories) {
      expect(s.title).not.toBe('B-Only-Story');
    }
  });

  // ── GET: aggregation ─────────────────────────────────────────────────────

  it('GET /api/stories returns chapterCount and totalWordCount aggregated correctly', async () => {
    const accessToken = await registerAndLogin('stories-agg-user');
    const req = makeFakeReq(accessToken);

    const storyWithChapters = await createStoryRepo(req).create({
      title: 'Has Chapters',
    });
    const emptyStory = await createStoryRepo(req).create({
      title: 'No Chapters',
    });

    const storyId = storyWithChapters.id as string;

    await createChapterRepo(req).create({
      storyId,
      title: 'Ch 1',
      orderIndex: 0,
      wordCount: 100,
    });
    await createChapterRepo(req).create({
      storyId,
      title: 'Ch 2',
      orderIndex: 1,
      wordCount: 250,
    });
    await createChapterRepo(req).create({
      storyId,
      title: 'Ch 3',
      orderIndex: 2,
      wordCount: 75,
    });

    const res = await request(app)
      .get('/api/stories')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.stories).toHaveLength(2);

    const full = res.body.stories.find((s: { id: string }) => s.id === storyId);
    expect(full).toBeDefined();
    expect(full.chapterCount).toBe(3);
    expect(full.totalWordCount).toBe(425);

    const empty = res.body.stories.find((s: { id: string }) => s.id === (emptyStory.id as string));
    expect(empty).toBeDefined();
    expect(empty.chapterCount).toBe(0);
    expect(empty.totalWordCount).toBe(0);
  });

  // ── GET: ordering ────────────────────────────────────────────────────────

  it('GET /api/stories orders by updatedAt desc', async () => {
    const accessToken = await registerAndLogin('stories-order-user');
    const req = makeFakeReq(accessToken);

    const s1 = await createStoryRepo(req).create({ title: 'Oldest' });
    await new Promise((r) => setTimeout(r, 5));
    const s2 = await createStoryRepo(req).create({ title: 'Middle' });
    await new Promise((r) => setTimeout(r, 5));
    const s3 = await createStoryRepo(req).create({ title: 'Newest' });

    const res = await request(app)
      .get('/api/stories')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.stories).toHaveLength(3);
    expect(res.body.stories[0].id).toBe(s3.id);
    expect(res.body.stories[1].id).toBe(s2.id);
    expect(res.body.stories[2].id).toBe(s1.id);
  });
});
