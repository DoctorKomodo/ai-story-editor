import { describe, expect, it } from 'vitest';
import { formatWordCountCompact } from '@/lib/formatWordCount';

describe('formatWordCountCompact', () => {
  it('renders 0 as em-dash', () => {
    expect(formatWordCountCompact(0)).toBe('—');
  });

  it('renders negatives defensively as em-dash', () => {
    expect(formatWordCountCompact(-1)).toBe('—');
  });

  it('renders 1..999 as the raw integer', () => {
    expect(formatWordCountCompact(1)).toBe('1');
    expect(formatWordCountCompact(987)).toBe('987');
    expect(formatWordCountCompact(999)).toBe('999');
  });

  it('renders >=1000 as one-decimal k', () => {
    expect(formatWordCountCompact(1000)).toBe('1.0k');
    expect(formatWordCountCompact(2000)).toBe('2.0k');
    expect(formatWordCountCompact(2100)).toBe('2.1k');
    expect(formatWordCountCompact(2150)).toBe('2.2k');
    expect(formatWordCountCompact(12345)).toBe('12.3k');
  });
});
