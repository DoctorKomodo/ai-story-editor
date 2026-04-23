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

export interface ModelInfo {
  id: string;
  name: string;
  contextLength: number;
  supportsReasoning: boolean;
  supportsVision: boolean;
}

export class UnknownModelError extends Error {
  readonly code = 'unknown_model';
  constructor(public readonly modelId: string) {
    super(`Unknown Venice model: ${modelId}`);
    this.name = 'UnknownModelError';
  }
}

const TTL_MS = 10 * 60 * 1000;

interface VeniceRawCapabilities {
  supportsReasoning?: boolean;
  supportsVision?: boolean;
}

interface VeniceRawModelSpec {
  name?: string;
  availableContextTokens?: number;
  capabilities?: VeniceRawCapabilities;
}

interface VeniceRawModel {
  id: string;
  type?: string;
  model_spec?: VeniceRawModelSpec;
}

function mapModel(raw: VeniceRawModel): ModelInfo {
  const spec = raw.model_spec ?? {};
  const caps = spec.capabilities ?? {};
  return {
    id: raw.id,
    name: spec.name ?? raw.id,
    contextLength: typeof spec.availableContextTokens === 'number' ? spec.availableContextTokens : 0,
    supportsReasoning: Boolean(caps.supportsReasoning),
    supportsVision: Boolean(caps.supportsVision),
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

    const models = data
      .filter((m) => (m.type ?? 'text') === 'text')
      .map(mapModel);

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

  return { fetchModels, getModelContextLength, findModel, resetCache };
}

export const veniceModelsService = createVeniceModelsService();
