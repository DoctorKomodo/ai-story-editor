// [V11] Venice error handling tests.
// Verifies that Venice API errors are mapped to user-friendly HTTP responses
// and that raw Venice error bodies / stack traces are never exposed.

import type { Request } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/index';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { attachDekToRequest } from '../../src/services/content-crypto.service';
import { _resetSessionStore, getSession } from '../../src/services/session-store';
import { veniceModelsService } from '../../src/services/venice.models.service';
import { prisma } from '../setup';

// ─── Constants ────────────────────────────────────────────────────────────────

const NAME = 'Error Handling User';
const USERNAME = 'ai-error-user';
const PASSWORD = 'ai-error-password';
// The key sentinel — must never appear in a log from [V11] error paths
const VALID_KEY = 'sk-venice-SECRET-ERROR-TEST-KEY';

const BASE_MODEL_ID = 'llama-3.3-70b';
const BASE_CONTEXT_LENGTH = 65536;

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
        maxCompletionTokens: 4096,
        capabilities: { supportsReasoning: false, supportsVision: false },
      },
    },
  ],
};

// A sentinel string Venice might include in raw error bodies — must never
// appear in our responses.
const VENICE_RAW_ERROR_SENTINEL = 'sk-raw-venice-error-body-should-not-appear';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jsonResponse(
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : 'err',
    headers: { 'content-type': 'application/json', ...extraHeaders },
  });
}

/**
 * Build a mock fetch Response that will cause the openai SDK to throw the
 * appropriate APIError subclass (AuthenticationError, RateLimitError, etc.).
 *
 * The SDK inspects the HTTP status of the Response and calls APIError.generate()
 * to produce the right subclass — so we must return a Response, NOT reject fetch.
 * Rejecting with an APIError instance causes the SDK to wrap it in
 * APIConnectionError (status: undefined), bypassing the subclass checks.
 */
function errorResponse(
  status: number,
  message: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  });
}

async function registerAndLogin(): Promise<{
  agent: ReturnType<typeof request.agent>;
  sessionId: string;
}> {
  const agent = request.agent(app);
  await agent
    .post('/api/auth/register')
    .set('Origin', 'http://localhost:3000')
    .send({ name: NAME, username: USERNAME, password: PASSWORD });
  const login = await agent
    .post('/api/auth/login')
    .set('Origin', 'http://localhost:3000')
    .send({ username: USERNAME, password: PASSWORD });
  expect(login.status).toBe(200);
  const raw = login.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = (raw ?? []).find((c) => c.startsWith('session='));
  expect(cookie).toBeDefined();
  const sessionId = decodeURIComponent(cookie!.split(';')[0].split('=')[1]);
  return { agent, sessionId };
}

async function storeKey(
  agent: ReturnType<typeof request.agent>,
  fetchSpy: ReturnType<typeof vi.fn>,
): Promise<void> {
  fetchSpy.mockResolvedValueOnce(jsonResponse(200, { data: [] }));
  const res = await agent
    .put('/api/users/me/venice-key')
    .set('Origin', 'http://localhost:3000')
    .send({ apiKey: VALID_KEY });
  expect(res.status).toBe(200);
}

function makeFakeReq(sessionId: string): Request {
  const session = getSession(sessionId);
  expect(session).not.toBeNull();
  const req = { user: { id: session!.userId, sessionId } } as unknown as Request;
  attachDekToRequest(req, session!.dek);
  return req;
}

async function setupStoryAndChapter(req: Request): Promise<{ storyId: string; chapterId: string }> {
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
  return { storyId, chapterId: chapter.id as string };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Venice error handling [V11]', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    _resetSessionStore();
    await prisma.message.deleteMany();
    await prisma.chat.deleteMany();
    await prisma.outlineItem.deleteMany();
    await prisma.character.deleteMany();
    await prisma.chapter.deleteMany();
    await prisma.story.deleteMany();
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
    await prisma.user.deleteMany();
  });

  // ── /complete error mapping ─────────────────────────────────────────────────

  describe('POST /api/ai/complete', () => {
    it('Venice 401 → our 400 with code venice_key_invalid', async () => {
      const { agent, sessionId } = await registerAndLogin();
      await storeKey(agent, fetchSpy);
      const req = makeFakeReq(sessionId);
      const { storyId, chapterId } = await setupStoryAndChapter(req);

      // Models list succeeds, then the completion returns 401
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
      // Return a 401 Response — the openai SDK converts this to AuthenticationError.
      // Do NOT use mockRejectedValueOnce: the SDK wraps fetch rejections in
      // APIConnectionError (status: undefined), bypassing our instanceof checks.
      fetchSpy.mockResolvedValueOnce(
        errorResponse(401, `Invalid API key ${VENICE_RAW_ERROR_SENTINEL}`),
      );

      const res = await agent
        .post('/api/ai/complete')
        .set('Origin', 'http://localhost:3000')
        .send({ action: 'continue', selectedText: '', chapterId, storyId, modelId: BASE_MODEL_ID });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('venice_key_invalid');
      // Raw Venice error body must not appear in our response
      expect(JSON.stringify(res.body)).not.toContain(VENICE_RAW_ERROR_SENTINEL);
    });

    it('Venice 429 with retry-after: 60 → our 429 with retryAfterSeconds: 60', async () => {
      const { agent, sessionId } = await registerAndLogin();
      await storeKey(agent, fetchSpy);
      const req = makeFakeReq(sessionId);
      const { storyId, chapterId } = await setupStoryAndChapter(req);

      fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
      fetchSpy.mockResolvedValueOnce(errorResponse(429, 'rate limited', { 'retry-after': '60' }));

      const res = await agent
        .post('/api/ai/complete')
        .set('Origin', 'http://localhost:3000')
        .send({ action: 'continue', selectedText: '', chapterId, storyId, modelId: BASE_MODEL_ID });

      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('venice_rate_limited');
      expect(res.body.error.retryAfterSeconds).toBe(60);
    });

    it('Venice 429 with no retry-after → retryAfterSeconds: null', async () => {
      const { agent, sessionId } = await registerAndLogin();
      await storeKey(agent, fetchSpy);
      const req = makeFakeReq(sessionId);
      const { storyId, chapterId } = await setupStoryAndChapter(req);

      fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
      fetchSpy.mockResolvedValueOnce(errorResponse(429, 'rate limited'));

      const res = await agent
        .post('/api/ai/complete')
        .set('Origin', 'http://localhost:3000')
        .send({ action: 'continue', selectedText: '', chapterId, storyId, modelId: BASE_MODEL_ID });

      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('venice_rate_limited');
      expect(res.body.error.retryAfterSeconds).toBeNull();
    });

    it('Venice 503 → our 502 with code venice_unavailable', async () => {
      const { agent, sessionId } = await registerAndLogin();
      await storeKey(agent, fetchSpy);
      const req = makeFakeReq(sessionId);
      const { storyId, chapterId } = await setupStoryAndChapter(req);

      fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
      fetchSpy.mockResolvedValueOnce(errorResponse(503, 'Service Unavailable'));

      const res = await agent
        .post('/api/ai/complete')
        .set('Origin', 'http://localhost:3000')
        .send({ action: 'continue', selectedText: '', chapterId, storyId, modelId: BASE_MODEL_ID });

      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('venice_unavailable');
    });

    it('Venice 418 (unexpected status) → our 502 with code venice_error', async () => {
      const { agent, sessionId } = await registerAndLogin();
      await storeKey(agent, fetchSpy);
      const req = makeFakeReq(sessionId);
      const { storyId, chapterId } = await setupStoryAndChapter(req);

      fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
      fetchSpy.mockResolvedValueOnce(
        errorResponse(418, `I am a teapot ${VENICE_RAW_ERROR_SENTINEL}`),
      );

      const res = await agent
        .post('/api/ai/complete')
        .set('Origin', 'http://localhost:3000')
        .send({ action: 'continue', selectedText: '', chapterId, storyId, modelId: BASE_MODEL_ID });

      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('venice_error');
      // Raw Venice error body must not appear
      expect(JSON.stringify(res.body)).not.toContain(VENICE_RAW_ERROR_SENTINEL);
    });

    it('Venice API key is never logged when Venice returns 401', async () => {
      const { agent, sessionId } = await registerAndLogin();
      await storeKey(agent, fetchSpy);
      const req = makeFakeReq(sessionId);
      const { storyId, chapterId } = await setupStoryAndChapter(req);

      fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
      fetchSpy.mockResolvedValueOnce(errorResponse(401, 'Invalid API key'));

      // Spy on all console channels — the key must not leak through any of them
      const errorSpy = vi.spyOn(console, 'error');
      const warnSpy = vi.spyOn(console, 'warn');
      const logSpy = vi.spyOn(console, 'log');
      const infoSpy = vi.spyOn(console, 'info');

      await agent
        .post('/api/ai/complete')
        .set('Origin', 'http://localhost:3000')
        .send({ action: 'continue', selectedText: '', chapterId, storyId, modelId: BASE_MODEL_ID });

      // The key must never appear in any console channel
      const allLoggedArgs = [
        ...errorSpy.mock.calls,
        ...warnSpy.mock.calls,
        ...logSpy.mock.calls,
        ...infoSpy.mock.calls,
      ]
        .flat()
        .map(String)
        .join(' ');
      expect(allLoggedArgs).not.toContain(VALID_KEY);

      vi.restoreAllMocks();
    });
  });
});
