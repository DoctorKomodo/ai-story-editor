import type request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { _resetSessionStore } from '../../src/services/session-store';
import { veniceModelsService } from '../../src/services/venice.models.service';
import {
  jsonResponse,
  MODEL_ID,
  MODEL_LIST_BODY,
  makeFakeReq,
  registerAndLogin,
  resetAll,
  storeKey,
  stubVeniceFetch,
  TEST_ORIGIN,
} from './_chat-test-helpers';

const MODEL_LIST_BODY_REASONING = {
  object: 'list',
  data: [
    {
      id: MODEL_ID,
      object: 'model',
      type: 'text',
      model_spec: {
        name: 'Venice Reasoning Model',
        availableContextTokens: 65536,
        maxCompletionTokens: 4096,
        capabilities: {
          supportsReasoning: true,
          supportsVision: false,
          supportsResponseSchema: true,
        },
      },
    },
  ],
};

async function setup(
  username: string,
  body: string | null = 'A sentence of prose.',
): Promise<{ agent: ReturnType<typeof request.agent>; chapterId: string; storyId: string }> {
  const { agent, sessionId } = await registerAndLogin(username);
  const req = makeFakeReq(sessionId);
  const story = await createStoryRepo(req).create({ title: 'T', worldNotes: null });
  const chapter = await createChapterRepo(req).create({
    storyId: story.id as string,
    title: 'Ch',
    bodyJson:
      body == null
        ? null
        : {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: body }] }],
          },
    orderIndex: 0,
    wordCount: body ? body.split(/\s+/).length : 0,
  });
  return { agent, chapterId: chapter.id as string, storyId: story.id as string };
}

const MODEL_LIST_BODY_NO_SCHEMA = {
  data: [
    {
      id: MODEL_ID,
      type: 'text',
      model_spec: {
        availableContextTokens: 8000,
        maxCompletionTokens: 1000,
        capabilities: { supportsResponseSchema: false },
      },
    },
  ],
};

describe('POST /api/stories/:storyId/chapters/:chapterId/summarise', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetAll();
    veniceModelsService.resetCache();
    vi.unstubAllGlobals();
  });

  afterEach(async () => {
    _resetSessionStore();
    await resetAll();
    veniceModelsService.resetCache();
    vi.unstubAllGlobals();
  });

  it('400 empty_chapter when chapter has zero words', async () => {
    const fetchSpy = stubVeniceFetch();
    const { agent, chapterId, storyId } = await setup('summarise-empty', null);
    await storeKey(agent, fetchSpy);
    const callsAfterSetup = fetchSpy.mock.calls.length;
    const res = await agent
      .post(`/api/stories/${storyId}/chapters/${chapterId}/summarise`)
      .set('Origin', TEST_ORIGIN)
      .send({ modelId: MODEL_ID });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('empty_chapter');
    expect(fetchSpy.mock.calls.length).toBe(callsAfterSetup);
  });

  it('400 model_unsupported_for_summarisation when supportsResponseSchema is false', async () => {
    const fetchSpy = stubVeniceFetch();
    const { agent, chapterId, storyId } = await setup('summarise-noschema');
    await storeKey(agent, fetchSpy);
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY_NO_SCHEMA));
    const res = await agent
      .post(`/api/stories/${storyId}/chapters/${chapterId}/summarise`)
      .set('Origin', TEST_ORIGIN)
      .send({ modelId: MODEL_ID });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('model_unsupported_for_summarisation');
  });

  it('happy path: persists a valid summary returned by Venice', async () => {
    const fetchSpy = stubVeniceFetch();
    const { agent, chapterId, storyId } = await setup('summarise-happy');
    await storeKey(agent, fetchSpy);
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, {
        choices: [
          {
            message: {
              content: JSON.stringify({ events: 'A.', stateAtEnd: 'B.', openThreads: 'C?' }),
            },
          },
        ],
      }),
    );
    const res = await agent
      .post(`/api/stories/${storyId}/chapters/${chapterId}/summarise`)
      .set('Origin', TEST_ORIGIN)
      .send({ modelId: MODEL_ID });
    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual({ events: 'A.', stateAtEnd: 'B.', openThreads: 'C?' });
    expect(typeof res.body.summaryUpdatedAt).toBe('string');
  });

  it('502 summary_parse_failed on malformed JSON', async () => {
    const fetchSpy = stubVeniceFetch();
    const { agent, chapterId, storyId } = await setup('summarise-malformed');
    await storeKey(agent, fetchSpy);
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, { choices: [{ message: { content: 'not json at all' } }] }),
    );
    const res = await agent
      .post(`/api/stories/${storyId}/chapters/${chapterId}/summarise`)
      .set('Origin', TEST_ORIGIN)
      .send({ modelId: MODEL_ID });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('summary_parse_failed');
  });
});

describe('summarise honors model settings + sends persona', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetAll();
    veniceModelsService.resetCache();
    vi.unstubAllGlobals();
  });

  afterEach(async () => {
    _resetSessionStore();
    await resetAll();
    veniceModelsService.resetCache();
    vi.unstubAllGlobals();
  });

  it('sends temperature, top_p, max_completion_tokens, venice_parameters, prompt_cache_key, and persona', async () => {
    const fetchSpy = stubVeniceFetch();
    const { agent, chapterId, storyId } = await setup('sum-orch-1');
    await storeKey(agent, fetchSpy);

    await agent
      .patch('/api/users/me/settings')
      .set('Origin', TEST_ORIGIN)
      .send({ chat: { overrides: { [MODEL_ID]: { temperature: 0.42 } } } });

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, {
        choices: [
          {
            message: {
              content: JSON.stringify({ events: 'A.', stateAtEnd: 'B.', openThreads: 'C?' }),
            },
          },
        ],
      }),
    );

    const res = await agent
      .post(`/api/stories/${storyId}/chapters/${chapterId}/summarise`)
      .set('Origin', TEST_ORIGIN)
      .send({ modelId: MODEL_ID });
    expect(res.status).toBe(200);

    const completionCall = fetchSpy.mock.calls.find(([url]) =>
      String(url).includes('/chat/completions'),
    );
    expect(completionCall).toBeTruthy();
    const sentBody = JSON.parse(String((completionCall![1] as RequestInit).body ?? '{}')) as Record<
      string,
      unknown
    >;

    expect(sentBody.temperature).toBe(0.42);
    expect(sentBody.top_p).toBeDefined();
    expect(sentBody.max_completion_tokens).toBeDefined();
    expect(sentBody.prompt_cache_key).toMatch(/^[0-9a-f]{32}$/);
    expect(
      (sentBody.venice_parameters as Record<string, unknown>).include_venice_system_prompt,
    ).toBe(true);
    expect((sentBody.messages as Array<{ role: string; content: string }>)[0].role).toBe('system');
    expect((sentBody.messages as Array<{ role: string; content: string }>)[0].content).toContain(
      'creative-writing assistant',
    );
    expect((sentBody.messages as Array<{ role: string; content: string }>)[0].content).toContain(
      'JSON object matching the provided schema',
    );
  });

  it('on reasoning model, sends strip_thinking_response: true', async () => {
    const fetchSpy = stubVeniceFetch();
    const { agent, chapterId, storyId } = await setup('sum-orch-2');
    await storeKey(agent, fetchSpy);

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY_REASONING));
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, {
        choices: [
          {
            message: {
              content: JSON.stringify({ events: 'A.', stateAtEnd: 'B.', openThreads: 'C?' }),
            },
          },
        ],
      }),
    );

    const res = await agent
      .post(`/api/stories/${storyId}/chapters/${chapterId}/summarise`)
      .set('Origin', TEST_ORIGIN)
      .send({ modelId: MODEL_ID });
    expect(res.status).toBe(200);

    const completionCall = fetchSpy.mock.calls.find(([url]) =>
      String(url).includes('/chat/completions'),
    );
    expect(completionCall).toBeTruthy();
    const sentBody = JSON.parse(String((completionCall![1] as RequestInit).body ?? '{}')) as Record<
      string,
      unknown
    >;

    expect((sentBody.venice_parameters as Record<string, unknown>).strip_thinking_response).toBe(
      true,
    );
  });

  it('sends reasoning:{enabled:false} when reasoning toggled off for a reasoning model', async () => {
    const fetchSpy = stubVeniceFetch();
    const { agent, chapterId, storyId } = await setup('sum-orch-reasoning-off');
    await storeKey(agent, fetchSpy);

    const settingsRes = await agent
      .patch('/api/users/me/settings')
      .set('Origin', TEST_ORIGIN)
      .send({ chat: { overrides: { [MODEL_ID]: { reasoning: false } } } });
    expect(settingsRes.status).toBe(200);

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY_REASONING));
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, {
        choices: [
          {
            message: {
              content: JSON.stringify({ events: 'A.', stateAtEnd: 'B.', openThreads: 'C?' }),
            },
          },
        ],
      }),
    );

    const res = await agent
      .post(`/api/stories/${storyId}/chapters/${chapterId}/summarise`)
      .set('Origin', TEST_ORIGIN)
      .send({ modelId: MODEL_ID });
    expect(res.status).toBe(200);

    const completionCall = fetchSpy.mock.calls.find(([url]) =>
      String(url).includes('/chat/completions'),
    );
    expect(completionCall).toBeTruthy();
    const sentBody = JSON.parse(String((completionCall![1] as RequestInit).body ?? '{}')) as Record<
      string,
      unknown
    >;

    expect(sentBody.reasoning).toEqual({ enabled: false });
  });

  it('honors include_venice_system_prompt=false (user toggled OFF in settings)', async () => {
    const fetchSpy = stubVeniceFetch();
    const { agent, chapterId, storyId } = await setup('sum-orch-3');
    await storeKey(agent, fetchSpy);

    await agent
      .patch('/api/users/me/settings')
      .set('Origin', TEST_ORIGIN)
      .send({ ai: { includeVeniceSystemPrompt: false } });

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, {
        choices: [
          {
            message: {
              content: JSON.stringify({ events: 'A.', stateAtEnd: 'B.', openThreads: 'C?' }),
            },
          },
        ],
      }),
    );

    const res = await agent
      .post(`/api/stories/${storyId}/chapters/${chapterId}/summarise`)
      .set('Origin', TEST_ORIGIN)
      .send({ modelId: MODEL_ID });
    expect(res.status).toBe(200);

    const completionCall = fetchSpy.mock.calls.find(([url]) =>
      String(url).includes('/chat/completions'),
    );
    expect(completionCall).toBeTruthy();
    const sentBody = JSON.parse(String((completionCall![1] as RequestInit).body ?? '{}')) as Record<
      string,
      unknown
    >;

    expect(
      (sentBody.venice_parameters as Record<string, unknown>).include_venice_system_prompt,
    ).toBe(false);
  });
});
