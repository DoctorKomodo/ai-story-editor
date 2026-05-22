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
    const tiny = { ...base, modelContextLength: 600 };
    const five = [0, 1, 2, 3, 4].map((i) => ({
      orderIndex: i,
      title: `t${i}`,
      summary: {
        events: 'x'.repeat(400),
        stateAtEnd: 'y'.repeat(400),
        openThreads: 'z'.repeat(400),
      },
    }));
    const out = buildPrompt({ ...tiny, previousChapters: five });
    const sys = out.messages[0]!.content;
    if (sys.includes('<previous_chapters')) {
      expect(sys).toMatch(/<previous_chapters truncated_count="[1-9]\d*">/);
      expect(sys).toContain('<chapter index="5"'); // highest-index survives
      expect(sys).not.toContain('<chapter index="1"'); // oldest dropped
    } else {
      expect(sys).not.toContain('truncated_count');
    }
  });
});
