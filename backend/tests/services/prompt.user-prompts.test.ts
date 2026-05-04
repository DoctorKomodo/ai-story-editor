// backend/tests/services/prompt.user-prompts.test.ts
//
// [X29] User-level prompt overrides — replaces V13 per-story override behaviour.
// Verifies:
//   1. userPrompts.system overrides DEFAULT_SYSTEM_PROMPT when non-empty.
//   2. userPrompts[action] overrides the built-in action template when non-empty.
//   3. null / undefined / '' / whitespace-only fall back to defaults.
//   4. Selection auto-append still happens for overridden action templates.
//   5. include_venice_system_prompt is independent of userPrompts.system.
//   6. freeform / ask actions are not template-driven and ignore userPrompts.

import { describe, expect, it } from 'vitest';
import {
  type BuildPromptInput,
  buildPrompt,
  DEFAULT_PROMPTS,
  DEFAULT_SYSTEM_PROMPT,
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

function userMsg(input: BuildPromptInput): string {
  return buildPrompt(input).messages[1]?.content ?? '';
}

// ─── system-prompt override ────────────────────────────────────────────────────

describe('[X29] userPrompts.system — override behaviour', () => {
  it('non-empty → system message equals override', () => {
    const custom = 'You are a gothic horror novelist.';
    expect(systemMsg(baseInput({ userPrompts: { system: custom } }))).toBe(custom);
  });

  it('null → DEFAULT_SYSTEM_PROMPT', () => {
    expect(systemMsg(baseInput({ userPrompts: { system: null } }))).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it('undefined → DEFAULT_SYSTEM_PROMPT', () => {
    expect(systemMsg(baseInput({ userPrompts: {} }))).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it('empty string → DEFAULT_SYSTEM_PROMPT', () => {
    expect(systemMsg(baseInput({ userPrompts: { system: '' } }))).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it('whitespace-only → DEFAULT_SYSTEM_PROMPT', () => {
    expect(systemMsg(baseInput({ userPrompts: { system: '   ' } }))).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it('userPrompts undefined entirely → DEFAULT_SYSTEM_PROMPT', () => {
    expect(systemMsg(baseInput())).toBe(DEFAULT_SYSTEM_PROMPT);
  });
});

// ─── action-template overrides ─────────────────────────────────────────────────
// `rewrite` covers both 'rephrase' and 'rewrite' actions per X29 spec.

const ACTION_KEYS = ['continue', 'rewrite', 'expand', 'summarise', 'describe'] as const;

describe('[X29] userPrompts.<action> — override behaviour', () => {
  for (const key of ACTION_KEYS) {
    const action = key === 'rewrite' ? 'rewrite' : key;
    it(`${key}: non-empty override appears in user message`, () => {
      const custom = `CUSTOM ${key.toUpperCase()} INSTRUCTION.`;
      const out = userMsg(
        baseInput({ action: action as BuildPromptInput['action'], userPrompts: { [key]: custom } }),
      );
      expect(out).toContain(custom);
    });

    it(`${key}: null falls back to DEFAULT_PROMPTS.${key}`, () => {
      const out = userMsg(
        baseInput({ action: action as BuildPromptInput['action'], userPrompts: { [key]: null } }),
      );
      expect(out).toContain(DEFAULT_PROMPTS[key]);
    });

    it(`${key}: whitespace-only falls back to DEFAULT_PROMPTS.${key}`, () => {
      const out = userMsg(
        baseInput({ action: action as BuildPromptInput['action'], userPrompts: { [key]: '   ' } }),
      );
      expect(out).toContain(DEFAULT_PROMPTS[key]);
    });
  }

  it('rephrase action also reads userPrompts.rewrite (collapsed override)', () => {
    const custom = 'CUSTOM REPHRASE.';
    const out = userMsg(baseInput({ action: 'rephrase', userPrompts: { rewrite: custom } }));
    expect(out).toContain(custom);
  });
});

// ─── selection auto-append ─────────────────────────────────────────────────────

describe('[X29] selection text auto-appends after overridden action templates', () => {
  it('overridden continue template still gets the Selection: «…» suffix', () => {
    const out = userMsg(
      baseInput({
        action: 'continue',
        selectedText: 'The dog barked.',
        userPrompts: { continue: 'CUSTOM CONTINUE INSTRUCTION.' },
      }),
    );
    expect(out).toContain('CUSTOM CONTINUE INSTRUCTION.');
    expect(out).toContain('Selection: «The dog barked.»');
  });
});

// ─── freeform / ask ignore userPrompts ─────────────────────────────────────────

describe('[X29] freeform / ask are not template-driven', () => {
  it('freeform: userPrompts has no observable effect', () => {
    const a = userMsg(
      baseInput({
        action: 'freeform',
        freeformInstruction: 'Tell me a haiku.',
      }),
    );
    const b = userMsg(
      baseInput({
        action: 'freeform',
        freeformInstruction: 'Tell me a haiku.',
        userPrompts: { continue: 'should not appear' } as never,
      }),
    );
    expect(a).toBe(b);
  });
});

// ─── include_venice_system_prompt is independent of userPrompts.system ────────

type PromptState = { label: string; value: string | null | undefined };
const promptStates: PromptState[] = [
  { label: 'null', value: null },
  { label: 'undefined', value: undefined },
  { label: 'empty', value: '' },
  { label: 'custom', value: 'Custom user system prompt.' },
];

describe('[X29] include_venice_system_prompt is independent of userPrompts.system', () => {
  for (const { label, value } of promptStates) {
    it(`userPrompts.system=${label} + flag=true → flag stays true`, () => {
      const r = buildPrompt(
        baseInput({
          userPrompts: { system: value as string | null },
          includeVeniceSystemPrompt: true,
        }),
      );
      expect(r.venice_parameters.include_venice_system_prompt).toBe(true);
    });

    it(`userPrompts.system=${label} + flag=false → flag stays false`, () => {
      const r = buildPrompt(
        baseInput({
          userPrompts: { system: value as string | null },
          includeVeniceSystemPrompt: false,
        }),
      );
      expect(r.venice_parameters.include_venice_system_prompt).toBe(false);
    });
  }
});
