import { describe, expect, it } from 'vitest';
import { computeWordCount } from '../../src/services/tiptap-text';

describe('computeWordCount', () => {
  it('counts whitespace-separated words from a TipTap tree', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one two three' }] }],
    };
    expect(computeWordCount(doc)).toBe(3);
  });
  it('returns 0 for empty/absent bodies', () => {
    expect(computeWordCount(null)).toBe(0);
    expect(computeWordCount({ type: 'doc', content: [] })).toBe(0);
  });
});
