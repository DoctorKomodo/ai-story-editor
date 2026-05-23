import { describe, expect, it } from 'vitest';
import { deriveListSummaryState, deriveSummaryState } from './useChapterSummary';

describe('deriveSummaryState', () => {
  it('returns missing when hasSummary is false', () => {
    expect(deriveSummaryState({ hasSummary: false, summaryIsStale: false, summary: null })).toBe(
      'missing',
    );
  });
  it('returns corrupted when hasSummary && summary === null (decrypt failure path)', () => {
    expect(deriveSummaryState({ hasSummary: true, summaryIsStale: false, summary: null })).toBe(
      'corrupted',
    );
  });
  it('returns stale when hasSummary && summaryIsStale && summary present', () => {
    expect(
      deriveSummaryState({
        hasSummary: true,
        summaryIsStale: true,
        summary: { events: 'a', stateAtEnd: 'b', openThreads: 'c' },
      }),
    ).toBe('stale');
  });
  it('returns current when hasSummary && !summaryIsStale && summary present', () => {
    expect(
      deriveSummaryState({
        hasSummary: true,
        summaryIsStale: false,
        summary: { events: 'a', stateAtEnd: 'b', openThreads: 'c' },
      }),
    ).toBe('current');
  });
});

describe('deriveListSummaryState (no detail — never corrupted)', () => {
  it('returns missing when hasSummary is false', () => {
    expect(deriveListSummaryState({ hasSummary: false, summaryIsStale: false })).toBe('missing');
  });
  it('returns stale when hasSummary && summaryIsStale', () => {
    expect(deriveListSummaryState({ hasSummary: true, summaryIsStale: true })).toBe('stale');
  });
  it('returns current when hasSummary && !summaryIsStale (NEVER corrupted from list meta)', () => {
    expect(deriveListSummaryState({ hasSummary: true, summaryIsStale: false })).toBe('current');
  });
});
