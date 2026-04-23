// [V11] Venice error handling tests.
// Verifies that Venice API errors are mapped to user-friendly HTTP responses
// and that raw Venice error bodies / stack traces are never exposed.

import request from 'supertest';
import jwt from 'jsonwebtoken';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
// APIError imported for instanceof checks in helper — the SDK exports it
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { APIError } from 'openai';
import { app } from '../../src/index';
import { veniceModelsService } from '../../src/services/venice.models.service';
import { getSession, _resetSessionStore } from '../../src/services/session-store';
import { attachDekToRequest } from '../../src/services/content-crypto.service';
import { createStoryRepo } from '../../src/repos/story.repo';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import type { AccessTokenPayload } from '../../src/services/auth.service';
import type { Request } from 'express';
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
  return new Response(
    JSON.stringify({ error: { message } }),
    {
      status,
      headers: { 'content-type': 'application/json', ...extraHeaders },
    },
  );
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

async function storeKey(
  accessToken: string,
  fetchSpy: ReturnType<typeof vi.fn>,
): Promise<void> {
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

async function setupStoryAndChapter(
  req: Request,
): Promise<{ storyId: string; chapterId: string }> {
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

  // ── /complete error mapping ─────────────────────────────────────────────────

  describe('POST /api/ai/complete', () => {
    it('Venice 401 → our 400 with code venice_key_invalid', async () => {
      const accessToken = await registerAndLogin();
      await storeKey(accessToken, fetchSpy);
      const req = makeFakeReq(accessToken);
      const { storyId, chapterId } = await setupStoryAndChapter(req);

      // Models list succeeds, then the completion returns 401
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
      // Return a 401 Response — the openai SDK converts this to AuthenticationError.
      // Do NOT use mockRejectedValueOnce: the SDK wraps fetch rejections in
      // APIConnectionError (status: undefined), bypassing our instanceof checks.
      fetchSpy.mockResolvedValueOnce(
        errorResponse(401, `Invalid API key ${VENICE_RAW_ERROR_SENTINEL}`),
      );

      const res = await request(app)
        .post('/api/ai/complete')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ action: 'continue', selectedText: '', chapterId, storyId, modelId: BASE_MODEL_ID });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('venice_key_invalid');
      // Raw Venice error body must not appear in our response
      expect(JSON.stringify(res.body)).not.toContain(VENICE_RAW_ERROR_SENTINEL);
    });

    it('Venice 429 with retry-after: 60 → our 429 with retryAfterSeconds: 60', async () => {
      const accessToken = await registerAndLogin();
      await storeKey(accessToken, fetchSpy);
      const req = makeFakeReq(accessToken);
      const { storyId, chapterId } = await setupStoryAndChapter(req);

      fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
      fetchSpy.mockResolvedValueOnce(
        errorResponse(429, 'rate limited', { 'retry-after': '60' }),
      );

      const res = await request(app)
        .post('/api/ai/complete')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ action: 'continue', selectedText: '', chapterId, storyId, modelId: BASE_MODEL_ID });

      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('venice_rate_limited');
      expect(res.body.error.retryAfterSeconds).toBe(60);
    });

    it('Venice 429 with no retry-after → retryAfterSeconds: null', async () => {
      const accessToken = await registerAndLogin();
      await storeKey(accessToken, fetchSpy);
      const req = makeFakeReq(accessToken);
      const { storyId, chapterId } = await setupStoryAndChapter(req);

      fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
      fetchSpy.mockResolvedValueOnce(errorResponse(429, 'rate limited'));

      const res = await request(app)
        .post('/api/ai/complete')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ action: 'continue', selectedText: '', chapterId, storyId, modelId: BASE_MODEL_ID });

      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('venice_rate_limited');
      expect(res.body.error.retryAfterSeconds).toBeNull();
    });

    it('Venice 503 → our 502 with code venice_unavailable', async () => {
      const accessToken = await registerAndLogin();
      await storeKey(accessToken, fetchSpy);
      const req = makeFakeReq(accessToken);
      const { storyId, chapterId } = await setupStoryAndChapter(req);

      fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
      fetchSpy.mockResolvedValueOnce(errorResponse(503, 'Service Unavailable'));

      const res = await request(app)
        .post('/api/ai/complete')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ action: 'continue', selectedText: '', chapterId, storyId, modelId: BASE_MODEL_ID });

      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('venice_unavailable');
    });

    it('Venice 418 (unexpected status) → our 502 with code venice_error', async () => {
      const accessToken = await registerAndLogin();
      await storeKey(accessToken, fetchSpy);
      const req = makeFakeReq(accessToken);
      const { storyId, chapterId } = await setupStoryAndChapter(req);

      fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
      fetchSpy.mockResolvedValueOnce(errorResponse(418, `I am a teapot ${VENICE_RAW_ERROR_SENTINEL}`));

      const res = await request(app)
        .post('/api/ai/complete')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ action: 'continue', selectedText: '', chapterId, storyId, modelId: BASE_MODEL_ID });

      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('venice_error');
      // Raw Venice error body must not appear
      expect(JSON.stringify(res.body)).not.toContain(VENICE_RAW_ERROR_SENTINEL);
    });

    it('Venice API key is never logged when Venice returns 401', async () => {
      const accessToken = await registerAndLogin();
      await storeKey(accessToken, fetchSpy);
      const req = makeFakeReq(accessToken);
      const { storyId, chapterId } = await setupStoryAndChapter(req);

      fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
      fetchSpy.mockResolvedValueOnce(errorResponse(401, 'Invalid API key'));

      const errorSpy = vi.spyOn(console, 'error');

      await request(app)
        .post('/api/ai/complete')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ action: 'continue', selectedText: '', chapterId, storyId, modelId: BASE_MODEL_ID });

      // The key must never appear in any console.error call
      const allLoggedArgs = errorSpy.mock.calls.flat().map(String).join(' ');
      expect(allLoggedArgs).not.toContain(VALID_KEY);

      errorSpy.mockRestore();
    });
  });

  // ── /balance error mapping ──────────────────────────────────────────────────

  describe('GET /api/ai/balance', () => {
    it('Venice 401 → our 400 with code venice_key_invalid', async () => {
      const accessToken = await registerAndLogin();
      await storeKey(accessToken, fetchSpy);

      fetchSpy.mockResolvedValueOnce(
        errorResponse(401, `Invalid API key ${VENICE_RAW_ERROR_SENTINEL}`),
      );

      const res = await request(app)
        .get('/api/ai/balance')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('venice_key_invalid');
      expect(JSON.stringify(res.body)).not.toContain(VENICE_RAW_ERROR_SENTINEL);
    });

    it('Venice 429 with retry-after: 30 → our 429 with retryAfterSeconds: 30', async () => {
      const accessToken = await registerAndLogin();
      await storeKey(accessToken, fetchSpy);

      fetchSpy.mockResolvedValueOnce(
        errorResponse(429, 'rate limited', { 'retry-after': '30' }),
      );

      const res = await request(app)
        .get('/api/ai/balance')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('venice_rate_limited');
      expect(res.body.error.retryAfterSeconds).toBe(30);
    });

    it('Venice 503 → our 502 with code venice_unavailable', async () => {
      const accessToken = await registerAndLogin();
      await storeKey(accessToken, fetchSpy);

      fetchSpy.mockResolvedValueOnce(errorResponse(503, 'Service Unavailable'));

      const res = await request(app)
        .get('/api/ai/balance')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('venice_unavailable');
    });

    it('Venice 418 (unexpected) → our 502 with code venice_error', async () => {
      const accessToken = await registerAndLogin();
      await storeKey(accessToken, fetchSpy);

      fetchSpy.mockResolvedValueOnce(
        errorResponse(418, `teapot ${VENICE_RAW_ERROR_SENTINEL}`),
      );

      const res = await request(app)
        .get('/api/ai/balance')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('venice_error');
      expect(JSON.stringify(res.body)).not.toContain(VENICE_RAW_ERROR_SENTINEL);
    });
  });
});
