// [V7] Web search — enable_web_search + enable_web_citations.
// Confirms flags are set when enableWebSearch: true and absent otherwise.

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

const NAME = 'Web Search Test User';
const USERNAME = 'ai-websearch-user';
const PASSWORD = 'websearch-test-password';
const VALID_KEY = 'sk-venice-websearch-test-key-SRCH';

const MODEL_ID = 'llama-3.3-70b';

const MODEL_LIST_BODY = {
  object: 'list',
  data: [
    {
      id: MODEL_ID,
      object: 'model',
      type: 'text',
      model_spec: {
        name: 'Llama 3.3 70B',
        availableContextTokens: 65536,
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
  const story = await createStoryRepo(req).create({ title: 'Web Search Story' });
  const storyId = story.id as string;
  const chapter = await createChapterRepo(req).create({
    storyId,
    title: 'Chapter',
    orderIndex: 0,
  });
  return { storyId, chapterId: chapter.id as string };
}

async function callCompleteAndGetVeniceParams(
  accessToken: string,
  storyId: string,
  chapterId: string,
  enableWebSearch: boolean | undefined,
  fetchSpy: ReturnType<typeof vi.fn>,
): Promise<Record<string, unknown>> {
  fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
  fetchSpy.mockResolvedValueOnce(sseStreamResponse([makeChunk('OK', 'stop')]));

  const body: Record<string, unknown> = {
    action: 'continue',
    selectedText: '',
    chapterId,
    storyId,
    modelId: MODEL_ID,
  };
  if (enableWebSearch !== undefined) {
    body.enableWebSearch = enableWebSearch;
  }

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
    .send(body);

  const completionCall = fetchSpy.mock.calls.find(([url]) =>
    String(url).includes('/chat/completions'),
  );
  expect(completionCall).toBeTruthy();
  const [, init] = completionCall!;
  const requestBody = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
  return requestBody.venice_parameters as Record<string, unknown>;
}

describe('POST /api/ai/complete — web search [V7]', () => {
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

  it('sets enable_web_search and enable_web_citations when enableWebSearch: true', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { storyId, chapterId } = await setupTestData(req);

    const vp = await callCompleteAndGetVeniceParams(
      accessToken,
      storyId,
      chapterId,
      true,
      fetchSpy,
    );
    expect(vp.enable_web_search).toBe('auto');
    expect(vp.enable_web_citations).toBe(true);
  });

  it('does not set web search flags when enableWebSearch is omitted', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { storyId, chapterId } = await setupTestData(req);

    const vp = await callCompleteAndGetVeniceParams(
      accessToken,
      storyId,
      chapterId,
      undefined,
      fetchSpy,
    );
    expect(vp.enable_web_search).toBeUndefined();
    expect(vp.enable_web_citations).toBeUndefined();
  });

  it('does not set web search flags when enableWebSearch: false', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { storyId, chapterId } = await setupTestData(req);

    const vp = await callCompleteAndGetVeniceParams(
      accessToken,
      storyId,
      chapterId,
      false,
      fetchSpy,
    );
    expect(vp.enable_web_search).toBeUndefined();
    expect(vp.enable_web_citations).toBeUndefined();
  });
});
