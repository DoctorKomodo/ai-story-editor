// [V8] prompt_cache_key — sha256(storyId:modelId) truncated to 32 hex chars.
// Confirms the key is deterministic, always present, and varies by model.

import { createHash } from 'node:crypto';
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

const NAME = 'Prompt Cache Test User';
const USERNAME = 'ai-promptcache-user';
const PASSWORD = 'promptcache-test-password';
const VALID_KEY = 'sk-venice-promptcache-test-key-PCCH';

const MODEL_A = 'llama-3.3-70b';
const MODEL_B = 'qwen-qwq-32b';

const MODEL_LIST_BODY = {
  object: 'list',
  data: [
    {
      id: MODEL_A,
      object: 'model',
      type: 'text',
      model_spec: {
        name: 'Llama 3.3 70B',
        availableContextTokens: 65536,
        capabilities: { supportsReasoning: false, supportsVision: false },
      },
    },
    {
      id: MODEL_B,
      object: 'model',
      type: 'text',
      model_spec: {
        name: 'Qwen QwQ 32B',
        availableContextTokens: 32768,
        capabilities: { supportsReasoning: true, supportsVision: false },
      },
    },
  ],
};

function expectedCacheKey(storyId: string, modelId: string): string {
  return createHash('sha256').update(`${storyId}:${modelId}`).digest('hex').slice(0, 32);
}

function makeChunk(content: string, finish: string | null = null) {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { content }, finish_reason: finish }],
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
  const session = getSession(decoded.sessionId!);
  expect(session).not.toBeNull();
  const req = { user: { id: decoded.sub, email: null } } as unknown as Request;
  attachDekToRequest(req, session!.dek);
  return req;
}

async function setupTestData(req: Request): Promise<{ storyId: string; chapterId: string }> {
  const story = await createStoryRepo(req).create({ title: 'Cache Story' });
  const storyId = story.id as string;
  const chapter = await createChapterRepo(req).create({
    storyId,
    title: 'Chapter',
    orderIndex: 0,
  });
  return { storyId, chapterId: chapter.id as string };
}

async function callCompleteAndGetRequestBody(
  accessToken: string,
  storyId: string,
  chapterId: string,
  modelId: string,
  fetchSpy: ReturnType<typeof vi.fn>,
): Promise<Record<string, unknown>> {
  fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
  fetchSpy.mockResolvedValueOnce(sseStreamResponse([makeChunk('OK', 'stop')]));

  await request(app)
    .post('/api/ai/complete')
    .set('Authorization', `Bearer ${accessToken}`)
    .buffer(true)
    .parse((response, callback) => {
      let data = '';
      response.on('data', (chunk: Buffer) => {
        data += chunk.toString();
      });
      response.on('end', () => callback(null, data));
    })
    .send({
      action: 'continue',
      selectedText: '',
      chapterId,
      storyId,
      modelId,
    });

  // Reset the models cache so the next call re-fetches (each test has a fresh
  // fetch mock sequence). Models are still in the cache from the fetchModels
  // call above, so getModelContextLength works on the second request.
  // Don't reset here — the cache may have items from this call that are valid.

  const completionCall = fetchSpy.mock.calls.find(([url]) =>
    String(url).includes('/chat/completions'),
  );
  expect(completionCall).toBeTruthy();
  const [, init] = completionCall!;
  const requestBody = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
  return requestBody;
}

describe('POST /api/ai/complete — prompt cache key [V8]', () => {
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

  it('sets prompt_cache_key at top level to sha256(storyId:modelId) first 32 hex chars', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { storyId, chapterId } = await setupTestData(req);

    const body = await callCompleteAndGetRequestBody(
      accessToken,
      storyId,
      chapterId,
      MODEL_A,
      fetchSpy,
    );

    // [V23] prompt_cache_key is a Venice TOP-LEVEL field, not nested under
    // venice_parameters — nesting causes Venice to silently ignore it.
    expect(body.prompt_cache_key).toBe(expectedCacheKey(storyId, MODEL_A));
    // Sanity: must be exactly 32 hex chars
    expect(typeof body.prompt_cache_key).toBe('string');
    expect((body.prompt_cache_key as string).length).toBe(32);
    expect(/^[0-9a-f]+$/.test(body.prompt_cache_key as string)).toBe(true);

    // [V23] Must NOT live under venice_parameters.
    const vp = body.venice_parameters as Record<string, unknown>;
    expect(vp.prompt_cache_key).toBeUndefined();
  });

  it('same storyId + modelId produces the same cache key across requests', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { storyId, chapterId } = await setupTestData(req);

    const body1 = await callCompleteAndGetRequestBody(
      accessToken,
      storyId,
      chapterId,
      MODEL_A,
      fetchSpy,
    );
    // Reset spy between calls, but cache is warm so no second models fetch needed
    fetchSpy.mockClear();
    fetchSpy.mockResolvedValueOnce(sseStreamResponse([makeChunk('OK', 'stop')]));

    await request(app)
      .post('/api/ai/complete')
      .set('Authorization', `Bearer ${accessToken}`)
      .buffer(true)
      .parse((response, callback) => {
        let data = '';
        response.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        response.on('end', () => callback(null, data));
      })
      .send({
        action: 'continue',
        selectedText: '',
        chapterId,
        storyId,
        modelId: MODEL_A,
      });

    const completionCall2 = fetchSpy.mock.calls.find(([url]) =>
      String(url).includes('/chat/completions'),
    );
    expect(completionCall2).toBeTruthy();
    const [, init2] = completionCall2!;
    const body2 = JSON.parse((init2 as RequestInit).body as string) as Record<string, unknown>;

    expect(body1.prompt_cache_key).toBe(body2.prompt_cache_key);
  });

  it('different modelId produces a different cache key', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { storyId, chapterId } = await setupTestData(req);

    const bodyA = await callCompleteAndGetRequestBody(
      accessToken,
      storyId,
      chapterId,
      MODEL_A,
      fetchSpy,
    );
    fetchSpy.mockClear();
    fetchSpy.mockResolvedValueOnce(sseStreamResponse([makeChunk('OK', 'stop')]));

    await request(app)
      .post('/api/ai/complete')
      .set('Authorization', `Bearer ${accessToken}`)
      .buffer(true)
      .parse((response, callback) => {
        let data = '';
        response.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        response.on('end', () => callback(null, data));
      })
      .send({
        action: 'continue',
        selectedText: '',
        chapterId,
        storyId,
        modelId: MODEL_B,
      });

    const completionCallB = fetchSpy.mock.calls.find(([url]) =>
      String(url).includes('/chat/completions'),
    );
    expect(completionCallB).toBeTruthy();
    const [, initB] = completionCallB!;
    const bodyB = JSON.parse((initB as RequestInit).body as string) as Record<string, unknown>;

    expect(bodyA.prompt_cache_key).not.toBe(bodyB.prompt_cache_key);
    expect(bodyB.prompt_cache_key).toBe(expectedCacheKey(storyId, MODEL_B));
  });
});
