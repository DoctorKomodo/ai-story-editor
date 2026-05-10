// [V12] Tests for AI action system prompts and per-action user prompt templates.
// Verifies each of the five original actions (continue, rephrase, expand,
// summarise, freeform) produces appropriately-worded prompts with correct
// selection delimiters and system message.

import { describe, expect, it } from 'vitest';
import {
  type BuildPromptInput,
  buildPrompt,
  DEFAULT_SYSTEM_PROMPT,
} from '../../src/services/prompt.service';

function baseInput(overrides: Partial<BuildPromptInput> = {}): BuildPromptInput {
  return {
    action: 'continue',
    selectedText: 'She turned and ran.',
    chapterContent: 'It was a dark and stormy night.',
    characters: [],
    worldNotes: null,
    modelContextLength: 4096,
    modelMaxCompletionTokens: 4096,
    userMaxCompletionTokens: Number.POSITIVE_INFINITY,
    ...overrides,
  };
}

function userContent(input: BuildPromptInput): string {
  const result = buildPrompt(input);
  return result.messages.find((m) => m.role === 'user')?.content ?? '';
}

function systemContent(input: BuildPromptInput): string {
  return buildPrompt(input).messages[0]?.content ?? '';
}

// ─── System message defaults to DEFAULT_SYSTEM_PROMPT ─────────────────────────

describe('[V12] system message — all actions open with DEFAULT_SYSTEM_PROMPT', () => {
  const actions: Array<BuildPromptInput['action']> = [
    'continue',
    'rephrase',
    'expand',
    'summarise',
  ];

  for (const action of actions) {
    it(`action=${action} → system message starts with DEFAULT_SYSTEM_PROMPT`, () => {
      const content = systemContent(baseInput({ action }));
      expect(content.startsWith(DEFAULT_SYSTEM_PROMPT)).toBe(true);
    });
  }

  it('action=freeform → system message starts with DEFAULT_SYSTEM_PROMPT', () => {
    const content = systemContent(
      baseInput({ action: 'freeform', freeformInstruction: 'Rewrite as Hemingway.' }),
    );
    expect(content.startsWith(DEFAULT_SYSTEM_PROMPT)).toBe(true);
  });
});

// ─── action: continue ─────────────────────────────────────────────────────────

describe('[V12] action=continue', () => {
  it('system message contains the "continue" task instruction', () => {
    const content = systemContent(baseInput({ action: 'continue', selectedText: 'She fled.' }));
    expect(content.toLowerCase()).toMatch(/task:\s*continue/);
  });

  it('user message contains selection wrapped in «…» delimiters', () => {
    const content = userContent(baseInput({ action: 'continue', selectedText: 'She fled.' }));
    expect(content).toContain('«She fled.»');
  });

  it('system message contains a word-count target (~80–150 words)', () => {
    const content = systemContent(baseInput({ action: 'continue', selectedText: 'She fled.' }));
    expect(content.toLowerCase()).toMatch(/\b(80|150|words?)\b/i);
  });

  it('empty selectedText: user payload is the imperative fallback "Continue." (no «…»)', () => {
    const content = userContent(baseInput({ action: 'continue', selectedText: '' }));
    expect(content).toBe('Continue.');
    expect(content).not.toContain('«');
    expect(content).not.toContain('»');
  });
});

// ─── action: rephrase ─────────────────────────────────────────────────────────

describe('[V12] action=rephrase', () => {
  it('system message contains the rewrite instruction (collapsed under X29)', () => {
    const content = systemContent(
      baseInput({ action: 'rephrase', selectedText: 'He said hello.' }),
    );
    expect(content.toLowerCase()).toContain('rewrite');
  });

  it('user message contains selection wrapped in «…» delimiters', () => {
    const content = userContent(baseInput({ action: 'rephrase', selectedText: 'He said hello.' }));
    expect(content).toContain('«He said hello.»');
  });

  it('system message mentions preserving meaning', () => {
    const content = systemContent(
      baseInput({ action: 'rephrase', selectedText: 'He said hello.' }),
    );
    expect(content.toLowerCase()).toMatch(/preserving|preserve|meaning/);
  });
});

// ─── action: expand ───────────────────────────────────────────────────────────

describe('[V12] action=expand', () => {
  it('system message contains the "expand" instruction', () => {
    const content = systemContent(
      baseInput({ action: 'expand', selectedText: 'The door creaked.' }),
    );
    expect(content.toLowerCase()).toContain('expand');
  });

  it('user message contains selection wrapped in «…» delimiters', () => {
    const content = userContent(baseInput({ action: 'expand', selectedText: 'The door creaked.' }));
    expect(content).toContain('«The door creaked.»');
  });

  it('system message mentions detail/description/depth', () => {
    const content = systemContent(
      baseInput({ action: 'expand', selectedText: 'The door creaked.' }),
    );
    expect(content.toLowerCase()).toMatch(/detail|descri|depth/);
  });
});

// ─── action: summarise ────────────────────────────────────────────────────────

describe('[V12] action=summarise', () => {
  it('system message contains the "summarise"/"summarize" instruction', () => {
    const content = systemContent(
      baseInput({ action: 'summarise', selectedText: 'A long passage.' }),
    );
    expect(content.toLowerCase()).toMatch(/summar(i|y)s?e/);
  });

  it('user message contains selection wrapped in «…» delimiters', () => {
    const content = userContent(
      baseInput({ action: 'summarise', selectedText: 'A long passage.' }),
    );
    expect(content).toContain('«A long passage.»');
  });

  it('system message mentions a sentence count limit', () => {
    const content = systemContent(
      baseInput({ action: 'summarise', selectedText: 'A long passage.' }),
    );
    expect(content.toLowerCase()).toMatch(/sentence|1.*2.*3|essential/);
  });
});

// ─── action: freeform ─────────────────────────────────────────────────────────

describe('[V12] action=freeform', () => {
  it('user message contains freeformInstruction verbatim', () => {
    const instruction = 'Rewrite in the style of Hemingway.';
    const content = userContent(
      baseInput({ action: 'freeform', freeformInstruction: instruction, selectedText: '' }),
    );
    expect(content).toContain(instruction);
  });

  it('user message contains the selectedText (when present)', () => {
    const content = userContent(
      baseInput({
        action: 'freeform',
        freeformInstruction: 'Tighten this.',
        selectedText: 'A long passage.',
      }),
    );
    expect(content).toContain('«A long passage.»');
  });

  it('throws when freeformInstruction is missing', () => {
    expect(() =>
      buildPrompt(
        baseInput({
          action: 'freeform',
          freeformInstruction: undefined,
          selectedText: 'Text.',
        }),
      ),
    ).toThrow(/freeformInstruction/i);
  });
});
