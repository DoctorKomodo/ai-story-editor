// [V21] Integration tests for GET /api/chats/:chatId/messages.
//
// Covers:
//   - 401 when unauthenticated
//   - 404 for nonexistent chat
//   - 404 for unowned chat (scoped via chapter→story→user)
//   - 200 empty { messages: [] } for an owned chat with no messages
//   - 200 returns decrypted content / attachmentJson, ordered by createdAt asc
//   - projected fields match the contract (id, role, content, attachmentJson,
//     model, tokens, latencyMs, createdAt) with no ciphertext / *Iv / *AuthTag leak

import type { Request } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createChatRepo } from '../../src/repos/chat.repo';
import { createMessageRepo } from '../../src/repos/message.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { _resetSessionStore } from '../../src/services/session-store';
import { registerAndLogin } from '../helpers/auth';
import { resetDb } from '../helpers/db';
import { prisma } from '../setup';
import { makeFakeReq } from './_chat-test-helpers';

async function setupStoryChapterChat(
  req: Request,
): Promise<{ storyId: string; chapterId: string; chatId: string }> {
  const story = await createStoryRepo(req).create({
    title: 'S',
    worldNotes: null,
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
  const chat = await createChatRepo(req).create({
    draftId: chapter.activeDraftId as string,
    title: null,
  });
  return { storyId, chapterId, chatId: chat.id as string };
}

describe('[V21] GET /api/chats/:chatId/messages', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetDb();
  });
  afterEach(async () => {
    _resetSessionStore();
    await resetDb();
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/chats/anything/messages');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('returns 404 for a nonexistent chat', async () => {
    const { agent } = await registerAndLogin({ username: 'chat-msg-u1' });
    const res = await agent.get('/api/chats/does-not-exist/messages');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it("returns 404 for another user's chat", async () => {
    const { sessionId: ownerSessionId } = await registerAndLogin({ username: 'chat-msg-owner' });
    const ownerReq = makeFakeReq(ownerSessionId);
    const { chatId } = await setupStoryChapterChat(ownerReq);

    const { agent: intruderAgent } = await registerAndLogin({ username: 'chat-msg-intruder' });
    const res = await intruderAgent.get(`/api/chats/${chatId}/messages`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('returns 200 with empty messages array for a new chat', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'chat-msg-u2' });
    const req = makeFakeReq(sessionId);
    const { chatId } = await setupStoryChapterChat(req);

    const res = await agent.get(`/api/chats/${chatId}/messages`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ messages: [] });
  });

  it('returns decrypted messages ordered by createdAt asc with contract-shaped fields', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'chat-msg-u3' });
    const req = makeFakeReq(sessionId);
    const { chatId } = await setupStoryChapterChat(req);
    const messageRepo = createMessageRepo(req);

    await messageRepo.create({
      chatId,
      role: 'user',
      content: 'first user turn',
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
      content: 'first assistant reply',
      model: 'llama-test',
      tokens: 42,
      latencyMs: 1234,
    });

    const res = await agent.get(`/api/chats/${chatId}/messages`);
    expect(res.status).toBe(200);
    const messages = res.body.messages as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('first user turn');
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
    expect(messages[1].content).toBe('first assistant reply');
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

  it('returns 500 when repo row has null content (egress schema rejects it)', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'chat-msg-u4' });
    const req = makeFakeReq(sessionId);
    const { chatId } = await setupStoryChapterChat(req);

    // Raw Prisma: messageRepo.create always encrypts content on write — only a
    // direct insert can produce the null-ciphertext state this test needs.
    await prisma.message.create({
      data: { chatId, role: 'user' },
    });

    const res = await agent.get(`/api/chats/${chatId}/messages`);
    expect(res.status).toBe(500);
    // `error.stack` is only populated when NODE_ENV !== 'production' (test env).
    // respond() wraps the raw ZodError in EgressSchemaDriftError so the central
    // ZodError -> 400 mapping branch doesn't misclassify this server-side
    // egress-contract drift as a client 400 (see lib/respond.ts).
    expect(res.body.error.stack).toBeDefined();
    expect(res.body.error.stack).toMatch(/EgressSchemaDriftError/);
  });
});
