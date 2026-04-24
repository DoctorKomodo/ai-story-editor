// [V9][V28] Rate limit header forwarding tests — chat surface.
// Mirrors tests/ai/rate-limit-headers.test.ts but targets
// POST /api/chats/:chatId/messages instead of POST /api/ai/complete.
//
// Asserts that Venice rate-limit headers are forwarded to the client with
// the `x-venice-` prefix, and that each header is absent on the response
// when Venice didn't send the corresponding upstream header.
//
// Covers the 6 forwarded headers:
//   x-ratelimit-remaining-requests  -> x-venice-remaining-requests   [V9]
//   x-ratelimit-remaining-tokens    -> x-venice-remaining-tokens     [V9]
//   x-ratelimit-limit-requests      -> x-venice-limit-requests       [V28]
//   x-ratelimit-limit-tokens        -> x-venice-limit-tokens         [V28]
//   x-ratelimit-reset-requests      -> x-venice-reset-requests       [V28]
//   x-ratelimit-reset-tokens        -> x-venice-reset-tokens         [V28]

import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/index';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createChatRepo } from '../../src/repos/chat.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import type { AccessTokenPayload } from '../../src/services/auth.service';
import { attachDekToRequest } from '../../src/services/content-crypto.service';
import { _resetSessionStore, getSession } from '../../src/services/session-store';
import { veniceModelsService } from '../../src/services/venice.models.service';
import { prisma } from '../setup';

// ─── Constants ────────────────────────────────────────────────────────────────

const NAME = 'Chat Rate Limit Header User';
const USERNAME = 'chat-rate-limit-header-user';
const PASSWORD = 'chat-rate-limit-header-password';
const VALID_KEY = 'sk-venice-chat-rate-limit-test-key-XXXX';

const BASE_MODEL_ID = 'llama-3.3-70b';
const BASE_CONTEXT_LENGTH = 65536;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MODEL_LIST_BODY = {
  object: 'list',
  data: [
    {
      id: BASE_MODEL_ID,
      object: 'model',
      type: 'text',
      model_spec: {
        name: 'Llama 3.3 70B',
        availableContextTokens: BASE_CONTEXT_LENGTH,
        capabilities: { supportsReasoning: false, supportsVision: false },
      },
    },
  ],
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : 'err',
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Build a fake SSE streaming response with optional rate-limit headers.
 * Emits a single content chunk, a usage chunk, then [DONE] so the chat
 * route's persistence path runs to completion.
 */
function sseStreamResponse(headers: Record<string, string> = {}): Response {
  const enc = new TextEncoder();
  const contentChunk = JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: null }],
  });
  const usageChunk = JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { content: null }, finish_reason: 'stop' }],
    usage: { total_tokens: 7 },
  });
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(`data: ${contentChunk}\n\n`));
      controller.enqueue(enc.encode(`data: ${usageChunk}\n\n`));
      controller.enqueue(enc.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream', ...headers },
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function registerAndLogin(): Promise<string> {
  await request(app)
    .post('/api/auth/register')
    .send({ name: NAME, username: USERNAME, password: PASSWORD });
  const login = await request(app)
    .post('/api/auth/login')
    .send({ username: USERNAME, password: PASSWORD });
  expect(login.status).toBe(200);
  return login.body.accessToken as string;
}

async function storeKey(accessToken: string, fetchSpy: ReturnType<typeof vi.fn>): Promise<void> {
  fetchSpy.mockResolvedValueOnce(jsonResponse(200, { data: [] }));
  const res = await request(app)
    .put('/api/users/me/venice-key')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ apiKey: VALID_KEY });
  expect(res.status).toBe(200);
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

async function setupChat(req: Request): Promise<{ chatId: string }> {
  const story = await createStoryRepo(req).create({ title: 'Test Story' });
  const storyId = story.id as string;
  const chapter = await createChapterRepo(req).create({
    storyId,
    title: 'Chapter One',
    bodyJson: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello.' }] }],
    },
    orderIndex: 0,
    wordCount: 1,
  });
  const chapterId = chapter.id as string;
  const chat = await createChatRepo(req).create({ chapterId, title: null });
  return { chatId: chat.id as string };
}

async function doChatMessageRequest(
  accessToken: string,
  chatId: string,
): Promise<request.Response> {
  return request(app)
    .post(`/api/chats/${chatId}/messages`)
    .set('Authorization', `Bearer ${accessToken}`)
    .buffer(true)
    .parse((response, callback) => {
      let data = '';
      response.on('data', (chunk: Buffer) => {
        data += chunk.toString();
      });
      response.on('end', () => callback(null, data));
    })
    .send({ content: 'Tell me a story.', modelId: BASE_MODEL_ID });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/chats/:chatId/messages — rate limit header forwarding [V9][V28]', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    _resetSessionStore();
    await prisma.message.deleteMany();
    await prisma.chat.deleteMany();
    await prisma.outlineItem.deleteMany();
    await prisma.character.deleteMany();
    await prisma.chapter.deleteMany();
    await prisma.story.deleteMany();
    await prisma.session.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
    veniceModelsService.resetCache();

    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    _resetSessionStore();
    await prisma.message.deleteMany();
    await prisma.chat.deleteMany();
    await prisma.outlineItem.deleteMany();
    await prisma.character.deleteMany();
    await prisma.chapter.deleteMany();
    await prisma.story.deleteMany();
    await prisma.session.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  it('[V9] forwards x-ratelimit-remaining-requests and x-ratelimit-remaining-tokens from Venice', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { chatId } = await setupChat(req);

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(
      sseStreamResponse({
        'x-ratelimit-remaining-requests': '42',
        'x-ratelimit-remaining-tokens': '9876',
      }),
    );

    const res = await doChatMessageRequest(accessToken, chatId);

    expect(res.status).toBe(200);
    expect(res.headers['x-venice-remaining-requests']).toBe('42');
    expect(res.headers['x-venice-remaining-tokens']).toBe('9876');
  });

  it('[V9] does not set x-venice-remaining-requests when Venice omitted x-ratelimit-remaining-requests', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { chatId } = await setupChat(req);

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(sseStreamResponse({ 'x-ratelimit-remaining-tokens': '5000' }));

    const res = await doChatMessageRequest(accessToken, chatId);

    expect(res.status).toBe(200);
    expect(res.headers['x-venice-remaining-requests']).toBeUndefined();
    expect(res.headers['x-venice-remaining-tokens']).toBe('5000');
  });

  it('[V9] does not set either remaining-* header when Venice omitted both', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { chatId } = await setupChat(req);

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(sseStreamResponse({}));

    const res = await doChatMessageRequest(accessToken, chatId);

    expect(res.status).toBe(200);
    expect(res.headers['x-venice-remaining-requests']).toBeUndefined();
    expect(res.headers['x-venice-remaining-tokens']).toBeUndefined();
  });

  // ── [V28] limit-* and reset-* header forwarding ─────────────────────────────

  it('[V28] forwards limit-* and reset-* rate-limit headers from Venice', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { chatId } = await setupChat(req);

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(
      sseStreamResponse({
        'x-ratelimit-remaining-requests': '42',
        'x-ratelimit-remaining-tokens': '9876',
        'x-ratelimit-limit-requests': '100',
        'x-ratelimit-limit-tokens': '200000',
        'x-ratelimit-reset-requests': '1m30s',
        'x-ratelimit-reset-tokens': '45s',
      }),
    );

    const res = await doChatMessageRequest(accessToken, chatId);

    expect(res.status).toBe(200);
    expect(res.headers['x-venice-remaining-requests']).toBe('42');
    expect(res.headers['x-venice-remaining-tokens']).toBe('9876');
    expect(res.headers['x-venice-limit-requests']).toBe('100');
    expect(res.headers['x-venice-limit-tokens']).toBe('200000');
    expect(res.headers['x-venice-reset-requests']).toBe('1m30s');
    expect(res.headers['x-venice-reset-tokens']).toBe('45s');
  });

  it('[V28] does not set limit-* / reset-* headers when Venice omits them', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { chatId } = await setupChat(req);

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(
      sseStreamResponse({
        'x-ratelimit-remaining-requests': '7',
        'x-ratelimit-remaining-tokens': '1234',
      }),
    );

    const res = await doChatMessageRequest(accessToken, chatId);

    expect(res.status).toBe(200);
    expect(res.headers['x-venice-remaining-requests']).toBe('7');
    expect(res.headers['x-venice-remaining-tokens']).toBe('1234');
    expect(res.headers['x-venice-limit-requests']).toBeUndefined();
    expect(res.headers['x-venice-limit-tokens']).toBeUndefined();
    expect(res.headers['x-venice-reset-requests']).toBeUndefined();
    expect(res.headers['x-venice-reset-tokens']).toBeUndefined();
  });

  it('[V28] forwards each limit-* / reset-* header independently when only some are present', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { chatId } = await setupChat(req);

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(
      sseStreamResponse({
        'x-ratelimit-limit-tokens': '200000',
        'x-ratelimit-reset-requests': '2m',
      }),
    );

    const res = await doChatMessageRequest(accessToken, chatId);

    expect(res.status).toBe(200);
    expect(res.headers['x-venice-limit-requests']).toBeUndefined();
    expect(res.headers['x-venice-limit-tokens']).toBe('200000');
    expect(res.headers['x-venice-reset-requests']).toBe('2m');
    expect(res.headers['x-venice-reset-tokens']).toBeUndefined();
  });
});
