// [V26] Chat web-search citations integration tests.
//
// Covers:
//   1. Citations frame precedes content frames when Venice returns results.
//   2. Empty search results → no citations frame, persisted null.
//   3. Toggle off → no web-search Venice params, no citations frame, null persisted.
//   4. Persisted citations round-trip via GET /api/chats/:chatId/messages.
//   5. Cap enforcement at 10 items.
//   6. Projection correctness: content → snippet, date → publishedAt.
//   7. Items missing title or url are dropped.
//   8. No ciphertext leak on the list endpoint.
//   9. Leak sentinel does not appear in raw citationsJsonCiphertext column.

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/index';
import { veniceModelsService } from '../../src/services/venice.models.service';
import { getSession, _resetSessionStore } from '../../src/services/session-store';
import { attachDekToRequest } from '../../src/services/content-crypto.service';
import { createStoryRepo } from '../../src/repos/story.repo';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createChatRepo } from '../../src/repos/chat.repo';
import type { AccessTokenPayload } from '../../src/services/auth.service';
import type { Request } from 'express';
import { prisma } from '../setup';

// ─── Constants ────────────────────────────────────────────────────────────────

const NAME = 'Citations Test User';
const USERNAME = 'chat-cit-user';
const PASSWORD = 'chat-cit-password';
const VALID_KEY = 'sk-venice-chat-cit-key-ABCD';

const BASE_MODEL_ID = 'llama-3.3-70b';
const BASE_CONTEXT_LENGTH = 65536;

const LEAK_SENTINEL = 'V26_CITATION_SENTINEL_X7q2';

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

async function setupStoryAndChapter(
  req: Request,
): Promise<{ storyId: string; chapterId: string }> {
  const story = await createStoryRepo(req).create({
    title: 'Cit Story',
    worldNotes: null,
    systemPrompt: null,
  });
  const storyId = story.id as string;
  const chapter = await createChapterRepo(req).create({
    storyId,
    title: 'Chapter One',
    bodyJson: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Some text.' }] }],
    },
    orderIndex: 0,
    wordCount: 2,
  });
  return { storyId, chapterId: chapter.id as string };
}

async function runPost(
  accessToken: string,
  chatId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: string; contentType: string }> {
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
    .send(body);
  return {
    status: res.status,
    body: res.body as string,
    contentType: (res.headers['content-type'] as string) ?? '',
  };
}

// Read the last /chat/completions call's request body so we can assert on
// the venice_parameters Venice saw.
function lastCompletionRequest(fetchSpy: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const completionCalls = fetchSpy.mock.calls.filter(([url]) =>
    String(url).includes('/chat/completions'),
  );
  expect(completionCalls.length).toBeGreaterThan(0);
  const [, init] = completionCalls[completionCalls.length - 1];
  return JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('[V26] Chat web-search citations', () => {
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

  it('emits citations frame before content and sets Venice web-search params', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { chapterId } = await setupStoryAndChapter(req);
    const chat = await createChatRepo(req).create({ chapterId, title: null });
    const chatId = chat.id as string;

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(
      sseStreamResponse([
        {
          venice_search_results: [
            { title: 'A', url: 'https://a.test/', content: 'snip-a', date: '2025-01-02' },
            { title: 'B', url: 'https://b.test/', content: 'snip-b', date: '2025-02-03' },
            { title: 'C', url: 'https://c.test/', content: 'snip-c', date: '2025-03-04' },
          ],
        },
        makeChunk('Hello '),
        makeChunk('world', 'stop'),
      ]),
    );

    const res = await runPost(accessToken, chatId, {
      content: 'Tell me.',
      modelId: BASE_MODEL_ID,
      enableWebSearch: true,
    });

    expect(res.status).toBe(200);
    expect(res.contentType).toMatch(/text\/event-stream/);

    // Venice call carried the three web-search params.
    const vreq = lastCompletionRequest(fetchSpy);
    const vp = vreq.venice_parameters as Record<string, unknown>;
    expect(vp.enable_web_search).toBe('auto');
    expect(vp.enable_web_citations).toBe(true);
    expect(vp.include_search_results_in_stream).toBe(true);

    // SSE stream: `event: citations\n` must precede any content frame.
    const citationsIdx = res.body.indexOf('event: citations\n');
    const firstContentIdx = res.body.indexOf('data: {"id":"chatcmpl-');
    expect(citationsIdx).toBeGreaterThanOrEqual(0);
    expect(firstContentIdx).toBeGreaterThan(citationsIdx);

    // The citations frame data decodes to the projected shape.
    const match = res.body.match(/event: citations\ndata: (.+)\n\n/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]) as { citations: unknown[] };
    expect(parsed.citations).toEqual([
      { title: 'A', url: 'https://a.test/', snippet: 'snip-a', publishedAt: '2025-01-02' },
      { title: 'B', url: 'https://b.test/', snippet: 'snip-b', publishedAt: '2025-02-03' },
      { title: 'C', url: 'https://c.test/', snippet: 'snip-c', publishedAt: '2025-03-04' },
    ]);

    // Raw search-results chunk is NOT forwarded to the client verbatim.
    expect(res.body).not.toContain('venice_search_results');
  });

  it('empty Venice results → no citations frame, persists null', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { chapterId } = await setupStoryAndChapter(req);
    const chat = await createChatRepo(req).create({ chapterId, title: null });
    const chatId = chat.id as string;

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(
      sseStreamResponse([
        { venice_search_results: [] },
        makeChunk('just text.', 'stop'),
      ]),
    );

    const res = await runPost(accessToken, chatId, {
      content: 'Hi.',
      modelId: BASE_MODEL_ID,
      enableWebSearch: true,
    });

    expect(res.status).toBe(200);
    expect(res.body).not.toContain('event: citations\n');

    // Assistant row persisted with null citations triple.
    const asstRow = await prisma.message.findFirst({ where: { chatId, role: 'assistant' } });
    expect(asstRow).not.toBeNull();
    expect(asstRow!.citationsJsonCiphertext).toBeNull();
    expect(asstRow!.citationsJsonIv).toBeNull();
    expect(asstRow!.citationsJsonAuthTag).toBeNull();
  });

  it('enableWebSearch omitted → no web-search params, no citations frame, null persisted', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { chapterId } = await setupStoryAndChapter(req);
    const chat = await createChatRepo(req).create({ chapterId, title: null });
    const chatId = chat.id as string;

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(sseStreamResponse([makeChunk('Plain reply.', 'stop')]));

    const res = await runPost(accessToken, chatId, {
      content: 'Hi.',
      modelId: BASE_MODEL_ID,
    });

    expect(res.status).toBe(200);
    const vreq = lastCompletionRequest(fetchSpy);
    const vp = vreq.venice_parameters as Record<string, unknown>;
    expect(vp.enable_web_search).toBeUndefined();
    expect(vp.enable_web_citations).toBeUndefined();
    expect(vp.include_search_results_in_stream).toBeUndefined();

    expect(res.body).not.toContain('event: citations\n');

    const asstRow = await prisma.message.findFirst({ where: { chatId, role: 'assistant' } });
    expect(asstRow).not.toBeNull();
    expect(asstRow!.citationsJsonCiphertext).toBeNull();
  });

  it('persisted citations round-trip via GET /api/chats/:chatId/messages', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { chapterId } = await setupStoryAndChapter(req);
    const chat = await createChatRepo(req).create({ chapterId, title: null });
    const chatId = chat.id as string;

    const expected = [
      { title: 'A', url: 'https://a.test/', snippet: 'snip-a', publishedAt: '2025-01-02' },
      { title: 'B', url: 'https://b.test/', snippet: 'snip-b', publishedAt: null },
    ];

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(
      sseStreamResponse([
        {
          venice_search_results: [
            { title: 'A', url: 'https://a.test/', content: 'snip-a', date: '2025-01-02' },
            // `date` omitted → publishedAt null.
            { title: 'B', url: 'https://b.test/', content: 'snip-b' },
          ],
        },
        makeChunk('Reply.', 'stop'),
      ]),
    );

    await runPost(accessToken, chatId, {
      content: 'Hi.',
      modelId: BASE_MODEL_ID,
      enableWebSearch: true,
    });

    const listRes = await request(app)
      .get(`/api/chats/${chatId}/messages`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(listRes.status).toBe(200);
    const messages = listRes.body.messages as Array<Record<string, unknown>>;
    const asst = messages.find((m) => m.role === 'assistant');
    expect(asst).toBeDefined();
    expect(asst!.citationsJson).toEqual(expected);

    const user = messages.find((m) => m.role === 'user');
    expect(user).toBeDefined();
    expect(user!.citationsJson).toBeNull();
  });

  it('caps citations at 10 items (extras discarded silently)', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { chapterId } = await setupStoryAndChapter(req);
    const chat = await createChatRepo(req).create({ chapterId, title: null });
    const chatId = chat.id as string;

    const input = Array.from({ length: 15 }, (_, i) => ({
      title: `T${i}`,
      url: `https://x.test/${i}`,
      content: `s${i}`,
      date: null,
    }));

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(
      sseStreamResponse([
        { venice_search_results: input },
        makeChunk('Reply.', 'stop'),
      ]),
    );

    const res = await runPost(accessToken, chatId, {
      content: 'Hi.',
      modelId: BASE_MODEL_ID,
      enableWebSearch: true,
    });
    expect(res.status).toBe(200);

    const match = res.body.match(/event: citations\ndata: (.+)\n\n/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]) as { citations: unknown[] };
    expect(parsed.citations).toHaveLength(10);
    expect((parsed.citations[0] as { title: string }).title).toBe('T0');
    expect((parsed.citations[9] as { title: string }).title).toBe('T9');

    // Persisted row round-trips 10 items via GET.
    const listRes = await request(app)
      .get(`/api/chats/${chatId}/messages`)
      .set('Authorization', `Bearer ${accessToken}`);
    const asst = (listRes.body.messages as Array<Record<string, unknown>>).find(
      (m) => m.role === 'assistant',
    );
    expect((asst!.citationsJson as unknown[]).length).toBe(10);
  });

  it('projection renames content → snippet and date → publishedAt', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { chapterId } = await setupStoryAndChapter(req);
    const chat = await createChatRepo(req).create({ chapterId, title: null });
    const chatId = chat.id as string;

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(
      sseStreamResponse([
        {
          venice_search_results: [
            { title: 'Only', url: 'https://only.test/', content: 'x', date: '2025-01-02' },
          ],
        },
        makeChunk('R.', 'stop'),
      ]),
    );

    const res = await runPost(accessToken, chatId, {
      content: 'Hi.',
      modelId: BASE_MODEL_ID,
      enableWebSearch: true,
    });

    const match = res.body.match(/event: citations\ndata: (.+)\n\n/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]) as { citations: Array<Record<string, unknown>> };
    const c = parsed.citations[0];
    expect(c.title).toBe('Only');
    expect(c.url).toBe('https://only.test/');
    expect(c.snippet).toBe('x');
    expect(c.publishedAt).toBe('2025-01-02');
    // Raw Venice keys must be gone.
    expect(c).not.toHaveProperty('content');
    expect(c).not.toHaveProperty('date');
  });

  it('drops items missing title or url', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { chapterId } = await setupStoryAndChapter(req);
    const chat = await createChatRepo(req).create({ chapterId, title: null });
    const chatId = chat.id as string;

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(
      sseStreamResponse([
        {
          venice_search_results: [
            { title: 'Keep', url: 'https://a.test/', content: 'ok', date: null },
            // Missing url:
            { title: 'Drop', content: 'nope', date: null },
            { title: 'Keep2', url: 'https://b.test/', content: 'ok', date: null },
          ],
        },
        makeChunk('R.', 'stop'),
      ]),
    );

    const res = await runPost(accessToken, chatId, {
      content: 'Hi.',
      modelId: BASE_MODEL_ID,
      enableWebSearch: true,
    });

    const match = res.body.match(/event: citations\ndata: (.+)\n\n/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]) as { citations: Array<Record<string, unknown>> };
    expect(parsed.citations).toHaveLength(2);
    expect(parsed.citations.map((c) => c.title)).toEqual(['Keep', 'Keep2']);
  });

  it('no *Ciphertext / *Iv / *AuthTag keys on GET list response', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { chapterId } = await setupStoryAndChapter(req);
    const chat = await createChatRepo(req).create({ chapterId, title: null });
    const chatId = chat.id as string;

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(
      sseStreamResponse([
        {
          venice_search_results: [
            { title: 'A', url: 'https://a.test/', content: 'ok', date: '2025-01-02' },
          ],
        },
        makeChunk('R.', 'stop'),
      ]),
    );

    await runPost(accessToken, chatId, {
      content: 'Hi.',
      modelId: BASE_MODEL_ID,
      enableWebSearch: true,
    });

    const listRes = await request(app)
      .get(`/api/chats/${chatId}/messages`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(listRes.status).toBe(200);
    const messages = listRes.body.messages as Array<Record<string, unknown>>;
    for (const m of messages) {
      for (const k of Object.keys(m)) {
        expect(k.endsWith('Ciphertext')).toBe(false);
        expect(k.endsWith('Iv')).toBe(false);
        expect(k.endsWith('AuthTag')).toBe(false);
      }
    }
  });

  it('leak sentinel does not appear in raw citationsJsonCiphertext but does in the decrypted GET', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { chapterId } = await setupStoryAndChapter(req);
    const chat = await createChatRepo(req).create({ chapterId, title: null });
    const chatId = chat.id as string;

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(
      sseStreamResponse([
        {
          venice_search_results: [
            {
              title: 'Leak title',
              url: 'https://leak.test/',
              content: `contains ${LEAK_SENTINEL} inside`,
              date: null,
            },
          ],
        },
        makeChunk('R.', 'stop'),
      ]),
    );

    await runPost(accessToken, chatId, {
      content: 'Hi.',
      modelId: BASE_MODEL_ID,
      enableWebSearch: true,
    });

    // Raw ciphertext column must not contain the sentinel.
    const raw = await prisma.message.findFirst({ where: { chatId, role: 'assistant' } });
    expect(raw).not.toBeNull();
    expect(raw!.citationsJsonCiphertext).not.toBeNull();
    expect(raw!.citationsJsonCiphertext).not.toContain(LEAK_SENTINEL);

    // Decrypted GET response must include the sentinel (end-to-end).
    const listRes = await request(app)
      .get(`/api/chats/${chatId}/messages`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(listRes.status).toBe(200);
    const serialised = JSON.stringify(listRes.body);
    expect(serialised).toContain(LEAK_SENTINEL);
  });
});
