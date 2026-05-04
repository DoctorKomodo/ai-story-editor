import type OpenAI from 'openai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createVeniceModelsService,
  UnknownModelError,
} from '../../src/services/venice.models.service';

// Shape of a Venice /v1/models entry. The `openai` SDK types its response as
// `{ id, object, created, owned_by }`, but Venice tunnels its capabilities +
// context length through `model_spec` and `type`. We carry extra fields
// through unchanged.
type VeniceRawModel = {
  id: string;
  object: 'model';
  type: 'text' | 'image' | 'embedding' | string;
  model_spec?: {
    name?: string;
    availableContextTokens?: number;
    capabilities?: {
      supportsReasoning?: boolean;
      supportsVision?: boolean;
      supportsWebSearch?: boolean;
    };
    description?: string;
    pricing?: {
      input?: { usd?: number; diem?: number };
      output?: { usd?: number; diem?: number };
    };
  };
};

function makeListStub(data: VeniceRawModel[]): { spy: ReturnType<typeof vi.fn>; client: OpenAI } {
  const spy = vi.fn(async () => ({ data }));
  // Only `models.list()` is exercised — cast via unknown to avoid any-typing
  // the rest of the OpenAI surface.
  const client = { models: { list: spy } } as unknown as OpenAI;
  return { spy, client };
}

const LLAMA: VeniceRawModel = {
  id: 'llama-3.3-70b',
  object: 'model',
  type: 'text',
  model_spec: {
    name: 'Llama 3.3 70B',
    description: 'A general-purpose 70B model tuned for instruction-following.',
    availableContextTokens: 65536,
    capabilities: { supportsReasoning: false, supportsVision: false },
    pricing: {
      input: { usd: 0.6, diem: 0.6 },
      output: { usd: 2.4, diem: 2.4 },
    },
  },
};

const QWEN_REASONING: VeniceRawModel = {
  id: 'qwen-qwq-32b',
  object: 'model',
  type: 'text',
  model_spec: {
    name: 'Qwen QwQ 32B',
    availableContextTokens: 32768,
    capabilities: { supportsReasoning: true, supportsVision: false },
  },
};

const VISION: VeniceRawModel = {
  id: 'mistral-vision',
  object: 'model',
  type: 'text',
  model_spec: {
    name: 'Mistral Vision',
    availableContextTokens: 131072,
    capabilities: { supportsReasoning: false, supportsVision: true },
  },
};

const WEB_SEARCH: VeniceRawModel = {
  id: 'llama-web-search',
  object: 'model',
  type: 'text',
  model_spec: {
    name: 'Llama Web Search',
    availableContextTokens: 65536,
    capabilities: { supportsReasoning: false, supportsVision: false, supportsWebSearch: true },
  },
};

const IMAGE: VeniceRawModel = {
  id: 'flux-schnell',
  object: 'model',
  type: 'image',
};

describe('venice.models.service [V2]', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchModels', () => {
    it('filters to text-type models and maps the Venice model_spec into the public shape', async () => {
      const { spy, client } = makeListStub([LLAMA, QWEN_REASONING, VISION, IMAGE]);
      const svc = createVeniceModelsService({
        getClient: async () => client,
      });

      const models = await svc.fetchModels('user-1');

      expect(spy).toHaveBeenCalledTimes(1);
      expect(models).toEqual([
        {
          id: 'llama-3.3-70b',
          name: 'Llama 3.3 70B',
          contextLength: 65536,
          supportsReasoning: false,
          supportsVision: false,
          supportsWebSearch: false,
          description: 'A general-purpose 70B model tuned for instruction-following.',
          pricing: { inputUsdPerMTok: 0.6, outputUsdPerMTok: 2.4 },
        },
        {
          id: 'qwen-qwq-32b',
          name: 'Qwen QwQ 32B',
          contextLength: 32768,
          supportsReasoning: true,
          supportsVision: false,
          supportsWebSearch: false,
          description: null,
          pricing: null,
        },
        {
          id: 'mistral-vision',
          name: 'Mistral Vision',
          contextLength: 131072,
          supportsReasoning: false,
          supportsVision: true,
          supportsWebSearch: false,
          description: null,
          pricing: null,
        },
      ]);
    });

    it('maps supportsWebSearch: true when Venice advertises it', async () => {
      const { client } = makeListStub([WEB_SEARCH]);
      const svc = createVeniceModelsService({ getClient: async () => client });

      const [only] = await svc.fetchModels('user-1');
      expect(only.id).toBe('llama-web-search');
      expect(only.supportsWebSearch).toBe(true);
    });

    it('falls back sensibly when Venice omits model_spec fields', async () => {
      const bare: VeniceRawModel = {
        id: 'bare-text',
        object: 'model',
        type: 'text',
      };
      const { client } = makeListStub([bare]);
      const svc = createVeniceModelsService({ getClient: async () => client });

      const [only] = await svc.fetchModels('user-1');
      expect(only.id).toBe('bare-text');
      expect(only.name).toBe('bare-text');
      expect(only.contextLength).toBe(0);
      expect(only.supportsReasoning).toBe(false);
      expect(only.supportsVision).toBe(false);
      expect(only.supportsWebSearch).toBe(false);
      expect(only.description).toBeNull();
      expect(only.pricing).toBeNull();
    });

    it('omits pricing when only the input side is present', async () => {
      const halfPriced: VeniceRawModel = {
        id: 'half-priced',
        object: 'model',
        type: 'text',
        model_spec: {
          name: 'Half Priced',
          pricing: { input: { usd: 0.15 } },
        },
      };
      const { client } = makeListStub([halfPriced]);
      const svc = createVeniceModelsService({ getClient: async () => client });

      const [only] = await svc.fetchModels('user-1');
      expect(only.pricing).toBeNull();
    });

    it('omits pricing when output.usd is non-numeric', async () => {
      const bad: VeniceRawModel = {
        id: 'bad-priced',
        object: 'model',
        type: 'text',
        model_spec: {
          name: 'Bad Priced',
          pricing: {
            input: { usd: 0.15 },
            // @ts-expect-error — intentional non-numeric to mirror upstream noise
            output: { usd: 'free' },
          },
        },
      };
      const { client } = makeListStub([bad]);
      const svc = createVeniceModelsService({ getClient: async () => client });

      const [only] = await svc.fetchModels('user-1');
      expect(only.pricing).toBeNull();
    });

    it('normalises blank description to null', async () => {
      const blank: VeniceRawModel = {
        id: 'blank-desc',
        object: 'model',
        type: 'text',
        model_spec: { name: 'Blank Desc', description: '   ' },
      };
      const { client } = makeListStub([blank]);
      const svc = createVeniceModelsService({ getClient: async () => client });

      const [only] = await svc.fetchModels('user-1');
      expect(only.description).toBeNull();
    });

    it('serves from cache within the 10-minute TTL without re-calling Venice', async () => {
      const { spy, client } = makeListStub([LLAMA]);
      let current = 1_000_000;
      const svc = createVeniceModelsService({
        getClient: async () => client,
        now: () => current,
      });

      await svc.fetchModels('user-1');
      current += 9 * 60 * 1000; // 9 min later
      await svc.fetchModels('user-1');
      current += 59 * 1000; // 9:59 total
      await svc.fetchModels('user-1');

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('refetches after the TTL expires', async () => {
      const { spy, client } = makeListStub([LLAMA]);
      let current = 1_000_000;
      const svc = createVeniceModelsService({
        getClient: async () => client,
        now: () => current,
      });

      await svc.fetchModels('user-1');
      current += 10 * 60 * 1000 + 1;
      await svc.fetchModels('user-1');

      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('scopes the cache per user — two users each trigger their own fetch', async () => {
      const { spy, client } = makeListStub([LLAMA]);
      const svc = createVeniceModelsService({ getClient: async () => client });

      await svc.fetchModels('user-a');
      await svc.fetchModels('user-b');

      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  describe('getModelContextLength', () => {
    it('returns the cached context length for a previously fetched model', async () => {
      const { client } = makeListStub([LLAMA, QWEN_REASONING]);
      const svc = createVeniceModelsService({ getClient: async () => client });

      await svc.fetchModels('user-1');

      expect(svc.getModelContextLength('llama-3.3-70b')).toBe(65536);
      expect(svc.getModelContextLength('qwen-qwq-32b')).toBe(32768);
    });

    it('throws UnknownModelError for a model id that is not in the cache', async () => {
      const svc = createVeniceModelsService({
        getClient: async () => makeListStub([]).client,
      });

      expect(() => svc.getModelContextLength('never-fetched')).toThrow(UnknownModelError);
    });
  });
});
