// [V13] Per-story system prompt and include_venice_system_prompt independence.
// Verifies that:
//   1. storySystemPrompt overrides the default when non-null/non-empty.
//   2. null / undefined / '' / whitespace-only all fall back to DEFAULT_SYSTEM_PROMPT.
//   3. The include_venice_system_prompt flag is driven solely by includeVeniceSystemPrompt
//      input — it is unaffected by whether storySystemPrompt is set or null.

import { describe, expect, it } from 'vitest';
import {
  buildPrompt,
  DEFAULT_SYSTEM_PROMPT,
  type BuildPromptInput,
} from '../../src/services/prompt.service';

function baseInput(overrides: Partial<BuildPromptInput> = {}): BuildPromptInput {
  return {
    action: 'continue',
    selectedText: 'She ran.',
    chapterContent: 'A stormy night.',
    characters: [],
    worldNotes: null,
    modelContextLength: 4096,
    ...overrides,
  };
}

function systemMsg(input: BuildPromptInput): string {
  return buildPrompt(input).messages[0]?.content ?? '';
}

// ─── storySystemPrompt override ───────────────────────────────────────────────

describe('[V13] storySystemPrompt — override behaviour', () => {
  it('non-empty string → system message equals that string (not DEFAULT)', () => {
    const custom = 'You are a gothic horror novelist.';
    expect(systemMsg(baseInput({ storySystemPrompt: custom }))).toBe(custom);
  });

  it('non-empty string → system message is NOT DEFAULT_SYSTEM_PROMPT', () => {
    const custom = 'You are a gothic horror novelist.';
    expect(systemMsg(baseInput({ storySystemPrompt: custom }))).not.toBe(DEFAULT_SYSTEM_PROMPT);
  });
});

// ─── storySystemPrompt fallback ───────────────────────────────────────────────

describe('[V13] storySystemPrompt — fallback to DEFAULT_SYSTEM_PROMPT', () => {
  it('null → DEFAULT_SYSTEM_PROMPT', () => {
    expect(systemMsg(baseInput({ storySystemPrompt: null }))).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it('undefined → DEFAULT_SYSTEM_PROMPT', () => {
    expect(systemMsg(baseInput({ storySystemPrompt: undefined }))).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it('empty string → DEFAULT_SYSTEM_PROMPT', () => {
    expect(systemMsg(baseInput({ storySystemPrompt: '' }))).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it('whitespace-only string → DEFAULT_SYSTEM_PROMPT (trimmed to empty)', () => {
    expect(systemMsg(baseInput({ storySystemPrompt: '   ' }))).toBe(DEFAULT_SYSTEM_PROMPT);
  });
});

// ─── include_venice_system_prompt independence ────────────────────────────────
// 2 flag values × 4 storySystemPrompt states = 8 assertions.
// The Venice flag must never be influenced by what storySystemPrompt is set to.

type StoryPromptState = {
  label: string;
  value: string | null | undefined;
};

const storyPromptStates: StoryPromptState[] = [
  { label: 'null', value: null },
  { label: 'undefined', value: undefined },
  { label: 'empty string', value: '' },
  { label: 'non-empty string', value: 'Custom system prompt.' },
];

describe('[V13] include_venice_system_prompt is independent of storySystemPrompt', () => {
  for (const { label, value } of storyPromptStates) {
    it(`storySystemPrompt=${label} + includeVeniceSystemPrompt=true → flag is true`, () => {
      const result = buildPrompt(
        baseInput({ storySystemPrompt: value, includeVeniceSystemPrompt: true }),
      );
      expect(result.venice_parameters.include_venice_system_prompt).toBe(true);
    });

    it(`storySystemPrompt=${label} + includeVeniceSystemPrompt=false → flag is false`, () => {
      const result = buildPrompt(
        baseInput({ storySystemPrompt: value, includeVeniceSystemPrompt: false }),
      );
      expect(result.venice_parameters.include_venice_system_prompt).toBe(false);
    });
  }

  it('omitted includeVeniceSystemPrompt with custom storySystemPrompt → flag defaults to true', () => {
    const input = baseInput({ storySystemPrompt: 'Custom.' });
    delete (input as Partial<BuildPromptInput>).includeVeniceSystemPrompt;
    const result = buildPrompt(input);
    expect(result.venice_parameters.include_venice_system_prompt).toBe(true);
  });

  it('omitted includeVeniceSystemPrompt with null storySystemPrompt → flag defaults to true', () => {
    const input = baseInput({ storySystemPrompt: null });
    delete (input as Partial<BuildPromptInput>).includeVeniceSystemPrompt;
    const result = buildPrompt(input);
    expect(result.venice_parameters.include_venice_system_prompt).toBe(true);
  });
});
