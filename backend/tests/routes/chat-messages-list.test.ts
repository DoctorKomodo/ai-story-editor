// [V21] Integration tests for GET /api/chats/:chatId/messages.
//
// Covers:
//   - 401 without Bearer
//   - 404 for nonexistent chat
//   - 404 for unowned chat (scoped via chapter→story→user)
//   - 200 empty { messages: [] } for an owned chat with no messages
//   - 200 returns decrypted contentJson / attachmentJson, ordered by createdAt asc
//   - projected fields match the contract (id, role, contentJson, attachmentJson,
//     model, tokens, latencyMs, createdAt) with no ciphertext / *Iv / *AuthTag leak

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import { getSession, _resetSessionStore } from '../../src/services/session-store';
import { attachDekToRequest } from '../../src/services/content-crypto.service';
import { createStoryRepo } from '../../src/repos/story.repo';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createChatRepo } from '../../src/repos/chat.repo';
import { createMessageRepo } from '../../src/repos/message.repo';
import type { AccessTokenPayload } from '../../src/services/auth.service';
import type { Request } from 'express';
import { prisma } from '../setup';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function registerAndLogin(
  username: string,
  password = 'chat-msgs-pw',
  name = 'Chat Msgs User',
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

async function setupStoryChapterChat(
  req: Request,
): Promise<{ storyId: string; chapterId: string; chatId: string }> {
  const story = await createStoryRepo(req).create({
    title: 'S',
    worldNotes: null,
    systemPrompt: null,
  });
  const storyId = story.id as string;
  const chapter = await createChapterRepo(req).create({
    storyId,
    title: 'Ch',
    bodyJson: null,
    orderIndex: 0,
    wordCount: 0,
  });
  const chapterId = chapter.id as string;
  const chat = await createChatRepo(req).create({ chapterId, title: null });
  return { storyId, chapterId, chatId: chat.id as string };
}

describe('[V21] GET /api/chats/:chatId/messages', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetAll();
  });
  afterEach(async () => {
    _resetSessionStore();
    await resetAll();
  });

  it('returns 401 without Bearer', async () => {
    const res = await request(app).get('/api/chats/anything/messages');
    expect(res.status).toBe(401);
  });

  it('returns 404 for a nonexistent chat', async () => {
    const accessToken = await registerAndLogin('chat-msg-u1');
    const res = await request(app)
      .get('/api/chats/does-not-exist/messages')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it("returns 404 for another user's chat", async () => {
    const ownerToken = await registerAndLogin('chat-msg-owner');
    const ownerReq = makeFakeReq(ownerToken);
    const { chatId } = await setupStoryChapterChat(ownerReq);

    const intruderToken = await registerAndLogin('chat-msg-intruder');
    const res = await request(app)
      .get(`/api/chats/${chatId}/messages`)
      .set('Authorization', `Bearer ${intruderToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('returns 200 with empty messages array for a new chat', async () => {
    const accessToken = await registerAndLogin('chat-msg-u2');
    const req = makeFakeReq(accessToken);
    const { chatId } = await setupStoryChapterChat(req);

    const res = await request(app)
      .get(`/api/chats/${chatId}/messages`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ messages: [] });
  });

  it('returns decrypted messages ordered by createdAt asc with contract-shaped fields', async () => {
    const accessToken = await registerAndLogin('chat-msg-u3');
    const req = makeFakeReq(accessToken);
    const { chatId } = await setupStoryChapterChat(req);
    const messageRepo = createMessageRepo(req);

    await messageRepo.create({
      chatId,
      role: 'user',
      contentJson: 'first user turn',
      attachmentJson: { selectionText: 'hello', chapterId: 'irrelevant-for-projection' },
      model: null,
      tokens: null,
      latencyMs: null,
    });
    // Small delay guarantees a distinct createdAt for ordering assertion.
    await new Promise((r) => setTimeout(r, 5));
    await messageRepo.create({
      chatId,
      role: 'assistant',
      contentJson: 'first assistant reply',
      model: 'llama-test',
      tokens: 42,
      latencyMs: 1234,
    });

    const res = await request(app)
      .get(`/api/chats/${chatId}/messages`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    const messages = res.body.messages as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[0].contentJson).toBe('first user turn');
    expect(messages[0].attachmentJson).toEqual({
      selectionText: 'hello',
      chapterId: 'irrelevant-for-projection',
    });
    expect(messages[0].model).toBeNull();
    expect(messages[0].tokens).toBeNull();
    expect(messages[0].latencyMs).toBeNull();
    expect(typeof messages[0].id).toBe('string');
    expect(typeof messages[0].createdAt).toBe('string');

    expect(messages[1].role).toBe('assistant');
    expect(messages[1].contentJson).toBe('first assistant reply');
    expect(messages[1].attachmentJson).toBeNull();
    expect(messages[1].model).toBe('llama-test');
    expect(messages[1].tokens).toBe(42);
    expect(messages[1].latencyMs).toBe(1234);

    // No ciphertext leak: projected response must not carry *Ciphertext / *Iv / *AuthTag.
    for (const m of messages) {
      for (const k of Object.keys(m)) {
        expect(k.endsWith('Ciphertext')).toBe(false);
        expect(k.endsWith('Iv')).toBe(false);
        expect(k.endsWith('AuthTag')).toBe(false);
      }
    }
  });
});
