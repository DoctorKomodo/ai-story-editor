import { describe, expect, it } from 'vitest';
import {
  resolveIncludeVeniceSystemPrompt,
  resolveUserPrompts,
} from '../../src/services/user-settings-resolvers';

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
});
