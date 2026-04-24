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
    ...overrides,
  };
}

function userContent(input: BuildPromptInput): string {
  const result = buildPrompt(input);
  return result.messages.find((m) => m.role === 'user')?.content ?? '';
}

// ─── action: rewrite ──────────────────────────────────────────────────────────

describe('[V14] action=rewrite', () => {
  it('user message contains "rewrite" instruction', () => {
    const content = userContent(baseInput({ action: 'rewrite', selectedText: 'She ran away.' }));
    expect(content.toLowerCase()).toContain('rewrite');
  });

  it('user message contains selection wrapped in «…» delimiters', () => {
    const content = userContent(baseInput({ action: 'rewrite', selectedText: 'She ran away.' }));
    expect(content).toContain('«She ran away.»');
  });

  it('user message mentions preserving meaning or voice', () => {
    const content = userContent(baseInput({ action: 'rewrite', selectedText: 'Text.' }));
    expect(content.toLowerCase()).toMatch(/meaning|voice/);
  });

  it('returns a single alternative version', () => {
    const content = userContent(baseInput({ action: 'rewrite', selectedText: 'Text.' }));
    expect(content.toLowerCase()).toContain('single');
  });
});

// ─── action: describe ─────────────────────────────────────────────────────────

describe('[V14] action=describe', () => {
  it('user message contains "describe" instruction', () => {
    const content = userContent(baseInput({ action: 'describe', selectedText: 'The old tower.' }));
    expect(content.toLowerCase()).toContain('describe');
  });

  it('user message contains selection wrapped in «…» delimiters', () => {
    const content = userContent(baseInput({ action: 'describe', selectedText: 'The old tower.' }));
    expect(content).toContain('«The old tower.»');
  });

  it('user message mentions sensory, physical, or emotional detail', () => {
    const content = userContent(baseInput({ action: 'describe', selectedText: 'Text.' }));
    expect(content.toLowerCase()).toMatch(/sensory|physical|emotional/);
  });

  it('user message mentions maintaining POV and tense', () => {
    const content = userContent(baseInput({ action: 'describe', selectedText: 'Text.' }));
    expect(content.toLowerCase()).toMatch(/pov|tense/i);
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

  it('user message labels the selection as "Attached selection"', () => {
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

  it('user message contains "User question:" label', () => {
    const content = userContent(
      baseInput({
        action: 'ask',
        selectedText: 'Text.',
        freeformInstruction: 'How does this end?',
      }),
    );
    expect(content.toLowerCase()).toContain('user question');
  });
});

// ─── action: continue (revised — word-count target) ───────────────────────────

describe('[V14] action=continue — word-count hint', () => {
  it('user message contains roughly 80–150 word target', () => {
    const content = userContent(baseInput({ action: 'continue', selectedText: 'She looked up.' }));
    // Template: "Aim for roughly 80–150 words"
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
    expect(content.toLowerCase()).toContain('rephrase');
  });

  it('action=summarise still produces a non-empty user message', () => {
    const content = userContent(baseInput({ action: 'summarise', selectedText: 'Long text.' }));
    expect(content.length).toBeGreaterThan(0);
    expect(content.toLowerCase()).toMatch(/summar/);
  });

  it('action=expand still produces a non-empty user message', () => {
    const content = userContent(baseInput({ action: 'expand', selectedText: 'Short text.' }));
    expect(content.length).toBeGreaterThan(0);
    expect(content.toLowerCase()).toContain('expand');
  });

  it('action=freeform still passes instruction through', () => {
    const instruction = 'Write this differently.';
    const content = userContent(
      baseInput({ action: 'freeform', freeformInstruction: instruction, selectedText: 'T.' }),
    );
    expect(content).toContain(instruction);
  });
});
