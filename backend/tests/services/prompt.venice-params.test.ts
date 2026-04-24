// [V4] Tests for venice_parameters.include_venice_system_prompt handling.
// Verifies that the flag is driven entirely by the caller-supplied input —
// never hardcoded — and that the default (omitted) resolves to true.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type BuildPromptInput, buildPrompt } from '../../src/services/prompt.service';

function baseInput(overrides: Partial<BuildPromptInput> = {}): BuildPromptInput {
  return {
    action: 'continue',
    selectedText: 'A test selection.',
    chapterContent: 'Some chapter content.',
    characters: [],
    worldNotes: null,
    modelContextLength: 4096,
    ...overrides,
  };
}

// ─── Three branches required by [V4] ─────────────────────────────────────────

describe('[V4] venice_parameters.include_venice_system_prompt', () => {
  it('explicit true → flag is true', () => {
    const result = buildPrompt(baseInput({ includeVeniceSystemPrompt: true }));
    expect(result.venice_parameters.include_venice_system_prompt).toBe(true);
  });

  it('explicit false → flag is false', () => {
    const result = buildPrompt(baseInput({ includeVeniceSystemPrompt: false }));
    expect(result.venice_parameters.include_venice_system_prompt).toBe(false);
  });

  it('omitted → flag is true (default)', () => {
    // No includeVeniceSystemPrompt key in input
    const input = baseInput();
    delete (input as Partial<BuildPromptInput>).includeVeniceSystemPrompt;
    const result = buildPrompt(input);
    expect(result.venice_parameters.include_venice_system_prompt).toBe(true);
  });
});

// ─── "Never hardcoded" guarantee ─────────────────────────────────────────────
// Read the source file as text and assert that the property assignment does
// NOT use a bare literal `true` as its value. The only way the property should
// be set is via a variable/expression that comes from the input.

describe('[V4] source-code: flag is not hardcoded', () => {
  it('include_venice_system_prompt is never assigned the literal boolean true directly', () => {
    const sourcePath = resolve(__dirname, '../../src/services/prompt.service.ts');
    const source = readFileSync(sourcePath, 'utf-8');

    // Pattern that would indicate a hardcoded true assignment, e.g.:
    //   include_venice_system_prompt: true
    // (with optional whitespace around the colon)
    const hardcodedPattern = /include_venice_system_prompt\s*:\s*true\b/;
    expect(hardcodedPattern.test(source)).toBe(false);
  });
});
