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

import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import type OpenAI from 'openai';
import { APIError } from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VeniceErrorContext } from '../../src/lib/venice-errors';
import type { UserSettings } from '../../src/routes/user-settings.routes';
import { getSession } from '../../src/services/session-store';
import { veniceModelsService } from '../../src/services/venice.models.service';
import { promptCacheKey } from '../../src/services/venice-call.service';
import {
  callVeniceCompletion,
  type PreparedVeniceCall,
  prepareVeniceCall,
  streamVeniceToResponse,
  type VeniceChatMessage,
  type VeniceStreamChunk,
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

// ─── streamVeniceToResponse ─────────────────────────────────────────────────────

const CTX: VeniceErrorContext = { userId: 'u1', route: 'ai-complete' };

const PREPARED: PreparedVeniceCall = {
  requestParams: { model: 'test-model' },
  snapshot: { model: 'test-model', messageCount: 2 },
};

function headersFrom(map: Record<string, string>) {
  return { get: (name: string) => map[name] ?? null };
}

function makeFakeClient(
  respond: () => {
    data: AsyncIterable<VeniceStreamChunk>;
    response: { headers: { get(name: string): string | null } };
  },
): OpenAI {
  return {
    chat: {
      completions: {
        create: () => ({ withResponse: async () => respond() }),
      },
    },
  } as unknown as OpenAI;
}

function makeFakeReqRes() {
  const req = new EventEmitter() as unknown as Request;
  const written: string[] = [];
  const headers: Record<string, string> = {};
  const state = { ended: false, statusCode: undefined as number | undefined };
  const res = {
    status(code: number) {
      state.statusCode = code;
      return res;
    },
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    flushHeaders() {},
    write(chunk: string) {
      written.push(chunk);
      return true;
    },
    end() {
      state.ended = true;
    },
  } as unknown as Response;
  return { req, res, written, headers, state };
}

// Builds an async-iterable "stream" matching the openai SDK's chunk stream
// shape, with a duck-typed `.controller.abort()` for the client-disconnect
// wiring under test. `onYield` runs synchronously right after each chunk is
// produced — used to simulate a mid-stream client disconnect between chunks.
function makeVeniceStream(
  chunks: VeniceStreamChunk[],
  opts: { throwAt?: number; err?: unknown; onYield?: (index: number) => void } = {},
) {
  const abort = vi.fn();
  async function* gen(): AsyncGenerator<VeniceStreamChunk> {
    for (let i = 0; i < chunks.length; i++) {
      if (opts.throwAt === i) throw opts.err ?? new Error('boom');
      yield chunks[i];
      opts.onYield?.(i);
    }
    if (opts.throwAt !== undefined && opts.throwAt >= chunks.length) {
      throw opts.err ?? new Error('boom');
    }
  }
  const iterable = gen();
  (iterable as unknown as { controller: { abort: () => void } }).controller = { abort };
  return { iterable, abort };
}

describe('streamVeniceToResponse', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errSpy.mockRestore();
  });

  it('forwards chunks and writes [DONE] on normal completion', async () => {
    const chunk = { choices: [{ delta: { content: 'hi' }, finish_reason: null }] };
    const { iterable } = makeVeniceStream([chunk]);
    const client = makeFakeClient(() => ({
      data: iterable,
      response: { headers: headersFrom({}) },
    }));
    const { req, res, written, state } = makeFakeReqRes();

    await streamVeniceToResponse({ client, req, res, prepared: PREPARED, ctx: CTX });

    expect(written).toEqual([`data: ${JSON.stringify(chunk)}\n\n`, 'data: [DONE]\n\n']);
    expect(state.ended).toBe(true);
    expect(state.statusCode).toBe(200);
  });

  it('client disconnect: stops the loop, writes no [DONE], attempts upstream abort', async () => {
    const chunk0 = { choices: [{ delta: { content: 'a' }, finish_reason: null }] };
    const chunk1 = { choices: [{ delta: { content: 'b' }, finish_reason: null }] };
    const { req, res, written, state } = makeFakeReqRes();
    const { iterable, abort } = makeVeniceStream([chunk0, chunk1], {
      onYield: (i) => {
        if (i === 0) (req as unknown as EventEmitter).emit('close');
      },
    });
    const client = makeFakeClient(() => ({
      data: iterable,
      response: { headers: headersFrom({}) },
    }));

    await streamVeniceToResponse({ client, req, res, prepared: PREPARED, ctx: CTX });

    expect(written).toEqual([`data: ${JSON.stringify(chunk0)}\n\n`]);
    expect(written).not.toContain('data: [DONE]\n\n');
    expect(abort).toHaveBeenCalledOnce();
    expect(state.ended).toBe(true);
  });

  it('non-APIError mid-stream: generic stream_error frame then [DONE], byte-exact', async () => {
    const { iterable } = makeVeniceStream([], { throwAt: 0, err: new Error('db exploded') });
    const client = makeFakeClient(() => ({
      data: iterable,
      response: { headers: headersFrom({}) },
    }));
    const { req, res, written, state } = makeFakeReqRes();

    await streamVeniceToResponse({ client, req, res, prepared: PREPARED, ctx: CTX });

    expect(written).toEqual([
      `data: ${JSON.stringify({
        error: 'An internal stream error occurred.',
        code: 'stream_error',
        message: 'An internal stream error occurred.',
      })}\n\n`,
      'data: [DONE]\n\n',
    ]);
    expect(state.ended).toBe(true);
  });

  it('APIError mid-stream: routes through mapVeniceErrorToSse', async () => {
    const apiErr = new APIError(503, { error: { message: 'Upstream busy' } }, '503', new Headers());
    const { iterable } = makeVeniceStream([], { throwAt: 0, err: apiErr });
    const client = makeFakeClient(() => ({
      data: iterable,
      response: { headers: headersFrom({}) },
    }));
    const { req, res, written, state } = makeFakeReqRes();

    await streamVeniceToResponse({ client, req, res, prepared: PREPARED, ctx: CTX });

    expect(written[0]).toContain('"code":"venice_unavailable"');
    expect(written[1]).toBe('data: [DONE]\n\n');
    expect(state.ended).toBe(true);
  });

  it("onChunk returning 'consume' suppresses the default frame; hook-written frames appear in order", async () => {
    const chunk0 = { choices: [{ delta: { content: 'x' }, finish_reason: null }] };
    const chunk1 = { choices: [{ delta: { content: 'y' }, finish_reason: null }] };
    const { iterable } = makeVeniceStream([chunk0, chunk1]);
    const client = makeFakeClient(() => ({
      data: iterable,
      response: { headers: headersFrom({}) },
    }));
    const { req, res, written, state } = makeFakeReqRes();

    await streamVeniceToResponse({
      client,
      req,
      res,
      prepared: PREPARED,
      ctx: CTX,
      hooks: {
        onChunk: (chunk, write) => {
          if (chunk === chunk0) {
            write('event: custom\ndata: {}\n\n');
            return 'consume';
          }
          return 'forward';
        },
      },
    });

    expect(written).toEqual([
      'event: custom\ndata: {}\n\n',
      `data: ${JSON.stringify(chunk1)}\n\n`,
      'data: [DONE]\n\n',
    ]);
    expect(state.ended).toBe(true);
  });

  it('onDone runs after the last chunk and before [DONE]', async () => {
    const chunk = { choices: [{ delta: { content: 'z' }, finish_reason: null }] };
    const { iterable } = makeVeniceStream([chunk]);
    const client = makeFakeClient(() => ({
      data: iterable,
      response: { headers: headersFrom({}) },
    }));
    const { req, res, written, state } = makeFakeReqRes();
    const order: string[] = [];

    await streamVeniceToResponse({
      client,
      req,
      res,
      prepared: PREPARED,
      ctx: CTX,
      hooks: {
        onChunk: () => {
          order.push('chunk');
          return 'forward';
        },
        onDone: async () => {
          order.push('done');
        },
      },
    });

    expect(order).toEqual(['chunk', 'done']);
    expect(written.at(-1)).toBe('data: [DONE]\n\n');
    expect(state.ended).toBe(true);
  });

  it('rate-limit headers: forwards each x-venice-* header only when Venice sent the source header', async () => {
    const chunk = { choices: [{ delta: { content: 'a' }, finish_reason: null }] };
    const { iterable: present } = makeVeniceStream([chunk]);
    const clientPresent = makeFakeClient(() => ({
      data: present,
      response: {
        headers: headersFrom({
          'x-ratelimit-remaining-requests': '10',
          'x-ratelimit-limit-requests': '100',
        }),
      },
    }));
    const { req: req1, res: res1, headers: headers1 } = makeFakeReqRes();
    await streamVeniceToResponse({
      client: clientPresent,
      req: req1,
      res: res1,
      prepared: PREPARED,
      ctx: CTX,
    });
    expect(headers1['x-venice-remaining-requests']).toBe('10');
    expect(headers1['x-venice-limit-requests']).toBe('100');
    expect(headers1['x-venice-remaining-tokens']).toBeUndefined();

    const { iterable: absent } = makeVeniceStream([chunk]);
    const clientAbsent = makeFakeClient(() => ({
      data: absent,
      response: { headers: headersFrom({}) },
    }));
    const { req: req2, res: res2, headers: headers2 } = makeFakeReqRes();
    await streamVeniceToResponse({
      client: clientAbsent,
      req: req2,
      res: res2,
      prepared: PREPARED,
      ctx: CTX,
    });
    expect(headers2['x-venice-remaining-requests']).toBeUndefined();
    expect(headers2['x-venice-limit-requests']).toBeUndefined();
  });
});

// ─── callVeniceCompletion ─────────────────────────────────────────────────────

describe('callVeniceCompletion', () => {
  it('returns the completion and sends no `stream` key, carrying response_format through', async () => {
    const createSpy = vi.fn(async (_params: Record<string, unknown>) => ({
      choices: [{ message: { content: '{"summary":"ok"}' } }],
    }));
    const client = {
      chat: { completions: { create: createSpy } },
    } as unknown as OpenAI;

    const prepared: PreparedVeniceCall = {
      requestParams: {
        model: 'test-model',
        response_format: { type: 'json_schema', json_schema: { name: 'ChapterSummary' } },
      },
      snapshot: { model: 'test-model', messageCount: 2 },
    };

    const result = await callVeniceCompletion({ client, prepared });

    expect(result.choices?.[0]?.message?.content).toBe('{"summary":"ok"}');
    expect(createSpy).toHaveBeenCalledOnce();
    const sentParams = createSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sentParams).not.toHaveProperty('stream');
    expect(sentParams.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'ChapterSummary' },
    });
  });
});
