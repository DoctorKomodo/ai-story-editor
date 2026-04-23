// [V9] Rate limit header forwarding tests.
// Asserts that x-ratelimit-remaining-requests and x-ratelimit-remaining-tokens
// from Venice are forwarded to the client as x-venice-remaining-requests and
// x-venice-remaining-tokens, and are absent when Venice didn't send them.

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

const NAME = 'Rate Limit Header User';
const USERNAME = 'rate-limit-header-user';
const PASSWORD = 'rate-limit-header-password';
const VALID_KEY = 'sk-venice-rate-limit-test-key-XXXX';

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
 */
function sseStreamResponse(
  headers: Record<string, string> = {},
): Response {
  const enc = new TextEncoder();
  const chunk = JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: 'stop' }],
  });
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(`data: ${chunk}\n\n`));
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

async function doCompleteRequest(
  accessToken: string,
  storyId: string,
  chapterId: string,
): Promise<request.Response> {
  return request(app)
    .post('/api/ai/complete')
    .set('Authorization', `Bearer ${accessToken}`)
    .buffer(true)
    .parse((response, callback) => {
      let data = '';
      response.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      response.on('end', () => callback(null, data));
    })
    .send({
      action: 'continue',
      selectedText: '',
      chapterId,
      storyId,
      modelId: BASE_MODEL_ID,
    });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/ai/complete — rate limit header forwarding [V9]', () => {
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

  it('forwards x-ratelimit-remaining-requests and x-ratelimit-remaining-tokens from Venice', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { storyId, chapterId } = await setupStoryAndChapter(req);

    // Mock: models list + Venice completion with rate-limit headers
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(
      sseStreamResponse({
        'x-ratelimit-remaining-requests': '42',
        'x-ratelimit-remaining-tokens': '9876',
      }),
    );

    const res = await doCompleteRequest(accessToken, storyId, chapterId);

    expect(res.status).toBe(200);
    expect(res.headers['x-venice-remaining-requests']).toBe('42');
    expect(res.headers['x-venice-remaining-tokens']).toBe('9876');
  });

  it('does not set x-venice-remaining-requests when Venice omitted x-ratelimit-remaining-requests', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { storyId, chapterId } = await setupStoryAndChapter(req);

    // Only tokens header present, requests absent
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(
      sseStreamResponse({ 'x-ratelimit-remaining-tokens': '5000' }),
    );

    const res = await doCompleteRequest(accessToken, storyId, chapterId);

    expect(res.status).toBe(200);
    expect(res.headers['x-venice-remaining-requests']).toBeUndefined();
    expect(res.headers['x-venice-remaining-tokens']).toBe('5000');
  });

  it('does not set either header when Venice omitted both rate-limit headers', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { storyId, chapterId } = await setupStoryAndChapter(req);

    // No rate-limit headers from Venice
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(sseStreamResponse({}));

    const res = await doCompleteRequest(accessToken, storyId, chapterId);

    expect(res.status).toBe(200);
    expect(res.headers['x-venice-remaining-requests']).toBeUndefined();
    expect(res.headers['x-venice-remaining-tokens']).toBeUndefined();
  });
});
