import type { CharacterPromptInput } from 'story-editor-shared';
import { describe, expect, it } from 'vitest';
import {
  type BuildPromptInput,
  buildPrompt,
  DEFAULT_PROMPTS,
  DEFAULT_SYSTEM_PROMPT,
  estimateTokens,
  PROSE_OUTPUT_RULES,
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

  it('includes character name, role, and personality in the system message', () => {
    expect(
      systemContent({
        characters: [
          {
            name: 'Eira',
            role: 'Protagonist',
            age: null,
            appearance: null,
            personality: 'brave, reckless',
            voice: null,
            backstory: null,
            arc: null,
            relationships: null,
          },
        ],
      }),
    ).toMatch(/Eira.*Protagonist.*brave, reckless/s);
  });

  it('handles characters with null role / prose fields gracefully', () => {
    expect(() =>
      buildPrompt(
        baseInput({
          characters: [
            {
              name: 'Nobody',
              role: null,
              age: null,
              appearance: null,
              personality: null,
              voice: null,
              backstory: null,
              arc: null,
              relationships: null,
            },
          ],
        }),
      ),
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
          characters: [
            {
              name: 'BigChar',
              role: 'Hero',
              age: null,
              appearance: null,
              personality: fatTraits,
              voice: null,
              backstory: null,
              arc: null,
              relationships: null,
            },
          ],
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
    characters: [
      {
        name: 'Jenny',
        role: 'protagonist',
        age: null,
        appearance: null,
        personality: 'curious',
        voice: null,
        backstory: null,
        arc: null,
        relationships: null,
      },
    ],
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
        {
          name: 'Jenny',
          role: 'protagonist',
          age: null,
          appearance: null,
          personality: 'curious',
          voice: null,
          backstory: null,
          arc: null,
          relationships: null,
        },
        {
          name: 'Linda',
          role: null,
          age: null,
          appearance: null,
          personality: 'reserved',
          voice: null,
          backstory: null,
          arc: null,
          relationships: null,
        },
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
      characters: [
        {
          name: 'Eira',
          role: 'protagonist',
          age: null,
          appearance: null,
          personality: 'CHAR_TRAIT_SENTINEL',
          voice: null,
          backstory: null,
          arc: null,
          relationships: null,
        },
      ],
      // Provide instructions for the actions that require them.
      freeformInstruction: action === 'scene' || action === 'ask' ? 'do the thing' : undefined,
    });
  }

  for (const action of ALL_ACTIONS) {
    it(`action=${action}: chapter / world / characters live in messages[0] (system)`, () => {
      const out = buildPrompt(inputFor(action));
      expect(out.messages[0]?.role).toBe('system');
      expect(out.messages[0]?.content).toContain('<chapter_so_far>');
      expect(out.messages[0]?.content).toContain('CHAPTER_BODY_SENTINEL');
      expect(out.messages[0]?.content).toContain('<world_notes>');
      expect(out.messages[0]?.content).toContain('WORLD_NOTES_SENTINEL');
      expect(out.messages[0]?.content).toContain('<characters>');
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

// ─── charactersBlock XML rendering (h0z) ────────────────────────────────────

describe('charactersBlock XML rendering (h0z)', () => {
  function baseInput(characters: CharacterPromptInput[]) {
    return {
      action: 'continue' as const,
      selectedText: '',
      chapterContent: '',
      characters,
      worldNotes: null,
      modelContextLength: 8192,
      modelMaxCompletionTokens: 1024,
      userMaxCompletionTokens: Number.POSITIVE_INFINITY,
    };
  }

  it('renders <characters>...</characters> with one <character> per entry', () => {
    const out = buildPrompt(
      baseInput([
        {
          name: 'Imogen Thorne',
          role: 'protagonist',
          age: null,
          appearance: null,
          personality: 'wry',
          voice: null,
          backstory: null,
          arc: null,
          relationships: null,
        },
        {
          name: 'Felix',
          role: 'rival',
          age: null,
          appearance: null,
          personality: 'vain',
          voice: null,
          backstory: null,
          arc: null,
          relationships: null,
        },
      ]),
    );
    const sys = out.messages[0].content;
    expect(sys).toContain('<characters>\n');
    expect(sys).toContain('\n</characters>');
    expect(sys).toContain('<character name="Imogen Thorne" role="protagonist">');
    expect(sys).toContain('  <personality>wry</personality>');
    expect(sys).toContain('<character name="Felix" role="rival">');
    expect(sys).toContain('  <personality>vain</personality>');
  });

  it('self-closing form when all prose fields are null', () => {
    const out = buildPrompt(
      baseInput([
        {
          name: 'Bystander',
          role: null,
          age: null,
          appearance: null,
          personality: null,
          voice: null,
          backstory: null,
          arc: null,
          relationships: null,
        },
      ]),
    );
    expect(out.messages[0].content).toContain('<character name="Bystander" />');
  });

  it('omits role attribute when role is null', () => {
    const out = buildPrompt(
      baseInput([
        {
          name: 'X',
          role: null,
          age: null,
          appearance: null,
          personality: 'flat',
          voice: null,
          backstory: null,
          arc: null,
          relationships: null,
        },
      ]),
    );
    const sys = out.messages[0].content;
    expect(sys).toContain('<character name="X">');
    expect(sys).toContain('  <personality>flat</personality>');
    expect(sys).not.toMatch(/role=""/);
    expect(sys).not.toMatch(/role="null"/);
  });

  it('empty-name character is skipped entirely', () => {
    const out = buildPrompt(
      baseInput([
        {
          name: '',
          role: 'rival',
          age: null,
          appearance: null,
          personality: 'noise',
          voice: null,
          backstory: null,
          arc: null,
          relationships: null,
        },
        {
          name: 'Real',
          role: 'protagonist',
          age: null,
          appearance: null,
          personality: 'ok',
          voice: null,
          backstory: null,
          arc: null,
          relationships: null,
        },
      ]),
    );
    const sys = out.messages[0].content;
    expect(sys).not.toContain('<character name=""');
    expect(sys).toContain('<character name="Real" role="protagonist">');
    expect(sys).toContain('  <personality>ok</personality>');
  });

  it('characters block omitted entirely when list is empty', () => {
    const out = buildPrompt(baseInput([]));
    expect(out.messages[0].content).not.toContain('<characters>');
  });

  it('escapes & < > " in attributes and & < > in text', () => {
    const out = buildPrompt(
      baseInput([
        {
          name: 'A & B "the kid"',
          role: '<rival>',
          age: null,
          appearance: 'has < and > and &',
          personality: null,
          voice: null,
          backstory: null,
          arc: null,
          relationships: null,
        },
      ]),
    );
    const sys = out.messages[0].content;
    expect(sys).toContain('name="A &amp; B &quot;the kid&quot;"');
    expect(sys).toContain('role="&lt;rival&gt;"');
    expect(sys).toContain('<appearance>has &lt; and &gt; and &amp;</appearance>');
  });

  it('collision test: name containing </character> does not close the tag prematurely', () => {
    const out = buildPrompt(
      baseInput([
        {
          name: '</character>',
          role: null,
          age: null,
          appearance: null,
          personality: 'ok',
          voice: null,
          backstory: null,
          arc: null,
          relationships: null,
        },
      ]),
    );
    const sys = out.messages[0].content;
    expect(sys).toContain('name="&lt;/character&gt;"');
    expect(sys).toContain('<character name="&lt;/character&gt;">');
    expect(sys).toContain('  <personality>ok</personality>');
  });
});

// ─── chapterBlock XML rendering (h0z) ────────────────────────────────────────

describe('chapterBlock XML rendering (h0z)', () => {
  function baseInput(chapterContent: string) {
    return {
      action: 'continue' as const,
      selectedText: '',
      chapterContent,
      characters: [],
      worldNotes: null,
      modelContextLength: 8192,
      modelMaxCompletionTokens: 1024,
      userMaxCompletionTokens: Number.POSITIVE_INFINITY,
    };
  }

  it('renders <chapter_so_far>...</chapter_so_far> when chapter content survives the trim', () => {
    const out = buildPrompt(baseInput('She crossed the room.'));
    expect(out.messages[0].content).toContain(
      '<chapter_so_far>\nShe crossed the room.\n</chapter_so_far>',
    );
  });

  it('omits the wrapper when chapter is empty', () => {
    expect(buildPrompt(baseInput('')).messages[0].content).not.toContain('<chapter_so_far>');
  });

  it('escapes & < > in chapter prose', () => {
    const out = buildPrompt(baseInput('Sam said "<3" then & sighed.'));
    expect(out.messages[0].content).toContain(
      '<chapter_so_far>\nSam said "&lt;3" then &amp; sighed.\n</chapter_so_far>',
    );
  });

  it('collision test: chapter containing </chapter_so_far> renders escaped', () => {
    const out = buildPrompt(baseInput('open </chapter_so_far> close'));
    expect(out.messages[0].content).toContain('open &lt;/chapter_so_far&gt; close');
  });

  it('double-escape semantics: literal "&amp;" in chapter renders as "&amp;amp;"', () => {
    const out = buildPrompt(baseInput('Smith &amp; Wesson'));
    expect(out.messages[0].content).toContain('Smith &amp;amp; Wesson');
  });

  it('trailing whitespace inside the wrapper is normalised', () => {
    const out = buildPrompt(baseInput('content\n\n  '));
    const sys = out.messages[0].content;
    expect(sys).toContain('<chapter_so_far>\ncontent\n</chapter_so_far>');
    expect(sys).not.toContain('content\n\n  ');
  });
});

// ─── taskBlock XML rendering (h0z) ──────────────────────────────────────────

describe('taskBlock XML rendering (h0z)', () => {
  function baseInput(action: 'continue' | 'scene', userPrompts?: Record<string, string>) {
    return {
      action,
      selectedText: '',
      chapterContent: 'CHAPTER',
      characters: [],
      worldNotes: null,
      modelContextLength: 8192,
      modelMaxCompletionTokens: 1024,
      userMaxCompletionTokens: Number.POSITIVE_INFINITY,
      userPrompts,
      freeformInstruction: action === 'scene' ? 'do the thing' : undefined,
    };
  }

  it('renders <task>...</task> with the resolved template inside', () => {
    const out = buildPrompt(baseInput('continue'));
    const sys = out.messages[0].content;
    expect(sys).toMatch(/<task>\n[\s\S]+\n<\/task>/);
  });

  it('user-override task template is XML-escaped (X29 surface)', () => {
    const out = buildPrompt(
      baseInput('continue', { continue: 'malicious </task> attempt with <tag> and & amp' }),
    );
    const sys = out.messages[0].content;
    // The user override is escaped; the </task> closer is the framework's, not the override's.
    expect(sys).toContain('malicious &lt;/task&gt; attempt with &lt;tag&gt; and &amp; amp');
    // The framework <task> opener and </task> closer are still present and structurally sound:
    expect(sys.match(/<task>\n/g)?.length).toBe(1);
    expect(sys.match(/\n<\/task>/g)?.length).toBe(1);
  });

  it('trailing whitespace in the resolved template is normalised', () => {
    const out = buildPrompt(baseInput('continue', { continue: 'do it.\n\n  ' }));
    const sys = out.messages[0].content;
    expect(sys).toContain('<task>\ndo it.\n</task>');
  });

  it('apostrophes survive the escape', () => {
    const out = buildPrompt(baseInput('continue', { continue: "don't break the apostrophe" }));
    const sys = out.messages[0].content;
    expect(sys).toContain("<task>\ndon't break the apostrophe\n</task>");
  });
});

// ─── worldNotesBlock XML rendering (h0z) ────────────────────────────────────

describe('worldNotesBlock XML rendering (h0z)', () => {
  function baseInput(worldNotes: string | null) {
    return {
      action: 'continue' as const,
      selectedText: '',
      chapterContent: '',
      characters: [],
      worldNotes,
      modelContextLength: 8192,
      modelMaxCompletionTokens: 1024,
      userMaxCompletionTokens: Number.POSITIVE_INFINITY,
    };
  }

  it('renders <world_notes>...</world_notes> when world notes present', () => {
    const out = buildPrompt(baseInput('Late-Victorian London.'));
    const sys = out.messages[0].content;
    expect(sys).toContain('<world_notes>\nLate-Victorian London.\n</world_notes>');
  });

  it('omits the wrapper entirely when world notes are null or empty', () => {
    expect(buildPrompt(baseInput(null)).messages[0].content).not.toContain('<world_notes>');
    expect(buildPrompt(baseInput('')).messages[0].content).not.toContain('<world_notes>');
  });

  it('escapes & < > in world-notes content', () => {
    const out = buildPrompt(baseInput('AT&T then <html> there'));
    expect(out.messages[0].content).toContain(
      '<world_notes>\nAT&amp;T then &lt;html&gt; there\n</world_notes>',
    );
  });

  it('collision test: world notes containing </world_notes> renders escaped', () => {
    const out = buildPrompt(baseInput('text </world_notes> more text'));
    const sys = out.messages[0].content;
    expect(sys).toContain('text &lt;/world_notes&gt; more text');
  });

  it('trailing whitespace inside the wrapper is normalised (no trailing \\n\\n before closer)', () => {
    const out = buildPrompt(baseInput('content\n\n   '));
    const sys = out.messages[0].content;
    expect(sys).toContain('<world_notes>\ncontent\n</world_notes>');
    expect(sys).not.toContain('content\n\n');
  });
});

// ─── character XML rendering — full sheet ────────────────────────────────────

describe('character XML rendering — full sheet', () => {
  function baseInput(characters: CharacterPromptInput[]) {
    return {
      action: 'continue' as const,
      selectedText: '',
      chapterContent: '',
      characters,
      worldNotes: null,
      modelContextLength: 8192,
      modelMaxCompletionTokens: 1024,
      userMaxCompletionTokens: Number.POSITIVE_INFINITY,
    };
  }

  const full: CharacterPromptInput = {
    name: 'Imogen Thorne',
    role: 'protagonist',
    age: '34',
    appearance: 'tall, auburn hair shorn at the jaw',
    personality: 'wry, distrusts kindness, holds grudges',
    voice: 'measured alto with a Devon edge',
    backstory: 'Widowed at 28 when her husband died in the mining collapse.',
    arc: 'from grief-numbed widow to reluctant insurgent',
    relationships: 'Sister to Felix; estranged from her father.',
  };

  it('renders all 9 fields — scalars as attrs, prose as nested children', () => {
    const sys = buildPrompt(baseInput([full])).messages[0].content;
    expect(sys).toContain('<character name="Imogen Thorne" role="protagonist" age="34">');
    expect(sys).toContain('  <appearance>tall, auburn hair shorn at the jaw</appearance>');
    expect(sys).toContain('  <personality>wry, distrusts kindness, holds grudges</personality>');
    expect(sys).toContain('  <voice>measured alto with a Devon edge</voice>');
    expect(sys).toContain(
      '  <backstory>Widowed at 28 when her husband died in the mining collapse.</backstory>',
    );
    expect(sys).toContain('  <arc>from grief-numbed widow to reluctant insurgent</arc>');
    expect(sys).toContain(
      '  <relationships>Sister to Felix; estranged from her father.</relationships>',
    );
    expect(sys).toContain('</character>');
  });

  it('scalar-only character (no prose) → self-closing', () => {
    const sys = buildPrompt(
      baseInput([
        {
          name: 'X',
          role: 'rival',
          age: '40',
          appearance: null,
          personality: null,
          voice: null,
          backstory: null,
          arc: null,
          relationships: null,
        },
      ]),
    ).messages[0].content;
    expect(sys).toContain('<character name="X" role="rival" age="40" />');
  });

  it('name-only character → self-closing with name attribute only', () => {
    const sys = buildPrompt(
      baseInput([
        {
          name: 'Bystander',
          role: null,
          age: null,
          appearance: null,
          personality: null,
          voice: null,
          backstory: null,
          arc: null,
          relationships: null,
        },
      ]),
    ).messages[0].content;
    expect(sys).toContain('<character name="Bystander" />');
  });

  it('omits attribute fields when null (role, age)', () => {
    const sys = buildPrompt(
      baseInput([
        {
          name: 'X',
          role: null,
          age: null,
          appearance: 'tall',
          personality: null,
          voice: null,
          backstory: null,
          arc: null,
          relationships: null,
        },
      ]),
    ).messages[0].content;
    expect(sys).toContain('<character name="X">');
    expect(sys).not.toMatch(/role="null"/);
    expect(sys).not.toMatch(/age="null"/);
  });

  it('omits child elements for null/whitespace prose fields', () => {
    const sys = buildPrompt(
      baseInput([
        {
          name: 'X',
          role: null,
          age: null,
          appearance: 'tall',
          personality: '   ',
          voice: '\t',
          backstory: null,
          arc: null,
          relationships: null,
        },
      ]),
    ).messages[0].content;
    expect(sys).toContain('<appearance>tall</appearance>');
    expect(sys).not.toContain('<personality>');
    expect(sys).not.toContain('<voice>');
  });

  it('empty-name character is skipped entirely', () => {
    const sys = buildPrompt(
      baseInput([
        {
          name: '',
          role: 'noise',
          age: null,
          appearance: null,
          personality: 'noise',
          voice: null,
          backstory: null,
          arc: null,
          relationships: null,
        },
        {
          name: 'Real',
          role: null,
          age: null,
          appearance: null,
          personality: 'real',
          voice: null,
          backstory: null,
          arc: null,
          relationships: null,
        },
      ]),
    ).messages[0].content;
    expect(sys).not.toContain('name=""');
    expect(sys).toContain('<character name="Real">');
  });

  it('escapes & < > " in attributes and & < > in nested text', () => {
    const sys = buildPrompt(
      baseInput([
        {
          name: 'A & B "the kid"',
          role: '<rival>',
          age: null,
          appearance: 'has < and > and &',
          personality: null,
          voice: null,
          backstory: null,
          arc: null,
          relationships: null,
        },
      ]),
    ).messages[0].content;
    expect(sys).toContain('name="A &amp; B &quot;the kid&quot;"');
    expect(sys).toContain('role="&lt;rival&gt;"');
    expect(sys).toContain('<appearance>has &lt; and &gt; and &amp;</appearance>');
  });

  it('collision: backstory containing </backstory> is escaped', () => {
    const sys = buildPrompt(
      baseInput([
        {
          name: 'X',
          role: null,
          age: null,
          appearance: null,
          personality: null,
          voice: null,
          backstory: 'open </backstory> close',
          arc: null,
          relationships: null,
        },
      ]),
    ).messages[0].content;
    expect(sys).toContain('<backstory>open &lt;/backstory&gt; close</backstory>');
  });

  it('collision: relationships containing </relationships> is escaped', () => {
    const sys = buildPrompt(
      baseInput([
        {
          name: 'X',
          role: null,
          age: null,
          appearance: null,
          personality: null,
          voice: null,
          backstory: null,
          arc: null,
          relationships: 'open </relationships> close',
        },
      ]),
    ).messages[0].content;
    expect(sys).toContain('<relationships>open &lt;/relationships&gt; close</relationships>');
  });

  it('collision: name containing </character> is escaped + structure intact', () => {
    const sys = buildPrompt(
      baseInput([
        {
          name: '</character>',
          role: null,
          age: null,
          appearance: 'ok',
          personality: null,
          voice: null,
          backstory: null,
          arc: null,
          relationships: null,
        },
      ]),
    ).messages[0].content;
    expect(sys).toContain('name="&lt;/character&gt;"');
    // Exactly one real opener and one real closer in the block:
    expect(sys.match(/<character /g)?.length).toBe(1);
    expect(sys.match(/<\/character>/g)?.length).toBe(1);
  });
});

// ─── [venice-orch step 2] system-prompt restructure ──────────────────────────

describe('[venice-orch step 2] system-prompt restructure', () => {
  it('DEFAULT_SYSTEM_PROMPT is persona-only — no output-shape rules', () => {
    expect(DEFAULT_SYSTEM_PROMPT).not.toMatch(/no quotation marks/i);
    expect(DEFAULT_SYSTEM_PROMPT).not.toMatch(/no preamble/i);
    expect(DEFAULT_SYSTEM_PROMPT).not.toMatch(/no XML tags/i);
    expect(DEFAULT_SYSTEM_PROMPT).not.toMatch(/no section labels/i);
    // Persona content survives:
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/creative-writing assistant/i);
  });

  it('PROSE_OUTPUT_RULES carries the output-shape rules', () => {
    expect(PROSE_OUTPUT_RULES).toMatch(/no quotation marks/i);
    expect(PROSE_OUTPUT_RULES).toMatch(/no preamble/i);
    expect(PROSE_OUTPUT_RULES).toMatch(/no XML tags/i);
    expect(PROSE_OUTPUT_RULES).toMatch(/no section labels/i);
  });

  const PROSE_ACTION_KEYS = [
    'continue',
    'rewrite',
    'expand',
    'summarise',
    'describe',
    'scene',
    'ask',
  ] as const;
  for (const key of PROSE_ACTION_KEYS) {
    it(`DEFAULT_PROMPTS.${key} starts with PROSE_OUTPUT_RULES`, () => {
      expect(DEFAULT_PROMPTS[key].startsWith(PROSE_OUTPUT_RULES)).toBe(true);
    });
  }

  it('DEFAULT_PROMPTS.summariseChapter does NOT include PROSE_OUTPUT_RULES (structured output)', () => {
    expect(DEFAULT_PROMPTS.summariseChapter).not.toContain('no quotation marks');
    expect(DEFAULT_PROMPTS.summariseChapter).toMatch(/JSON object matching the provided schema/i);
  });
});
