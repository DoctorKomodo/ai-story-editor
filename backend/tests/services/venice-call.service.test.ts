import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserSettings } from '../../src/routes/user-settings.routes';
import type { ModelInfo } from '../../src/services/venice.models.service';
import {
  buildVeniceParams,
  hydrateUserSettings,
  logVeniceParams,
  promptCacheKey,
  resolveReasoningEnabled,
  resolveTextGenWithFallback,
} from '../../src/services/venice-call.service';
import { resetUsers } from '../helpers/db';
import { prisma } from '../setup';

describe('promptCacheKey', () => {
  it('returns a 32-char hex string for a single part', () => {
    const key = promptCacheKey('story-abc');
    expect(key).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is deterministic — same parts → same output', () => {
    expect(promptCacheKey('s', 'm')).toBe(promptCacheKey('s', 'm'));
  });

  it('different parts → different output', () => {
    expect(promptCacheKey('s1', 'm')).not.toBe(promptCacheKey('s2', 'm'));
    expect(promptCacheKey('s', 'm1')).not.toBe(promptCacheKey('s', 'm2'));
  });
});

describe('hydrateUserSettings', () => {
  let userId: string;

  afterEach(async () => {
    await resetUsers();
  });

  it('null settingsJson → defaults (includeVeniceSystemPrompt true, empty userPrompts, empty chat)', async () => {
    const user = await prisma.user.create({
      data: {
        username: `hus-${Math.random().toString(36).slice(2, 10)}`,
        passwordHash: 'h',
        settingsJson: undefined,
      },
    });
    userId = user.id;
    const result = await hydrateUserSettings(userId);
    expect(result.raw).toBeNull();
    expect(result.includeVeniceSystemPrompt).toBe(true);
    expect(result.userPrompts).toEqual({});
    expect(result.settings.chat).toEqual({ model: null, overrides: {} });
  });

  it('full settings shape passes through and resolvers compute correctly', async () => {
    const settingsJson = {
      ai: { includeVeniceSystemPrompt: false },
      prompts: { system: 'custom system' },
      chat: { model: 'llama-3.1-70b', overrides: { 'llama-3.1-70b': { temperature: 0.5 } } },
    };
    const user = await prisma.user.create({
      data: {
        username: `hus-${Math.random().toString(36).slice(2, 10)}`,
        passwordHash: 'h',
        settingsJson,
      },
    });
    userId = user.id;
    const result = await hydrateUserSettings(userId);
    expect(result.includeVeniceSystemPrompt).toBe(false);
    expect(result.userPrompts).toEqual({ system: 'custom system' });
    expect(result.settings.chat.model).toBe('llama-3.1-70b');
    expect(result.settings.chat.overrides['llama-3.1-70b']?.temperature).toBe(0.5);
  });

  it('partial settings — missing chat — gets defensive default chat shape', async () => {
    const user = await prisma.user.create({
      data: {
        username: `hus-${Math.random().toString(36).slice(2, 10)}`,
        passwordHash: 'h',
        settingsJson: { ai: { includeVeniceSystemPrompt: false } },
      },
    });
    userId = user.id;
    const result = await hydrateUserSettings(userId);
    expect(result.settings.chat).toEqual({ model: null, overrides: {} });
  });
});

describe('buildVeniceParams', () => {
  it('spreads base unchanged when no flags set', () => {
    const base = { include_venice_system_prompt: true };
    expect(buildVeniceParams({ base, supportsReasoning: false })).toEqual(base);
  });

  it('supportsReasoning=true adds strip_thinking_response: true', () => {
    const out = buildVeniceParams({ base: {}, supportsReasoning: true });
    expect(out.strip_thinking_response).toBe(true);
  });

  it('enableWebSearch=true adds enable_web_search auto + enable_web_citations', () => {
    const out = buildVeniceParams({ base: {}, supportsReasoning: false, enableWebSearch: true });
    expect(out.enable_web_search).toBe('auto');
    expect(out.enable_web_citations).toBe(true);
  });

  it('enableChatStreamHints=true adds include_search_results_in_stream', () => {
    const out = buildVeniceParams({
      base: {},
      supportsReasoning: false,
      enableChatStreamHints: true,
    });
    expect(out.include_search_results_in_stream).toBe(true);
  });

  // Regression guard: a truthy check on includeVeniceSystemPrompt would
  // silently drop false, letting Venice default to true and ignore the
  // user's toggle.
  it('explicit includeVeniceSystemPrompt:false overrides base value of true', () => {
    const out = buildVeniceParams({
      base: { include_venice_system_prompt: true },
      supportsReasoning: false,
      includeVeniceSystemPrompt: false,
    });
    expect(out.include_venice_system_prompt).toBe(false);
  });

  it('explicit includeVeniceSystemPrompt:true writes through when base is empty', () => {
    const out = buildVeniceParams({
      base: {},
      supportsReasoning: false,
      includeVeniceSystemPrompt: true,
    });
    expect(out.include_venice_system_prompt).toBe(true);
  });
});

describe('resolveTextGenWithFallback', () => {
  const emptySettings: UserSettings = { chat: { model: null, overrides: {} } } as UserSettings;

  it('modelInfo undefined → returns global-default fallback with provided maxCompletionTokens', () => {
    const out = resolveTextGenWithFallback(emptySettings, undefined, 1234);
    expect(out.temperature).toBeUndefined();
    expect(out.top_p).toBeUndefined();
    expect(out.max_completion_tokens).toBe(1234);
    expect(out.source.temperature).toBe('global-default');
    expect(out.source.top_p).toBe('global-default');
    expect(out.source.max_completion_tokens).toBe('global-default');
  });

  it('modelInfo null → returns global-default fallback (same as undefined)', () => {
    const out = resolveTextGenWithFallback(emptySettings, null, 5678);
    expect(out.temperature).toBeUndefined();
    expect(out.top_p).toBeUndefined();
    expect(out.max_completion_tokens).toBe(5678);
    expect(out.source.temperature).toBe('global-default');
  });

  it('modelInfo present → delegates to resolveTextGenParams', () => {
    const modelInfo: ModelInfo = {
      id: 'llama-3.1-70b',
      name: 'Llama 3.1 70B',
      contextLength: 8192,
      maxCompletionTokens: 4096,
      defaultTemperature: 0.7,
      defaultTopP: 0.95,
      supportsReasoning: false,
      supportsVision: false,
      supportsWebSearch: false,
      supportsResponseSchema: false,
      description: null,
      pricing: null,
    };
    const out = resolveTextGenWithFallback(emptySettings, modelInfo, 999);
    // No user override → falls back to Venice model defaults
    expect(out.temperature).toBe(0.7);
    expect(out.top_p).toBe(0.95);
    expect(out.source.temperature).toBe('venice-default');
  });
});

describe('logVeniceParams', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development');
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    logSpy.mockRestore();
  });

  it('logs [venice.params] with the full input shape', () => {
    logVeniceParams({
      route: 'chapter-summarise',
      userId: 'u1',
      modelId: 'llama-3.1-70b',
      resolved: {
        temperature: 0.7,
        top_p: 0.95,
        max_completion_tokens: 4096,
        source: {
          temperature: 'override',
          top_p: 'venice-default',
          max_completion_tokens: 'venice-default',
        },
      },
      action: 'summariseChapter',
      modelCap: 4096,
      reasoningEnabled: false,
    });
    expect(logSpy).toHaveBeenCalledOnce();
    expect(logSpy.mock.calls[0]?.[0]).toBe('[venice.params]');
    const payload = JSON.parse(logSpy.mock.calls[0]?.[1] as string);
    expect(payload.route).toBe('chapter-summarise');
    expect(payload.userId).toBe('u1');
    expect(payload.temperature.value).toBe(0.7);
    expect(payload.temperature.source).toBe('override');
  });

  it('does not log in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    logVeniceParams({
      route: 'ai-complete',
      userId: 'u1',
      modelId: 'm',
      resolved: {
        temperature: 0.7,
        top_p: 0.95,
        max_completion_tokens: 100,
        source: { temperature: 'override', top_p: 'override', max_completion_tokens: 'override' },
      },
      modelCap: 100,
      reasoningEnabled: true,
    });
    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe('resolveReasoningEnabled', () => {
  const reasoning = { id: 'r', supportsReasoning: true } as unknown as ModelInfo;
  const plain = { id: 'p', supportsReasoning: false } as unknown as ModelInfo;
  const s = (ov: Record<string, { reasoning?: boolean }>) =>
    ({ chat: { model: null, overrides: ov } }) as unknown as UserSettings;

  it('defaults to enabled (true) for a reasoning model with no override', () => {
    expect(resolveReasoningEnabled(s({}), reasoning)).toBe(true);
  });
  it('returns false only when a reasoning model is explicitly overridden off', () => {
    expect(resolveReasoningEnabled(s({ r: { reasoning: false } }), reasoning)).toBe(false);
  });
  it('returns true for a non-reasoning model even if overridden off', () => {
    expect(resolveReasoningEnabled(s({ p: { reasoning: false } }), plain)).toBe(true);
  });
  it('returns true for null modelInfo', () => {
    expect(resolveReasoningEnabled(s({}), null)).toBe(true);
  });
});
