// [SC4] Integration tests for POST /api/chapters/:chapterId/chats (kind field)
// and GET /api/chapters/:chapterId/chats (kind filter).
// [SC5] Integration test for POST /api/chats/:chatId/messages kind=scene routing.

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/index';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createMessageRepo } from '../../src/repos/message.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { _resetSessionStore } from '../../src/services/session-store';
import { veniceModelsService } from '../../src/services/venice.models.service';
import {
  jsonResponse,
  MODEL_ID,
  MODEL_LIST_BODY,
  makeFakeReq,
  queueSseResponse,
  registerAndLogin,
  resetAll,
  sseStreamResponse,
  storeKey,
  stubVeniceFetch,
} from './_chat-test-helpers';

// Returns a supertest agent (with auth header set), a chapterId, and the raw
// accessToken (for constructing repo instances in tests that need them).
async function setup(
  username: string,
): Promise<{ agent: ReturnType<typeof request.agent>; chapterId: string; accessToken: string }> {
  const accessToken = await registerAndLogin(username);
  const req = makeFakeReq(accessToken);

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

  const agent = request.agent(app);
  agent.set('Authorization', `Bearer ${accessToken}`);

  return { agent, chapterId, accessToken };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('POST /api/chapters/:chapterId/chats — kind', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetAll();
  });

  afterEach(async () => {
    _resetSessionStore();
    await resetAll();
  });

  it('creates a scene-kind chat when kind="scene" is provided', async () => {
    const { agent, chapterId } = await setup('chat-kind-scene-u1');
    const res = await agent
      .post(`/api/chapters/${chapterId}/chats`)
      .send({ title: 's1', kind: 'scene' })
      .expect(201);
    expect(res.body.chat.kind).toBe('scene');
    expect(res.body.chat).not.toHaveProperty('messageCount');
    expect(typeof res.body.chat.createdAt).toBe('string');
    expect(typeof res.body.chat.updatedAt).toBe('string');
    expect(typeof res.body.chat.lastActivityAt).toBe('string');
  });

  it('defaults to kind="ask" when omitted', async () => {
    const { agent, chapterId } = await setup('chat-kind-ask-u2');
    const res = await agent
      .post(`/api/chapters/${chapterId}/chats`)
      .send({ title: 'a1' })
      .expect(201);
    expect(res.body.chat.kind).toBe('ask');
    expect(res.body.chat).not.toHaveProperty('messageCount');
    expect(typeof res.body.chat.createdAt).toBe('string');
    expect(typeof res.body.chat.updatedAt).toBe('string');
    expect(typeof res.body.chat.lastActivityAt).toBe('string');
  });

  it('rejects unknown kind values', async () => {
    const { agent, chapterId } = await setup('chat-kind-bogus-u3');
    await agent
      .post(`/api/chapters/${chapterId}/chats`)
      .send({ title: 'x', kind: 'bogus' })
      .expect(400);
  });
});

describe('GET /api/chapters/:chapterId/chats — kind filter', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetAll();
  });

  afterEach(async () => {
    _resetSessionStore();
    await resetAll();
  });

  it('returns only kind=scene rows when ?kind=scene', async () => {
    const { agent, chapterId } = await setup('chat-filter-scene-u4');
    await agent.post(`/api/chapters/${chapterId}/chats`).send({ title: 'a', kind: 'ask' });
    await agent.post(`/api/chapters/${chapterId}/chats`).send({ title: 's', kind: 'scene' });

    const res = await agent
      .get(`/api/chapters/${chapterId}/chats`)
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
    const { agent, chapterId } = await setup('chat-filter-ask-u6');
    await agent.post(`/api/chapters/${chapterId}/chats`).send({ title: 'a', kind: 'ask' });
    await agent.post(`/api/chapters/${chapterId}/chats`).send({ title: 's', kind: 'scene' });

    const res = await agent
      .get(`/api/chapters/${chapterId}/chats`)
      .query({ kind: 'ask' })
      .expect(200);
    expect(res.body.chats).toHaveLength(1);
    expect(res.body.chats[0].kind).toBe('ask');
    expect(typeof res.body.chats[0].messageCount).toBe('number');
    expect(typeof res.body.chats[0].createdAt).toBe('string');
    expect(typeof res.body.chats[0].updatedAt).toBe('string');
    expect(typeof res.body.chats[0].lastActivityAt).toBe('string');
  });

  // [D1] ?kind=bogus → 400
  it('returns 400 when ?kind is an unknown value', async () => {
    const { agent, chapterId } = await setup('chat-filter-bogus-u7');
    await agent.get(`/api/chapters/${chapterId}/chats`).query({ kind: 'bogus' }).expect(400);
  });

  it('returns both kinds when ?kind is omitted', async () => {
    const { agent, chapterId } = await setup('chat-filter-all-u5');
    await agent.post(`/api/chapters/${chapterId}/chats`).send({ title: 'a', kind: 'ask' });
    await agent.post(`/api/chapters/${chapterId}/chats`).send({ title: 's', kind: 'scene' });

    const res = await agent.get(`/api/chapters/${chapterId}/chats`).expect(200);
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
    const { agent, chapterId } = await setup('chat-lastactivity-u8');
    await agent.post(`/api/chapters/${chapterId}/chats`).send({ title: 'a', kind: 'ask' });

    const res = await agent.get(`/api/chapters/${chapterId}/chats`).expect(200);
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
    await resetAll();
    veniceModelsService.resetCache();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    _resetSessionStore();
    await resetAll();
  });

  it('does not persist a new user message on retry=true; prior assistant is replaced with new content', async () => {
    const { agent, chapterId } = await setup('sc6-retry-u1');
    const fetchSpy = stubVeniceFetch();
    await storeKey(agent, fetchSpy);

    const created = await agent
      .post(`/api/chapters/${chapterId}/chats`)
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
    const { agent, chapterId } = await setup('sc6-retry-u2');
    const fetchSpy = stubVeniceFetch();
    await storeKey(agent, fetchSpy);

    const created = await agent
      .post(`/api/chapters/${chapterId}/chats`)
      .send({ title: 's', kind: 'scene' });
    const chatId = created.body.chat.id as string;

    // No prior messages — retry has nothing to base on.
    await agent
      .post(`/api/chats/${chatId}/messages`)
      .send({ retry: true, modelId: MODEL_ID })
      .expect(400);
  });

  it('does not require content when retry=true', async () => {
    const { agent, chapterId } = await setup('sc6-retry-u3');
    const fetchSpy = stubVeniceFetch();
    await storeKey(agent, fetchSpy);

    const created = await agent
      .post(`/api/chapters/${chapterId}/chats`)
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
    const { agent, chapterId } = await setup('sc6-retry-u4');
    const fetchSpy = stubVeniceFetch();
    await storeKey(agent, fetchSpy);
    const created = await agent
      .post(`/api/chapters/${chapterId}/chats`)
      .send({ title: 's', kind: 'scene' });
    const chatId = created.body.chat.id as string;
    await agent
      .post(`/api/chats/${chatId}/messages`)
      .send({ retry: true, content: 'extra', modelId: MODEL_ID })
      .expect(400);
  });

  // [ai-surfaces-v1] Case C: retry deletes prior trailing assistant before regenerating.
  it('on retry, deletes prior trailing assistant before regenerating (case C — linear retry)', async () => {
    const { agent, chapterId } = await setup('sc6-retry-caseC');
    const fetchSpy = stubVeniceFetch();
    await storeKey(agent, fetchSpy);

    const created = await agent
      .post(`/api/chapters/${chapterId}/chats`)
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
    const { agent, accessToken, chapterId } = await setup('k1r-9ph-regression');
    const fetchSpy = stubVeniceFetch();
    await storeKey(agent, fetchSpy);

    // Chapter must have content for the test to be meaningful.
    const req = makeFakeReq(accessToken);
    await createChapterRepo(req).update(chapterId, {
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
      .post(`/api/chapters/${chapterId}/chats`)
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
    const { agent, chapterId, accessToken } = await setup('sc6-retry-caseB');
    const fetchSpy = stubVeniceFetch();
    await storeKey(agent, fetchSpy);

    const created = await agent
      .post(`/api/chapters/${chapterId}/chats`)
      .send({ title: 'case-b', kind: 'ask' });
    const chatId = created.body.chat.id as string;

    // Seed only a user message via the repo layer — no assistant is ever created,
    // modelling a mid-stream error where the server died before persisting the reply.
    const messageRepo = createMessageRepo(makeFakeReq(accessToken));
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
    await resetAll();
  });

  afterEach(async () => {
    _resetSessionStore();
    await resetAll();
  });

  it('updates the title', async () => {
    const { agent, chapterId } = await setup('sc7-patch-u1');
    const created = await agent
      .post(`/api/chapters/${chapterId}/chats`)
      .send({ title: 'old', kind: 'scene' });
    const chatId = created.body.chat.id as string;

    const res = await agent.patch(`/api/chats/${chatId}`).send({ title: 'new title' }).expect(200);
    expect(res.body.chat.title).toBe('new title');
    expect(res.body.chat).not.toHaveProperty('messageCount');
    expect(typeof res.body.chat.createdAt).toBe('string');
    expect(typeof res.body.chat.updatedAt).toBe('string');
    expect(typeof res.body.chat.lastActivityAt).toBe('string');
  });

  it('returns 404 for unknown id', async () => {
    const { agent } = await setup('sc7-patch-u2');
    await agent.patch('/api/chats/cl000notreal').send({ title: 'x' }).expect(404);
  });

  it('returns 404 for chat owned by another user', async () => {
    const { agent: agentA, chapterId } = await setup('sc7-patch-u3');
    const created = await agentA
      .post(`/api/chapters/${chapterId}/chats`)
      .send({ title: 'a', kind: 'scene' });
    const chatId = created.body.chat.id as string;

    const { agent: agentB } = await setupAsDifferentUser('sc7-patch-u4');
    await agentB.patch(`/api/chats/${chatId}`).send({ title: 'hijack' }).expect(404);
  });

  it('rejects invalid bodies', async () => {
    const { agent, chapterId } = await setup('sc7-patch-u5');
    const created = await agent
      .post(`/api/chapters/${chapterId}/chats`)
      .send({ title: 'a', kind: 'scene' });
    const chatId = created.body.chat.id as string;

    await agent.patch(`/api/chats/${chatId}`).send({ title: '' }).expect(400);
    await agent.patch(`/api/chats/${chatId}`).send({}).expect(400);
    await agent
      .patch(`/api/chats/${chatId}`)
      .send({ title: 'a'.repeat(201) })
      .expect(400);
  });

  // [D2] .strict() extra-fields rejection
  it('rejects extra fields in the body (.strict())', async () => {
    const { agent, chapterId } = await setup('sc7-patch-u6');
    const created = await agent
      .post(`/api/chapters/${chapterId}/chats`)
      .send({ title: 'a', kind: 'scene' });
    const chatId = created.body.chat.id as string;

    await agent.patch(`/api/chats/${chatId}`).send({ title: 'valid', extra: 'field' }).expect(400);
  });

  // [D2] 200-char boundary: title of exactly 200 chars must succeed
  it('accepts title of exactly 200 characters', async () => {
    const { agent, chapterId } = await setup('sc7-patch-u7');
    const created = await agent
      .post(`/api/chapters/${chapterId}/chats`)
      .send({ title: 'a', kind: 'scene' });
    const chatId = created.body.chat.id as string;

    const res = await agent
      .patch(`/api/chats/${chatId}`)
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
    await resetAll();
    veniceModelsService.resetCache();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    _resetSessionStore();
    await resetAll();
  });

  it('deletes the chat and cascades messages', async () => {
    const { agent, chapterId } = await setup('sc8-delete-u1');
    const fetchSpy = stubVeniceFetch();
    await storeKey(agent, fetchSpy);
    const created = await agent
      .post(`/api/chapters/${chapterId}/chats`)
      .send({ title: 's', kind: 'scene' });
    const chatId = created.body.chat.id as string;

    // Add a message so we can confirm cascade.
    queueSseResponse(fetchSpy, 'Assistant reply.');
    await sendMessage(agent, chatId, { content: 'd', modelId: MODEL_ID });

    await agent.delete(`/api/chats/${chatId}`).expect(204);

    await agent.get(`/api/chats/${chatId}/messages`).expect(404);
  });

  it('returns 404 for unknown id', async () => {
    const { agent } = await setup('sc8-delete-u2');
    await agent.delete('/api/chats/cl000notreal').expect(404);
  });

  it('returns 404 for chat owned by another user', async () => {
    const { agent: agentA, chapterId } = await setup('sc8-delete-u3');
    const created = await agentA
      .post(`/api/chapters/${chapterId}/chats`)
      .send({ title: 'a', kind: 'scene' });
    const chatId = created.body.chat.id as string;

    const { agent: agentB } = await setupAsDifferentUser('sc8-delete-u4');
    await agentB.delete(`/api/chats/${chatId}`).expect(404);
  });
});

// ─── SC5 suite ────────────────────────────────────────────────────────────────

describe('POST /api/chats/:chatId/messages — kind=scene routing', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetAll();
    veniceModelsService.resetCache();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    _resetSessionStore();
    await resetAll();
  });

  it('builds the prompt with action="scene" when chat.kind="scene"', async () => {
    const { agent, chapterId } = await setup('sc5-scene-u1');
    const fetchSpy = stubVeniceFetch();
    await storeKey(agent, fetchSpy);

    const created = await agent
      .post(`/api/chapters/${chapterId}/chats`)
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
