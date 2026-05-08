import { describe, expect, it } from 'vitest';
import {
  type BuildPromptInput,
  buildPrompt,
  DEFAULT_PROMPTS,
  DEFAULT_SYSTEM_PROMPT,
  estimateTokens,
  PromptValidationError,
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
    modelMaxCompletionTokens: 4096,
    userMaxCompletionTokens: Number.POSITIVE_INFINITY,
    ...overrides,
  };
}

// ─── Shape / structure ───────────────────────────────────────────────────────

describe('buildPrompt — shape', () => {
  it('returns messages, venice_parameters, and max_completion_tokens', () => {
    const result = buildPrompt(baseInput());
    expect(result).toHaveProperty('messages');
    expect(result).toHaveProperty('venice_parameters');
    expect(result).toHaveProperty('max_completion_tokens');
    expect(Array.isArray(result.messages)).toBe(true);
  });

  it('first message is system role', () => {
    const result = buildPrompt(baseInput());
    expect(result.messages[0]?.role).toBe('system');
  });

  // [X29] System-prompt resolution moved to userPrompts.system; full coverage
  // lives in prompt.user-prompts.test.ts. The storySystemPrompt input was
  // removed when per-story overrides were dropped.

  it('has a user message following the system message', () => {
    const result = buildPrompt(baseInput());
    const userMsg = result.messages.find((m) => m.role === 'user');
    expect(userMsg).toBeTruthy();
    expect(typeof userMsg?.content).toBe('string');
  });
});

// ─── max_completion_tokens budget ─────────────────────────────────────────────

describe('buildPrompt — max_completion_tokens', () => {
  it('user_setting < model_cap → user_setting wins', () => {
    const r = buildPrompt(
      baseInput({
        modelContextLength: 128_000,
        modelMaxCompletionTokens: 32_000,
        userMaxCompletionTokens: 800,
      }),
    );
    expect(r.max_completion_tokens).toBe(800);
  });

  it('model_cap < user_setting → model_cap wins', () => {
    const r = buildPrompt(
      baseInput({
        modelContextLength: 128_000,
        modelMaxCompletionTokens: 4096,
        userMaxCompletionTokens: 16_000,
      }),
    );
    expect(r.max_completion_tokens).toBe(4096);
  });

  it('user_setting === model_cap → that value', () => {
    const r = buildPrompt(
      baseInput({
        modelContextLength: 128_000,
        modelMaxCompletionTokens: 8192,
        userMaxCompletionTokens: 8192,
      }),
    );
    expect(r.max_completion_tokens).toBe(8192);
  });

  it('user_setting === Number.POSITIVE_INFINITY (unset) → model_cap wins', () => {
    const r = buildPrompt(
      baseInput({
        modelContextLength: 128_000,
        modelMaxCompletionTokens: 16_384,
        userMaxCompletionTokens: Number.POSITIVE_INFINITY,
      }),
    );
    expect(r.max_completion_tokens).toBe(16_384);
  });

  it('does NOT apply the legacy 0.2 × context heuristic any more', () => {
    // For a 256k-context model, the old code would have produced 51200.
    // Under the new rule, the model_cap dominates.
    const r = buildPrompt(
      baseInput({
        modelContextLength: 256_000,
        modelMaxCompletionTokens: 32_768,
        userMaxCompletionTokens: Number.POSITIVE_INFINITY,
      }),
    );
    expect(r.max_completion_tokens).toBe(32_768);
    expect(r.max_completion_tokens).not.toBe(Math.floor(256_000 * 0.2));
  });

  it('response cap is NOT shrunk by prompt-budget pressure (response > context-safety)', () => {
    // Pathological: response cap wider than the model's context. The builder
    // must still honour the response contract; chapter content just falls out.
    const r = buildPrompt(
      baseInput({
        modelContextLength: 4096,
        modelMaxCompletionTokens: 8192,
        userMaxCompletionTokens: Number.POSITIVE_INFINITY,
        chapterContent: 'x'.repeat(40_000),
      }),
    );
    expect(r.max_completion_tokens).toBe(8192);
    // Chapter is dropped because promptBudget = 4096 - 8192 - 512 < 0.
    const userMsg = r.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userMsg).not.toContain('xxxx'); // no chapter content survives
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

  it('action=rephrase uses the rewrite template (collapsed under X29) and includes the selection', () => {
    const content = userContent(baseInput({ action: 'rephrase', selectedText: 'He said hello.' }));
    expect(content.toLowerCase()).toContain('rewrite');
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
    const content =
      buildPrompt(baseInput({ worldNotes: 'The world is a vast ocean.' })).messages.find(
        (m) => m.role === 'user',
      )?.content ?? '';
    expect(content).toContain('The world is a vast ocean.');
  });

  it('includes character name, role, and keyTraits in the user message', () => {
    const content =
      buildPrompt(
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
      baseInput({
        chapterContent: bigContent,
        modelContextLength: 4096,
        modelMaxCompletionTokens: 256, // small response cap → leaves prompt budget for truncated chapter
      }),
    );
    const userContent = result.messages.find((m) => m.role === 'user')?.content ?? '';
    // The tail (newest content) must survive
    expect(userContent).toContain(TAIL);
    // The head (oldest content) must have been dropped
    expect(userContent).not.toContain(HEAD);
    // The overall token count of the user message must be ≤ derived prompt
    // budget = contextLength - responseTokens - SAFETY_MARGIN_TOKENS.
    const responseTokens = Math.min(256, Number.POSITIVE_INFINITY); // = 256
    const promptBudget = 4096 - responseTokens - 512;
    const userTokens = estimateTokens(userContent);
    expect(userTokens).toBeLessThanOrEqual(Math.max(0, promptBudget) + 10);
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
    const result = buildPrompt(baseInput({ worldNotes: fatWorldNotes, modelContextLength: 4096 }));
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

// ─── scene action ─────────────────────────────────────────────────────────────

describe('buildPrompt — scene action', () => {
  const baseSceneInput = {
    action: 'scene' as const,
    selectedText: '',
    chapterContent: 'The veranda was empty when she arrived.',
    characters: [{ name: 'Jenny', role: 'protagonist', keyTraits: 'curious' }],
    worldNotes: null,
    modelContextLength: 32_000,
    modelMaxCompletionTokens: 4096,
    userMaxCompletionTokens: Number.POSITIVE_INFINITY,
    freeformInstruction: 'Jenny approaches Linda on the veranda and they talk about cheese.',
  };

  it('uses the default scene template when no override is supplied', () => {
    const out = buildPrompt(baseSceneInput);
    expect(out.messages[0].role).toBe('system');
    expect(out.messages[0].content).toContain(DEFAULT_PROMPTS.scene);
    expect(out.messages[0].content).toContain('Jenny'); // character present even with worldNotes: null
    expect(out.messages[1].role).toBe('user');
    expect(out.messages[1].content).toBe(baseSceneInput.freeformInstruction);
  });

  it('uses the user override when provided', () => {
    const out = buildPrompt({
      ...baseSceneInput,
      userPrompts: { scene: 'CUSTOM SCENE TEMPLATE' },
    });
    expect(out.messages[0].content).toContain('CUSTOM SCENE TEMPLATE');
    expect(out.messages[0].content).not.toContain(DEFAULT_PROMPTS.scene);
  });

  it('throws when freeformInstruction is missing', () => {
    expect(() => buildPrompt({ ...baseSceneInput, freeformInstruction: undefined })).toThrow(
      PromptValidationError,
    );
  });

  it('does not synthesise an "Attached selection" framing — scene takes raw direction', () => {
    const out = buildPrompt(baseSceneInput);
    expect(out.messages[1].content).not.toContain('Attached selection');
    expect(out.messages[1].content).not.toContain('User question');
  });

  it('includes world notes, characters, and chapter content in the system message for scene', () => {
    const out = buildPrompt({
      ...baseSceneInput,
      worldNotes: 'The town is haunted.',
      characters: [
        { name: 'Jenny', role: 'protagonist', keyTraits: 'curious' },
        { name: 'Linda', role: null, keyTraits: 'reserved' },
      ],
      chapterContent: 'The veranda was empty when she arrived.',
    });
    expect(out.messages[0].role).toBe('system');
    expect(out.messages[0].content).toContain('The town is haunted.');
    expect(out.messages[0].content).toContain('Jenny');
    expect(out.messages[0].content).toContain('Linda');
    expect(out.messages[0].content).toContain('The veranda was empty when she arrived.');
    // The user message stays raw.
    expect(out.messages[1].content).toBe(baseSceneInput.freeformInstruction);
  });
});
