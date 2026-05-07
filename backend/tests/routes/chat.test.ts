// [SC4] Integration tests for POST /api/chapters/:chapterId/chats (kind field)
// and GET /api/chapters/:chapterId/chats (kind filter).
// [SC5] Integration test for POST /api/chats/:chatId/messages kind=scene routing.

import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/index';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import type { AccessTokenPayload } from '../../src/services/auth.service';
import { attachDekToRequest } from '../../src/services/content-crypto.service';
import { _resetSessionStore, getSession } from '../../src/services/session-store';
import { veniceModelsService } from '../../src/services/venice.models.service';
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

// ─── Fixtures shared by SC5 suite ─────────────────────────────────────────────

const SC5_MODEL_ID = 'venice-test-model';

const SC5_MODEL_LIST_BODY = {
  object: 'list',
  data: [
    {
      id: SC5_MODEL_ID,
      object: 'model',
      type: 'text',
      model_spec: {
        name: 'Venice Test Model',
        availableContextTokens: 65536,
        maxCompletionTokens: 4096,
        capabilities: { supportsReasoning: false, supportsVision: false },
      },
    },
  ],
};

function sc5JsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : 'err',
    headers: { 'content-type': 'application/json' },
  });
}

function sc5SseStreamResponse(chunks: Array<Record<string, unknown>>): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(c)}\n\n`));
      }
      controller.enqueue(enc.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

// veniceSetup: registers a user, stores a BYOK key, creates story+chapter,
// returns agent + chapterId + fetchSpy (already stubbed on globalThis).
async function veniceSetup(username: string): Promise<{
  agent: ReturnType<typeof request.agent>;
  chapterId: string;
  fetchSpy: ReturnType<typeof vi.fn>;
}> {
  const fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);

  const accessToken = await registerAndLogin(username);

  // Store BYOK key (validate endpoint returns 200 with { data: [] }).
  fetchSpy.mockResolvedValueOnce(sc5JsonResponse(200, { data: [] }));
  const keyRes = await request(app)
    .put('/api/users/me/venice-key')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ apiKey: 'sk-venice-sc5-test-key-ABCD' });
  expect(keyRes.status).toBe(200);

  const req = makeFakeReq(accessToken);
  const story = await createStoryRepo(req).create({ title: 'SC5 Story', worldNotes: null });
  const chapter = await createChapterRepo(req).create({
    storyId: story.id as string,
    title: 'SC5 Chapter',
    bodyJson: null,
    orderIndex: 0,
    wordCount: 0,
  });

  const agent = request.agent(app);
  agent.set('Authorization', `Bearer ${accessToken}`);

  return { agent, chapterId: chapter.id as string, fetchSpy };
}

// ─── SC6 suite ────────────────────────────────────────────────────────────────

// Helper: queue a fresh SSE response on the fetch spy (shared by SC6 and SC8 suites).
function queueSseResponse(fetchSpy: ReturnType<typeof vi.fn>, content: string): void {
  fetchSpy.mockResolvedValueOnce(sc5JsonResponse(200, SC5_MODEL_LIST_BODY));
  fetchSpy.mockResolvedValueOnce(
    sc5SseStreamResponse([
      {
        id: 'chatcmpl-retry',
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { content }, finish_reason: null }],
      },
    ]),
  );
}

// Fire a POST /messages call and drain the SSE stream (so the assistant message is persisted).
async function sendMessage(
  agent: ReturnType<typeof request.agent>,
  chatId: string,
  body: Record<string, unknown>,
): Promise<number> {
  const res = await agent
    .post(`/api/chats/${chatId}/messages`)
    .buffer(true)
    .parse((response, callback) => {
      let data = '';
      response.on('data', (chunk: Buffer) => {
        data += chunk.toString();
      });
      response.on('end', () => callback(null, data));
    })
    .send(body);
  return res.status as number;
}

describe('POST /api/chats/:chatId/messages — retry flag', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetAll();
    veniceModelsService.resetCache();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    _resetSessionStore();
    await resetAll();
  });

  it('does not persist a new user message when retry=true', async () => {
    const { agent, chapterId, fetchSpy } = await veniceSetup('sc6-retry-u1');

    const created = await agent
      .post(`/api/chapters/${chapterId}/chats`)
      .send({ title: 's', kind: 'scene' });
    const chatId = created.body.chat.id as string;

    // First turn — normal generate. Models cache miss + stream.
    queueSseResponse(fetchSpy, 'First assistant reply.');
    const firstStatus = await sendMessage(agent, chatId, {
      content: 'Direction A',
      modelId: SC5_MODEL_ID,
    });
    expect(firstStatus).toBe(200);

    // Read messages: should be 1 user + 1 assistant.
    const before = await agent.get(`/api/chats/${chatId}/messages`).expect(200);
    expect(before.body.messages.filter((m: { role: string }) => m.role === 'user')).toHaveLength(1);
    expect(
      before.body.messages.filter((m: { role: string }) => m.role === 'assistant'),
    ).toHaveLength(1);

    // Retry — must NOT add a user message. Models cache is warm so only stream mock needed.
    fetchSpy.mockResolvedValueOnce(
      sc5SseStreamResponse([
        {
          id: 'chatcmpl-retry2',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { content: 'Retry reply.' }, finish_reason: null }],
        },
      ]),
    );
    const retryStatus = await sendMessage(agent, chatId, {
      retry: true,
      modelId: SC5_MODEL_ID,
    });
    expect(retryStatus).toBe(200);

    const after = await agent.get(`/api/chats/${chatId}/messages`).expect(200);
    expect(after.body.messages.filter((m: { role: string }) => m.role === 'user')).toHaveLength(1);
    expect(
      after.body.messages.filter((m: { role: string }) => m.role === 'assistant'),
    ).toHaveLength(2);
  });

  it('400 when retry=true and the trailing message is not a user turn', async () => {
    const { agent, chapterId } = await veniceSetup('sc6-retry-u2');

    const created = await agent
      .post(`/api/chapters/${chapterId}/chats`)
      .send({ title: 's', kind: 'scene' });
    const chatId = created.body.chat.id as string;

    // No prior messages — retry has nothing to base on.
    await agent
      .post(`/api/chats/${chatId}/messages`)
      .send({ retry: true, modelId: SC5_MODEL_ID })
      .expect(400);
  });

  it('does not require content when retry=true', async () => {
    const { agent, chapterId, fetchSpy } = await veniceSetup('sc6-retry-u3');

    const created = await agent
      .post(`/api/chapters/${chapterId}/chats`)
      .send({ title: 's', kind: 'scene' });
    const chatId = created.body.chat.id as string;

    // Prime with a normal turn first.
    queueSseResponse(fetchSpy, 'First reply.');
    await sendMessage(agent, chatId, { content: 'd', modelId: SC5_MODEL_ID });

    // Retry with no content — models cache warm, only stream mock needed.
    fetchSpy.mockResolvedValueOnce(
      sc5SseStreamResponse([
        {
          id: 'chatcmpl-retry3',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { content: 'No-content retry.' }, finish_reason: null }],
        },
      ]),
    );
    const retryStatus = await sendMessage(agent, chatId, {
      retry: true,
      modelId: SC5_MODEL_ID,
    });
    expect(retryStatus).toBe(200);
  });
});

// ─── SC7 suite ────────────────────────────────────────────────────────────────

// setupAsDifferentUser: registers a second user and returns only an authed agent.
// Does NOT need a story or chapter — ownership-fence tests only need the agent.
async function setupAsDifferentUser(
  username: string,
): Promise<{ agent: ReturnType<typeof request.agent> }> {
  const accessToken = await registerAndLogin(username, 'diff-user-pw', 'Different User');
  const agent = request.agent(app);
  agent.set('Authorization', `Bearer ${accessToken}`);
  return { agent };
}

describe('PATCH /api/chats/:id', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetAll();
  });

  afterEach(async () => {
    _resetSessionStore();
    await resetAll();
  });

  it('updates the title', async () => {
    const { agent, chapterId } = await setup('sc7-patch-u1');
    const created = await agent
      .post(`/api/chapters/${chapterId}/chats`)
      .send({ title: 'old', kind: 'scene' });
    const chatId = created.body.chat.id as string;

    const res = await agent.patch(`/api/chats/${chatId}`).send({ title: 'new title' }).expect(200);
    expect(res.body.chat.title).toBe('new title');
  });

  it('returns 404 for unknown id', async () => {
    const { agent } = await setup('sc7-patch-u2');
    await agent.patch('/api/chats/cl000notreal').send({ title: 'x' }).expect(404);
  });

  it('returns 404 for chat owned by another user', async () => {
    const { agent: agentA, chapterId } = await setup('sc7-patch-u3');
    const created = await agentA
      .post(`/api/chapters/${chapterId}/chats`)
      .send({ title: 'a', kind: 'scene' });
    const chatId = created.body.chat.id as string;

    const { agent: agentB } = await setupAsDifferentUser('sc7-patch-u4');
    await agentB.patch(`/api/chats/${chatId}`).send({ title: 'hijack' }).expect(404);
  });

  it('rejects invalid bodies', async () => {
    const { agent, chapterId } = await setup('sc7-patch-u5');
    const created = await agent
      .post(`/api/chapters/${chapterId}/chats`)
      .send({ title: 'a', kind: 'scene' });
    const chatId = created.body.chat.id as string;

    await agent.patch(`/api/chats/${chatId}`).send({ title: '' }).expect(400);
    await agent.patch(`/api/chats/${chatId}`).send({}).expect(400);
  });
});

// ─── SC8 suite ────────────────────────────────────────────────────────────────

describe('DELETE /api/chats/:id', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetAll();
    veniceModelsService.resetCache();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    _resetSessionStore();
    await resetAll();
  });

  it('deletes the chat and cascades messages', async () => {
    const { agent, chapterId, fetchSpy } = await veniceSetup('sc8-delete-u1');
    const created = await agent
      .post(`/api/chapters/${chapterId}/chats`)
      .send({ title: 's', kind: 'scene' });
    const chatId = created.body.chat.id as string;

    // Add a message so we can confirm cascade.
    queueSseResponse(fetchSpy, 'Assistant reply.');
    await sendMessage(agent, chatId, { content: 'd', modelId: SC5_MODEL_ID });

    await agent.delete(`/api/chats/${chatId}`).expect(204);

    await agent.get(`/api/chats/${chatId}/messages`).expect(404);
  });

  it('returns 404 for unknown id', async () => {
    const { agent } = await setup('sc8-delete-u2');
    await agent.delete('/api/chats/cl000notreal').expect(404);
  });

  it('returns 404 for chat owned by another user', async () => {
    const { agent: agentA, chapterId } = await setup('sc8-delete-u3');
    const created = await agentA
      .post(`/api/chapters/${chapterId}/chats`)
      .send({ title: 'a', kind: 'scene' });
    const chatId = created.body.chat.id as string;

    const { agent: agentB } = await setupAsDifferentUser('sc8-delete-u4');
    await agentB.delete(`/api/chats/${chatId}`).expect(404);
  });
});

// ─── SC5 suite ────────────────────────────────────────────────────────────────

describe('POST /api/chats/:chatId/messages — kind=scene routing', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetAll();
    veniceModelsService.resetCache();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    _resetSessionStore();
    await resetAll();
  });

  it('builds the prompt with action="scene" when chat.kind="scene"', async () => {
    const { agent, chapterId, fetchSpy } = await veniceSetup('sc5-scene-u1');

    const created = await agent
      .post(`/api/chapters/${chapterId}/chats`)
      .send({ title: 's1', kind: 'scene' })
      .expect(201);
    const chatId = created.body.chat.id as string;

    // Prime models cache, then serve the completion stream.
    fetchSpy.mockResolvedValueOnce(sc5JsonResponse(200, SC5_MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(
      sc5SseStreamResponse([
        {
          id: 'chatcmpl-sc5',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { content: 'Scene prose.' }, finish_reason: null }],
        },
      ]),
    );

    const res = await agent
      .post(`/api/chats/${chatId}/messages`)
      .buffer(true)
      .parse((response, callback) => {
        let data = '';
        response.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        response.on('end', () => callback(null, data));
      })
      .send({
        content: 'Jenny approaches Linda on the veranda and they talk about cheese.',
        modelId: SC5_MODEL_ID,
      });

    expect(res.status).toBe(200);
    expect(res.body as string).toContain('data:'); // SSE flowed

    // Find the Venice completions call and inspect the messages array.
    const completionCall = fetchSpy.mock.calls.find(([url]) =>
      String(url).includes('/chat/completions'),
    );
    expect(completionCall).toBeTruthy();
    const [, init] = completionCall!;
    const requestBody = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
    const sentMessages = requestBody.messages as Array<{ role: string; content: string }>;

    // System message must contain the scene template text.
    expect(sentMessages[0].role).toBe('system');
    expect(sentMessages[0].content).toContain('write a passage of prose');

    // Last user message must be the raw direction — no "User question:" framing.
    const lastMsg = sentMessages[sentMessages.length - 1];
    expect(lastMsg.role).toBe('user');
    expect(lastMsg.content).toBe(
      'Jenny approaches Linda on the veranda and they talk about cheese.',
    );
    expect(lastMsg.content).not.toContain('User question');
  });
});
