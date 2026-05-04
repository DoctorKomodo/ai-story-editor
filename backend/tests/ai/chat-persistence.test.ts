// [V15] Chat persistence integration tests.
//
// Covers:
//   - POST /api/chapters/:chapterId/chats — create, 201, decrypted title
//   - GET  /api/chapters/:chapterId/chats — list sorted by createdAt asc
//   - Auth gates on all three endpoints (401 without Bearer)
//   - Ownership gates (404 when chapter/chat not owned)
//   - POST /api/chats/:chatId/messages — SSE streams, both messages persisted
//   - tokens + latencyMs captured on assistant message
//   - 409 + no messages when user has no BYOK key (error occurs before persist)
//   - Post-persist Venice failure: user message exists, assistant does not
//   - Ciphertext check: sentinel must not appear in raw contentJsonCiphertext
//   - History included on subsequent message (prior user+assistant pair present)

import { createHash } from 'node:crypto';
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

const NAME = 'Chat Test User';
const USERNAME = 'chat-persist-user';
const PASSWORD = 'chat-persist-password';
const VALID_KEY = 'sk-venice-chat-persist-key-ABCD';

const BASE_MODEL_ID = 'llama-3.3-70b';
const BASE_CONTEXT_LENGTH = 65536;

const MSG_SENTINEL = 'UniqueMsg5entinelPhrase_8y3xZ';

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

function makeChunk(content: string, finish: string | null = null) {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { content }, finish_reason: finish }],
  };
}

function makeUsageChunk(totalTokens: number) {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { content: null }, finish_reason: 'stop' }],
    usage: { total_tokens: totalTokens },
  };
}

function sseStreamResponse(chunks: Array<Record<string, unknown>>): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(c)}\n\n`));
      }
      controller.enqueue(enc.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : 'err',
    headers: { 'content-type': 'application/json' },
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

async function setupStoryAndChapter(req: Request): Promise<{ storyId: string; chapterId: string }> {
  const story = await createStoryRepo(req).create({
    title: 'Test Story',
    worldNotes: 'A magical world.',
  });
  const storyId = story.id as string;
  const chapter = await createChapterRepo(req).create({
    storyId,
    title: 'Chapter One',
    bodyJson: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Some chapter text.' }] }],
    },
    orderIndex: 0,
    wordCount: 3,
  });
  return { storyId, chapterId: chapter.id as string };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Chat persistence [V15]', () => {
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

  // ── Create chat ─────────────────────────────────────────────────────────────

  it('POST /api/chapters/:chapterId/chats returns 201 with decrypted title', async () => {
    const accessToken = await registerAndLogin();
    const req = makeFakeReq(accessToken);
    const { chapterId } = await setupStoryAndChapter(req);

    const res = await request(app)
      .post(`/api/chapters/${chapterId}/chats`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'My Chat' });

    expect(res.status).toBe(201);
    expect(res.body.chat.title).toBe('My Chat');
    expect(res.body.chat.chapterId).toBe(chapterId);
    expect(typeof res.body.chat.id).toBe('string');
  });

  it('POST /api/chapters/:chapterId/chats returns 201 with null title when omitted', async () => {
    const accessToken = await registerAndLogin();
    const req = makeFakeReq(accessToken);
    const { chapterId } = await setupStoryAndChapter(req);

    const res = await request(app)
      .post(`/api/chapters/${chapterId}/chats`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.chat.title).toBeNull();
  });

  // [V20] strict schema — unknown keys on CreateChatBody are rejected.
  it('POST /api/chapters/:chapterId/chats returns 400 validation_error on unknown keys', async () => {
    const accessToken = await registerAndLogin();
    const req = makeFakeReq(accessToken);
    const { chapterId } = await setupStoryAndChapter(req);

    const res = await request(app)
      .post(`/api/chapters/${chapterId}/chats`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'ok', extraneous: 'nope' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(Array.isArray(res.body.error.issues)).toBe(true);
  });

  it('POST /api/chapters/:chapterId/chats returns 401 without Bearer', async () => {
    const res = await request(app).post('/api/chapters/some-id/chats').send({ title: 'x' });
    expect(res.status).toBe(401);
  });

  it('POST /api/chapters/:chapterId/chats returns 404 for unowned chapter', async () => {
    const accessToken = await registerAndLogin();

    const res = await request(app)
      .post('/api/chapters/nonexistent-chapter/chats')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  // ── List chats ──────────────────────────────────────────────────────────────

  it('GET /api/chapters/:chapterId/chats returns chats sorted by createdAt asc', async () => {
    const accessToken = await registerAndLogin();
    const req = makeFakeReq(accessToken);
    const { chapterId } = await setupStoryAndChapter(req);

    // Create two chats with a small delay so createdAt differs.
    await createChatRepo(req).create({ chapterId, title: 'First Chat' });
    // Tiny pause to guarantee distinct timestamps.
    await new Promise((r) => setTimeout(r, 5));
    await createChatRepo(req).create({ chapterId, title: 'Second Chat' });

    const res = await request(app)
      .get(`/api/chapters/${chapterId}/chats`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.chats).toHaveLength(2);
    expect(res.body.chats[0].title).toBe('First Chat');
    expect(res.body.chats[1].title).toBe('Second Chat');
    // Chats include messageCount.
    expect(typeof res.body.chats[0].messageCount).toBe('number');
  });

  it('GET /api/chapters/:chapterId/chats returns 401 without Bearer', async () => {
    const res = await request(app).get('/api/chapters/some-id/chats');
    expect(res.status).toBe(401);
  });

  it('GET /api/chapters/:chapterId/chats returns 404 for unowned chapter', async () => {
    const accessToken = await registerAndLogin();
    const res = await request(app)
      .get('/api/chapters/nonexistent-chapter/chats')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  // ── Post message — SSE streaming ────────────────────────────────────────────

  it('POST /api/chats/:chatId/messages returns 401 without Bearer', async () => {
    const res = await request(app)
      .post('/api/chats/some-chat/messages')
      .send({ content: 'hi', modelId: BASE_MODEL_ID });
    expect(res.status).toBe(401);
  });

  // [V20] strict schema — unknown top-level key on PostMessageBody.
  it('POST /api/chats/:chatId/messages returns 400 validation_error on unknown top-level key', async () => {
    const accessToken = await registerAndLogin();
    const res = await request(app)
      .post('/api/chats/some-chat/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ content: 'hi', modelId: BASE_MODEL_ID, stray: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  // [V20] strict schema — unknown key inside nested `attachment`.
  it('POST /api/chats/:chatId/messages returns 400 validation_error on unknown attachment key', async () => {
    const accessToken = await registerAndLogin();
    const res = await request(app)
      .post('/api/chats/some-chat/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        content: 'hi',
        modelId: BASE_MODEL_ID,
        attachment: { selectionText: 'x', chapterId: 'y', extra: 'nope' },
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('POST /api/chats/:chatId/messages returns 404 for unowned chat', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    // Prime models cache
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));

    const res = await request(app)
      .post('/api/chats/nonexistent-chat/messages')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ content: 'hi', modelId: BASE_MODEL_ID });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('streams SSE, persists user + assistant messages with tokens and latencyMs', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { chapterId } = await setupStoryAndChapter(req);

    const chat = await createChatRepo(req).create({ chapterId, title: null });
    const chatId = chat.id as string;

    const EXPECTED_TOKENS = 42;

    // Mock: models list + Venice completion stream (with usage chunk at end).
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(
      sseStreamResponse([
        makeChunk('Hello'),
        makeChunk(' world', null),
        makeUsageChunk(EXPECTED_TOKENS),
      ]),
    );

    const res = await request(app)
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

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    const body = res.body as string;
    expect(body).toContain('"Hello"');
    expect(body).toContain('" world"');
    expect(body).toContain('data: [DONE]');

    // Both messages must be persisted.
    const msgs = await prisma.message.findMany({
      where: { chatId },
      orderBy: { createdAt: 'asc' },
    });
    expect(msgs).toHaveLength(2);

    const userMsg = msgs[0];
    const assistantMsg = msgs[1];

    expect(userMsg.role).toBe('user');
    expect(userMsg.model).toBeNull();
    expect(userMsg.tokens).toBeNull();
    expect(userMsg.latencyMs).toBeNull();

    expect(assistantMsg.role).toBe('assistant');
    expect(assistantMsg.model).toBe(BASE_MODEL_ID);
    expect(assistantMsg.tokens).toBe(EXPECTED_TOKENS);
    expect(assistantMsg.latencyMs).toBeGreaterThan(0);
  });

  it('returns 409 and persists NO messages when user has no BYOK key', async () => {
    const accessToken = await registerAndLogin();
    const req = makeFakeReq(accessToken);
    const { chapterId } = await setupStoryAndChapter(req);
    const chat = await createChatRepo(req).create({ chapterId, title: null });
    const chatId = chat.id as string;

    // No storeKey call — user has no BYOK.
    const res = await request(app)
      .post(`/api/chats/${chatId}/messages`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ content: 'Hi.', modelId: BASE_MODEL_ID });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('venice_key_required');

    // No messages persisted — error happened before persist step.
    const count = await prisma.message.count({ where: { chatId } });
    expect(count).toBe(0);
  });

  it('persists user message but NOT assistant message on post-persist Venice rate-limit error', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { chapterId } = await setupStoryAndChapter(req);
    const chat = await createChatRepo(req).create({ chapterId, title: null });
    const chatId = chat.id as string;

    // Models list succeeds, then Venice stream returns 429.
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    // Build a 429 SSE-style failure (openai SDK throws RateLimitError from status 429 body).
    // We simulate a stream error after headers are flushed by making the stream body throw.
    const enc = new TextEncoder();
    const failStream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Emit one chunk so headers flush, then error.
        controller.enqueue(enc.encode(`data: ${JSON.stringify(makeChunk('Hi'))}\n\n`));
        controller.error(
          Object.assign(new Error('Venice rate limited'), {
            status: 429,
            constructor: { name: 'RateLimitError' },
          }),
        );
      },
    });
    // We need to actually throw a RateLimitError from the openai SDK. The simplest
    // approach is to use the stream SSE path to deliver a partial response and then
    // throw from the stream, which mapVeniceErrorToSse handles.
    // Since we can't easily replicate an openai SDK RateLimitError, we simulate
    // the stream erroring by providing a stream that errors mid-way.
    // The route will catch the non-APIError and write a generic stream_error frame.
    fetchSpy.mockResolvedValueOnce(
      new Response(failStream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    );

    const res = await request(app)
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
      .send({ content: 'Trigger error.', modelId: BASE_MODEL_ID });

    // SSE response (headers were flushed before stream error).
    expect(res.status).toBe(200);
    const body = res.body as string;
    // Should contain a stream_error or similar terminal frame + [DONE].
    expect(body).toContain('data: [DONE]');

    // User message must be persisted; assistant message must not (stream errored).
    const msgs = await prisma.message.findMany({
      where: { chatId },
      orderBy: { createdAt: 'asc' },
    });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('user');
  });

  it('ciphertext check: sentinel does not appear in raw contentJsonCiphertext', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { chapterId } = await setupStoryAndChapter(req);
    const chat = await createChatRepo(req).create({ chapterId, title: null });
    const chatId = chat.id as string;

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(sseStreamResponse([makeChunk('Assistant reply.', 'stop')]));

    await request(app)
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
      .send({ content: MSG_SENTINEL, modelId: BASE_MODEL_ID });

    // Raw ciphertext must not contain the sentinel.
    const rawMsg = await prisma.message.findFirst({
      where: { chatId, role: 'user' },
    });
    expect(rawMsg).not.toBeNull();
    expect(rawMsg!.contentJsonCiphertext).not.toBeNull();
    expect(rawMsg!.contentJsonCiphertext).not.toContain(MSG_SENTINEL);
  });

  it('history included on subsequent message', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { chapterId } = await setupStoryAndChapter(req);
    const chat = await createChatRepo(req).create({ chapterId, title: null });
    const chatId = chat.id as string;

    // First message
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(sseStreamResponse([makeChunk('First reply.', 'stop')]));
    await request(app)
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
      .send({ content: 'First user message.', modelId: BASE_MODEL_ID });

    // Second message
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(sseStreamResponse([makeChunk('Second reply.', 'stop')]));
    await request(app)
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
      .send({ content: 'Second user message.', modelId: BASE_MODEL_ID });

    // Inspect the Venice completions call from the SECOND message send.
    const completionCalls = fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes('/chat/completions'),
    );
    // Two Venice calls (one per message send).
    expect(completionCalls.length).toBe(2);

    const [, secondCallInit] = completionCalls[1];
    const requestBody = JSON.parse((secondCallInit as RequestInit).body as string) as Record<
      string,
      unknown
    >;
    const sentMessages = requestBody.messages as Array<{ role: string; content: string }>;

    // Should be: [system, user(first), assistant(first reply), user(second)]
    // That's at minimum 4 messages.
    expect(sentMessages.length).toBeGreaterThanOrEqual(4);

    // Find the history turn: a user message with "First user message."
    const firstUserTurn = sentMessages.find(
      (m) => m.role === 'user' && m.content.includes('First user message.'),
    );
    expect(firstUserTurn).toBeDefined();

    // And the assistant reply before the second user message.
    const assistantTurn = sentMessages.find(
      (m) => m.role === 'assistant' && m.content.includes('First reply.'),
    );
    expect(assistantTurn).toBeDefined();
  });

  it('[V23] sends prompt_cache_key at top level, not inside venice_parameters', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { chapterId } = await setupStoryAndChapter(req);

    const chat = await createChatRepo(req).create({ chapterId, title: null });
    const chatId = chat.id as string;

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(sseStreamResponse([makeChunk('Reply.', 'stop')]));

    await request(app)
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
      .send({ content: 'Hi.', modelId: BASE_MODEL_ID });

    const completionCall = fetchSpy.mock.calls.find(([url]) =>
      String(url).includes('/chat/completions'),
    );
    expect(completionCall).toBeTruthy();
    const [, init] = completionCall!;
    const body = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;

    const expectedKey = createHash('sha256')
      .update(`${chatId}:${BASE_MODEL_ID}`)
      .digest('hex')
      .slice(0, 32);

    // [V23] Venice documents prompt_cache_key as a TOP-LEVEL field alongside
    // model/messages/stream. Burying it inside venice_parameters makes Venice
    // silently ignore it and every call pays cold-prompt cost.
    expect(body.prompt_cache_key).toBe(expectedKey);
    expect(typeof body.prompt_cache_key).toBe('string');
    expect((body.prompt_cache_key as string).length).toBe(32);

    // [V23] Must NOT be duplicated into venice_parameters.
    const vp = body.venice_parameters as Record<string, unknown>;
    expect(vp.prompt_cache_key).toBeUndefined();
  });
});
