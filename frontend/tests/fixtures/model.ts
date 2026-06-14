import type { Model } from '@/hooks/useModels';

/**
 * Typed Model fixture. `Model` is the frontend-local interface from
 * `@/hooks/useModels` (it mirrors the backend ModelInfo wire shape, not a
 * shared zod type). Explicit `: Model` return annotation localizes drift.
 */
export function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'llama-3.3-70b',
    name: 'Llama 3.3 70B',
    contextLength: 128_000,
    maxCompletionTokens: 16_384,
    supportsReasoning: false,
    supportsVision: false,
    supportsWebSearch: false,
    description: null,
    pricing: null,
    defaultTemperature: null,
    defaultTopP: null,
    ...overrides,
  };
}
