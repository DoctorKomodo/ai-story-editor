import { describe, expect, it } from 'vitest';
import { GLOBAL_TEXT_GEN_DEFAULTS } from '../../src/lib/text-gen-defaults';
import type { UserSettings } from '../../src/routes/user-settings.routes';
import {
  resolveIncludeVeniceSystemPrompt,
  resolveTextGenParams,
  resolveUserPrompts,
} from '../../src/services/user-settings-resolvers';
import type { ModelInfo } from '../../src/services/venice.models.service';

describe('resolveIncludeVeniceSystemPrompt', () => {
  it('defaults to true when raw is null', () => {
    expect(resolveIncludeVeniceSystemPrompt(null)).toBe(true);
  });
  it('defaults to true when raw is not an object', () => {
    expect(resolveIncludeVeniceSystemPrompt('nope')).toBe(true);
    expect(resolveIncludeVeniceSystemPrompt(42)).toBe(true);
  });
  it('defaults to true when ai.includeVeniceSystemPrompt is absent', () => {
    expect(resolveIncludeVeniceSystemPrompt({})).toBe(true);
    expect(resolveIncludeVeniceSystemPrompt({ ai: {} })).toBe(true);
  });
  it('returns the explicit value when set', () => {
    expect(resolveIncludeVeniceSystemPrompt({ ai: { includeVeniceSystemPrompt: false } })).toBe(
      false,
    );
    expect(resolveIncludeVeniceSystemPrompt({ ai: { includeVeniceSystemPrompt: true } })).toBe(
      true,
    );
  });
  it('ignores non-boolean values and falls back to true', () => {
    expect(
      resolveIncludeVeniceSystemPrompt({
        ai: { includeVeniceSystemPrompt: 'yes' as unknown as boolean },
      }),
    ).toBe(true);
  });
});

describe('resolveUserPrompts', () => {
  it('returns {} when raw is null / not-an-object', () => {
    expect(resolveUserPrompts(null)).toEqual({});
    expect(resolveUserPrompts('nope')).toEqual({});
  });
  it('returns {} when prompts is absent', () => {
    expect(resolveUserPrompts({})).toEqual({});
  });
  it('returns the prompts slice when present', () => {
    expect(resolveUserPrompts({ prompts: { system: 'Hi', continue: null } })).toEqual({
      system: 'Hi',
      continue: null,
    });
  });
  it('carries a summariseChapter override through', () => {
    const override = 'Custom chapter-summary prompt.';
    const result = resolveUserPrompts({ prompts: { summariseChapter: override } });
    expect(result.summariseChapter).toBe(override);
  });
  it('carries a null summariseChapter (reset to default) through', () => {
    const result = resolveUserPrompts({ prompts: { summariseChapter: null } });
    expect(result.summariseChapter).toBeNull();
  });
});

// ─── resolveTextGenParams ─────────────────────────────────────────────────────

const MODEL_WITH_DEFAULTS: ModelInfo = {
  id: 'qwen-3-6-plus',
  name: 'Qwen 3.6 Plus',
  contextLength: 1_000_000,
  maxCompletionTokens: 65_536,
  supportsReasoning: true,
  supportsVision: true,
  supportsWebSearch: true,
  description: null,
  pricing: null,
  defaultTemperature: 0.7,
  defaultTopP: 0.8,
};

const MODEL_BARE: ModelInfo = {
  ...MODEL_WITH_DEFAULTS,
  id: 'bare-model',
  defaultTemperature: null,
  defaultTopP: null,
};

const SMALL_MODEL: ModelInfo = {
  ...MODEL_WITH_DEFAULTS,
  id: 'small-model',
  maxCompletionTokens: 500,
};

function settingsWith(overrides: UserSettings['chat']['overrides']): UserSettings {
  return {
    chat: { model: null, overrides },
  } as UserSettings;
}

describe('resolveTextGenParams', () => {
  it('uses Venice defaults when no override and Venice exposes them', () => {
    const result = resolveTextGenParams(settingsWith({}), MODEL_WITH_DEFAULTS);
    expect(result.temperature).toBe(0.7);
    expect(result.top_p).toBe(0.8);
    expect(result.source.temperature).toBe('venice-default');
    expect(result.source.top_p).toBe('venice-default');
  });

  it('falls back to global defaults when Venice exposes nothing', () => {
    const result = resolveTextGenParams(settingsWith({}), MODEL_BARE);
    expect(result.temperature).toBe(GLOBAL_TEXT_GEN_DEFAULTS.temperature);
    expect(result.top_p).toBe(GLOBAL_TEXT_GEN_DEFAULTS.topP);
    expect(result.source.temperature).toBe('global-default');
    expect(result.source.top_p).toBe('global-default');
  });

  it('user override wins over Venice default', () => {
    const result = resolveTextGenParams(
      settingsWith({ 'qwen-3-6-plus': { temperature: 1.2 } }),
      MODEL_WITH_DEFAULTS,
    );
    expect(result.temperature).toBe(1.2);
    expect(result.source.temperature).toBe('override');
    expect(result.top_p).toBe(0.8);
    expect(result.source.top_p).toBe('venice-default');
  });

  it('partial overrides per model — only set fields override', () => {
    const result = resolveTextGenParams(settingsWith({ 'bare-model': { topP: 0.5 } }), MODEL_BARE);
    expect(result.top_p).toBe(0.5);
    expect(result.source.top_p).toBe('override');
    expect(result.temperature).toBe(GLOBAL_TEXT_GEN_DEFAULTS.temperature);
    expect(result.source.temperature).toBe('global-default');
  });

  it('overrides are scoped per modelId — other models unaffected', () => {
    const result = resolveTextGenParams(
      settingsWith({ 'other-model': { temperature: 1.5 } }),
      MODEL_WITH_DEFAULTS,
    );
    expect(result.temperature).toBe(0.7);
    expect(result.source.temperature).toBe('venice-default');
  });

  it('maxTokens override caps at modelInfo.maxCompletionTokens with override-capped source', () => {
    const result = resolveTextGenParams(
      settingsWith({ 'small-model': { maxTokens: 9_999 } }),
      SMALL_MODEL,
    );
    expect(result.max_completion_tokens).toBe(500);
    expect(result.source.max_completion_tokens).toBe('override-capped');
  });

  it('maxTokens override under cap is reported as override (not capped)', () => {
    const result = resolveTextGenParams(
      settingsWith({ 'small-model': { maxTokens: 200 } }),
      SMALL_MODEL,
    );
    expect(result.max_completion_tokens).toBe(200);
    expect(result.source.max_completion_tokens).toBe('override');
  });

  it('maxTokens with no override falls to global default capped by model max', () => {
    const result = resolveTextGenParams(settingsWith({}), SMALL_MODEL);
    // global default 800 > model cap 500 → cap wins, source is venice-default
    // (the cap came from the model itself, not from a user override)
    expect(result.max_completion_tokens).toBe(500);
    expect(result.source.max_completion_tokens).toBe('venice-default');
  });

  it('treats overrides[modelId] === {} identically to absent key', () => {
    const result = resolveTextGenParams(settingsWith({ 'qwen-3-6-plus': {} }), MODEL_WITH_DEFAULTS);
    expect(result.source.temperature).toBe('venice-default');
    expect(result.source.top_p).toBe('venice-default');
    expect(result.source.max_completion_tokens).toBe('venice-default');
  });
});
