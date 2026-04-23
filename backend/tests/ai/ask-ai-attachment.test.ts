// [V16] Ask-AI attachment payload integration tests.
//
// Covers:
//   - POST /api/chats/:chatId/messages with attachment: { selectionText, chapterId }
//   - attachmentJson persisted (decrypted via repo = { selectionText, chapterId })
//   - Venice user message content contains "Attached selection: «...»"
//   - 400 when attachment.chapterId != chat's chapter (attachment_chapter_mismatch)
//   - Attachment ciphertext: sentinel in selectionText must not appear raw
//   - Attachment-less path still works (re-assertion from V15)

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
import { createChatRepo } from '../../src/repos/chat.repo';
import { createMessageRepo } from '../../src/repos/message.repo';
import type { AccessTokenPayload } from '../../src/services/auth.service';
import type { Request } from 'express';
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
  accessToken: string,
  chatId: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const res = await request(app)
    .post(`/api/chats/${chatId}/messages`)
    .set('Authorization', `Bearer ${accessToken}`)
    .buffer(true)
    .parse((response, callback) => {
      let data = '';
      response.on('data', (chunk: Buffer) => { data += chunk.toString(); });
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

  it('persists attachmentJson and Venice content includes attached selection label', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { chapterId, chatId } = await setupStoryChapterAndChat(req);

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(
      sseStreamResponse([makeChunk('Good question!', 'stop')]),
    );

    await sendMessage(accessToken, chatId, {
      content: 'What is the significance of this?',
      modelId: BASE_MODEL_ID,
      attachment: { selectionText: 'The tall oak tree', chapterId },
    });

    // Assert user message row has attachmentJson.
    // Use the repo (repo layer — decrypts on read).
    const decoded = jwt.decode(accessToken) as AccessTokenPayload;
    const sessionId = decoded.sessionId!;
    const session = getSession(sessionId);
    const fakeReq = { user: { id: decoded.sub, email: null } } as unknown as Request;
    attachDekToRequest(fakeReq, session!.dek);

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
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { storyId, chapterId, chatId } = await setupStoryChapterAndChat(req);

    // Create a second chapter in the same story.
    const chapter2 = await createChapterRepo(req).create({
      storyId,
      title: 'Chapter Two',
      orderIndex: 1,
    });
    const wrongChapterId = chapter2.id as string;

    // Prime models list (handler checks chat first, before models, so won't get that far).
    // Actually, the mismatch check happens BEFORE models cache priming — so no need.

    const res = await request(app)
      .post(`/api/chats/${chatId}/messages`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        content: 'What is this?',
        modelId: BASE_MODEL_ID,
        attachment: { selectionText: 'Some text', chapterId: wrongChapterId },
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('attachment_chapter_mismatch');
  });

  it('attachment ciphertext: sentinel in selectionText does not appear in raw attachmentJsonCiphertext', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { chapterId, chatId } = await setupStoryChapterAndChat(req);

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(
      sseStreamResponse([makeChunk('Reply.', 'stop')]),
    );

    await sendMessage(accessToken, chatId, {
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

  it('attachment-less path still works (no attachmentJson on user message)', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { chatId } = await setupStoryChapterAndChat(req);

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(
      sseStreamResponse([makeChunk('Reply without attachment.', 'stop')]),
    );

    const body = await sendMessage(accessToken, chatId, {
      content: 'Plain question, no attachment.',
      modelId: BASE_MODEL_ID,
    });

    expect(body).toContain('data: [DONE]');

    // attachmentJson should be null on the user message.
    const decoded = jwt.decode(accessToken) as AccessTokenPayload;
    const sessionId = decoded.sessionId!;
    const session = getSession(sessionId);
    const fakeReq = { user: { id: decoded.sub, email: null } } as unknown as Request;
    attachDekToRequest(fakeReq, session!.dek);

    const messages = await createMessageRepo(fakeReq).findManyForChat(chatId);
    const userMsg = messages.find((m) => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(userMsg!.attachmentJson).toBeNull();
  });
});
