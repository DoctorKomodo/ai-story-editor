// Shared Venice completion-call orchestration. Extracted from the near-identical
// hand-assembled sequences in ai.routes.ts, chat.routes.ts, and chapters.routes.ts
// (`/summarise`) — see docs/superpowers/plans/2026-07-02-venice-stream-service-extraction.md.
//
// Behavior-preserving: SSE frame bytes, the six x-venice-* headers, status codes,
// error envelopes, and upstream request semantics are unchanged from the three
// pre-extraction call sites. This module is also where all `as unknown as` casts
// against the openai SDK now live — the routes no longer touch the SDK's request/
// response shapes directly.

import type { VeniceErrorContext, VeniceRequestSnapshot } from '../lib/venice-errors';
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
