// [B1] Integration tests for GET /api/stories and POST /api/stories.
//
// Covers:
//   - GET /api/stories 401 without session
//   - POST /api/stories 401 without session
//   - POST /api/stories 400 on Zod failure (missing title)
//   - POST /api/stories 201 returns decrypted narrative, no ciphertext fields
//   - GET /api/stories returns only caller's stories (owner scoping)
//   - GET /api/stories aggregates chapterCount + totalWordCount correctly
//   - GET /api/stories orders by updatedAt desc

import type { Request } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createDraftRepo } from '../../src/repos/draft.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { attachDekToRequest } from '../../src/services/content-crypto.service';
import { _resetSessionStore, getSession } from '../../src/services/session-store';
import { registerAndLogin } from '../helpers/auth';
import { resetDb } from '../helpers/db';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEST_ORIGIN = 'http://localhost:3000';

function makeFakeReq(sessionId: string): Request {
  const session = getSession(sessionId);
  expect(session).not.toBeNull();
  const req = { user: { id: session!.userId, sessionId } } as unknown as Request;
  attachDekToRequest(req, session!.dek);
  return req;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Stories routes [B1]', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetDb();
  });

  afterEach(async () => {
    _resetSessionStore();
    await resetDb();
  });

  // ── Auth gates ────────────────────────────────────────────────────────────

  it('GET /api/stories returns 401 without session', async () => {
    const res = await request(app).get('/api/stories');
    expect(res.status).toBe(401);
  });

  it('POST /api/stories returns 401 without session', async () => {
    const res = await request(app)
      .post('/api/stories')
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'Nope' });
    expect(res.status).toBe(401);
  });

  // ── POST validation ──────────────────────────────────────────────────────

  it('POST /api/stories returns 400 when title is missing', async () => {
    const { agent } = await registerAndLogin({ username: 'stories-zod-user' });
    const res = await agent
      .post('/api/stories')
      .set('Origin', TEST_ORIGIN)
      .send({ synopsis: 'a tale with no title' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(res.body.error.issues).toBeDefined();
  });

  it('POST /api/stories returns 400 when title is empty', async () => {
    const { agent } = await registerAndLogin({ username: 'stories-empty-title-user' });
    const res = await agent.post('/api/stories').set('Origin', TEST_ORIGIN).send({ title: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  // ── POST happy path ──────────────────────────────────────────────────────

  it('POST /api/stories returns 201 with decrypted fields and no ciphertext', async () => {
    const { agent } = await registerAndLogin({ username: 'stories-create-user' });
    const res = await agent.post('/api/stories').set('Origin', TEST_ORIGIN).send({
      title: 'The First Draft',
      synopsis: 'A writer meets a deadline.',
      genre: 'literary',
      worldNotes: 'Set in a quiet town.',
      targetWords: 50000,
    });

    expect(res.status).toBe(201);
    expect(res.body.story).toBeDefined();
    const story = res.body.story;
    expect(story.title).toBe('The First Draft');
    expect(story.synopsis).toBe('A writer meets a deadline.');
    expect(story.genre).toBe('literary');
    expect(story.worldNotes).toBe('Set in a quiet town.');
    expect(story.targetWords).toBe(50000);
    expect(typeof story.id).toBe('string');

    // No ciphertext fields leak through.
    for (const key of Object.keys(story)) {
      expect(key.endsWith('Ciphertext')).toBe(false);
      expect(key.endsWith('Iv')).toBe(false);
      expect(key.endsWith('AuthTag')).toBe(false);
    }
    expect(story).not.toHaveProperty('userId');
  });

  it('POST /api/stories accepts minimal body (title only)', async () => {
    const { agent } = await registerAndLogin({ username: 'stories-minimal-user' });
    const res = await agent
      .post('/api/stories')
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'Just a Title' });

    expect(res.status).toBe(201);
    expect(res.body.story.title).toBe('Just a Title');
    expect(res.body.story.synopsis).toBeNull();
    expect(res.body.story.worldNotes).toBeNull();
    expect(res.body.story.genre).toBeNull();
    expect(res.body.story.targetWords).toBeNull();
  });

  // ── GET: owner scoping ───────────────────────────────────────────────────

  it("GET /api/stories returns only the caller's stories", async () => {
    const { agent: agentA, sessionId: sessionIdA } = await registerAndLogin({
      username: 'stories-owner-a',
    });
    const { sessionId: sessionIdB } = await registerAndLogin({ username: 'stories-owner-b' });

    const reqA = makeFakeReq(sessionIdA);
    const reqB = makeFakeReq(sessionIdB);

    await createStoryRepo(reqA).create({ title: 'A-Story-1' });
    await createStoryRepo(reqA).create({ title: 'A-Story-2' });
    await createStoryRepo(reqB).create({ title: 'B-Only-Story' });

    const res = await agentA.get('/api/stories');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.stories)).toBe(true);
    expect(res.body.stories).toHaveLength(2);
    const titles = res.body.stories.map((s: { title: string }) => s.title).sort();
    expect(titles).toEqual(['A-Story-1', 'A-Story-2']);

    // Strictly: B's story must not leak in.
    for (const s of res.body.stories) {
      expect(s.title).not.toBe('B-Only-Story');
      expect(s).not.toHaveProperty('userId');
    }
  });

  // ── GET: aggregation ─────────────────────────────────────────────────────

  it('GET /api/stories returns chapterCount and totalWordCount aggregated correctly', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'stories-agg-user' });
    const req = makeFakeReq(sessionId);

    const storyWithChapters = await createStoryRepo(req).create({
      title: 'Has Chapters',
    });
    const emptyStory = await createStoryRepo(req).create({
      title: 'No Chapters',
    });

    const storyId = storyWithChapters.id as string;

    const ch1 = await createChapterRepo(req).create({
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

    // [9wk.5] totals must follow the ACTIVE draft, not the create-time value:
    // give Ch 1 a second draft with a different word count and activate it.
    const alt = await createDraftRepo(req).create({
      chapterId: ch1.id as string,
      // bodyJson deliberately omitted (optional) — only wordCount feeds the
      // aggregate under test; the file has no TipTap-doc helper to borrow.
      wordCount: 999,
      orderIndex: 1, // the mint sits at 0
    });
    await createDraftRepo(req).setActive(ch1.id as string, alt.id);

    const res = await agent.get('/api/stories');

    expect(res.status).toBe(200);
    expect(res.body.stories).toHaveLength(2);

    const full = res.body.stories.find((s: { id: string }) => s.id === storyId);
    expect(full).toBeDefined();
    expect(full.chapterCount).toBe(3);
    expect(full.totalWordCount).toBe(999 + 250 + 75);

    const empty = res.body.stories.find((s: { id: string }) => s.id === (emptyStory.id as string));
    expect(empty).toBeDefined();
    expect(empty.chapterCount).toBe(0);
    expect(empty.totalWordCount).toBe(0);
  });

  // ── PATCH /:id ───────────────────────────────────────────────────────────

  it('PATCH /api/stories/:id accepts includePreviousChaptersInPrompt and persists it', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'stories-pcs-toggle' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'T', worldNotes: null });

    const res = await agent
      .patch(`/api/stories/${story.id as string}`)
      .set('Origin', TEST_ORIGIN)
      .send({ includePreviousChaptersInPrompt: false });
    expect(res.status).toBe(200);
    expect(res.body.story.includePreviousChaptersInPrompt).toBe(false);

    const getRes = await agent.get(`/api/stories/${story.id as string}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.story.includePreviousChaptersInPrompt).toBe(false);
  });

  // ── GET: ordering ────────────────────────────────────────────────────────

  it('GET /api/stories orders by updatedAt desc', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'stories-order-user' });
    const req = makeFakeReq(sessionId);

    const s1 = await createStoryRepo(req).create({ title: 'Oldest' });
    await new Promise((r) => setTimeout(r, 5));
    const s2 = await createStoryRepo(req).create({ title: 'Middle' });
    await new Promise((r) => setTimeout(r, 5));
    const s3 = await createStoryRepo(req).create({ title: 'Newest' });

    const res = await agent.get('/api/stories');

    expect(res.status).toBe(200);
    expect(res.body.stories).toHaveLength(3);
    expect(res.body.stories[0].id).toBe(s3.id);
    expect(res.body.stories[1].id).toBe(s2.id);
    expect(res.body.stories[2].id).toBe(s1.id);
  });
});
