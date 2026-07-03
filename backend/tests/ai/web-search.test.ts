// [X11] Web search is chat-only. The inline /api/ai/complete surface must NEVER
// set enable_web_search / enable_web_citations — citations are rendered only in
// the chat panel (V26), so web search here would cost Venice credits with no
// user-visible benefit. The route schema doesn't accept enableWebSearch, so a
// client that sends it has the field stripped and web search stays off.

import type { Request } from 'express';
import type request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { attachDekToRequest } from '../../src/services/content-crypto.service';
import { getSession } from '../../src/services/session-store';
import { veniceModelsService } from '../../src/services/venice.models.service';
import { registerAndLogin } from '../helpers/auth';
import { resetDb } from '../helpers/db';

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
        maxCompletionTokens: 4096,
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
  agent: ReturnType<typeof request.agent>,
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

  await agent
    .post('/api/ai/complete')
    .set('Origin', 'http://localhost:3000')
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

describe('POST /api/ai/complete — web search off (chat-only) [X11]', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await resetDb();
    veniceModelsService.resetCache();

    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await resetDb();
  });

  it('ignores a client-sent enableWebSearch: true — flags never set on /complete', async () => {
    const { agent, sessionId } = await registerAndLogin();
    await storeKey(agent, fetchSpy);
    const req = makeFakeReq(sessionId);
    const { storyId, chapterId } = await setupTestData(req);

    const vp = await callCompleteAndGetVeniceParams(agent, storyId, chapterId, true, fetchSpy);
    expect(vp.enable_web_search).toBeUndefined();
    expect(vp.enable_web_citations).toBeUndefined();
  });

  it('does not set web search flags when enableWebSearch is omitted', async () => {
    const { agent, sessionId } = await registerAndLogin();
    await storeKey(agent, fetchSpy);
    const req = makeFakeReq(sessionId);
    const { storyId, chapterId } = await setupTestData(req);

    const vp = await callCompleteAndGetVeniceParams(agent, storyId, chapterId, undefined, fetchSpy);
    expect(vp.enable_web_search).toBeUndefined();
    expect(vp.enable_web_citations).toBeUndefined();
  });

  it('does not set web search flags when enableWebSearch: false', async () => {
    const { agent, sessionId } = await registerAndLogin();
    await storeKey(agent, fetchSpy);
    const req = makeFakeReq(sessionId);
    const { storyId, chapterId } = await setupTestData(req);

    const vp = await callCompleteAndGetVeniceParams(agent, storyId, chapterId, false, fetchSpy);
    expect(vp.enable_web_search).toBeUndefined();
    expect(vp.enable_web_citations).toBeUndefined();
  });
});
