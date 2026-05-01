// [B5] Integration tests for character CRUD under
// /api/stories/:storyId/characters.

import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import { createCharacterRepo } from '../../src/repos/character.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import type { AccessTokenPayload } from '../../src/services/auth.service';
import { attachDekToRequest } from '../../src/services/content-crypto.service';
import { _resetSessionStore, getSession } from '../../src/services/session-store';
import { prisma } from '../setup';

async function registerAndLogin(
  username: string,
  password = 'characters-pw',
  name = 'Character Route User',
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

describe('Character routes [B5]', () => {
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
    const res = await request(app).get(`/api/stories/${FAKE_ID}/characters`);
    expect(res.status).toBe(401);
  });

  it('POST returns 401 without Bearer', async () => {
    const res = await request(app)
      .post(`/api/stories/${FAKE_ID}/characters`)
      .send({ name: 'Alice' });
    expect(res.status).toBe(401);
  });

  it('GET /:characterId returns 401 without Bearer', async () => {
    const res = await request(app).get(`/api/stories/${FAKE_ID}/characters/${FAKE_ID}`);
    expect(res.status).toBe(401);
  });

  it('PATCH /:characterId returns 401 without Bearer', async () => {
    const res = await request(app)
      .patch(`/api/stories/${FAKE_ID}/characters/${FAKE_ID}`)
      .send({ name: 'No' });
    expect(res.status).toBe(401);
  });

  it('DELETE /:characterId returns 401 without Bearer', async () => {
    const res = await request(app).delete(`/api/stories/${FAKE_ID}/characters/${FAKE_ID}`);
    expect(res.status).toBe(401);
  });

  // ── POST ownership / Zod ──────────────────────────────────────────────────

  it('POST returns 403 when :storyId does not belong to the caller', async () => {
    const tokenA = await registerAndLogin('characters-owner-a');
    const tokenB = await registerAndLogin('characters-owner-b');
    const reqA = makeFakeReq(tokenA);
    const story = await createStoryRepo(reqA).create({ title: 'A only' });

    const res = await request(app)
      .post(`/api/stories/${story.id as string}/characters`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ name: 'hijack' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('POST returns 400 on empty name', async () => {
    const accessToken = await registerAndLogin('characters-empty-name');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'My Story' });

    const res = await request(app)
      .post(`/api/stories/${story.id as string}/characters`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('POST returns 400 on missing name', async () => {
    const accessToken = await registerAndLogin('characters-missing-name');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'My Story' });

    const res = await request(app)
      .post(`/api/stories/${story.id as string}/characters`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ role: 'protagonist' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('POST returns 400 when an unknown key is passed', async () => {
    const accessToken = await registerAndLogin('characters-strict-post');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'Strict' });

    const res = await request(app)
      .post(`/api/stories/${story.id as string}/characters`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Bob', extraField: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  // ── POST happy path ───────────────────────────────────────────────────────

  it('POST 201 returns decrypted fields with no ciphertext keys', async () => {
    const accessToken = await registerAndLogin('characters-create');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'Characters Home' });
    const storyId = story.id as string;

    const res = await request(app)
      .post(`/api/stories/${storyId}/characters`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Alice Wonder',
        role: 'protagonist',
        age: '28',
        color: '#abcdef',
        initial: 'AW',
        appearance: 'Tall',
        voice: 'Calm',
        arc: 'Growth',
        physicalDescription: 'Brown hair',
        personality: 'Curious',
        backstory: 'Born in a small town',
        notes: 'Likes tea',
      });
    expect(res.status).toBe(201);
    expect(res.body.character.name).toBe('Alice Wonder');
    expect(res.body.character.role).toBe('protagonist');
    expect(res.body.character.age).toBe('28');
    expect(res.body.character.color).toBe('#abcdef');
    expect(res.body.character.initial).toBe('AW');
    expect(res.body.character.appearance).toBe('Tall');
    expect(res.body.character.voice).toBe('Calm');
    expect(res.body.character.arc).toBe('Growth');
    expect(res.body.character.physicalDescription).toBe('Brown hair');
    expect(res.body.character.personality).toBe('Curious');
    expect(res.body.character.backstory).toBe('Born in a small town');
    expect(res.body.character.notes).toBe('Likes tea');
    expect(res.body.character.storyId).toBe(storyId);
    assertNoCiphertextKeys(res.body.character);
  });

  // ── GET /:characterId ─────────────────────────────────────────────────────

  it('GET /:characterId returns 200 with decrypted fields', async () => {
    const accessToken = await registerAndLogin('characters-get-one');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'Readable' });
    const storyId = story.id as string;

    const created = await createCharacterRepo(req).create({
      storyId,
      orderIndex: 0,
      name: 'Readable Char',
      role: 'mentor',
      notes: 'guides hero',
    });

    const res = await request(app)
      .get(`/api/stories/${storyId}/characters/${created.id as string}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.character.name).toBe('Readable Char');
    expect(res.body.character.role).toBe('mentor');
    expect(res.body.character.notes).toBe('guides hero');
    expect(res.body.character.storyId).toBe(storyId);
    assertNoCiphertextKeys(res.body.character);
  });

  it('GET /:characterId returns 404 when characterId is under a different story', async () => {
    const accessToken = await registerAndLogin('characters-path-integrity');
    const req = makeFakeReq(accessToken);
    const storyA = await createStoryRepo(req).create({ title: 'A' });
    const storyB = await createStoryRepo(req).create({ title: 'B' });

    const charA = await createCharacterRepo(req).create({
      storyId: storyA.id as string,
      orderIndex: 0,
      name: 'Char in A',
    });

    const res = await request(app)
      .get(`/api/stories/${storyB.id as string}/characters/${charA.id as string}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('GET /:characterId returns 403 when character belongs to another user', async () => {
    const tokenA = await registerAndLogin('characters-xuser-a');
    const tokenB = await registerAndLogin('characters-xuser-b');

    const reqA = makeFakeReq(tokenA);
    const story = await createStoryRepo(reqA).create({ title: 'A only' });
    const char = await createCharacterRepo(reqA).create({
      storyId: story.id as string,
      orderIndex: 0,
      name: 'A char',
    });

    const res = await request(app)
      .get(`/api/stories/${story.id as string}/characters/${char.id as string}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(403);
  });

  // ── GET list ──────────────────────────────────────────────────────────────

  it('GET list returns 200 ordered by createdAt asc with no ciphertext', async () => {
    const accessToken = await registerAndLogin('characters-list');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'Ordered' });
    const storyId = story.id as string;

    const first = await createCharacterRepo(req).create({ storyId, orderIndex: 0, name: 'First' });
    // Ensure strictly increasing createdAt timestamps.
    await new Promise((r) => setTimeout(r, 5));
    const second = await createCharacterRepo(req).create({
      storyId,
      orderIndex: 1,
      name: 'Second',
    });
    await new Promise((r) => setTimeout(r, 5));
    const third = await createCharacterRepo(req).create({ storyId, orderIndex: 2, name: 'Third' });

    const res = await request(app)
      .get(`/api/stories/${storyId}/characters`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.characters)).toBe(true);
    expect(res.body.characters).toHaveLength(3);
    expect(res.body.characters.map((c: { id: string }) => c.id)).toEqual([
      first.id,
      second.id,
      third.id,
    ]);
    expect(res.body.characters.map((c: { name: string }) => c.name)).toEqual([
      'First',
      'Second',
      'Third',
    ]);
    for (const c of res.body.characters) {
      assertNoCiphertextKeys(c);
    }
  });

  it("GET list returns 403 when storyId is not the caller's", async () => {
    const tokenA = await registerAndLogin('characters-list-a');
    const tokenB = await registerAndLogin('characters-list-b');
    const reqA = makeFakeReq(tokenA);
    const story = await createStoryRepo(reqA).create({ title: 'A' });

    const res = await request(app)
      .get(`/api/stories/${story.id as string}/characters`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(403);
  });

  // ── PATCH /:characterId ───────────────────────────────────────────────────

  it('PATCH 200 updating one field does not touch others; clearing null works', async () => {
    const accessToken = await registerAndLogin('characters-patch');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'Patchable' });
    const storyId = story.id as string;

    const created = await createCharacterRepo(req).create({
      storyId,
      orderIndex: 0,
      name: 'Original',
      role: 'sidekick',
      notes: 'keep me',
      color: '#112233',
    });
    const id = created.id as string;

    // Update only notes; everything else should be unchanged.
    const r1 = await request(app)
      .patch(`/api/stories/${storyId}/characters/${id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ notes: 'updated notes' });
    expect(r1.status).toBe(200);
    expect(r1.body.character.notes).toBe('updated notes');
    expect(r1.body.character.name).toBe('Original');
    expect(r1.body.character.role).toBe('sidekick');
    expect(r1.body.character.color).toBe('#112233');
    assertNoCiphertextKeys(r1.body.character);

    // Clear role to null.
    const r2 = await request(app)
      .patch(`/api/stories/${storyId}/characters/${id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ role: null });
    expect(r2.status).toBe(200);
    expect(r2.body.character.role).toBeNull();
    expect(r2.body.character.name).toBe('Original');
    expect(r2.body.character.notes).toBe('updated notes');
  });

  it('PATCH returns 400 on an unknown key', async () => {
    const accessToken = await registerAndLogin('characters-patch-strict');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'Strict' });
    const storyId = story.id as string;
    const created = await createCharacterRepo(req).create({
      storyId,
      orderIndex: 0,
      name: 'Char',
    });

    const res = await request(app)
      .patch(`/api/stories/${storyId}/characters/${created.id as string}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'ok', mystery: 'field' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('PATCH returns 400 on overlong name (>200)', async () => {
    const accessToken = await registerAndLogin('characters-patch-overlong');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'Strict' });
    const storyId = story.id as string;
    const created = await createCharacterRepo(req).create({
      storyId,
      orderIndex: 0,
      name: 'Char',
    });

    const tooLong = 'x'.repeat(201);
    const res = await request(app)
      .patch(`/api/stories/${storyId}/characters/${created.id as string}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: tooLong });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  // ── DELETE /:characterId ──────────────────────────────────────────────────

  it('DELETE /:characterId returns 204 and follow-up GET is 403', async () => {
    const accessToken = await registerAndLogin('characters-delete');
    const req = makeFakeReq(accessToken);
    const story = await createStoryRepo(req).create({ title: 'Home' });
    const storyId = story.id as string;
    const created = await createCharacterRepo(req).create({
      storyId,
      orderIndex: 0,
      name: 'Doomed',
    });
    const id = created.id as string;

    const del = await request(app)
      .delete(`/api/stories/${storyId}/characters/${id}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(del.status).toBe(204);
    expect(del.body).toEqual({});

    const get = await request(app)
      .get(`/api/stories/${storyId}/characters/${id}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(get.status).toBe(403);
  });
});
