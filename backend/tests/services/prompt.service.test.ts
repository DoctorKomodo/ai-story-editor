import { describe, expect, it } from 'vitest';
import {
  type BuildPromptInput,
  buildPrompt,
  type CharacterRecord,
  DEFAULT_PROMPTS,
  DEFAULT_SYSTEM_PROMPT,
  estimateTokens,
  PromptValidationError,
  toCharacterContext,
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
  function systemContent(input: BuildPromptInput): string {
    const result = buildPrompt(input);
    return result.messages.find((m) => m.role === 'system')?.content ?? '';
  }

  function userContent(input: BuildPromptInput): string {
    const result = buildPrompt(input);
    return result.messages.find((m) => m.role === 'user')?.content ?? '';
  }

  it('action=continue includes the "continue" instruction in system; user has the selection', () => {
    const input = baseInput({ action: 'continue', selectedText: 'She fled.' });
    expect(systemContent(input).toLowerCase()).toContain('continue');
    expect(userContent(input)).toContain('«She fled.»');
  });

  it('action=rephrase includes the "rewrite" instruction in system (collapsed under X29)', () => {
    const input = baseInput({ action: 'rephrase', selectedText: 'He said hello.' });
    expect(systemContent(input).toLowerCase()).toContain('rewrite');
    expect(userContent(input)).toContain('«He said hello.»');
  });

  it('action=expand includes the "expand" instruction in system', () => {
    const input = baseInput({ action: 'expand', selectedText: 'The door creaked.' });
    expect(systemContent(input).toLowerCase()).toContain('expand');
    expect(userContent(input)).toContain('«The door creaked.»');
  });

  it('action=summarise includes the "summarise"/"summarize" instruction in system', () => {
    const input = baseInput({ action: 'summarise', selectedText: 'A long passage.' });
    expect(systemContent(input).toLowerCase()).toMatch(/summar(i|y)s?e/);
    expect(userContent(input)).toContain('«A long passage.»');
  });
});

// ─── World notes and characters ───────────────────────────────────────────────

describe('buildPrompt — worldNotes and characters', () => {
  function systemContent(overrides: Partial<BuildPromptInput>): string {
    return (
      buildPrompt(baseInput(overrides)).messages.find((m) => m.role === 'system')?.content ?? ''
    );
  }

  it('includes worldNotes in the system message', () => {
    expect(systemContent({ worldNotes: 'The world is a vast ocean.' })).toContain(
      'The world is a vast ocean.',
    );
  });

  it('includes character name, role, and keyTraits in the system message', () => {
    expect(
      systemContent({
        characters: [{ name: 'Eira', role: 'Protagonist', keyTraits: 'brave, reckless' }],
      }),
    ).toMatch(/Eira.*Protagonist.*brave, reckless/s);
  });

  it('handles characters with null role / keyTraits gracefully', () => {
    expect(() =>
      buildPrompt(baseInput({ characters: [{ name: 'Nobody', role: null, keyTraits: null }] })),
    ).not.toThrow();
  });
});

// ─── Truncation ───────────────────────────────────────────────────────────────

describe('buildPrompt — chapterContent truncation', () => {
  function systemContent(input: BuildPromptInput): string {
    return buildPrompt(input).messages.find((m) => m.role === 'system')?.content ?? '';
  }

  it('truncates chapterContent from the top when over budget', () => {
    const HEAD = 'HEAD_DROPPED_SENTINEL';
    const TAIL = 'TAIL_CONTENT_SURVIVES';
    const bigContent = HEAD + 'x'.repeat(200_000) + TAIL;
    const result = buildPrompt(
      baseInput({
        chapterContent: bigContent,
        modelContextLength: 4096,
        modelMaxCompletionTokens: 256,
      }),
    );
    const sys = result.messages.find((m) => m.role === 'system')?.content ?? '';
    expect(sys).toContain(TAIL);
    expect(sys).not.toContain(HEAD);
    // Total fixed tokens (system + user) must fit in the prompt budget.
    const responseTokens = Math.min(256, Number.POSITIVE_INFINITY);
    const promptBudget = 4096 - responseTokens - 512;
    const userMsg = result.messages.find((m) => m.role === 'user')?.content ?? '';
    const totalTokens = estimateTokens(sys) + estimateTokens(userMsg);
    expect(totalTokens).toBeLessThanOrEqual(Math.max(0, promptBudget) + 10);
  });

  it('sets chapterContent to empty string when worldNotes + characters alone exceed budget', () => {
    const fatWorldNotes = 'W'.repeat(4096 * 4 * 2);
    const sys = systemContent(
      baseInput({
        worldNotes: fatWorldNotes,
        chapterContent: 'Should be gone.',
        modelContextLength: 4096,
      }),
    );
    expect(sys).toContain('W'.repeat(20));
    expect(sys).not.toContain('Should be gone.');
  });

  it('worldNotes are never truncated even when they alone exceed the budget', () => {
    const fatWorldNotes = 'W'.repeat(4096 * 4 * 2);
    expect(
      systemContent(baseInput({ worldNotes: fatWorldNotes, modelContextLength: 4096 })),
    ).toContain(fatWorldNotes);
  });

  it('characters are never truncated even when they alone exceed the budget', () => {
    const fatTraits = 'T'.repeat(4096 * 4 * 2);
    expect(
      systemContent(
        baseInput({
          characters: [{ name: 'BigChar', role: 'Hero', keyTraits: fatTraits }],
          modelContextLength: 4096,
        }),
      ),
    ).toContain(fatTraits);
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

// ─── Canonical shape invariant (k1r) ─────────────────────────────────────────

describe('buildPrompt — canonical shape invariant (k1r)', () => {
  const ALL_ACTIONS: BuildPromptInput['action'][] = [
    'continue',
    'rephrase',
    'expand',
    'summarise',
    'rewrite',
    'describe',
    'scene',
    'ask',
  ];

  function inputFor(action: BuildPromptInput['action']): BuildPromptInput {
    return baseInput({
      action,
      // Use a large context so chapterContent survives the token-budget trim.
      modelContextLength: 128_000,
      modelMaxCompletionTokens: 4096,
      chapterContent: 'CHAPTER_BODY_SENTINEL',
      worldNotes: 'WORLD_NOTES_SENTINEL',
      characters: [{ name: 'Eira', role: 'protagonist', keyTraits: 'CHAR_TRAIT_SENTINEL' }],
      // Provide instructions for the actions that require them.
      freeformInstruction: action === 'scene' || action === 'ask' ? 'do the thing' : undefined,
    });
  }

  for (const action of ALL_ACTIONS) {
    it(`action=${action}: chapter / world / characters live in messages[0] (system)`, () => {
      const out = buildPrompt(inputFor(action));
      expect(out.messages[0]?.role).toBe('system');
      expect(out.messages[0]?.content).toContain('Chapter so far:');
      expect(out.messages[0]?.content).toContain('CHAPTER_BODY_SENTINEL');
      expect(out.messages[0]?.content).toContain('World notes:');
      expect(out.messages[0]?.content).toContain('WORLD_NOTES_SENTINEL');
      expect(out.messages[0]?.content).toContain('Characters:');
      expect(out.messages[0]?.content).toContain('CHAR_TRAIT_SENTINEL');
    });

    it(`action=${action}: messages[1] (user) does NOT carry chapter / world / characters`, () => {
      const out = buildPrompt(inputFor(action));
      expect(out.messages[1]?.role).toBe('user');
      const userContent = out.messages[1]?.content ?? '';
      expect(userContent).not.toContain('CHAPTER_BODY_SENTINEL');
      expect(userContent).not.toContain('WORLD_NOTES_SENTINEL');
      expect(userContent).not.toContain('CHAR_TRAIT_SENTINEL');
    });
  }
});

// ─── toCharacterContext (h0z) ────────────────────────────────────────────────

describe('toCharacterContext (h0z)', () => {
  it('all four trait fields populated → joined with "; "; no truncation even when result > 200 chars', () => {
    const long = 'x'.repeat(80);
    const c: CharacterRecord = {
      name: 'Imogen Thorne',
      role: 'protagonist',
      personality: long,
      arc: long,
      appearance: long,
      voice: 'auburn hair',
    };
    const out = toCharacterContext(c);
    expect(out.name).toBe('Imogen Thorne');
    expect(out.role).toBe('protagonist');
    expect(out.keyTraits).not.toBeNull();
    expect(out.keyTraits!.length).toBeGreaterThan(200);
    expect(out.keyTraits).toBe(`${long}; ${long}; ${long}; auburn hair`);
  });

  it('only personality populated → single value, no separator', () => {
    expect(toCharacterContext({ name: 'Bystander', personality: 'shy' })).toEqual({
      name: 'Bystander',
      role: null,
      keyTraits: 'shy',
    });
  });

  it('whitespace-only trait fields are skipped', () => {
    const out = toCharacterContext({
      name: 'X',
      personality: '   ',
      arc: '\t\n',
      appearance: 'tall',
    });
    expect(out.keyTraits).toBe('tall');
  });

  it('all trait fields missing/null → keyTraits is null', () => {
    expect(toCharacterContext({ name: 'X' }).keyTraits).toBeNull();
  });

  it('role missing or empty → role is null', () => {
    expect(toCharacterContext({ name: 'X' }).role).toBeNull();
    expect(toCharacterContext({ name: 'X', role: '' }).role).toBe(''); // empty string is preserved as-is per typeof check
  });

  it('name missing or non-string → empty string', () => {
    expect(toCharacterContext({}).name).toBe('');
    expect(toCharacterContext({ name: 42 as unknown }).name).toBe('');
  });
});
