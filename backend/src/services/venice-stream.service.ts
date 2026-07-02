// Shared Venice completion-call orchestration. Extracted from the near-identical
// hand-assembled sequences in ai.routes.ts, chat.routes.ts, and chapters.routes.ts
// (`/summarise`) — see docs/superpowers/plans/2026-07-02-venice-stream-service-extraction.md.
//
// Behavior-preserving: SSE frame bytes, the six x-venice-* headers, status codes,
// error envelopes, and upstream request semantics are unchanged from the three
// pre-extraction call sites. This module is also where all `as unknown as` casts
// against the openai SDK now live — the routes no longer touch the SDK's request/
// response shapes directly.

import type { Request, Response } from 'express';
import type OpenAI from 'openai';
import {
  logVeniceErrorDev,
  mapVeniceErrorToSse,
  type VeniceErrorContext,
  type VeniceRequestSnapshot,
} from '../lib/venice-errors';
import type { UserSettings } from '../routes/user-settings.routes';
import { veniceModelsService } from './venice.models.service';
import {
  buildVeniceParams,
  logVeniceParams,
  promptCacheKey,
  resolveReasoningEnabled,
  resolveTextGenWithFallback,
} from './venice-call.service';

// ─── prepareVeniceCall ─────────────────────────────────────────────────────────

export type VeniceChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export interface PrepareVeniceCallInput {
  route: VeniceErrorContext['route'];
  userId: string;
  modelId: string;
  messages: VeniceChatMessage[];
  settings: UserSettings;
  baseVeniceParams: Record<string, unknown>;
  fallbackMaxCompletionTokens: number;
  cacheKeyParts: string[];
  action: string;
  modelCap: number | undefined;
  enableWebSearch?: boolean;
  enableChatStreamHints?: boolean;
  includeVeniceSystemPrompt?: boolean;
  includeUsage?: boolean;
  responseFormat?: unknown;
  // The short snapshot form for response_format — see chapters.routes.ts's
  // `{ type: 'json_schema', name: 'ChapterSummary' }` (not the full schema).
  // Falls back to `responseFormat` itself when omitted.
  snapshotResponseFormat?: unknown;
}

export interface PreparedVeniceCall {
  requestParams: Record<string, unknown>;
  snapshot: VeniceRequestSnapshot;
}

export function prepareVeniceCall(input: PrepareVeniceCallInput): PreparedVeniceCall {
  const modelInfo = veniceModelsService.findModel(input.modelId, input.userId);
  const venice_parameters = buildVeniceParams({
    base: input.baseVeniceParams,
    supportsReasoning: modelInfo?.supportsReasoning === true,
    enableWebSearch: input.enableWebSearch,
    enableChatStreamHints: input.enableChatStreamHints,
    includeVeniceSystemPrompt: input.includeVeniceSystemPrompt,
  });
  const reasoningEnabled = resolveReasoningEnabled(input.settings, modelInfo);

  const resolved = resolveTextGenWithFallback(
    input.settings,
    modelInfo,
    input.fallbackMaxCompletionTokens,
  );

  logVeniceParams({
    // logVeniceParams's route union excludes 'ai-models' (that route never
    // reaches a completion call); PrepareVeniceCallInput widens to the full
    // VeniceErrorContext union for symmetry with the error-mapping context.
    route: input.route as 'ai-complete' | 'chat' | 'chapter-summarise',
    userId: input.userId,
    modelId: input.modelId,
    resolved,
    action: input.action,
    modelCap: input.modelCap,
    enableWebSearch: venice_parameters.enable_web_search as string | undefined,
    reasoningEnabled,
  });

  const cacheKey = promptCacheKey(...input.cacheKeyParts);

  const requestParams: Record<string, unknown> = {
    model: input.modelId,
    messages: input.messages,
    temperature: resolved.temperature,
    top_p: resolved.top_p,
    max_completion_tokens: resolved.max_completion_tokens,
    ...(input.includeUsage === true ? { stream_options: { include_usage: true } } : {}),
    ...(input.responseFormat !== undefined ? { response_format: input.responseFormat } : {}),
    prompt_cache_key: cacheKey,
    venice_parameters,
    ...(reasoningEnabled ? {} : { reasoning: { enabled: false } }),
  };

  const snapshot: VeniceRequestSnapshot = {
    model: input.modelId,
    messageCount: input.messages.length,
    systemMessagePreview:
      typeof input.messages[0]?.content === 'string' ? input.messages[0].content : undefined,
    userMessagePreview:
      typeof input.messages.at(-1)?.content === 'string'
        ? (input.messages.at(-1)!.content as string)
        : undefined,
    venice_parameters,
    ...(input.responseFormat !== undefined
      ? { response_format: input.snapshotResponseFormat ?? input.responseFormat }
      : {}),
    promptCacheKey: cacheKey,
    temperature: resolved.temperature,
    top_p: resolved.top_p,
    max_completion_tokens: resolved.max_completion_tokens,
  };

  return { requestParams, snapshot };
}

// ─── streamVeniceToResponse ─────────────────────────────────────────────────────

export interface VeniceStreamChunk {
  choices: Array<{ delta: { content?: string | null }; finish_reason: string | null }>;
  usage?: { total_tokens?: number } | null;
  // Venice extension chunk ([V26]); typed here so hook callers need no cast.
  venice_search_results?: unknown;
}

export interface VeniceStreamHooks {
  /** Called per upstream chunk BEFORE default forwarding. Return 'consume' to
   *  suppress the default `data: <chunk>\n\n` frame (the hook may write its own
   *  frames via `write`). Default when absent: forward. */
  onChunk?: (chunk: VeniceStreamChunk, write: (frame: string) => void) => 'consume' | 'forward';
  /** Runs after the loop, before `data: [DONE]`, only when the client is still
   *  connected. Hooks MUST catch their own errors (see chat's persist catch) —
   *  a throw here would otherwise surface as a stream_error frame. */
  onDone?: () => Promise<void>;
}

interface VeniceStreamWithResponse {
  data: AsyncIterable<VeniceStreamChunk>;
  // Fetch API Response (not Express Response) — use structural type to avoid
  // the import collision between Express.Response and globalThis.Response.
  response: { headers: { get(name: string): string | null } };
}

export async function streamVeniceToResponse(opts: {
  client: OpenAI;
  req: Request;
  res: Response;
  prepared: PreparedVeniceCall;
  ctx: VeniceErrorContext;
  hooks?: VeniceStreamHooks;
}): Promise<void> {
  const { client, req, res, prepared, ctx, hooks } = opts;

  // [V9] Use .withResponse() so we can read rate-limit headers from the HTTP
  // response before the body streams. `venice_parameters` is not in the openai
  // SDK types; cast through unknown at the call site. Also cast .withResponse()
  // return so TS treats `data` as AsyncIterable<VeniceStreamChunk> (stream: true
  // guarantees this at runtime but the overload union obscures it).
  const streamWithResp = (await client.chat.completions
    .create({
      ...prepared.requestParams,
      stream: true as const,
    } as unknown as Parameters<typeof client.chat.completions.create>[0])
    .withResponse()) as unknown as VeniceStreamWithResponse;
  const { data: stream, response: veniceResponse } = streamWithResp;

  // ── Write SSE response headers ──────────────────────────────────────────────
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  // [V9][V28] Forward Venice rate-limit headers to the client so the frontend
  // can display "X / Y remaining until HH:MM" without a second round-trip.
  // Only set each when Venice actually sent it.
  const remainingRequests = veniceResponse.headers.get('x-ratelimit-remaining-requests');
  const remainingTokens = veniceResponse.headers.get('x-ratelimit-remaining-tokens');
  const limitRequests = veniceResponse.headers.get('x-ratelimit-limit-requests');
  const limitTokens = veniceResponse.headers.get('x-ratelimit-limit-tokens');
  const resetRequests = veniceResponse.headers.get('x-ratelimit-reset-requests');
  const resetTokens = veniceResponse.headers.get('x-ratelimit-reset-tokens');
  if (remainingRequests !== null) {
    res.setHeader('x-venice-remaining-requests', remainingRequests);
  }
  if (remainingTokens !== null) {
    res.setHeader('x-venice-remaining-tokens', remainingTokens);
  }
  if (limitRequests !== null) {
    res.setHeader('x-venice-limit-requests', limitRequests);
  }
  if (limitTokens !== null) {
    res.setHeader('x-venice-limit-tokens', limitTokens);
  }
  if (resetRequests !== null) {
    res.setHeader('x-venice-reset-requests', resetRequests);
  }
  if (resetTokens !== null) {
    res.setHeader('x-venice-reset-tokens', resetTokens);
  }

  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  // Headers are now committed — all errors from this point must be written
  // as terminal SSE frames; Express's global error handler can no longer
  // send an HTTP error response.

  // Stop iteration cleanly when the client disconnects mid-stream.
  let clientClosed = false;
  req.on('close', () => {
    clientClosed = true;
    // Best-effort abort of the Venice stream so we don't leak an open
    // connection upstream.
    try {
      (stream as unknown as { controller?: { abort?: () => void } }).controller?.abort?.();
    } catch {
      // Ignore — the stream may already be closed.
    }
  });

  try {
    for await (const chunk of stream) {
      if (clientClosed) break;
      const action = hooks?.onChunk?.(chunk, (frame) => res.write(frame)) ?? 'forward';
      if (action === 'forward') {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
    }

    if (!clientClosed) {
      if (hooks?.onDone) {
        await hooks.onDone();
      }
      res.write('data: [DONE]\n\n');
    }
  } catch (streamErr) {
    // Stream errored after headers were flushed — write a terminal error
    // frame so the client knows something went wrong, then close cleanly.
    // Do NOT call next(err): headers are already committed.
    logVeniceErrorDev({
      err: streamErr,
      ctx,
      request: prepared.snapshot,
    });
    if (!clientClosed) {
      // [V11] Map Venice API errors to structured SSE frames. Falls back to
      // generic stream_error for unknown errors.
      const handled = mapVeniceErrorToSse(streamErr, (data) => res.write(data), ctx);
      if (!handled) {
        res.write(
          `data: ${JSON.stringify({
            error: 'An internal stream error occurred.',
            code: 'stream_error',
            message: 'An internal stream error occurred.',
          })}\n\n`,
        );
        res.write('data: [DONE]\n\n');
      }
    }
  } finally {
    res.end();
  }
}
