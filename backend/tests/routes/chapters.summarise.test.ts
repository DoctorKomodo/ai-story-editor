import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/index';
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
} from './_chat-test-helpers';

async function setup(
  username: string,
  body: string | null = 'A sentence of prose.',
): Promise<{ agent: ReturnType<typeof request.agent>; chapterId: string; storyId: string }> {
  const accessToken = await registerAndLogin(username);
  const req = makeFakeReq(accessToken);
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
  const agent = request.agent(app);
  agent.set('Authorization', `Bearer ${accessToken}`);
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
      .send({ modelId: MODEL_ID });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('summary_parse_failed');
  });
});
