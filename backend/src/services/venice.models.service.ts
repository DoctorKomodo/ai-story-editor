// [V2] Venice models cache. One source of truth for the list of text models a
// BYOK user can pick from and for per-model context budgets. Token counts are
// never hardcoded elsewhere — the prompt builder ([V3]) looks them up here.
//
// Venice's /v1/models response is OpenAI-compatible with extensions: each
// model carries a `type` ("text" | "image" | ...) and a `model_spec` block
// with `availableContextTokens` and a `capabilities` map. We map that into a
// narrower public `ModelInfo` shape.

import type OpenAI from 'openai';
import { getVeniceClient } from '../lib/venice';

export interface ModelPricing {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  contextLength: number;
  maxCompletionTokens: number;
  supportsReasoning: boolean;
  supportsVision: boolean;
  supportsWebSearch: boolean;
  description: string | null;
  pricing: ModelPricing | null;
  defaultTemperature: number | null;
  defaultTopP: number | null;
}

export class UnknownModelError extends Error {
  readonly code = 'unknown_model';
  constructor(public readonly modelId: string) {
    super(`Unknown Venice model: ${modelId}`);
    this.name = 'UnknownModelError';
  }
}

const TTL_MS = 10 * 60 * 1000;

// Cap used when Venice's /v1/models omits or zeroes maxCompletionTokens.
// 4096 is below every observed Venice cap (lowest in the catalogue today is
// 4096 itself), so a request built against it will never trip the upstream
// "max_tokens > maximum allowed" 400.
const FALLBACK_MAX_COMPLETION_TOKENS = 4096;

interface VeniceRawCapabilities {
  supportsReasoning?: boolean;
  supportsVision?: boolean;
  supportsWebSearch?: boolean;
}

interface VeniceRawModelSpec {
  name?: string;
  availableContextTokens?: number;
  maxCompletionTokens?: number;
  capabilities?: VeniceRawCapabilities;
  description?: string;
  pricing?: {
    input?: { usd?: number };
    output?: { usd?: number };
  };
  constraints?: {
    temperature?: { default?: number };
    top_p?: { default?: number };
  };
}

interface VeniceRawModel {
  id: string;
  type?: string;
  model_spec?: VeniceRawModelSpec;
}

export function mapModel(raw: VeniceRawModel): ModelInfo {
  const spec = raw.model_spec ?? {};
  const caps = spec.capabilities ?? {};

  const rawDesc = typeof spec.description === 'string' ? spec.description.trim() : '';
  const description = rawDesc.length > 0 ? rawDesc : null;

  const inUsd = spec.pricing?.input?.usd;
  const outUsd = spec.pricing?.output?.usd;
  const pricing =
    typeof inUsd === 'number' && typeof outUsd === 'number'
      ? { inputUsdPerMTok: inUsd, outputUsdPerMTok: outUsd }
      : null;

  const rawCap = spec.maxCompletionTokens;
  let maxCompletionTokens: number;
  if (typeof rawCap === 'number' && rawCap > 0) {
    maxCompletionTokens = rawCap;
  } else {
    maxCompletionTokens = FALLBACK_MAX_COMPLETION_TOKENS;
    console.warn(
      `[venice.models] model "${raw.id}" exposes no positive maxCompletionTokens; defaulting to ${FALLBACK_MAX_COMPLETION_TOKENS}`,
    );
  }

  const constraints = spec.constraints ?? {};
  const dt = constraints.temperature?.default;
  const dp = constraints.top_p?.default;
  const defaultTemperature = typeof dt === 'number' ? dt : null;
  const defaultTopP = typeof dp === 'number' ? dp : null;

  return {
    id: raw.id,
    name: spec.name ?? raw.id,
    contextLength:
      typeof spec.availableContextTokens === 'number' ? spec.availableContextTokens : 0,
    maxCompletionTokens,
    supportsReasoning: Boolean(caps.supportsReasoning),
    supportsVision: Boolean(caps.supportsVision),
    supportsWebSearch: Boolean(caps.supportsWebSearch),
    description,
    pricing,
    defaultTemperature,
    defaultTopP,
  };
}

export interface VeniceModelsServiceDeps {
  getClient?: (userId: string) => Promise<OpenAI>;
  now?: () => number;
}

interface CacheEntry {
  models: ModelInfo[];
  fetchedAt: number;
}

export function createVeniceModelsService(deps: VeniceModelsServiceDeps = {}) {
  const getClient = deps.getClient ?? getVeniceClient;
  const now = deps.now ?? Date.now;

  // Per-user cache: different users may use different endpoints, and each
  // endpoint may expose a different model list. Context-length lookups fan
  // out across every user's cache (see getModelContextLength below).
  const byUser = new Map<string, CacheEntry>();

  async function fetchModels(userId: string): Promise<ModelInfo[]> {
    const hit = byUser.get(userId);
    if (hit && now() - hit.fetchedAt < TTL_MS) {
      return hit.models;
    }

    const client = await getClient(userId);
    // Venice's extensions aren't typed in the openai SDK — the SDK exposes
    // only { id, object, created, owned_by }. Cast through unknown to pick
    // up `type` and `model_spec`.
    const page = await client.models.list();
    const data = (page as unknown as { data: VeniceRawModel[] }).data ?? [];

    const models = data.filter((m) => (m.type ?? 'text') === 'text').map(mapModel);

    byUser.set(userId, { models, fetchedAt: now() });
    return models;
  }

  function getModelContextLength(modelId: string): number {
    for (const entry of byUser.values()) {
      for (const m of entry.models) {
        if (m.id === modelId) return m.contextLength;
      }
    }
    throw new UnknownModelError(modelId);
  }

  function getModelMaxCompletionTokens(modelId: string): number {
    for (const entry of byUser.values()) {
      for (const m of entry.models) {
        if (m.id === modelId) return m.maxCompletionTokens;
      }
    }
    throw new UnknownModelError(modelId);
  }

  // [V6] Find a model by id from the in-memory cache. Returns null when the
  // model isn't present. fetchModels() must have been called first (which
  // /api/ai/complete always does) so the cache is populated; a null return
  // means "not in Venice's list for this user", not "cache is empty".
  function findModel(modelId: string): ModelInfo | null {
    for (const entry of byUser.values()) {
      for (const m of entry.models) {
        if (m.id === modelId) return m;
      }
    }
    return null;
  }

  function resetCache(): void {
    byUser.clear();
  }

  return { fetchModels, getModelContextLength, getModelMaxCompletionTokens, findModel, resetCache };
}

export const veniceModelsService = createVeniceModelsService();
