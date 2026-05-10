import { describe, expect, it } from 'vitest';
// buildUserPayload is intentionally not yet exported from prompt.service —
// Task 3 of the k1r plan introduces it. Until then, this entire file fails
// at import time with "buildUserPayload is not a function". That's the
// expected RED state.
import { type BuildPromptInput, buildUserPayload } from '../../src/services/prompt.service';

function input(overrides: Partial<BuildPromptInput> = {}): BuildPromptInput {
  return {
    action: 'continue',
    selectedText: '',
    chapterContent: '',
    characters: [],
    worldNotes: null,
    modelContextLength: 4096,
    modelMaxCompletionTokens: 4096,
    userMaxCompletionTokens: Number.POSITIVE_INFINITY,
    ...overrides,
  };
}

describe('buildUserPayload — matrix', () => {
  describe('scene', () => {
    it('returns freeformInstruction verbatim', () => {
      expect(
        buildUserPayload(
          input({ action: 'scene', freeformInstruction: 'Jenny meets Linda on the veranda.' }),
        ),
      ).toBe('Jenny meets Linda on the veranda.');
    });
  });

  describe('ask', () => {
    it('without attachment: returns the question verbatim (no User question: prefix)', () => {
      expect(
        buildUserPayload(input({ action: 'ask', freeformInstruction: 'Why does she leave?' })),
      ).toBe('Why does she leave?');
    });

    it('with attachment: appends Attached selection: «...» after the question', () => {
      expect(
        buildUserPayload(
          input({
            action: 'ask',
            freeformInstruction: 'What is happening?',
            selectedText: 'The fire crackled.',
          }),
        ),
      ).toBe('What is happening?\n\nAttached selection: «The fire crackled.»');
    });
  });

  describe('continue', () => {
    it('with selection: returns Selection: «...»', () => {
      expect(buildUserPayload(input({ action: 'continue', selectedText: 'She fled.' }))).toBe(
        'Selection: «She fled.»',
      );
    });

    it('empty selection: returns imperative fallback "Continue."', () => {
      expect(buildUserPayload(input({ action: 'continue', selectedText: '' }))).toBe('Continue.');
    });
  });

  describe('rephrase / rewrite / expand / summarise / describe', () => {
    const cases: Array<[BuildPromptInput['action'], string]> = [
      ['rephrase', 'He said hello.'],
      ['rewrite', 'He said hello.'],
      ['expand', 'The door creaked.'],
      ['summarise', 'A long passage.'],
      ['describe', 'The man.'],
    ];
    for (const [action, sel] of cases) {
      it(`${action}: returns Selection: «...»`, () => {
        expect(buildUserPayload(input({ action, selectedText: sel }))).toBe(`Selection: «${sel}»`);
      });
    }
  });

  describe('freeform', () => {
    it('with selection: returns instruction + Selection: «...»', () => {
      expect(
        buildUserPayload(
          input({
            action: 'freeform',
            freeformInstruction: 'Rewrite as Hemingway.',
            selectedText: 'The sun rose.',
          }),
        ),
      ).toBe('Rewrite as Hemingway.\n\nSelection: «The sun rose.»');
    });

    it('without selection: returns just the instruction', () => {
      expect(
        buildUserPayload(
          input({ action: 'freeform', freeformInstruction: 'Rewrite as Hemingway.' }),
        ),
      ).toBe('Rewrite as Hemingway.');
    });
  });
});
