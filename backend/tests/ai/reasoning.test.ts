// [V6] strip_thinking_response — reasoning model support.
// Confirms that strip_thinking_response is set to true when the selected model
// has supportsReasoning: true, and is absent otherwise.

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

const NAME = 'Reasoning Test User';
const USERNAME = 'ai-reasoning-user';
const PASSWORD = 'reasoning-test-password';
const VALID_KEY = 'sk-venice-reasoning-test-key-1234';

const REASONING_MODEL_ID = 'qwen-qwq-32b';
const PLAIN_MODEL_ID = 'llama-3.3-70b';

const MODEL_LIST_BODY = {
  object: 'list',
  data: [
    {
      id: PLAIN_MODEL_ID,
      object: 'model',
      type: 'text',
      model_spec: {
        name: 'Llama 3.3 70B',
        availableContextTokens: 65536,
        capabilities: { supportsReasoning: false, supportsVision: false },
      },
    },
    {
      id: REASONING_MODEL_ID,
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
  const story = await createStoryRepo(req).create({ title: 'Reasoning Story' });
  const storyId = story.id as string;
  const chapter = await createChapterRepo(req).create({
    storyId,
    title: 'Chapter',
    orderIndex: 0,
  });
  return { storyId, chapterId: chapter.id as string };
}

async function callComplete(
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
      response.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      response.on('end', () => callback(null, data));
    })
    .send({ action: 'continue', selectedText: '', chapterId, storyId, modelId });

  const completionCall = fetchSpy.mock.calls.find(([url]) =>
    String(url).includes('/chat/completions'),
  );
  expect(completionCall).toBeTruthy();
  const [, init] = completionCall!;
  return JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
}

describe('POST /api/ai/complete — reasoning model [V6]', () => {
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

  it('sets strip_thinking_response: true when model has supportsReasoning: true', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { storyId, chapterId } = await setupTestData(req);

    const requestBody = await callComplete(accessToken, storyId, chapterId, REASONING_MODEL_ID, fetchSpy);
    const vp = requestBody.venice_parameters as Record<string, unknown>;
    expect(vp.strip_thinking_response).toBe(true);
  });

  it('does not set strip_thinking_response for a non-reasoning model', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { storyId, chapterId } = await setupTestData(req);

    const requestBody = await callComplete(accessToken, storyId, chapterId, PLAIN_MODEL_ID, fetchSpy);
    const vp = requestBody.venice_parameters as Record<string, unknown>;
    // Must be absent or explicitly not true
    expect(vp.strip_thinking_response).not.toBe(true);
  });
});
