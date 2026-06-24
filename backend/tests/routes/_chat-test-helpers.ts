// Shared Venice-fetch + auth helpers for chat route integration tests.

import type { Request } from 'express';
import request from 'supertest';
import { expect, vi } from 'vitest';
import { app } from '../../src/index';
import { sessionCookieName } from '../../src/lib/session-cookie';
import { attachDekToRequest } from '../../src/services/content-crypto.service';
import { _resetSessionStore, getSession } from '../../src/services/session-store';
import { prisma } from '../setup';

// ─── Auth helpers ─────────────────────────────────────────────────────────────

export const TEST_ORIGIN = 'http://localhost:3000';

export interface TestSession {
  agent: ReturnType<typeof request.agent>;
  sessionId: string;
}

function extractSessionId(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const name = sessionCookieName();
  const cookie = (raw ?? []).find((c) => c.startsWith(`${name}=`));
  expect(cookie).toBeDefined();
  return decodeURIComponent(cookie!.split(';')[0].split('=')[1]);
}

export async function registerAndLogin(
  username: string,
  password = 'chat-route-pw',
  name = 'Chat Route User',
): Promise<TestSession> {
  const agent = request.agent(app);
  await agent
    .post('/api/auth/register')
    .set('Origin', TEST_ORIGIN)
    .send({ name, username, password });
  const login = await agent
    .post('/api/auth/login')
    .set('Origin', TEST_ORIGIN)
    .send({ username, password });
  expect(login.status).toBe(200);
  return { agent, sessionId: extractSessionId(login) };
}

export function makeFakeReq(sessionId: string): Request {
  const session = getSession(sessionId);
  expect(session).not.toBeNull();
  const req = { user: { id: session!.userId, sessionId } } as unknown as Request;
  attachDekToRequest(req, session!.dek);
  return req;
}

// ─── DB teardown ──────────────────────────────────────────────────────────────

export async function resetAll(): Promise<void> {
  _resetSessionStore();
  await prisma.message.deleteMany();
  await prisma.chat.deleteMany();
  await prisma.outlineItem.deleteMany();
  await prisma.character.deleteMany();
  await prisma.chapter.deleteMany();
  await prisma.story.deleteMany();
  await prisma.user.deleteMany();
}

// ─── Venice fetch fixtures ────────────────────────────────────────────────────

export const MODEL_ID = 'venice-test-model';

export const MODEL_LIST_BODY = {
  object: 'list',
  data: [
    {
      id: MODEL_ID,
      object: 'model',
      type: 'text',
      model_spec: {
        name: 'Venice Test Model',
        availableContextTokens: 65536,
        maxCompletionTokens: 4096,
        capabilities: {
          supportsReasoning: false,
          supportsVision: false,
          supportsResponseSchema: true,
        },
      },
    },
  ],
};

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : 'err',
    headers: { 'content-type': 'application/json' },
  });
}

export function sseStreamResponse(chunks: Array<Record<string, unknown>>): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(c)}\n\n`));
      }
      controller.enqueue(enc.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

// Installs a fresh fetch spy on globalThis. Must be paired with
// vi.unstubAllGlobals() in afterEach.
export function stubVeniceFetch(): ReturnType<typeof vi.fn> {
  const fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  return fetchSpy;
}

// Stores a BYOK Venice key for the authenticated user (validate call → 200).
export async function storeKey(
  agent: ReturnType<typeof request.agent>,
  fetchSpy: ReturnType<typeof vi.fn>,
): Promise<void> {
  fetchSpy.mockResolvedValueOnce(jsonResponse(200, { data: [] }));
  const keyRes = await agent
    .put('/api/users/me/venice-key')
    .set('Origin', TEST_ORIGIN)
    .send({ apiKey: 'sk-venice-sc5-test-key-ABCD' });
  expect(keyRes.status).toBe(200);
}

// Queues a fresh SSE response on the fetch spy (models list cache miss + stream).
export function queueSseResponse(fetchSpy: ReturnType<typeof vi.fn>, content: string): void {
  fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
  fetchSpy.mockResolvedValueOnce(
    sseStreamResponse([
      {
        id: 'chatcmpl-retry',
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { content }, finish_reason: null }],
      },
    ]),
  );
}
