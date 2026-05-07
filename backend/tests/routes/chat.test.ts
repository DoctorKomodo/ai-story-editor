// [SC4] Integration tests for POST /api/chapters/:chapterId/chats (kind field)
// and GET /api/chapters/:chapterId/chats (kind filter).

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
  password = 'chat-route-pw',
  name = 'Chat Route User',
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

// Returns a supertest agent (with auth header set) and a chapterId for use in tests.
async function setup(
  username: string,
): Promise<{ agent: ReturnType<typeof request.agent>; chapterId: string }> {
  const accessToken = await registerAndLogin(username);
  const req = makeFakeReq(accessToken);

  const story = await createStoryRepo(req).create({ title: 'T', worldNotes: null });
  const storyId = story.id as string;
  const chapter = await createChapterRepo(req).create({
    storyId,
    title: 'Ch',
    bodyJson: null,
    orderIndex: 0,
    wordCount: 0,
  });
  const chapterId = chapter.id as string;

  const agent = request.agent(app);
  agent.set('Authorization', `Bearer ${accessToken}`);

  return { agent, chapterId };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('POST /api/chapters/:chapterId/chats — kind', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetAll();
  });

  afterEach(async () => {
    _resetSessionStore();
    await resetAll();
  });

  it('creates a scene-kind chat when kind="scene" is provided', async () => {
    const { agent, chapterId } = await setup('chat-kind-scene-u1');
    const res = await agent
      .post(`/api/chapters/${chapterId}/chats`)
      .send({ title: 's1', kind: 'scene' })
      .expect(201);
    expect(res.body.chat.kind).toBe('scene');
  });

  it('defaults to kind="ask" when omitted', async () => {
    const { agent, chapterId } = await setup('chat-kind-ask-u2');
    const res = await agent
      .post(`/api/chapters/${chapterId}/chats`)
      .send({ title: 'a1' })
      .expect(201);
    expect(res.body.chat.kind).toBe('ask');
  });

  it('rejects unknown kind values', async () => {
    const { agent, chapterId } = await setup('chat-kind-bogus-u3');
    await agent
      .post(`/api/chapters/${chapterId}/chats`)
      .send({ title: 'x', kind: 'bogus' })
      .expect(400);
  });
});

describe('GET /api/chapters/:chapterId/chats — kind filter', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetAll();
  });

  afterEach(async () => {
    _resetSessionStore();
    await resetAll();
  });

  it('returns only kind=scene rows when ?kind=scene', async () => {
    const { agent, chapterId } = await setup('chat-filter-scene-u4');
    await agent.post(`/api/chapters/${chapterId}/chats`).send({ title: 'a', kind: 'ask' });
    await agent.post(`/api/chapters/${chapterId}/chats`).send({ title: 's', kind: 'scene' });

    const res = await agent
      .get(`/api/chapters/${chapterId}/chats`)
      .query({ kind: 'scene' })
      .expect(200);
    expect(res.body.chats).toHaveLength(1);
    expect(res.body.chats[0].kind).toBe('scene');
  });

  it('returns both kinds when ?kind is omitted', async () => {
    const { agent, chapterId } = await setup('chat-filter-all-u5');
    await agent.post(`/api/chapters/${chapterId}/chats`).send({ title: 'a', kind: 'ask' });
    await agent.post(`/api/chapters/${chapterId}/chats`).send({ title: 's', kind: 'scene' });

    const res = await agent.get(`/api/chapters/${chapterId}/chats`).expect(200);
    expect(res.body.chats).toHaveLength(2);
  });
});
