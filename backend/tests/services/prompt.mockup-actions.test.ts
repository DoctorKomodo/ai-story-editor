// [V14] Tests for the extended action set: rewrite, describe, ask, and the
// refined continue action (with ~80-word word-count hint). Also smoke-tests
// that existing actions (rephrase, summarise) were not removed.

import { describe, expect, it } from 'vitest';
import { type BuildPromptInput, buildPrompt } from '../../src/services/prompt.service';

function baseInput(overrides: Partial<BuildPromptInput> = {}): BuildPromptInput {
  return {
    action: 'continue',
    selectedText: 'The candle flickered.',
    chapterContent: 'A quiet inn at the edge of the forest.',
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
  return buildPrompt(input).messages.find((m) => m.role === 'system')?.content ?? '';
}

// ─── action: rewrite ──────────────────────────────────────────────────────────

describe('[V14] action=rewrite', () => {
  it('system message contains "rewrite" instruction', () => {
    const content = systemContent(baseInput({ action: 'rewrite', selectedText: 'Hello.' }));
    expect(content.toLowerCase()).toContain('rewrite');
  });

  it('user message contains selection wrapped in «…» delimiters', () => {
    const content = userContent(baseInput({ action: 'rewrite', selectedText: 'Hello.' }));
    expect(content).toContain('«Hello.»');
  });

  it('system message mentions preserving meaning or voice', () => {
    const content = systemContent(baseInput({ action: 'rewrite', selectedText: 'Hello.' }));
    expect(content.toLowerCase()).toMatch(/preserving|preserve|meaning|voice/);
  });

  it('system message states a single alternative version', () => {
    const content = systemContent(baseInput({ action: 'rewrite', selectedText: 'Hello.' }));
    expect(content.toLowerCase()).toMatch(/single|alternative|version/);
  });
});

// ─── action: describe ─────────────────────────────────────────────────────────

describe('[V14] action=describe', () => {
  it('system message contains "describe" instruction', () => {
    const content = systemContent(baseInput({ action: 'describe', selectedText: 'The man.' }));
    expect(content.toLowerCase()).toContain('describe');
  });

  it('user message contains selection wrapped in «…» delimiters', () => {
    const content = userContent(baseInput({ action: 'describe', selectedText: 'The man.' }));
    expect(content).toContain('«The man.»');
  });

  it('system message mentions sensory, physical, or emotional detail', () => {
    const content = systemContent(baseInput({ action: 'describe', selectedText: 'The man.' }));
    expect(content.toLowerCase()).toMatch(/sensory|physical|emotional|detail/);
  });

  it('system message mentions maintaining POV and tense', () => {
    const content = systemContent(baseInput({ action: 'describe', selectedText: 'The man.' }));
    expect(content.toLowerCase()).toMatch(/pov|point of view|tense/);
  });
});

// ─── action: ask ──────────────────────────────────────────────────────────────

describe('[V14] action=ask', () => {
  it('user message contains the freeformInstruction verbatim', () => {
    const question = 'What motivates this character?';
    const content = userContent(
      baseInput({
        action: 'ask',
        selectedText: 'He stared into the fire.',
        freeformInstruction: question,
      }),
    );
    expect(content).toContain(question);
  });

  it('user message labels the attached selection as "Attached selection"', () => {
    const content = userContent(
      baseInput({
        action: 'ask',
        selectedText: 'He stared into the fire.',
        freeformInstruction: 'Why does he do this?',
      }),
    );
    expect(content.toLowerCase()).toContain('attached selection');
  });

  it('user message contains selection wrapped in «…» delimiters', () => {
    const content = userContent(
      baseInput({
        action: 'ask',
        selectedText: 'He stared into the fire.',
        freeformInstruction: 'Why?',
      }),
    );
    expect(content).toContain('«He stared into the fire.»');
  });

  it('throws when freeformInstruction is missing', () => {
    expect(() =>
      buildPrompt(
        baseInput({ action: 'ask', selectedText: 'Text.', freeformInstruction: undefined }),
      ),
    ).toThrow(/freeformInstruction/i);
  });

  it('user message does NOT contain the legacy "User question:" prefix (k1r)', () => {
    const content = userContent(
      baseInput({
        action: 'ask',
        selectedText: 'Text.',
        freeformInstruction: 'How does this end?',
      }),
    );
    expect(content.toLowerCase()).not.toContain('user question');
  });

  it('system message contains the ask task template', () => {
    const content = systemContent(baseInput({ action: 'ask', freeformInstruction: 'How?' }));
    expect(content.toLowerCase()).toMatch(/answer.*question|question.*story/);
  });
});

// ─── action: continue (revised — word-count target) ───────────────────────────

describe('[V14] action=continue — word-count hint', () => {
  it('system message contains roughly 80–150 word target', () => {
    const content = systemContent(
      baseInput({ action: 'continue', selectedText: 'She looked up.' }),
    );
    expect(content).toMatch(/80.{0,5}150/);
  });

  it('user message contains selection wrapped in «…» delimiters', () => {
    const content = userContent(baseInput({ action: 'continue', selectedText: 'She looked up.' }));
    expect(content).toContain('«She looked up.»');
  });
});

// ─── Smoke tests: existing actions not removed by V14 ─────────────────────────

describe('[V14] smoke — existing actions still produce prompts', () => {
  it('action=rephrase still produces a non-empty user message', () => {
    const content = userContent(baseInput({ action: 'rephrase', selectedText: 'Old text.' }));
    expect(content.length).toBeGreaterThan(0);
  });

  it('action=rephrase system message contains rewrite template', () => {
    const content = systemContent(baseInput({ action: 'rephrase', selectedText: 'Old text.' }));
    expect(content.toLowerCase()).toContain('rewrite');
  });

  it('action=summarise still produces a non-empty user message', () => {
    const content = userContent(baseInput({ action: 'summarise', selectedText: 'Long text.' }));
    expect(content.length).toBeGreaterThan(0);
  });

  it('action=summarise system message contains summarise template', () => {
    const content = systemContent(baseInput({ action: 'summarise', selectedText: 'Long text.' }));
    expect(content.toLowerCase()).toMatch(/summar/);
  });

  it('action=expand still produces a non-empty user message', () => {
    const content = userContent(baseInput({ action: 'expand', selectedText: 'Short text.' }));
    expect(content.length).toBeGreaterThan(0);
  });

  it('action=expand system message contains expand template', () => {
    const content = systemContent(baseInput({ action: 'expand', selectedText: 'Short text.' }));
    expect(content.toLowerCase()).toContain('expand');
  });
});
