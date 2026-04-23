import { describe, expect, it } from 'vitest';
import {
  buildPrompt,
  estimateTokens,
  DEFAULT_SYSTEM_PROMPT,
  type BuildPromptInput,
} from '../../src/services/prompt.service';

// ─── estimateTokens ──────────────────────────────────────────────────────────

describe('estimateTokens', () => {
  it('is exported and returns ceil(chars / 4)', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('a'.repeat(100))).toBe(25);
    expect(estimateTokens('a'.repeat(101))).toBe(26);
  });
});

// ─── DEFAULT_SYSTEM_PROMPT ───────────────────────────────────────────────────

describe('DEFAULT_SYSTEM_PROMPT', () => {
  it('is a non-empty exported string', () => {
    expect(typeof DEFAULT_SYSTEM_PROMPT).toBe('string');
    expect(DEFAULT_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Shape / structure ───────────────────────────────────────────────────────

describe('buildPrompt — shape', () => {
  it('returns messages, venice_parameters, and max_tokens', () => {
    const result = buildPrompt(baseInput());
    expect(result).toHaveProperty('messages');
    expect(result).toHaveProperty('venice_parameters');
    expect(result).toHaveProperty('max_tokens');
    expect(Array.isArray(result.messages)).toBe(true);
  });

  it('first message is system role', () => {
    const result = buildPrompt(baseInput());
    expect(result.messages[0]?.role).toBe('system');
  });

  it('uses DEFAULT_SYSTEM_PROMPT when storySystemPrompt is null', () => {
    const result = buildPrompt(baseInput({ storySystemPrompt: null }));
    expect(result.messages[0]?.content).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it('uses storySystemPrompt when provided as a non-empty string', () => {
    const customPrompt = 'You are a gothic horror novelist.';
    const result = buildPrompt(baseInput({ storySystemPrompt: customPrompt }));
    expect(result.messages[0]?.content).toBe(customPrompt);
  });

  it('falls back to DEFAULT_SYSTEM_PROMPT when storySystemPrompt is undefined', () => {
    const result = buildPrompt(baseInput({ storySystemPrompt: undefined }));
    expect(result.messages[0]?.content).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it('falls back to DEFAULT_SYSTEM_PROMPT when storySystemPrompt is empty string', () => {
    const result = buildPrompt(baseInput({ storySystemPrompt: '' }));
    expect(result.messages[0]?.content).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it('has a user message following the system message', () => {
    const result = buildPrompt(baseInput());
    const userMsg = result.messages.find((m) => m.role === 'user');
    expect(userMsg).toBeTruthy();
    expect(typeof userMsg?.content).toBe('string');
  });
});

// ─── max_tokens budget ────────────────────────────────────────────────────────

describe('buildPrompt — max_tokens', () => {
  it('equals floor(modelContextLength * 0.2)', () => {
    const result = buildPrompt(baseInput({ modelContextLength: 4096 }));
    expect(result.max_tokens).toBe(Math.floor(4096 * 0.2));
  });

  it('works for a larger context length', () => {
    const result = buildPrompt(baseInput({ modelContextLength: 65536 }));
    expect(result.max_tokens).toBe(Math.floor(65536 * 0.2));
  });

  it('floors non-integer result (4097 * 0.2 = 819.4 → 819)', () => {
    expect(buildPrompt(baseInput({ modelContextLength: 4097 })).max_tokens).toBe(819);
  });
});

// ─── Action → task block ──────────────────────────────────────────────────────

describe('buildPrompt — action task block', () => {
  function userContent(input: BuildPromptInput): string {
    const result = buildPrompt(input);
    return result.messages.find((m) => m.role === 'user')?.content ?? '';
  }

  it('action=continue includes the selection and "continue" instruction', () => {
    const content = userContent(baseInput({ action: 'continue', selectedText: 'She fled.' }));
    expect(content.toLowerCase()).toContain('continue');
    expect(content).toContain('She fled.');
  });

  it('action=rephrase includes the selection and "rephrase" instruction', () => {
    const content = userContent(baseInput({ action: 'rephrase', selectedText: 'He said hello.' }));
    expect(content.toLowerCase()).toContain('rephrase');
    expect(content).toContain('He said hello.');
  });

  it('action=expand includes the selection and "expand" instruction', () => {
    const content = userContent(baseInput({ action: 'expand', selectedText: 'The door creaked.' }));
    expect(content.toLowerCase()).toContain('expand');
    expect(content).toContain('The door creaked.');
  });

  it('action=summarise includes the selection and "summarise" or "summarize" instruction', () => {
    const content = userContent(
      baseInput({ action: 'summarise', selectedText: 'A long passage.' }),
    );
    expect(content.toLowerCase()).toMatch(/summar(i|y)s?e/);
    expect(content).toContain('A long passage.');
  });

  it('action=freeform uses freeformInstruction verbatim', () => {
    const instruction = 'Rewrite in the style of Hemingway.';
    const content = userContent(
      baseInput({ action: 'freeform', freeformInstruction: instruction, selectedText: 'Text.' }),
    );
    expect(content).toContain(instruction);
    expect(content).toContain('Text.');
  });
});

// ─── World notes and characters ───────────────────────────────────────────────

describe('buildPrompt — worldNotes and characters', () => {
  it('includes worldNotes in the user message', () => {
    const content = buildPrompt(
      baseInput({ worldNotes: 'The world is a vast ocean.' }),
    ).messages.find((m) => m.role === 'user')?.content ?? '';
    expect(content).toContain('The world is a vast ocean.');
  });

  it('includes character name, role, and keyTraits in the user message', () => {
    const content = buildPrompt(
      baseInput({
        characters: [{ name: 'Eira', role: 'Protagonist', keyTraits: 'brave, reckless' }],
      }),
    ).messages.find((m) => m.role === 'user')?.content ?? '';
    expect(content).toContain('Eira');
    expect(content).toContain('Protagonist');
    expect(content).toContain('brave, reckless');
  });

  it('handles characters with null role / keyTraits gracefully', () => {
    expect(() =>
      buildPrompt(
        baseInput({
          characters: [{ name: 'Nobody', role: null, keyTraits: null }],
        }),
      ),
    ).not.toThrow();
  });
});

// ─── Truncation ───────────────────────────────────────────────────────────────

describe('buildPrompt — chapterContent truncation', () => {
  // A 200k-char chapter content against a 4096-token context is obviously
  // over-budget. The prompt builder must truncate from the TOP (oldest chars),
  // so the END of the string (newest content) survives.
  it('truncates chapterContent from the top when over budget', () => {
    const HEAD = 'HEAD_DROPPED_SENTINEL';
    const TAIL = 'TAIL_CONTENT_SURVIVES';
    const bigContent = HEAD + 'x'.repeat(200_000) + TAIL;
    const result = buildPrompt(
      baseInput({ chapterContent: bigContent, modelContextLength: 4096 }),
    );
    const userContent = result.messages.find((m) => m.role === 'user')?.content ?? '';
    // The tail (newest content) must survive
    expect(userContent).toContain(TAIL);
    // The head (oldest content) must have been dropped
    expect(userContent).not.toContain(HEAD);
    // The overall token count of the user message must be ≤ promptBudget
    const promptBudget = Math.floor(4096 * 0.8);
    const sysTokens = estimateTokens(result.messages[0]?.content ?? '');
    const userTokens = estimateTokens(userContent);
    expect(sysTokens + userTokens).toBeLessThanOrEqual(promptBudget + 10); // small rounding slack
  });

  it('sets chapterContent to empty string when worldNotes + characters alone exceed budget', () => {
    // worldNotes that fill the entire budget
    const fatWorldNotes = 'W'.repeat(4096 * 4 * 2); // 2× the total token budget
    const result = buildPrompt(
      baseInput({
        worldNotes: fatWorldNotes,
        chapterContent: 'Should be gone.',
        modelContextLength: 4096,
      }),
    );
    const userContent = result.messages.find((m) => m.role === 'user')?.content ?? '';
    // worldNotes must still appear (never truncated)
    expect(userContent).toContain('W'.repeat(20)); // at least the start of worldNotes
    // chapter content should be empty or absent
    expect(userContent).not.toContain('Should be gone.');
  });

  it('worldNotes are never truncated even when they alone exceed the budget', () => {
    const fatWorldNotes = 'W'.repeat(4096 * 4 * 2);
    const result = buildPrompt(
      baseInput({ worldNotes: fatWorldNotes, modelContextLength: 4096 }),
    );
    const userContent = result.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userContent).toContain(fatWorldNotes);
  });

  it('characters are never truncated even when they alone exceed the budget', () => {
    const fatTraits = 'T'.repeat(4096 * 4 * 2);
    const result = buildPrompt(
      baseInput({
        characters: [{ name: 'BigChar', role: 'Hero', keyTraits: fatTraits }],
        modelContextLength: 4096,
      }),
    );
    const userContent = result.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userContent).toContain(fatTraits);
  });
});
