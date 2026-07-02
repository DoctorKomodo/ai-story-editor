// Unit tests for backend/src/services/venice-stream.service.ts.
//
// prepareVeniceCall reads through the module-singleton `veniceModelsService`
// (see venice.models.service.ts's `findModel`), so tests prime that singleton's
// per-user cache the same way the route integration tests do: register+login a
// real user, store a BYOK key against a stubbed fetch, then call
// `veniceModelsService.fetchModels` with a stubbed models-list response. This
// mirrors the established pattern in tests/ai/complete.test.ts and
// tests/routes/_chat-test-helpers.ts rather than reaching for a disconnected
// local `createVeniceModelsService` instance (which prepareVeniceCall, tied to
// the singleton, would never see).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserSettings } from '../../src/routes/user-settings.routes';
import { getSession } from '../../src/services/session-store';
import { veniceModelsService } from '../../src/services/venice.models.service';
import { promptCacheKey } from '../../src/services/venice-call.service';
import {
  prepareVeniceCall,
  type VeniceChatMessage,
} from '../../src/services/venice-stream.service';
import {
  jsonResponse,
  registerAndLogin,
  resetAll,
  storeKey,
  stubVeniceFetch,
  type TestSession,
} from '../routes/_chat-test-helpers';

const PLAIN_MODEL_ID = 'plain-model';
const REASONING_MODEL_ID = 'reasoning-model';

const MODEL_LIST_BODY = {
  object: 'list',
  data: [
    {
      id: PLAIN_MODEL_ID,
      object: 'model',
      type: 'text',
      model_spec: {
        name: 'Plain Model',
        availableContextTokens: 65536,
        maxCompletionTokens: 4096,
        capabilities: { supportsReasoning: false, supportsVision: false },
        constraints: { temperature: { default: 0.7 }, top_p: { default: 0.9 } },
      },
    },
    {
      id: REASONING_MODEL_ID,
      object: 'model',
      type: 'text',
      model_spec: {
        name: 'Reasoning Model',
        availableContextTokens: 32768,
        maxCompletionTokens: 8192,
        capabilities: { supportsReasoning: true, supportsVision: false },
      },
    },
  ],
};

const baseSettings = (overrides: Record<string, { reasoning?: boolean }> = {}): UserSettings =>
  ({ chat: { model: null, overrides } }) as UserSettings;

const MESSAGES: VeniceChatMessage[] = [
  { role: 'system', content: 'SYS' },
  { role: 'user', content: 'USR' },
];

describe('prepareVeniceCall', () => {
  let session: TestSession;
  let userId: string;
  let dek: Buffer;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    fetchSpy = stubVeniceFetch();
    session = await registerAndLogin('venice-stream-user');
    await storeKey(session.agent, fetchSpy);
    const stored = getSession(session.sessionId);
    userId = stored!.userId;
    dek = stored!.dek;

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    await veniceModelsService.fetchModels(dek, userId);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    veniceModelsService.resetCache();
    await resetAll();
  });

  it('plain complete-shape input: prompt_cache_key top-level, no stream_options/response_format/reasoning', () => {
    const prepared = prepareVeniceCall({
      route: 'ai-complete',
      userId,
      modelId: PLAIN_MODEL_ID,
      messages: MESSAGES,
      settings: baseSettings(),
      baseVeniceParams: {},
      fallbackMaxCompletionTokens: 999,
      cacheKeyParts: ['story-1', PLAIN_MODEL_ID],
      action: 'continue',
      modelCap: 4096,
    });

    expect(prepared.requestParams.prompt_cache_key).toBe(promptCacheKey('story-1', PLAIN_MODEL_ID));
    expect(prepared.requestParams).not.toHaveProperty('stream_options');
    expect(prepared.requestParams).not.toHaveProperty('response_format');
    expect(prepared.requestParams).not.toHaveProperty('reasoning');
    const vp = prepared.requestParams.venice_parameters as Record<string, unknown>;
    expect(vp).not.toHaveProperty('prompt_cache_key');
  });

  it('reasoning-capable model with per-model override off → reasoning:{enabled:false} + strip_thinking_response', () => {
    const prepared = prepareVeniceCall({
      route: 'ai-complete',
      userId,
      modelId: REASONING_MODEL_ID,
      messages: MESSAGES,
      settings: baseSettings({ [REASONING_MODEL_ID]: { reasoning: false } }),
      baseVeniceParams: {},
      fallbackMaxCompletionTokens: 999,
      cacheKeyParts: ['story-1', REASONING_MODEL_ID],
      action: 'continue',
      modelCap: 8192,
    });

    expect(prepared.requestParams.reasoning).toEqual({ enabled: false });
    const vp = prepared.requestParams.venice_parameters as Record<string, unknown>;
    expect(vp.strip_thinking_response).toBe(true);
  });

  it('reasoning-capable model with no override stays enabled → no reasoning key on requestParams', () => {
    const prepared = prepareVeniceCall({
      route: 'ai-complete',
      userId,
      modelId: REASONING_MODEL_ID,
      messages: MESSAGES,
      settings: baseSettings(),
      baseVeniceParams: {},
      fallbackMaxCompletionTokens: 999,
      cacheKeyParts: ['story-1', REASONING_MODEL_ID],
      action: 'continue',
      modelCap: 8192,
    });

    expect(prepared.requestParams).not.toHaveProperty('reasoning');
  });

  it('chat-shape input: web-search + stream hints + include_usage', () => {
    const prepared = prepareVeniceCall({
      route: 'chat',
      userId,
      modelId: PLAIN_MODEL_ID,
      messages: MESSAGES,
      settings: baseSettings(),
      baseVeniceParams: {},
      fallbackMaxCompletionTokens: 999,
      cacheKeyParts: ['chat-1', PLAIN_MODEL_ID],
      action: 'ask',
      modelCap: 4096,
      enableWebSearch: true,
      enableChatStreamHints: true,
      includeUsage: true,
    });

    const vp = prepared.requestParams.venice_parameters as Record<string, unknown>;
    expect(vp.enable_web_search).toBe('auto');
    expect(vp.enable_web_citations).toBe(true);
    expect(vp.include_search_results_in_stream).toBe(true);
    expect(prepared.requestParams.stream_options).toEqual({ include_usage: true });
  });

  it('summarise-shape input: include_venice_system_prompt:false + response_format present; snapshot keeps short form', () => {
    const fullSchema = {
      type: 'json_schema',
      json_schema: { name: 'ChapterSummary', schema: {}, strict: true },
    };
    const prepared = prepareVeniceCall({
      route: 'chapter-summarise',
      userId,
      modelId: PLAIN_MODEL_ID,
      messages: MESSAGES,
      settings: baseSettings(),
      baseVeniceParams: {},
      fallbackMaxCompletionTokens: 4096,
      cacheKeyParts: ['chapter-1', PLAIN_MODEL_ID],
      action: 'summariseChapter',
      modelCap: 4096,
      includeVeniceSystemPrompt: false,
      responseFormat: fullSchema,
      snapshotResponseFormat: { type: 'json_schema', name: 'ChapterSummary' },
    });

    const vp = prepared.requestParams.venice_parameters as Record<string, unknown>;
    expect(vp.include_venice_system_prompt).toBe(false);
    expect(prepared.requestParams.response_format).toEqual(fullSchema);
    expect(prepared.snapshot.response_format).toEqual({
      type: 'json_schema',
      name: 'ChapterSummary',
    });
  });

  it('snapshot mirrors messageCount, previews, cache key, and resolved params', () => {
    const prepared = prepareVeniceCall({
      route: 'ai-complete',
      userId,
      modelId: PLAIN_MODEL_ID,
      messages: MESSAGES,
      settings: baseSettings(),
      baseVeniceParams: {},
      fallbackMaxCompletionTokens: 999,
      cacheKeyParts: ['story-2', PLAIN_MODEL_ID],
      action: 'continue',
      modelCap: 4096,
    });

    expect(prepared.snapshot.messageCount).toBe(2);
    expect(prepared.snapshot.systemMessagePreview).toBe('SYS');
    expect(prepared.snapshot.userMessagePreview).toBe('USR');
    expect(prepared.snapshot.promptCacheKey).toBe(promptCacheKey('story-2', PLAIN_MODEL_ID));
    expect(prepared.snapshot.temperature).toBe(0.7);
    expect(prepared.snapshot.top_p).toBe(0.9);
    expect(prepared.snapshot.max_completion_tokens).toBe(4096);
  });

  it('unknown model (findModel → null) falls back through resolveTextGenWithFallback', () => {
    const prepared = prepareVeniceCall({
      route: 'ai-complete',
      userId,
      modelId: 'not-in-cache',
      messages: MESSAGES,
      settings: baseSettings(),
      baseVeniceParams: {},
      fallbackMaxCompletionTokens: 777,
      cacheKeyParts: ['story-3', 'not-in-cache'],
      action: 'continue',
      modelCap: undefined,
    });

    expect(prepared.requestParams.max_completion_tokens).toBe(777);
    expect(prepared.requestParams.temperature).toBeUndefined();
    expect(prepared.requestParams.top_p).toBeUndefined();
  });
});
