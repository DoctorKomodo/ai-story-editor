// [V12] Tests for AI action system prompts and per-action user prompt templates.
// Verifies each of the five original actions (continue, rephrase, expand,
// summarise, freeform) produces appropriately-worded prompts with correct
// selection delimiters and system message.

import { describe, expect, it } from 'vitest';
import {
  buildPrompt,
  renderAskUserContent,
  DEFAULT_SYSTEM_PROMPT,
  type BuildPromptInput,
} from '../../src/services/prompt.service';

function baseInput(overrides: Partial<BuildPromptInput> = {}): BuildPromptInput {
  return {
    action: 'continue',
    selectedText: 'She turned and ran.',
    chapterContent: 'It was a dark and stormy night.',
    characters: [],
    worldNotes: null,
    modelContextLength: 4096,
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

describe('[V12] system message — all actions use DEFAULT_SYSTEM_PROMPT by default', () => {
  const actions: Array<BuildPromptInput['action']> = [
    'continue',
    'rephrase',
    'expand',
    'summarise',
  ];

  for (const action of actions) {
    it(`action=${action} → system message is DEFAULT_SYSTEM_PROMPT`, () => {
      const content = systemContent(baseInput({ action }));
      expect(content).toBe(DEFAULT_SYSTEM_PROMPT);
    });
  }

  it('action=freeform → system message is DEFAULT_SYSTEM_PROMPT', () => {
    const content = systemContent(
      baseInput({ action: 'freeform', freeformInstruction: 'Rewrite as Hemingway.' }),
    );
    expect(content).toBe(DEFAULT_SYSTEM_PROMPT);
  });
});

// ─── action: continue ─────────────────────────────────────────────────────────

describe('[V12] action=continue', () => {
  it('user message contains "continue" instruction', () => {
    const content = userContent(baseInput({ action: 'continue', selectedText: 'She fled.' }));
    expect(content.toLowerCase()).toContain('continue');
  });

  it('user message contains selection wrapped in «…» delimiters', () => {
    const content = userContent(baseInput({ action: 'continue', selectedText: 'She fled.' }));
    expect(content).toContain('«She fled.»');
  });

  it('user message contains a word-count target (~80–150 words)', () => {
    const content = userContent(baseInput({ action: 'continue', selectedText: 'She fled.' }));
    // The template includes a word count hint for ⌥↵ cursor-context continuation
    expect(content.toLowerCase()).toMatch(/\b(80|150|words?)\b/i);
  });

  it('empty selectedText → selection delimiter «…» is NOT included', () => {
    const content = userContent(baseInput({ action: 'continue', selectedText: '' }));
    expect(content).not.toContain('«');
    expect(content).not.toContain('»');
  });
});

// ─── action: rephrase ─────────────────────────────────────────────────────────

describe('[V12] action=rephrase', () => {
  it('user message contains "rephrase" instruction', () => {
    const content = userContent(baseInput({ action: 'rephrase', selectedText: 'He said hello.' }));
    expect(content.toLowerCase()).toContain('rephrase');
  });

  it('user message contains selection wrapped in «…» delimiters', () => {
    const content = userContent(baseInput({ action: 'rephrase', selectedText: 'He said hello.' }));
    expect(content).toContain('«He said hello.»');
  });

  it('user message mentions preserving meaning', () => {
    const content = userContent(baseInput({ action: 'rephrase', selectedText: 'Text.' }));
    expect(content.toLowerCase()).toContain('meaning');
  });
});

// ─── action: expand ───────────────────────────────────────────────────────────

describe('[V12] action=expand', () => {
  it('user message contains "expand" instruction', () => {
    const content = userContent(baseInput({ action: 'expand', selectedText: 'The door creaked.' }));
    expect(content.toLowerCase()).toContain('expand');
  });

  it('user message contains selection wrapped in «…» delimiters', () => {
    const content = userContent(baseInput({ action: 'expand', selectedText: 'The door creaked.' }));
    expect(content).toContain('«The door creaked.»');
  });

  it('user message mentions detail/description/depth', () => {
    const content = userContent(baseInput({ action: 'expand', selectedText: 'Text.' }));
    expect(content.toLowerCase()).toMatch(/detail|description|depth/);
  });
});

// ─── action: summarise ────────────────────────────────────────────────────────

describe('[V12] action=summarise', () => {
  it('user message contains "summarise"/"summarize" instruction', () => {
    const content = userContent(
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

  it('user message mentions a sentence count limit', () => {
    const content = userContent(baseInput({ action: 'summarise', selectedText: 'Text.' }));
    // Template says "1–3 sentences"
    expect(content.toLowerCase()).toMatch(/sentence/);
  });
});

// ─── action: freeform ─────────────────────────────────────────────────────────

describe('[V12] action=freeform', () => {
  it('user message contains freeformInstruction verbatim', () => {
    const instruction = 'Rewrite in the style of Hemingway.';
    const content = userContent(
      baseInput({ action: 'freeform', freeformInstruction: instruction, selectedText: 'Text.' }),
    );
    expect(content).toContain(instruction);
  });

  it('user message contains the selectedText', () => {
    const content = userContent(
      baseInput({
        action: 'freeform',
        freeformInstruction: 'Do something.',
        selectedText: 'Unique freeform text.',
      }),
    );
    expect(content).toContain('Unique freeform text.');
  });

  it('empty freeformInstruction → empty string prefix (no crash)', () => {
    expect(() =>
      buildPrompt(baseInput({ action: 'freeform', freeformInstruction: '', selectedText: 'T.' })),
    ).not.toThrow();
  });
});

// ─── renderAskUserContent ─────────────────────────────────────────────────────

describe('renderAskUserContent', () => {
  it('without selection: returns "User question: <instruction>"', () => {
    const result = renderAskUserContent({ freeformInstruction: 'What happens next?' });
    expect(result).toBe('User question: What happens next?');
    expect(result).not.toContain('Attached selection');
  });

  it('with selection: appends "Attached selection: «…»" on a new line', () => {
    const result = renderAskUserContent({
      freeformInstruction: 'Explain this passage.',
      selectionText: 'The sun rose slowly.',
    });
    expect(result).toBe(
      'User question: Explain this passage.\n\nAttached selection: «The sun rose slowly.»',
    );
  });

  it('empty selectionText is treated as no selection (no attachment block)', () => {
    const result = renderAskUserContent({
      freeformInstruction: 'Tell me more.',
      selectionText: '',
    });
    expect(result).toBe('User question: Tell me more.');
    expect(result).not.toContain('Attached selection');
  });

  it('null selectionText is treated as no selection', () => {
    const result = renderAskUserContent({
      freeformInstruction: 'Any thoughts?',
      selectionText: null,
    });
    expect(result).toBe('User question: Any thoughts?');
    expect(result).not.toContain('Attached selection');
  });

  it('matches the framing that buildPrompt action=ask produces', () => {
    const instruction = 'What is the theme here?';
    const selection = 'He walked away in silence.';

    // Via buildPrompt (integration path).
    const built = buildPrompt(
      baseInput({ action: 'ask', freeformInstruction: instruction, selectedText: selection }),
    );
    const builtUserContent = built.messages.find((m) => m.role === 'user')?.content ?? '';

    // Via renderAskUserContent (history-reconstruction path).
    const rendered = renderAskUserContent({ freeformInstruction: instruction, selectionText: selection });

    // The task block is embedded inside a larger user message (chapter, characters, etc.),
    // but both must agree on the key framing strings.
    expect(builtUserContent).toContain(rendered);
  });
});
