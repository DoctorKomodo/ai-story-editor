// [V16] Ask-AI attachment payload integration tests.
//
// Covers:
//   - POST /api/chats/:chatId/messages with attachment: { selectionText, chapterId }
//   - attachmentJson persisted (decrypted via repo = { selectionText, chapterId })
//   - Venice user message content contains "Attached selection: «...»"
//   - 400 when attachment.chapterId != chat's chapter (attachment_chapter_mismatch)
//   - Attachment ciphertext: sentinel in selectionText must not appear raw
//   - Attachment-less path still works (re-assertion from V15)

import type { Request } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/index';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createChatRepo } from '../../src/repos/chat.repo';
import { createMessageRepo } from '../../src/repos/message.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { attachDekToRequest } from '../../src/services/content-crypto.service';
import { _resetSessionStore, getSession } from '../../src/services/session-store';
import { veniceModelsService } from '../../src/services/venice.models.service';
import { prisma } from '../setup';

// ─── Constants ────────────────────────────────────────────────────────────────

const NAME = 'Attachment Test User';
const USERNAME = 'attachment-test-user';
const PASSWORD = 'attachment-test-password';
const VALID_KEY = 'sk-venice-attachment-test-key-WXYZ';

const BASE_MODEL_ID = 'llama-3.3-70b';
const BASE_CONTEXT_LENGTH = 65536;

const ATTACHMENT_SENTINEL = 'UniqueAttach5entinel_4z8wQ';

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

async function setupStoryChapterAndChat(req: Request): Promise<{
  storyId: string;
  chapterId: string;
  chatId: string;
}> {
  const story = await createStoryRepo(req).create({ title: 'Attachment Story' });
  const storyId = story.id as string;
  const chapter = await createChapterRepo(req).create({
    storyId,
    title: 'Chapter One',
    bodyJson: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Chapter body text.' }] }],
    },
    orderIndex: 0,
    wordCount: 3,
  });
  const chapterId = chapter.id as string;
  const chat = await createChatRepo(req).create({ chapterId, title: null });
  const chatId = chat.id as string;
  return { storyId, chapterId, chatId };
}

// Helper to SSE-stream a message via supertest.
async function sendMessage(
  agent: ReturnType<typeof request.agent>,
  chatId: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const res = await agent
    .post(`/api/chats/${chatId}/messages`)
    .set('Origin', 'http://localhost:3000')
    .buffer(true)
    .parse((response, callback) => {
      let data = '';
      response.on('data', (chunk: Buffer) => {
        data += chunk.toString();
      });
      response.on('end', () => callback(null, data));
    })
    .send(payload);
  return res.body as string;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Ask-AI attachment payload [V16]', () => {
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

  it('persists attachmentJson and Venice content includes attached selection label', async () => {
    const { agent, sessionId } = await registerAndLogin();
    await storeKey(agent, fetchSpy);
    const req = makeFakeReq(sessionId);
    const { chapterId, chatId } = await setupStoryChapterAndChat(req);

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(sseStreamResponse([makeChunk('Good question!', 'stop')]));

    await sendMessage(agent, chatId, {
      content: 'What is the significance of this?',
      modelId: BASE_MODEL_ID,
      attachment: { selectionText: 'The tall oak tree', chapterId },
    });

    // Assert user message row has attachmentJson.
    // Use the repo (repo layer — decrypts on read).
    const fakeReq = makeFakeReq(sessionId);

    const messages = await createMessageRepo(fakeReq).findManyForChat(chatId);
    const userMsg = messages.find((m) => m.role === 'user');
    expect(userMsg).toBeDefined();
    const attachment = userMsg!.attachmentJson as { selectionText: string; chapterId: string };
    expect(attachment).not.toBeNull();
    expect(attachment.selectionText).toBe('The tall oak tree');
    expect(attachment.chapterId).toBe(chapterId);

    // Venice request's user message must contain the attachment label.
    const completionCall = fetchSpy.mock.calls.find(([url]) =>
      String(url).includes('/chat/completions'),
    );
    expect(completionCall).toBeTruthy();
    const [, init] = completionCall!;
    const requestBody = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
    const sentMessages = requestBody.messages as Array<{ role: string; content: string }>;
    // The last user message (synthesised by prompt builder) should include the attachment text.
    const lastUserMsg = [...sentMessages].reverse().find((m) => m.role === 'user');
    expect(lastUserMsg).toBeDefined();
    expect(lastUserMsg!.content).toContain('The tall oak tree');
    expect(lastUserMsg!.content).toContain('Attached selection');
  });

  it('returns 400 with attachment_chapter_mismatch when chapterId does not match', async () => {
    const { agent, sessionId } = await registerAndLogin();
    await storeKey(agent, fetchSpy);
    const req = makeFakeReq(sessionId);
    const { storyId, chatId } = await setupStoryChapterAndChat(req);

    // Create a second chapter in the same story.
    const chapter2 = await createChapterRepo(req).create({
      storyId,
      title: 'Chapter Two',
      orderIndex: 1,
    });
    const wrongChapterId = chapter2.id as string;

    // Prime models list (handler checks chat first, before models, so won't get that far).
    // Actually, the mismatch check happens BEFORE models cache priming — so no need.

    const res = await agent
      .post(`/api/chats/${chatId}/messages`)
      .set('Origin', 'http://localhost:3000')
      .send({
        content: 'What is this?',
        modelId: BASE_MODEL_ID,
        attachment: { selectionText: 'Some text', chapterId: wrongChapterId },
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('attachment_chapter_mismatch');
  });

  it('attachment ciphertext: sentinel in selectionText does not appear in raw attachmentJsonCiphertext', async () => {
    const { agent, sessionId } = await registerAndLogin();
    await storeKey(agent, fetchSpy);
    const req = makeFakeReq(sessionId);
    const { chapterId, chatId } = await setupStoryChapterAndChat(req);

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(sseStreamResponse([makeChunk('Reply.', 'stop')]));

    await sendMessage(agent, chatId, {
      content: 'Question.',
      modelId: BASE_MODEL_ID,
      attachment: { selectionText: ATTACHMENT_SENTINEL, chapterId },
    });

    const rawMsg = await prisma.message.findFirst({
      where: { chatId, role: 'user' },
    });
    expect(rawMsg).not.toBeNull();
    expect(rawMsg!.attachmentJsonCiphertext).not.toBeNull();
    expect(rawMsg!.attachmentJsonCiphertext).not.toContain(ATTACHMENT_SENTINEL);
  });

  it('multi-turn: prior user turn WITH attachment is re-synthesised in history (round-trip)', async () => {
    const { agent, sessionId } = await registerAndLogin();
    await storeKey(agent, fetchSpy);
    const req = makeFakeReq(sessionId);
    const { chapterId, chatId } = await setupStoryChapterAndChat(req);

    // ── Turn 1: user sends a message WITH an attachment ──────────────────────
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(sseStreamResponse([makeChunk('Turn-one reply.', 'stop')]));

    await sendMessage(agent, chatId, {
      content: 'What is the significance of this passage?',
      modelId: BASE_MODEL_ID,
      attachment: { selectionText: 'The knight removed his helmet.', chapterId },
    });

    // ── Turn 2: user sends WITHOUT attachment ────────────────────────────────
    // The models list is already cached, so only one Venice call needed here.
    fetchSpy.mockResolvedValueOnce(sseStreamResponse([makeChunk('Turn-two reply.', 'stop')]));

    await sendMessage(agent, chatId, {
      content: 'Can you elaborate on that?',
      modelId: BASE_MODEL_ID,
    });

    // ── Assert the second Venice completions call ────────────────────────────
    const completionCalls = fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes('/chat/completions'),
    );
    // Two turns → two completions calls.
    expect(completionCalls.length).toBeGreaterThanOrEqual(2);

    const secondCall = completionCalls[1]!;
    const [, init] = secondCall;
    const requestBody = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
    const sentMessages = requestBody.messages as Array<{ role: string; content: string }>;

    // The prior user turn (turn 1) should have its attachment text in the
    // reconstructed history content — proving the round-trip is intact.
    const priorUserTurn = sentMessages.find(
      (m) => m.role === 'user' && m.content.includes('What is the significance of this passage?'),
    );
    expect(priorUserTurn).toBeDefined();
    expect(priorUserTurn!.content).toContain('The knight removed his helmet.');
    expect(priorUserTurn!.content).toContain('Attached selection');
  });

  it('attachment-less path still works (no attachmentJson on user message)', async () => {
    const { agent, sessionId } = await registerAndLogin();
    await storeKey(agent, fetchSpy);
    const req = makeFakeReq(sessionId);
    const { chatId } = await setupStoryChapterAndChat(req);

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(
      sseStreamResponse([makeChunk('Reply without attachment.', 'stop')]),
    );

    const body = await sendMessage(agent, chatId, {
      content: 'Plain question, no attachment.',
      modelId: BASE_MODEL_ID,
    });

    expect(body).toContain('data: [DONE]');

    // attachmentJson should be null on the user message.
    const fakeReq = makeFakeReq(sessionId);

    const messages = await createMessageRepo(fakeReq).findManyForChat(chatId);
    const userMsg = messages.find((m) => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(userMsg!.attachmentJson).toBeNull();
  });
});
