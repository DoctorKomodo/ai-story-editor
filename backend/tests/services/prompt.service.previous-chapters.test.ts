import { describe, expect, it } from 'vitest';
import { buildPrompt } from '../../src/services/prompt.service';

const base = {
  action: 'continue' as const,
  selectedText: '',
  chapterContent: 'Current chapter prose.',
  characters: [],
  worldNotes: null,
  modelContextLength: 8000,
  modelMaxCompletionTokens: 1000,
  userMaxCompletionTokens: Number.POSITIVE_INFINITY,
};
const SUMMARY = (n: number) => ({
  events: `events-${n}`,
  stateAtEnd: `state-${n}`,
  openThreads: `threads-${n}`,
});

describe('prompt.service previousChapters', () => {
  it('omits the block when previousChapters is empty/undefined', () => {
    const out = buildPrompt(base);
    expect(out.messages[0]!.content).not.toContain('<previous_chapters>');
  });

  it('renders entries between <characters> and <chapter_so_far>', () => {
    const out = buildPrompt({
      ...base,
      previousChapters: [{ orderIndex: 0, title: 'Crossing', summary: SUMMARY(1) }],
    });
    const sys = out.messages[0]!.content;
    expect(sys).toContain('<previous_chapters>');
    expect(sys).toContain('<chapter index="1" title="Crossing">');
    expect(sys).toContain('<events>events-1</events>');
    expect(sys).toContain('<state_at_end>state-1</state_at_end>');
    expect(sys).toContain('<open_threads>threads-1</open_threads>');
    expect(sys.indexOf('<previous_chapters>')).toBeLessThan(sys.indexOf('<chapter_so_far>'));
  });

  it('XML-escapes &/</> in fields', () => {
    const out = buildPrompt({
      ...base,
      previousChapters: [
        {
          orderIndex: 0,
          title: 'A & B',
          summary: { events: '<x>', stateAtEnd: '&', openThreads: '>y' },
        },
      ],
    });
    const sys = out.messages[0]!.content;
    expect(sys).toContain('title="A &amp; B"');
    expect(sys).toContain('&lt;x&gt;');
    expect(sys).toContain('&amp;');
    expect(sys).toContain('&gt;y');
  });

  it('drops oldest first when summaries push chapter below budget', () => {
    // modelContextLength: 2000, modelMaxCompletionTokens: 500
    // → responseTokens = 500, promptBudgetTokens = 2000 - 500 - 512 = 988
    // Each summary has ~1200 chars per field × 3 fields ≈ 3600 chars ≈ 900 tokens.
    // The five entries together far exceed 988 tokens, so the truncation loop
    // runs; but one entry (the newest, index "5") fits within budget.
    // The if-branch (block present) is the REQUIRED path for these params.
    const budget = { ...base, modelContextLength: 2000, modelMaxCompletionTokens: 500 };
    const five = [0, 1, 2, 3, 4].map((i) => ({
      orderIndex: i,
      title: `t${i}`,
      summary: {
        events: 'x'.repeat(400),
        stateAtEnd: 'y'.repeat(400),
        openThreads: 'z'.repeat(400),
      },
    }));
    const out = buildPrompt({ ...budget, previousChapters: five });
    const sys = out.messages[0]!.content;
    // The if-branch must execute — these params guarantee at least one entry survives.
    if (!sys.includes('<previous_chapters')) {
      throw new Error(
        'Expected <previous_chapters> block to be present — budget params must allow at least one entry to survive',
      );
    }
    expect(sys).toMatch(/<previous_chapters truncated_count="[1-9]\d*">/);
    expect(sys).toContain('<chapter index="5"'); // highest-index (newest) survives
    expect(sys).not.toContain('<chapter index="1"'); // oldest dropped
  });
});
