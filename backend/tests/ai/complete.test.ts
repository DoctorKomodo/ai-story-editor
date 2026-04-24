// [V5] POST /api/ai/complete — integration tests.
// Uses supertest + globalThis.fetch stub (same pattern as models.test.ts).
// Story + chapter data is created directly via repo layer after decoding the
// session DEK from the in-process session store.

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

// ─── Constants ────────────────────────────────────────────────────────────────

const NAME = 'Complete Test User';
const USERNAME = 'ai-complete-user';
const PASSWORD = 'complete-test-password';
const VALID_KEY = 'sk-venice-complete-test-key-XYZW';

const BASE_MODEL_ID = 'llama-3.3-70b';
const BASE_CONTEXT_LENGTH = 65536;

// Minimal sentinel text used to check that plaintext chapter content never
// leaks into the SSE response or the client request body.
const CHAPTER_SENTINEL = 'UniqueS3ntinelPhrase_7x9qK';

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
    {
      id: 'qwen-qwq-32b',
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

// Minimal OpenAI-compatible SSE chunk
function makeChunk(content: string, finish: string | null = null) {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { content }, finish_reason: finish }],
  };
}

/**
 * Create a ReadableStream<Uint8Array> that yields SSE chunks, ending with
 * `data: [DONE]`. The openai SDK's streaming consumer expects this format from
 * `response.body` when `stream: true` is set.
 */
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

/**
 * Decode the access token to get userId + sessionId, retrieve the DEK from
 * the in-process session store, and return a fake Express Request that has the
 * DEK attached so repo calls can encrypt/decrypt.
 */
function makeFakeReq(accessToken: string): Request {
  const decoded = jwt.decode(accessToken) as AccessTokenPayload;
  const sessionId = decoded.sessionId!;
  const session = getSession(sessionId);
  expect(session).not.toBeNull();
  const req = { user: { id: decoded.sub, email: null } } as unknown as Request;
  attachDekToRequest(req, session!.dek);
  return req;
}

/**
 * Set up test data: story + chapter (with sentinel text in body).
 * Returns { storyId, chapterId }.
 */
async function setupStoryAndChapter(req: Request): Promise<{ storyId: string; chapterId: string }> {
  const story = await createStoryRepo(req).create({
    title: 'Test Story',
    worldNotes: 'A magical world.',
    systemPrompt: null,
  });
  const storyId = story.id as string;

  const bodyJson = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: `Chapter text. ${CHAPTER_SENTINEL}` }],
      },
    ],
  };
  const chapter = await createChapterRepo(req).create({
    storyId,
    title: 'Chapter One',
    bodyJson,
    orderIndex: 0,
    wordCount: 3,
  });
  return { storyId, chapterId: chapter.id as string };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/ai/complete [V5]', () => {
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

  it('returns 401 without a Bearer token', async () => {
    const res = await request(app)
      .post('/api/ai/complete')
      .send({ action: 'continue', selectedText: '', chapterId: 'x', storyId: 'x', modelId: 'y' });
    expect(res.status).toBe(401);
  });

  it('returns 400 on invalid body — missing required fields', async () => {
    const accessToken = await registerAndLogin();
    const res = await request(app)
      .post('/api/ai/complete')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ action: 'continue' }); // missing chapterId / storyId / modelId
    expect(res.status).toBe(400);
  });

  it('returns 400 when action is an invalid enum value', async () => {
    const accessToken = await registerAndLogin();
    const res = await request(app)
      .post('/api/ai/complete')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        action: 'teleport',
        selectedText: '',
        chapterId: 'c',
        storyId: 's',
        modelId: 'm',
      });
    expect(res.status).toBe(400);
  });

  it('returns 400 when action is freeform but freeformInstruction is missing', async () => {
    const accessToken = await registerAndLogin();
    const res = await request(app)
      .post('/api/ai/complete')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        action: 'freeform',
        selectedText: 'some text',
        chapterId: 'c',
        storyId: 's',
        modelId: 'm',
        // freeformInstruction intentionally absent
      });
    expect(res.status).toBe(400);
  });

  it('returns 409 venice_key_required when user has no BYOK key', async () => {
    const accessToken = await registerAndLogin();
    const _req = makeFakeReq(accessToken);

    // Prime the models cache manually with a stub so we hit the "no BYOK key"
    // path from getVeniceClient, not from fetchModels. But the handler calls
    // fetchModels first — so we need to let the 409 come from that call.
    // Since there's no key, getVeniceClient inside fetchModels will throw.

    const res = await request(app)
      .post('/api/ai/complete')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        action: 'continue',
        selectedText: '',
        chapterId: 'some-chapter',
        storyId: 'some-story',
        modelId: BASE_MODEL_ID,
      });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('venice_key_required');
  });

  it('returns 404 when chapter storyId does not match body storyId', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);

    // Create a second story; the chapter belongs to the first story.
    const story1 = await createStoryRepo(req).create({ title: 'Story 1' });
    const story2 = await createStoryRepo(req).create({ title: 'Story 2' });
    const chapter = await createChapterRepo(req).create({
      storyId: story1.id as string,
      title: 'Ch',
      orderIndex: 0,
    });

    // Mock the models call so the handler gets past fetchModels
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));

    const res = await request(app)
      .post('/api/ai/complete')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        action: 'continue',
        selectedText: '',
        chapterId: chapter.id as string,
        storyId: story2.id as string, // wrong story
        modelId: BASE_MODEL_ID,
      });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('returns 404 when story is not owned by the caller', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));

    const res = await request(app)
      .post('/api/ai/complete')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        action: 'continue',
        selectedText: '',
        chapterId: 'nonexistent-chapter',
        storyId: 'nonexistent-story',
        modelId: BASE_MODEL_ID,
      });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('streams SSE with at least one data chunk and a [DONE] terminator', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { storyId, chapterId } = await setupStoryAndChapter(req);

    // Mock: models list + Venice completion stream
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(
      sseStreamResponse([makeChunk('Hello'), makeChunk(' world', 'stop')]),
    );

    const res = await request(app)
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
      .send({ action: 'continue', selectedText: '', chapterId, storyId, modelId: BASE_MODEL_ID });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    const body = res.body as string;
    // Assert that the actual chunk content flows through — not just any SSE frame.
    expect(body).toContain('"Hello"');
    expect(body).toContain('" world"');
    expect(body).toContain('data: [DONE]');
  });

  it('Venice is called with the per-user decrypted key in Authorization header', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { storyId, chapterId } = await setupStoryAndChapter(req);

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(sseStreamResponse([makeChunk('Hi', 'stop')]));

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
      .send({ action: 'continue', selectedText: '', chapterId, storyId, modelId: BASE_MODEL_ID });

    // Find the Venice chat completion call (not the models or venice-key validation calls)
    const completionCall = fetchSpy.mock.calls.find(([url]) =>
      String(url).includes('/chat/completions'),
    );
    expect(completionCall).toBeTruthy();
    const [, init] = completionCall!;
    const auth =
      (init?.headers as Record<string, string> | undefined)?.Authorization ??
      (init?.headers as Record<string, string> | undefined)?.authorization;
    expect(auth).toBe(`Bearer ${VALID_KEY}`);
  });

  it('Venice request carries the prompt builder messages and max_completion_tokens', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { storyId, chapterId } = await setupStoryAndChapter(req);

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
      .send({ action: 'continue', selectedText: '', chapterId, storyId, modelId: BASE_MODEL_ID });

    const completionCall = fetchSpy.mock.calls.find(([url]) =>
      String(url).includes('/chat/completions'),
    );
    expect(completionCall).toBeTruthy();
    const [, init] = completionCall!;
    const requestBody = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
    expect(Array.isArray(requestBody.messages)).toBe(true);
    expect((requestBody.messages as unknown[]).length).toBeGreaterThan(0);
    expect(typeof requestBody.max_completion_tokens).toBe('number');
    expect(requestBody.stream).toBe(true);
  });

  it('reads includeVeniceSystemPrompt from settingsJson.ai when set to false', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { storyId, chapterId } = await setupStoryAndChapter(req);

    // Update user's settingsJson to set includeVeniceSystemPrompt: false
    const decoded = jwt.decode(accessToken) as AccessTokenPayload;
    await prisma.user.update({
      where: { id: decoded.sub },
      data: { settingsJson: { ai: { includeVeniceSystemPrompt: false } } },
    });

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
      .send({ action: 'continue', selectedText: '', chapterId, storyId, modelId: BASE_MODEL_ID });

    const completionCall = fetchSpy.mock.calls.find(([url]) =>
      String(url).includes('/chat/completions'),
    );
    expect(completionCall).toBeTruthy();
    const [, init] = completionCall!;
    const requestBody = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
    const vp = requestBody.venice_parameters as Record<string, unknown>;
    expect(vp.include_venice_system_prompt).toBe(false);
  });

  it('defaults includeVeniceSystemPrompt to true when settingsJson is null', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { storyId, chapterId } = await setupStoryAndChapter(req);

    // Ensure settingsJson is null
    const decoded = jwt.decode(accessToken) as AccessTokenPayload;
    await prisma.user.update({
      where: { id: decoded.sub },
      data: { settingsJson: null },
    });

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
      .send({ action: 'continue', selectedText: '', chapterId, storyId, modelId: BASE_MODEL_ID });

    const completionCall = fetchSpy.mock.calls.find(([url]) =>
      String(url).includes('/chat/completions'),
    );
    expect(completionCall).toBeTruthy();
    const [, init] = completionCall!;
    const requestBody = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
    const vp = requestBody.venice_parameters as Record<string, unknown>;
    expect(vp.include_venice_system_prompt).toBe(true);
  });

  it('plaintext chapter body never appears in the SSE response', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { storyId, chapterId } = await setupStoryAndChapter(req);

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(sseStreamResponse([makeChunk('Completion text', 'stop')]));

    const res = await request(app)
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
      .send({ action: 'continue', selectedText: '', chapterId, storyId, modelId: BASE_MODEL_ID });

    // The SSE wire response must not contain the sentinel chapter text.
    expect(res.body as string).not.toContain(CHAPTER_SENTINEL);
  });
});
