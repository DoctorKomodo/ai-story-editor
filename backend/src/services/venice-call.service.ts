import { createHash } from 'node:crypto';
import { prisma } from '../lib/prisma';
import type { UserSettings } from '../routes/user-settings.routes';
import {
  type PromptsSettings,
  type ResolvedTextGenParams,
  resolveIncludeVeniceSystemPrompt,
  resolveTextGenParams,
  resolveUserPrompts,
} from './user-settings-resolvers';
import type { ModelInfo } from './venice.models.service';

// Hash so the cache-key is opaque to Venice telemetry while still
// deterministic per (parts).
export function promptCacheKey(...parts: string[]): string {
  return createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 32);
}

export interface HydratedUserSettings {
  raw: unknown;
  settings: UserSettings;
  includeVeniceSystemPrompt: boolean;
  userPrompts: PromptsSettings;
}

/**
 * Loads user.settingsJson once, coerces to a full UserSettings shape, and
 * pre-runs the two existing resolvers.
 *
 * Defensive coerce: settingsJson is `unknown` from Prisma; pass through as
 * Partial<UserSettings>, then fill chat with safe defaults (null model,
 * empty overrides) so downstream resolveTextGenParams never sees `undefined`.
 */
export async function hydrateUserSettings(userId: string): Promise<HydratedUserSettings> {
  const userRow = await prisma.user.findUnique({
    where: { id: userId },
    select: { settingsJson: true },
  });
  const raw = userRow?.settingsJson ?? null;

  const partialSettings = (raw as Partial<UserSettings>) ?? {};
  const settings: UserSettings = {
    ...partialSettings,
    chat: {
      model: null,
      overrides: {},
      ...partialSettings.chat,
    },
  };

  return {
    raw,
    settings,
    includeVeniceSystemPrompt: resolveIncludeVeniceSystemPrompt(raw),
    userPrompts: resolveUserPrompts(raw),
  };
}

export interface BuildVeniceParamsInput {
  base: Record<string, unknown>;
  supportsReasoning: boolean;
  enableWebSearch?: boolean;
  enableChatStreamHints?: boolean;
  includeVeniceSystemPrompt?: boolean;
}

/**
 * Assemble the Venice-specific `venice_parameters` object for a completion
 * call. Spreads `base` first, then conditionally writes feature flags on top.
 *
 * Precedence rule: explicit input args use `!== undefined` checks (NOT truthy
 * checks). A user toggling `include_venice_system_prompt` OFF returns `false`
 * from the resolver — a truthy check would silently drop the field and Venice
 * would receive the default (true), violating the user's choice.
 */
export function buildVeniceParams(input: BuildVeniceParamsInput): Record<string, unknown> {
  const out: Record<string, unknown> = { ...input.base };

  if (input.supportsReasoning) {
    out.strip_thinking_response = true;
  }

  if (input.enableWebSearch === true) {
    out.enable_web_search = 'auto';
    out.enable_web_citations = true;
  }

  if (input.enableChatStreamHints === true) {
    out.include_search_results_in_stream = true;
  }

  if (input.includeVeniceSystemPrompt !== undefined) {
    out.include_venice_system_prompt = input.includeVeniceSystemPrompt;
  }

  return out;
}

/**
 * Thin wrapper over resolveTextGenParams that handles the modelInfo-null
 * case. The fallback handles the race where Venice's catalog cache refreshes
 * between fetchModels() and findModel().
 */
export function resolveTextGenWithFallback(
  settings: UserSettings,
  modelInfo: ModelInfo | null | undefined,
  fallbackMaxCompletionTokens: number,
): ResolvedTextGenParams {
  if (modelInfo == null) {
    return {
      temperature: undefined as unknown as number,
      top_p: undefined as unknown as number,
      max_completion_tokens: fallbackMaxCompletionTokens,
      source: {
        temperature: 'global-default',
        top_p: 'global-default',
        max_completion_tokens: 'global-default',
      },
    };
  }
  return resolveTextGenParams(settings, modelInfo);
}

/**
 * Whether reasoning should be left enabled (Venice's default) for this call.
 * Only a reasoning-capable model whose per-model override is explicitly `false`
 * disables it; everything else stays on. Computed at the assembly site so the
 * 3-param resolveTextGenParams contract stays focused.
 */
export function resolveReasoningEnabled(
  settings: UserSettings,
  modelInfo: ModelInfo | null | undefined,
): boolean {
  if (modelInfo == null || modelInfo.supportsReasoning !== true) return true;
  return settings.chat.overrides?.[modelInfo.id]?.reasoning !== false;
}

export interface LogVeniceParamsInput {
  route: 'ai-complete' | 'chat' | 'chapter-summarise';
  userId: string;
  modelId: string;
  resolved: ResolvedTextGenParams;
  action?: string;
  modelCap: number | undefined;
  enableWebSearch?: string;
  reasoningEnabled: boolean;
}

/**
 * Emit the [venice.params] structured dev log. Identical schema across the
 * three routes so a developer can diff resolved-params side-by-side.
 *
 * No-op in production.
 */
export function logVeniceParams(input: LogVeniceParamsInput): void {
  if (process.env.NODE_ENV === 'production') return;
  console.log(
    '[venice.params]',
    JSON.stringify({
      route: input.route,
      userId: input.userId,
      modelId: input.modelId,
      temperature: { value: input.resolved.temperature, source: input.resolved.source.temperature },
      top_p: { value: input.resolved.top_p, source: input.resolved.source.top_p },
      max_completion_tokens: {
        value: input.resolved.max_completion_tokens,
        source: input.resolved.source.max_completion_tokens,
      },
      action: input.action,
      model_cap: input.modelCap,
      enable_web_search: input.enableWebSearch,
      reasoning_enabled: input.reasoningEnabled,
    }),
  );
}
