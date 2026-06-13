// Pure resolvers for User.settingsJson — the JSON blob is opaque from the
// Prisma side, so each AI/chat route had been re-deriving the same defensive
// reads from `unknown`. Lifted here so additions live alongside the existing
// ones. `resolveTextGenParams` is the canonical path for AI-call parameters
// (temperature / top_p / max_completion_tokens) as of X28.
//
// Each resolver returns a sane default for unset / non-object / wrong-shape
// inputs so callers can always pass the resolved value into buildPrompt
// without further branching.

import { GLOBAL_TEXT_GEN_DEFAULTS, MAX_OUTPUT_TOKENS_CEILING } from '../lib/text-gen-defaults';
import type { UserSettings } from '../routes/user-settings.routes';
import type { ModelInfo } from './venice.models.service';

export interface PromptsSettings {
  system?: string | null;
  continue?: string | null;
  rewrite?: string | null;
  expand?: string | null;
  summarise?: string | null;
  summariseChapter?: string | null;
  describe?: string | null;
  scene?: string | null;
  ask?: string | null;
}

interface UserSettingsShape {
  ai?: { includeVeniceSystemPrompt?: boolean };
  prompts?: PromptsSettings;
}

function asSettingsObject(raw: unknown): UserSettingsShape | null {
  if (!raw || typeof raw !== 'object') return null;
  return raw as UserSettingsShape;
}

// ─── resolveTextGenParams ─────────────────────────────────────────────────────

export type ParamSource = 'override' | 'override-capped' | 'venice-default' | 'global-default';

export interface ResolvedTextGenParams {
  temperature: number;
  top_p: number;
  max_completion_tokens: number;
  source: {
    temperature: ParamSource;
    top_p: ParamSource;
    max_completion_tokens: ParamSource;
  };
}

/**
 * Resolves the three text-generation parameters (temperature, top_p,
 * max_completion_tokens) for a given model, walking the chain:
 *   user override → Venice model default → global default
 *
 * Returns both the resolved values and a `source` map so callers can
 * surface provenance in debug logs and UI tooltips (X28).
 */
export function resolveTextGenParams(
  settings: UserSettings,
  modelInfo: ModelInfo,
): ResolvedTextGenParams {
  const override = settings.chat.overrides?.[modelInfo.id] ?? {};

  // temperature
  let temperature: number;
  let temperatureSource: ParamSource;
  if (typeof override.temperature === 'number') {
    temperature = override.temperature;
    temperatureSource = 'override';
  } else if (typeof modelInfo.defaultTemperature === 'number') {
    temperature = modelInfo.defaultTemperature;
    temperatureSource = 'venice-default';
  } else {
    temperature = GLOBAL_TEXT_GEN_DEFAULTS.temperature;
    temperatureSource = 'global-default';
  }

  // top_p
  let top_p: number;
  let topPSource: ParamSource;
  if (typeof override.topP === 'number') {
    top_p = override.topP;
    topPSource = 'override';
  } else if (typeof modelInfo.defaultTopP === 'number') {
    top_p = modelInfo.defaultTopP;
    topPSource = 'venice-default';
  } else {
    top_p = GLOBAL_TEXT_GEN_DEFAULTS.topP;
    topPSource = 'global-default';
  }

  // max_completion_tokens — capped at modelInfo.maxCompletionTokens
  const cap = modelInfo.maxCompletionTokens;
  let max_completion_tokens: number;
  let maxSource: ParamSource;
  if (typeof override.maxTokens === 'number') {
    if (override.maxTokens > cap) {
      max_completion_tokens = cap;
      maxSource = 'override-capped';
    } else {
      max_completion_tokens = override.maxTokens;
      maxSource = 'override';
    }
  } else {
    // No user override. Default to as much output as the model allows, bounded
    // by our UI ceiling: min(cap, CEILING). Source reflects which bound wins —
    // the model's Venice-published cap when it's the binding value, our ceiling
    // constant otherwise. (Most models expose >= 32K, so 'global-default' is the
    // common outcome.) GLOBAL_TEXT_GEN_DEFAULTS.maxTokens no longer participates.
    max_completion_tokens = Math.min(cap, MAX_OUTPUT_TOKENS_CEILING);
    maxSource = cap <= MAX_OUTPUT_TOKENS_CEILING ? 'venice-default' : 'global-default';
  }

  return {
    temperature,
    top_p,
    max_completion_tokens,
    source: {
      temperature: temperatureSource,
      top_p: topPSource,
      max_completion_tokens: maxSource,
    },
  };
}

export function resolveIncludeVeniceSystemPrompt(raw: unknown): boolean {
  const settings = asSettingsObject(raw);
  if (!settings) return true;
  const flag = settings.ai?.includeVeniceSystemPrompt;
  if (typeof flag === 'boolean') return flag;
  return true;
}

export function resolveUserPrompts(raw: unknown): PromptsSettings {
  const settings = asSettingsObject(raw);
  if (!settings) return {};
  return settings.prompts ?? {};
}
