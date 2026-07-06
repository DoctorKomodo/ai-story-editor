// [SC4] Integration tests for POST /api/drafts/:draftId/chats (kind field)
// and GET /api/drafts/:draftId/chats (kind filter).
// [9wk.4] Chats are draft-scoped — re-mounted under /api/drafts/:draftId/chats.
// [SC5] Integration test for POST /api/chats/:chatId/messages kind=scene routing.

import type request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createDraftRepo } from '../../src/repos/draft.repo';
import { createMessageRepo } from '../../src/repos/message.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { _resetSessionStore } from '../../src/services/session-store';
import { veniceModelsService } from '../../src/services/venice.models.service';
import { registerAndLogin, TEST_ORIGIN } from '../helpers/auth';
import { resetDb } from '../helpers/db';
import {
  jsonResponse,
  MODEL_ID,
  MODEL_LIST_BODY,
  makeFakeReq,
  queueSseResponse,
  sseStreamResponse,
  storeKey,
  stubVeniceFetch,
} from './_chat-test-helpers';

// Returns a supertest agent (with session cookie set), a chapterId + its
// active draftId, and the sessionId (for constructing repo instances in
// tests that need them).
async function setup(username: string): Promise<{
  agent: ReturnType<typeof request.agent>;
  chapterId: string;
  draftId: string;
  sessionId: string;
}> {
  const { agent, sessionId } = await registerAndLogin({ username });
  const req = makeFakeReq(sessionId);

  const story = await createStoryRepo(req).create({ title: 'T', worldNotes: null });
  const storyId = story.id as string;
  const chapter = await createChapterRepo(req).create({
    storyId,
    title: 'Ch',
    bodyJson: null,
    orderIndex: 0,
    wordCount: 0,
  });
  const chapterId = chapter.id as string;
  const draftId = chapter.activeDraftId as string;

  return { agent, chapterId, draftId, sessionId };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('POST /api/drafts/:draftId/chats — kind', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetDb();
  });

  afterEach(async () => {
    _resetSessionStore();
    await resetDb();
  });

  it('creates a scene-kind chat when kind="scene" is provided', async () => {
    const { agent, draftId } = await setup('chat-kind-scene-u1');
    const res = await agent
      .post(`/api/drafts/${draftId}/chats`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 's1', kind: 'scene' })
      .expect(201);
    expect(res.body.chat.kind).toBe('scene');
    expect(res.body.chat).not.toHaveProperty('messageCount');
    expect(typeof res.body.chat.createdAt).toBe('string');
    expect(typeof res.body.chat.updatedAt).toBe('string');
    expect(typeof res.body.chat.lastActivityAt).toBe('string');
  });

  it('defaults to kind="ask" when omitted', async () => {
    const { agent, draftId } = await setup('chat-kind-ask-u2');
    const res = await agent
      .post(`/api/drafts/${draftId}/chats`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'a1' })
      .expect(201);
    expect(res.body.chat.kind).toBe('ask');
    expect(res.body.chat).not.toHaveProperty('messageCount');
    expect(typeof res.body.chat.createdAt).toBe('string');
    expect(typeof res.body.chat.updatedAt).toBe('string');
    expect(typeof res.body.chat.lastActivityAt).toBe('string');
  });

  it('rejects unknown kind values', async () => {
    const { agent, draftId } = await setup('chat-kind-bogus-u3');
    await agent
      .post(`/api/drafts/${draftId}/chats`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'x', kind: 'bogus' })
      .expect(400);
  });
});

describe('GET /api/drafts/:draftId/chats — kind filter', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetDb();
  });

  afterEach(async () => {
    _resetSessionStore();
    await resetDb();
  });

  it('returns only kind=scene rows when ?kind=scene', async () => {
    const { agent, draftId } = await setup('chat-filter-scene-u4');
    await agent
      .post(`/api/drafts/${draftId}/chats`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'a', kind: 'ask' });
    await agent
      .post(`/api/drafts/${draftId}/chats`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 's', kind: 'scene' });

    const res = await agent
      .get(`/api/drafts/${draftId}/chats`)
      .query({ kind: 'scene' })
      .expect(200);
    expect(res.body.chats).toHaveLength(1);
    expect(res.body.chats[0].kind).toBe('scene');
    expect(typeof res.body.chats[0].messageCount).toBe('number');
    expect(typeof res.body.chats[0].createdAt).toBe('string');
    expect(typeof res.body.chats[0].updatedAt).toBe('string');
    expect(typeof res.body.chats[0].lastActivityAt).toBe('string');
  });

  // [D1] ?kind=ask filter
  it('returns only kind=ask rows when ?kind=ask', async () => {
    const { agent, draftId } = await setup('chat-filter-ask-u6');
    await agent
      .post(`/api/drafts/${draftId}/chats`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'a', kind: 'ask' });
    await agent
      .post(`/api/drafts/${draftId}/chats`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 's', kind: 'scene' });

    const res = await agent.get(`/api/drafts/${draftId}/chats`).query({ kind: 'ask' }).expect(200);
    expect(res.body.chats).toHaveLength(1);
    expect(res.body.chats[0].kind).toBe('ask');
    expect(typeof res.body.chats[0].messageCount).toBe('number');
    expect(typeof res.body.chats[0].createdAt).toBe('string');
    expect(typeof res.body.chats[0].updatedAt).toBe('string');
    expect(typeof res.body.chats[0].lastActivityAt).toBe('string');
  });

  // [D1] ?kind=bogus → 400
  it('returns 400 when ?kind is an unknown value', async () => {
    const { agent, draftId } = await setup('chat-filter-bogus-u7');
    await agent.get(`/api/drafts/${draftId}/chats`).query({ kind: 'bogus' }).expect(400);
  });

  it('returns both kinds when ?kind is omitted', async () => {
    const { agent, draftId } = await setup('chat-filter-all-u5');
    await agent
      .post(`/api/drafts/${draftId}/chats`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'a', kind: 'ask' });
    await agent
      .post(`/api/drafts/${draftId}/chats`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 's', kind: 'scene' });

    const res = await agent.get(`/api/drafts/${draftId}/chats`).expect(200);
    expect(res.body.chats).toHaveLength(2);
    // [D1] Assert both kinds are present
    const kinds = res.body.chats.map((c: { kind: string }) => c.kind).sort();
    expect(kinds).toEqual(['ask', 'scene']);
    // All entries carry messageCount and ISO date strings.
    for (const chat of res.body.chats as Array<Record<string, unknown>>) {
      expect(typeof chat.messageCount).toBe('number');
      expect(typeof chat.createdAt).toBe('string');
      expect(typeof chat.updatedAt).toBe('string');
      expect(typeof chat.lastActivityAt).toBe('string');
    }
  });

  // [loj] Each chat in the response must carry a lastActivityAt string field so
  // the SessionPicker "X ago" label has its recency source.
  it('response chats each carry a lastActivityAt string field', async () => {
    const { agent, draftId } = await setup('chat-lastactivity-u8');
    await agent
      .post(`/api/drafts/${draftId}/chats`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'a', kind: 'ask' });

    const res = await agent.get(`/api/drafts/${draftId}/chats`).expect(200);
    expect(res.body.chats).toHaveLength(1);
    expect(typeof res.body.chats[0].lastActivityAt).toBe('string');
    expect(res.body.chats[0].lastActivityAt).not.toBe('');
    expect(typeof res.body.chats[0].messageCount).toBe('number');
  });
});

// ─── SC6 suite ────────────────────────────────────────────────────────────────

// Fire a POST /messages call and drain the SSE stream (so the assistant message is persisted).
async function sendMessage(
  agent: ReturnType<typeof request.agent>,
  chatId: string,
  body: Record<string, unknown>,
): Promise<number> {
  const res = await agent
    .post(`/api/chats/${chatId}/messages`)
    .set('Origin', TEST_ORIGIN)
    .buffer(true)
    .parse((response, callback) => {
      let data = '';
      response.on('data', (chunk: Buffer) => {
        data += chunk.toString();
      });
      response.on('end', () => callback(null, data));
    })
    .send(body);
  return res.status as number;
}

describe('POST /api/chats/:chatId/messages — retry flag', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetDb();
    veniceModelsService.resetCache();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    _resetSessionStore();
    await resetDb();
  });

  it('does not persist a new user message on retry=true; prior assistant is replaced with new content', async () => {
    const { agent, draftId } = await setup('sc6-retry-u1');
    const fetchSpy = stubVeniceFetch();
    await storeKey(agent, fetchSpy);

    const created = await agent
      .post(`/api/drafts/${draftId}/chats`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 's', kind: 'scene' });
    const chatId = created.body.chat.id as string;

    // First turn — normal generate. Models cache miss + stream.
    queueSseResponse(fetchSpy, 'First assistant reply.');
    const firstStatus = await sendMessage(agent, chatId, {
      content: 'Direction A',
      modelId: MODEL_ID,
    });
    expect(firstStatus).toBe(200);

    // Read messages: should be 1 user + 1 assistant.
    const before = await agent.get(`/api/chats/${chatId}/messages`).expect(200);
    expect(before.body.messages.filter((m: { role: string }) => m.role === 'user')).toHaveLength(1);
    expect(
      before.body.messages.filter((m: { role: string }) => m.role === 'assistant'),
    ).toHaveLength(1);

    // Retry — must NOT add a user message. Models cache is warm so only stream mock needed.
    fetchSpy.mockResolvedValueOnce(
      sseStreamResponse([
        {
          id: 'chatcmpl-retry2',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { content: 'Retry reply.' }, finish_reason: null }],
        },
      ]),
    );
    const retryStatus = await sendMessage(agent, chatId, {
      retry: true,
      modelId: MODEL_ID,
    });
    expect(retryStatus).toBe(200);

    const after = await agent.get(`/api/chats/${chatId}/messages`).expect(200);
    expect(after.body.messages.filter((m: { role: string }) => m.role === 'user')).toHaveLength(1);
    // Linear retry: old assistant is replaced; exactly one assistant survives with the new content.
    const assistants = after.body.messages.filter((m: { role: string }) => m.role === 'assistant');
    expect(assistants).toHaveLength(1);
    expect(assistants[0].content).toBe('Retry reply.');
  });

  it('400 when retry=true and the trailing message is not a user turn', async () => {
    const { agent, draftId } = await setup('sc6-retry-u2');
    const fetchSpy = stubVeniceFetch();
    await storeKey(agent, fetchSpy);

    const created = await agent
      .post(`/api/drafts/${draftId}/chats`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 's', kind: 'scene' });
    const chatId = created.body.chat.id as string;

    // No prior messages — retry has nothing to base on.
    await agent
      .post(`/api/chats/${chatId}/messages`)
      .set('Origin', TEST_ORIGIN)
      .send({ retry: true, modelId: MODEL_ID })
      .expect(400);
  });

  it('does not require content when retry=true', async () => {
    const { agent, draftId } = await setup('sc6-retry-u3');
    const fetchSpy = stubVeniceFetch();
    await storeKey(agent, fetchSpy);

    const created = await agent
      .post(`/api/drafts/${draftId}/chats`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 's', kind: 'scene' });
    const chatId = created.body.chat.id as string;

    // Prime with a normal turn first.
    queueSseResponse(fetchSpy, 'First reply.');
    await sendMessage(agent, chatId, { content: 'd', modelId: MODEL_ID });

    // Retry with no content — models cache warm, only stream mock needed.
    fetchSpy.mockResolvedValueOnce(
      sseStreamResponse([
        {
          id: 'chatcmpl-retry3',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { content: 'No-content retry.' }, finish_reason: null }],
        },
      ]),
    );
    const retryStatus = await sendMessage(agent, chatId, {
      retry: true,
      modelId: MODEL_ID,
    });
    expect(retryStatus).toBe(200);
  });

  it('400 when retry=true and content is also supplied', async () => {
    const { agent, draftId } = await setup('sc6-retry-u4');
    const fetchSpy = stubVeniceFetch();
    await storeKey(agent, fetchSpy);
    const created = await agent
      .post(`/api/drafts/${draftId}/chats`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 's', kind: 'scene' });
    const chatId = created.body.chat.id as string;
    await agent
      .post(`/api/chats/${chatId}/messages`)
      .set('Origin', TEST_ORIGIN)
      .send({ retry: true, content: 'extra', modelId: MODEL_ID })
      .expect(400);
  });

  // [ai-surfaces-v1] Case C: retry deletes prior trailing assistant before regenerating.
  it('on retry, deletes prior trailing assistant before regenerating (case C — linear retry)', async () => {
    const { agent, draftId } = await setup('sc6-retry-caseC');
    const fetchSpy = stubVeniceFetch();
    await storeKey(agent, fetchSpy);

    const created = await agent
      .post(`/api/drafts/${draftId}/chats`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'case-c', kind: 'ask' });
    const chatId = created.body.chat.id as string;

    // First normal turn: user message + assistant reply.
    queueSseResponse(fetchSpy, 'first reply');
    await sendMessage(agent, chatId, { content: 'hello', modelId: MODEL_ID });

    // Verify starting state: 1 user + 1 assistant.
    const before = await agent.get(`/api/chats/${chatId}/messages`).expect(200);
    expect(before.body.messages.filter((m: { role: string }) => m.role === 'user')).toHaveLength(1);
    expect(
      before.body.messages.filter((m: { role: string }) => m.role === 'assistant'),
    ).toHaveLength(1);

    // Retry: old assistant should be deleted, new one created. Models cache warm.
    fetchSpy.mockResolvedValueOnce(
      sseStreamResponse([
        {
          id: 'chatcmpl-caseC',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { content: 'second reply' }, finish_reason: null }],
        },
      ]),
    );
    const retryStatus = await sendMessage(agent, chatId, { retry: true, modelId: MODEL_ID });
    expect(retryStatus).toBe(200);

    const after = await agent.get(`/api/chats/${chatId}/messages`).expect(200);
    const assistants = after.body.messages.filter((m: { role: string }) => m.role === 'assistant');
    // Exactly one assistant — the old one was deleted before the new one was created.
    expect(assistants).toHaveLength(1);
    // The surviving assistant carries the new reply content.
    expect(assistants[0].content).toBe('second reply');
  });

  it('[9ph] retry on ask preserves chapter context (regression)', async () => {
    const { agent, sessionId, draftId } = await setup('k1r-9ph-regression');
    const fetchSpy = stubVeniceFetch();
    await storeKey(agent, fetchSpy);

    // Chapter must have content for the test to be meaningful.
    const req = makeFakeReq(sessionId);
    await createDraftRepo(req).update(draftId, {
      bodyJson: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'The dragon circled the keep before landing on the courtyard.',
              },
            ],
          },
        ],
      },
      wordCount: 11,
    });

    const created = await agent
      .post(`/api/drafts/${draftId}/chats`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'q', kind: 'ask' });
    const chatId = created.body.chat.id as string;

    // First turn — establishes a user message + assistant reply.
    queueSseResponse(fetchSpy, 'A circling sky-snake is bad news.');
    await sendMessage(agent, chatId, {
      content: 'What is the dragon doing?',
      modelId: MODEL_ID,
    });

    // Retry — models cache warm; only the stream mock is needed.
    fetchSpy.mockResolvedValueOnce(
      sseStreamResponse([
        {
          id: 'chatcmpl-9ph',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { content: 'Retry reply.' }, finish_reason: null }],
        },
      ]),
    );
    const retryStatus = await sendMessage(agent, chatId, { retry: true, modelId: MODEL_ID });
    expect(retryStatus).toBe(200);

    // Inspect the SECOND completions call (the retry's outgoing wire payload).
    const completionCalls = fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes('/chat/completions'),
    );
    expect(completionCalls.length).toBeGreaterThanOrEqual(2);
    const [, retryInit] = completionCalls[completionCalls.length - 1]!;
    const retryBody = JSON.parse((retryInit as RequestInit).body as string) as Record<
      string,
      unknown
    >;
    const sent = retryBody.messages as Array<{ role: string; content: string }>;

    // The structural invariant: SOME message must include the chapter fragment.
    // Today (pre-k1r) this fails — the synthesisedUserMsg was dropped on retry,
    // taking chapter context with it for the `ask` action.
    expect(sent.some((m) => m.content.includes('<chapter_so_far>'))).toBe(true);
    expect(sent.some((m) => m.content.includes('dragon circled the keep'))).toBe(true);
  });

  // [ai-surfaces-v1] Case B: retry with no trailing assistant (mid-stream error scenario).
  it('on retry with no trailing assistant, generates cleanly with no deletions (case B)', async () => {
    const { agent, sessionId, draftId } = await setup('sc6-retry-caseB');
    const fetchSpy = stubVeniceFetch();
    await storeKey(agent, fetchSpy);

    const created = await agent
      .post(`/api/drafts/${draftId}/chats`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'case-b', kind: 'ask' });
    const chatId = created.body.chat.id as string;

    // Seed only a user message via the repo layer — no assistant is ever created,
    // modelling a mid-stream error where the server died before persisting the reply.
    const messageRepo = createMessageRepo(makeFakeReq(sessionId));
    await messageRepo.create({ chatId, role: 'user', content: 'hello' });

    // Confirm we are at user-only state.
    const midState = await agent.get(`/api/chats/${chatId}/messages`).expect(200);
    expect(midState.body.messages).toHaveLength(1);
    expect(midState.body.messages[0].role).toBe('user');

    // Retry: no trailing assistant to delete; should just generate cleanly.
    // Queue model-list fetch first (warms the cache) then the SSE reply.
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(
      sseStreamResponse([
        {
          id: 'chatcmpl-caseB',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { content: 'reply' }, finish_reason: null }],
        },
      ]),
    );
    const retryStatus = await sendMessage(agent, chatId, { retry: true, modelId: MODEL_ID });
    expect(retryStatus).toBe(200);

    const after = await agent.get(`/api/chats/${chatId}/messages`).expect(200);
    // user + new assistant = 2
    expect(after.body.messages).toHaveLength(2);
    expect(after.body.messages[1].role).toBe('assistant');
    expect(after.body.messages[1].content).toBe('reply');
  });
});

// ─── SC7 suite ────────────────────────────────────────────────────────────────

// setupAsDifferentUser: registers a second user and returns only an authed agent.
// Reuses setup() — the story/chapter it creates are unused but cheap.
async function setupAsDifferentUser(
  username: string,
): Promise<{ agent: ReturnType<typeof request.agent> }> {
  const { agent } = await setup(username);
  return { agent };
}

describe('PATCH /api/chats/:id', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetDb();
  });

  afterEach(async () => {
    _resetSessionStore();
    await resetDb();
  });

  it('updates the title', async () => {
    const { agent, draftId } = await setup('sc7-patch-u1');
    const created = await agent
      .post(`/api/drafts/${draftId}/chats`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'old', kind: 'scene' });
    const chatId = created.body.chat.id as string;

    const res = await agent
      .patch(`/api/chats/${chatId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'new title' })
      .expect(200);
    expect(res.body.chat.title).toBe('new title');
    expect(res.body.chat).not.toHaveProperty('messageCount');
    expect(typeof res.body.chat.createdAt).toBe('string');
    expect(typeof res.body.chat.updatedAt).toBe('string');
    expect(typeof res.body.chat.lastActivityAt).toBe('string');
  });

  it('returns 404 for unknown id', async () => {
    const { agent } = await setup('sc7-patch-u2');
    await agent
      .patch('/api/chats/cl000notreal')
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'x' })
      .expect(404);
  });

  it('returns 404 for chat owned by another user', async () => {
    const { agent: agentA, draftId } = await setup('sc7-patch-u3');
    const created = await agentA
      .post(`/api/drafts/${draftId}/chats`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'a', kind: 'scene' });
    const chatId = created.body.chat.id as string;

    const { agent: agentB } = await setupAsDifferentUser('sc7-patch-u4');
    await agentB
      .patch(`/api/chats/${chatId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'hijack' })
      .expect(404);
  });

  it('rejects invalid bodies', async () => {
    const { agent, draftId } = await setup('sc7-patch-u5');
    const created = await agent
      .post(`/api/drafts/${draftId}/chats`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'a', kind: 'scene' });
    const chatId = created.body.chat.id as string;

    await agent
      .patch(`/api/chats/${chatId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: '' })
      .expect(400);
    await agent.patch(`/api/chats/${chatId}`).set('Origin', TEST_ORIGIN).send({}).expect(400);
    await agent
      .patch(`/api/chats/${chatId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'a'.repeat(201) })
      .expect(400);
  });

  // [D2] .strict() extra-fields rejection
  it('rejects extra fields in the body (.strict())', async () => {
    const { agent, draftId } = await setup('sc7-patch-u6');
    const created = await agent
      .post(`/api/drafts/${draftId}/chats`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'a', kind: 'scene' });
    const chatId = created.body.chat.id as string;

    await agent
      .patch(`/api/chats/${chatId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'valid', extra: 'field' })
      .expect(400);
  });

  // [D2] 200-char boundary: title of exactly 200 chars must succeed
  it('accepts title of exactly 200 characters', async () => {
    const { agent, draftId } = await setup('sc7-patch-u7');
    const created = await agent
      .post(`/api/drafts/${draftId}/chats`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'a', kind: 'scene' });
    const chatId = created.body.chat.id as string;

    const res = await agent
      .patch(`/api/chats/${chatId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'b'.repeat(200) })
      .expect(200);
    expect(res.body.chat.title).toBe('b'.repeat(200));
    expect(res.body.chat).not.toHaveProperty('messageCount');
    expect(typeof res.body.chat.createdAt).toBe('string');
    expect(typeof res.body.chat.updatedAt).toBe('string');
    expect(typeof res.body.chat.lastActivityAt).toBe('string');
  });
});

// ─── SC8 suite ────────────────────────────────────────────────────────────────

describe('DELETE /api/chats/:id', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetDb();
    veniceModelsService.resetCache();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    _resetSessionStore();
    await resetDb();
  });

  it('deletes the chat and cascades messages', async () => {
    const { agent, draftId } = await setup('sc8-delete-u1');
    const fetchSpy = stubVeniceFetch();
    await storeKey(agent, fetchSpy);
    const created = await agent
      .post(`/api/drafts/${draftId}/chats`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 's', kind: 'scene' });
    const chatId = created.body.chat.id as string;

    // Add a message so we can confirm cascade.
    queueSseResponse(fetchSpy, 'Assistant reply.');
    await sendMessage(agent, chatId, { content: 'd', modelId: MODEL_ID });

    await agent.delete(`/api/chats/${chatId}`).set('Origin', TEST_ORIGIN).expect(204);

    await agent.get(`/api/chats/${chatId}/messages`).expect(404);
  });

  it('returns 404 for unknown id', async () => {
    const { agent } = await setup('sc8-delete-u2');
    await agent.delete('/api/chats/cl000notreal').set('Origin', TEST_ORIGIN).expect(404);
  });

  it('returns 404 for chat owned by another user', async () => {
    const { agent: agentA, draftId } = await setup('sc8-delete-u3');
    const created = await agentA
      .post(`/api/drafts/${draftId}/chats`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'a', kind: 'scene' });
    const chatId = created.body.chat.id as string;

    const { agent: agentB } = await setupAsDifferentUser('sc8-delete-u4');
    await agentB.delete(`/api/chats/${chatId}`).set('Origin', TEST_ORIGIN).expect(404);
  });
});

// ─── SC5 suite ────────────────────────────────────────────────────────────────

describe('POST /api/chats/:chatId/messages — kind=scene routing', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetDb();
    veniceModelsService.resetCache();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    _resetSessionStore();
    await resetDb();
  });

  it('builds the prompt with action="scene" when chat.kind="scene"', async () => {
    const { agent, draftId } = await setup('sc5-scene-u1');
    const fetchSpy = stubVeniceFetch();
    await storeKey(agent, fetchSpy);

    const created = await agent
      .post(`/api/drafts/${draftId}/chats`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 's1', kind: 'scene' })
      .expect(201);
    const chatId = created.body.chat.id as string;

    // Prime models cache, then serve the completion stream.
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(
      sseStreamResponse([
        {
          id: 'chatcmpl-sc5',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { content: 'Scene prose.' }, finish_reason: null }],
        },
      ]),
    );

    const res = await agent
      .post(`/api/chats/${chatId}/messages`)
      .set('Origin', TEST_ORIGIN)
      .buffer(true)
      .parse((response, callback) => {
        let data = '';
        response.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        response.on('end', () => callback(null, data));
      })
      .send({
        content: 'Jenny approaches Linda on the veranda and they talk about cheese.',
        modelId: MODEL_ID,
      });

    expect(res.status).toBe(200);
    expect(res.body as string).toContain('data:'); // SSE flowed

    // Find the Venice completions call and inspect the messages array.
    const completionCall = fetchSpy.mock.calls.find(([url]) =>
      String(url).includes('/chat/completions'),
    );
    expect(completionCall).toBeTruthy();
    const [, init] = completionCall!;
    const requestBody = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
    const sentMessages = requestBody.messages as Array<{ role: string; content: string }>;

    // System message must contain the scene template text.
    expect(sentMessages[0].role).toBe('system');
    expect(sentMessages[0].content).toContain('write a passage of prose');

    // Last user message must be the raw direction — no "User question:" framing.
    const lastMsg = sentMessages[sentMessages.length - 1];
    expect(lastMsg.role).toBe('user');
    expect(lastMsg.content).toBe(
      'Jenny approaches Linda on the veranda and they talk about cheese.',
    );
    expect(lastMsg.content).not.toContain('User question');
  });
});

// ─── [pcs] previous-chapter summaries injection — chat route ─────────────────

async function setupTwoChaptersWithChat(
  username: string,
  opts?: { toggleOff?: boolean },
): Promise<{
  agent: ReturnType<typeof request.agent>;
  sessionId: string;
  chatId: string;
  fetchSpy: ReturnType<typeof vi.fn>;
}> {
  const { agent, sessionId } = await registerAndLogin({ username });
  const req = makeFakeReq(sessionId);

  const story = await createStoryRepo(req).create({ title: 'T', worldNotes: null });
  const storyId = story.id as string;

  if (opts?.toggleOff) {
    await createStoryRepo(req).update(storyId, { includePreviousChaptersInPrompt: false });
  }

  const ch0 = await createChapterRepo(req).create({
    storyId,
    title: 'Opening',
    orderIndex: 0,
    wordCount: 0,
  });
  const ch1 = await createChapterRepo(req).create({
    storyId,
    title: 'Rising Action',
    orderIndex: 1,
    wordCount: 3,
    bodyJson: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The plot thickens.' }] }],
    },
  });

  await createDraftRepo(req).update(ch0.activeDraftId as string, {
    summaryJson: {
      events: 'The hero met the mentor.',
      stateAtEnd: "Mentor's hut, dusk.",
      openThreads: 'Why did the mentor disappear?',
    },
  });

  const fetchSpy = stubVeniceFetch();
  await storeKey(agent, fetchSpy);

  const chatRes = await agent
    .post(`/api/drafts/${ch1.activeDraftId as string}/chats`)
    .set('Origin', TEST_ORIGIN)
    .send({ title: 'pcs-test', kind: 'ask' })
    .expect(201);
  const chatId = chatRes.body.chat.id as string;

  return { agent, sessionId, chatId, fetchSpy };
}

describe('POST /api/chats/:chatId/messages — [pcs] previous-chapter summaries', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetDb();
    veniceModelsService.resetCache();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    _resetSessionStore();
    await resetDb();
  });

  it('system message contains <previous_chapters> when toggle=true and prior chapter has a summary', async () => {
    const { agent, chatId, fetchSpy } = await setupTwoChaptersWithChat('pcs-chat-u1');

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(
      sseStreamResponse([
        {
          id: 'chatcmpl-pcs1',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { content: 'OK' }, finish_reason: null }],
        },
      ]),
    );

    await agent
      .post(`/api/chats/${chatId}/messages`)
      .set('Origin', TEST_ORIGIN)
      .buffer(true)
      .parse((response, callback) => {
        let data = '';
        response.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        response.on('end', () => callback(null, data));
      })
      .send({ content: 'What happened before?', modelId: MODEL_ID });

    const call = fetchSpy.mock.calls.find(([url]) => String(url).includes('/chat/completions'));
    const sentBody = JSON.parse(
      String((call?.[1] as RequestInit | undefined)?.body ?? '{}'),
    ) as Record<string, unknown>;
    const systemMessage = (sentBody.messages as Array<{ role: string; content: string }>)?.[0]
      ?.content;
    expect(systemMessage).toContain('<previous_chapters>');
    // prompt builder renders orderIndex+1 as the human-facing chapter number
    expect(systemMessage).toContain('<chapter index="1"');
  });

  it('system message omits <previous_chapters> when includePreviousChaptersInPrompt=false', async () => {
    const { agent, chatId, fetchSpy } = await setupTwoChaptersWithChat('pcs-chat-u2', {
      toggleOff: true,
    });

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(
      sseStreamResponse([
        {
          id: 'chatcmpl-pcs2',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { content: 'OK' }, finish_reason: null }],
        },
      ]),
    );

    await agent
      .post(`/api/chats/${chatId}/messages`)
      .set('Origin', TEST_ORIGIN)
      .buffer(true)
      .parse((response, callback) => {
        let data = '';
        response.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        response.on('end', () => callback(null, data));
      })
      .send({ content: 'What happened before?', modelId: MODEL_ID });

    const call = fetchSpy.mock.calls.find(([url]) => String(url).includes('/chat/completions'));
    const sentBody = JSON.parse(
      String((call?.[1] as RequestInit | undefined)?.body ?? '{}'),
    ) as Record<string, unknown>;
    const systemMessage = (sentBody.messages as Array<{ role: string; content: string }>)?.[0]
      ?.content;
    expect(systemMessage).not.toContain('<previous_chapters>');
  });

  it('[9wk.5] a summary on a NON-active draft of a prior chapter does not enter <previous_chapters>', async () => {
    // Mirrors setupTwoChaptersWithChat's wiring, but instead of writing the
    // prior chapter's summary onto its ACTIVE draft (via draftRepo.update),
    // mints a second, non-active draft carrying the summary — the active
    // draft is left unsummarised.
    const { agent, sessionId } = await registerAndLogin({ username: 'pcs-chat-u3' });
    const req = makeFakeReq(sessionId);

    const story = await createStoryRepo(req).create({ title: 'T', worldNotes: null });
    const storyId = story.id as string;

    const ch0 = await createChapterRepo(req).create({
      storyId,
      title: 'Opening',
      orderIndex: 0,
      wordCount: 0,
    });
    const ch1 = await createChapterRepo(req).create({
      storyId,
      title: 'Rising Action',
      orderIndex: 1,
      wordCount: 3,
      bodyJson: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The plot thickens.' }] }],
      },
    });

    // Non-active draft on ch0 carries the summary; ch0's active draft (the
    // create-time mint) is left unsummarised.
    await createDraftRepo(req).create({
      chapterId: ch0.id as string,
      summaryJson: {
        events: 'The hero met the mentor.',
        stateAtEnd: "Mentor's hut, dusk.",
        openThreads: 'Why did the mentor disappear?',
      },
      orderIndex: 1,
    });

    const fetchSpy = stubVeniceFetch();
    await storeKey(agent, fetchSpy);

    const chatRes = await agent
      .post(`/api/drafts/${ch1.activeDraftId as string}/chats`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'pcs-test', kind: 'ask' })
      .expect(201);
    const chatId = chatRes.body.chat.id as string;

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(
      sseStreamResponse([
        {
          id: 'chatcmpl-pcs3',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { content: 'OK' }, finish_reason: null }],
        },
      ]),
    );

    await agent
      .post(`/api/chats/${chatId}/messages`)
      .set('Origin', TEST_ORIGIN)
      .buffer(true)
      .parse((response, callback) => {
        let data = '';
        response.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        response.on('end', () => callback(null, data));
      })
      .send({ content: 'What happened before?', modelId: MODEL_ID });

    const call = fetchSpy.mock.calls.find(([url]) => String(url).includes('/chat/completions'));
    const sentBody = JSON.parse(
      String((call?.[1] as RequestInit | undefined)?.body ?? '{}'),
    ) as Record<string, unknown>;
    const systemMessage = (sentBody.messages as Array<{ role: string; content: string }>)?.[0]
      ?.content;
    expect(systemMessage).not.toContain('<previous_chapters>');
  });
});

// ─── POST resend via fromMessageId suite ─────────────────────────────────────

// Shared setup: creates a chat with two completed turns [u1, a1, u2, a2].
// Returns the chat and the IDs of u1 and a1 (used as anchors in various tests).
async function setupTwoTurnChat(
  username: string,
  kind: 'ask' | 'scene' = 'ask',
): Promise<{
  agent: ReturnType<typeof request.agent>;
  chatId: string;
  u1Id: string;
  a1Id: string;
  u2Id: string;
  a2Id: string;
  fetchSpy: ReturnType<typeof vi.fn>;
}> {
  const { agent, draftId } = await setup(username);
  const fetchSpy = stubVeniceFetch();
  await storeKey(agent, fetchSpy);

  const created = await agent
    .post(`/api/drafts/${draftId}/chats`)
    .set('Origin', TEST_ORIGIN)
    .send({ title: 'resend-test', kind });
  const chatId = created.body.chat.id as string;

  // Turn 1
  queueSseResponse(fetchSpy, 'first assistant reply');
  await sendMessage(agent, chatId, { content: 'user message one', modelId: MODEL_ID });

  // Turn 2 — models cache warm; only queue the stream.
  fetchSpy.mockResolvedValueOnce(
    sseStreamResponse([
      {
        id: 'chatcmpl-turn2',
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { content: 'second assistant reply' }, finish_reason: null }],
      },
    ]),
  );
  await sendMessage(agent, chatId, { content: 'user message two', modelId: MODEL_ID });

  // Snapshot IDs for assertions.
  const msgsRes = await agent.get(`/api/chats/${chatId}/messages`).expect(200);
  const msgs = msgsRes.body.messages as Array<{ id: string; role: string }>;
  const u1Id = msgs[0].id;
  const a1Id = msgs[1].id;
  const u2Id = msgs[2].id;
  const a2Id = msgs[3].id;

  return { agent, chatId, u1Id, a1Id, u2Id, a2Id, fetchSpy };
}

describe('POST resend via fromMessageId', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetDb();
    veniceModelsService.resetCache();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    _resetSessionStore();
    await resetDb();
  });

  it('drops everything after the anchor user message and regenerates', async () => {
    const { agent, chatId, u1Id, fetchSpy } = await setupTwoTurnChat('resend-drop-u1');

    // Resend from u1: expect a1/u2/a2 to be dropped and a fresh assistant to appear.
    fetchSpy.mockResolvedValueOnce(
      sseStreamResponse([
        {
          id: 'chatcmpl-resend1',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { content: 'regenerated from u1' }, finish_reason: null }],
        },
      ]),
    );
    const res = await sendMessage(agent, chatId, { modelId: MODEL_ID, fromMessageId: u1Id });
    expect(res).toBe(200);

    const list = await agent.get(`/api/chats/${chatId}/messages`).expect(200);
    const roles = (list.body.messages as Array<{ role: string }>).map((m) => m.role);
    expect(roles).toEqual(['user', 'assistant']);
    expect((list.body.messages as Array<{ id: string }>)[0].id).toBe(u1Id);
  });

  it('does NOT create a duplicate user message on resend', async () => {
    const { agent, chatId, u1Id, fetchSpy } = await setupTwoTurnChat('resend-nodup-u1');

    fetchSpy.mockResolvedValueOnce(
      sseStreamResponse([
        {
          id: 'chatcmpl-nodup',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { content: 'again' }, finish_reason: null }],
        },
      ]),
    );
    await sendMessage(agent, chatId, { modelId: MODEL_ID, fromMessageId: u1Id });

    const list = await agent.get(`/api/chats/${chatId}/messages`).expect(200);
    const userCount = (list.body.messages as Array<{ role: string }>).filter(
      (m) => m.role === 'user',
    ).length;
    expect(userCount).toBe(1); // u1 reused, not re-inserted
  });

  it('rejects fromMessageId pointing at an assistant message with 400', async () => {
    const { agent, chatId, a1Id } = await setupTwoTurnChat('resend-asst-u1');

    const res = await agent
      .post(`/api/chats/${chatId}/messages`)
      .set('Origin', TEST_ORIGIN)
      .send({ modelId: MODEL_ID, fromMessageId: a1Id });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('resend_invalid_state');
  });

  it('rejects an unknown fromMessageId with 400', async () => {
    const { agent, chatId } = await setupTwoTurnChat('resend-unknown-u1');

    const res = await agent
      .post(`/api/chats/${chatId}/messages`)
      .set('Origin', TEST_ORIGIN)
      .send({ modelId: MODEL_ID, fromMessageId: 'does-not-exist' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('resend_invalid_state');
  });

  it('rejects a fromMessageId from a different chat (same user) with 400', async () => {
    const { agent, chatId, draftId } = await (async () => {
      const base = await setup('resend-cross-chat-u1');
      const fetchSpy = stubVeniceFetch();
      await storeKey(base.agent, fetchSpy);
      const created = await base.agent
        .post(`/api/drafts/${base.draftId}/chats`)
        .set('Origin', TEST_ORIGIN)
        .send({ title: 'main-chat', kind: 'ask' });
      return {
        agent: base.agent,
        chatId: created.body.chat.id as string,
        draftId: base.draftId,
        fetchSpy,
      };
    })();

    // Create a SECOND chat for the same user.
    const otherCreated = await agent
      .post(`/api/drafts/${draftId}/chats`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'other-chat', kind: 'ask' });
    const otherChatId = otherCreated.body.chat.id as string;

    // Add a user message to the OTHER chat via the route.
    // We need a warm models cache — reinitialise.
    veniceModelsService.resetCache();
    const fetchSpy2 = stubVeniceFetch();
    await storeKey(agent, fetchSpy2);
    queueSseResponse(fetchSpy2, 'other chat reply');
    await sendMessage(agent, otherChatId, { content: 'other chat message', modelId: MODEL_ID });

    const otherMsgs = await agent.get(`/api/chats/${otherChatId}/messages`).expect(200);
    const otherChatUserMsgId = (
      otherMsgs.body.messages as Array<{ id: string; role: string }>
    ).find((m) => m.role === 'user')!.id;

    // Attempt to use that message ID against the FIRST (empty) chat.
    const res = await agent
      .post(`/api/chats/${chatId}/messages`)
      .set('Origin', TEST_ORIGIN)
      .send({ modelId: MODEL_ID, fromMessageId: otherChatUserMsgId });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('resend_invalid_state');

    // The rejected resend wrote nothing to the target chat (it started empty
    // and the 400 returns before any persist).
    const list = await agent.get(`/api/chats/${chatId}/messages`).expect(200);
    expect(list.body.messages as Array<{ id: string }>).toHaveLength(0);
  });

  it('drop+regenerate works for kind=scene (kind-agnostic)', async () => {
    const { agent, chatId, u1Id, fetchSpy } = await setupTwoTurnChat('resend-scene-u1', 'scene');

    fetchSpy.mockResolvedValueOnce(
      sseStreamResponse([
        {
          id: 'chatcmpl-scene-resend',
          object: 'chat.completion.chunk',
          choices: [
            { index: 0, delta: { content: 'scene regenerated from u1' }, finish_reason: null },
          ],
        },
      ]),
    );
    const status = await sendMessage(agent, chatId, { modelId: MODEL_ID, fromMessageId: u1Id });
    expect(status).toBe(200);

    const list = await agent.get(`/api/chats/${chatId}/messages`).expect(200);
    const roles = (list.body.messages as Array<{ role: string }>).map((m) => m.role);
    expect(roles).toEqual(['user', 'assistant']);
    expect((list.body.messages as Array<{ id: string }>)[0].id).toBe(u1Id);
  });
});

// ─── PATCH /api/chats/:chatId/messages/:id suite ──────────────────────────────

describe('PATCH /api/chats/:chatId/messages/:id (edit)', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetDb();
    veniceModelsService.resetCache();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    _resetSessionStore();
    await resetDb();
  });

  // Creates a chat with one user message + one assistant message, returning
  // their IDs and the chatId along with the agent.
  async function setupChatWithMessages(username: string): Promise<{
    agent: ReturnType<typeof request.agent>;
    chatId: string;
    userMessageId: string;
    assistantMessageId: string;
  }> {
    const { agent, draftId } = await setup(username);
    const fetchSpy = stubVeniceFetch();
    await storeKey(agent, fetchSpy);

    const created = await agent
      .post(`/api/drafts/${draftId}/chats`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'edit-test', kind: 'ask' });
    const chatId = created.body.chat.id as string;

    // POST a full turn so we get both a user and an assistant message.
    queueSseResponse(fetchSpy, 'Assistant reply for edit test.');
    await sendMessage(agent, chatId, { content: 'original user content', modelId: MODEL_ID });

    // Retrieve messages to capture both IDs.
    const msgsRes = await agent.get(`/api/chats/${chatId}/messages`).expect(200);
    const messages = msgsRes.body.messages as Array<{ id: string; role: string }>;
    const userMessageId = messages.find((m) => m.role === 'user')!.id;
    const assistantMessageId = messages.find((m) => m.role === 'assistant')!.id;

    return { agent, chatId, userMessageId, assistantMessageId };
  }

  it('edits a user message in place, sets updatedAt, bumps lastActivityAt', async () => {
    const { agent, chatId, userMessageId } = await setupChatWithMessages('edit-u1');

    // Capture updatedAt before the edit (must be null for a fresh message).
    const beforeMsgs = await agent.get(`/api/chats/${chatId}/messages`).expect(200);
    const userMsgBefore = (
      beforeMsgs.body.messages as Array<{ id: string; content: string; updatedAt: string | null }>
    ).find((m) => m.id === userMessageId)!;
    expect(userMsgBefore.content).toBe('original user content');
    expect(userMsgBefore.updatedAt).toBeNull();

    const res = await agent
      .patch(`/api/chats/${chatId}/messages/${userMessageId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ content: 'edited text' });

    expect(res.status).toBe(200);
    expect(res.body.message.content).toBe('edited text');
    expect(res.body.message.updatedAt).not.toBeNull();
    expect(typeof res.body.message.updatedAt).toBe('string');
  });

  it('bumps Chat.lastActivityAt on edit', async () => {
    const { agent, draftId } = await setup('edit-lastactivity-u1');
    const fetchSpy = stubVeniceFetch();
    await storeKey(agent, fetchSpy);

    // Capture a known chapter ID and build a chat.
    const created = await agent
      .post(`/api/drafts/${draftId}/chats`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'act-test', kind: 'ask' });
    const chatId = created.body.chat.id as string;

    // Send a full turn so we get a user message to edit.
    queueSseResponse(fetchSpy, 'reply');
    await sendMessage(agent, chatId, { content: 'hello', modelId: MODEL_ID });

    // Get lastActivityAt via the chapter chats list.
    const chatsBefore = await agent.get(`/api/drafts/${draftId}/chats`).expect(200);
    const beforeAt = (chatsBefore.body.chats as Array<{ id: string; lastActivityAt: string }>).find(
      (c) => c.id === chatId,
    )!.lastActivityAt;

    // Get user message ID.
    const msgsRes = await agent.get(`/api/chats/${chatId}/messages`).expect(200);
    const userMessageId = (msgsRes.body.messages as Array<{ id: string; role: string }>).find(
      (m) => m.role === 'user',
    )!.id;

    // Wait a tick so the timestamp can advance.
    await new Promise((r) => setTimeout(r, 5));

    await agent
      .patch(`/api/chats/${chatId}/messages/${userMessageId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ content: 'edited' })
      .expect(200);

    const chatsAfter = await agent.get(`/api/drafts/${draftId}/chats`).expect(200);
    const afterAt = (chatsAfter.body.chats as Array<{ id: string; lastActivityAt: string }>).find(
      (c) => c.id === chatId,
    )!.lastActivityAt;

    expect(new Date(afterAt).getTime()).toBeGreaterThan(new Date(beforeAt).getTime());
  });

  it('rejects editing an assistant message (role !== user) with 404', async () => {
    const { agent, chatId, assistantMessageId } = await setupChatWithMessages('edit-u2');

    const res = await agent
      .patch(`/api/chats/${chatId}/messages/${assistantMessageId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ content: 'nope' });
    expect(res.status).toBe(404);
  });

  it('returns 404 for a message id that does not exist', async () => {
    const { agent, chatId } = await setupChatWithMessages('edit-u3');

    const res = await agent
      .patch(`/api/chats/${chatId}/messages/does-not-exist`)
      .set('Origin', TEST_ORIGIN)
      .send({ content: 'x' });
    expect(res.status).toBe(404);
  });

  it('returns 404 for a chat that does not exist', async () => {
    const { agent } = await setup('edit-u4');

    const res = await agent
      .patch('/api/chats/does-not-exist/messages/also-not-real')
      .set('Origin', TEST_ORIGIN)
      .send({ content: 'x' });
    expect(res.status).toBe(404);
  });

  it('returns 404 when the message belongs to a different chat (same user)', async () => {
    // Both chats belong to the same user; the bug would allow a message from chatB
    // to be edited through the chatA URL (same userId ownership passes, wrong chatId).
    const { agent, draftId } = await setup('edit-cross-chat-u1');
    const fetchSpy = stubVeniceFetch();
    await storeKey(agent, fetchSpy);

    // Create chatA with a user message.
    const createdA = await agent
      .post(`/api/drafts/${draftId}/chats`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'chat-a', kind: 'ask' });
    const chatAId = createdA.body.chat.id as string;
    queueSseResponse(fetchSpy, 'Chat A assistant reply.');
    await sendMessage(agent, chatAId, { content: 'chat A original content', modelId: MODEL_ID });

    // Create chatB (same user, same chapter) with its own user message.
    // Models cache is already warm after chatA's send — only queue the stream.
    const createdB = await agent
      .post(`/api/drafts/${draftId}/chats`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'chat-b', kind: 'ask' });
    const chatBId = createdB.body.chat.id as string;
    fetchSpy.mockResolvedValueOnce(
      sseStreamResponse([
        {
          id: 'chatcmpl-cross-chat-b',
          object: 'chat.completion.chunk',
          choices: [
            { index: 0, delta: { content: 'Chat B assistant reply.' }, finish_reason: null },
          ],
        },
      ]),
    );
    await sendMessage(agent, chatBId, {
      content: 'chat B original content',
      modelId: MODEL_ID,
    });

    // Get chatB's user message ID.
    const chatBMsgs = await agent.get(`/api/chats/${chatBId}/messages`).expect(200);
    const chatBUserMessageId = (
      chatBMsgs.body.messages as Array<{ id: string; role: string }>
    ).find((m) => m.role === 'user')!.id;

    // PATCH chatA URL with chatB's message ID — must be 404 because chatId doesn't match.
    const res = await agent
      .patch(`/api/chats/${chatAId}/messages/${chatBUserMessageId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ content: 'cross-chat edit attempt' });
    expect(res.status).toBe(404);

    // Confirm chatB's message content is unchanged.
    const chatBMsgsAfter = await agent.get(`/api/chats/${chatBId}/messages`).expect(200);
    const chatBUserMsgAfter = (
      chatBMsgsAfter.body.messages as Array<{ id: string; role: string; content: string }>
    ).find((m) => m.id === chatBUserMessageId)!;
    expect(chatBUserMsgAfter.content).toBe('chat B original content');
  });

  it('rejects empty content', async () => {
    const { agent, chatId, userMessageId } = await setupChatWithMessages('edit-u5');

    const res = await agent
      .patch(`/api/chats/${chatId}/messages/${userMessageId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ content: '' });
    expect(res.status).toBe(400);
  });
});
