import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deriveListSummaryState,
  deriveSummaryState,
  useSummariseChapterMutation,
  useUpdateChapterSummaryMutation,
} from '@/hooks/useChapterSummary';

describe('deriveSummaryState', () => {
  it('returns missing when hasSummary is false', () => {
    expect(deriveSummaryState({ hasSummary: false, summaryIsStale: false, summary: null })).toBe(
      'missing',
    );
  });
  it('returns missing regardless of summary value when hasSummary is false', () => {
    expect(
      deriveSummaryState({
        hasSummary: false,
        summaryIsStale: false,
        summary: { events: 'a', stateAtEnd: 'b', openThreads: 'c' },
      }),
    ).toBe('missing');
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

function wrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return QueryClientProvider({ client: qc, children });
  };
}

const SUMMARY_RESPONSE_BODY = JSON.stringify({
  summary: { events: 'a', stateAtEnd: 'b', openThreads: 'c' },
  summaryUpdatedAt: '2026-05-18T00:00:00.000Z',
});

describe('useSummariseChapterMutation (draft-scoped)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs /drafts/:draftId/summarise and invalidates all four keys', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(SUMMARY_RESPONSE_BODY, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useSummariseChapterMutation('d-1', 'c-1', 's-1'), {
      wrapper: wrapper(qc),
    });

    act(() => {
      result.current.mutate('m-1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/drafts/d-1/summarise'),
      expect.objectContaining({ method: 'POST' }),
    );
    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => c[0]?.queryKey);
    expect(invalidatedKeys).toEqual(
      expect.arrayContaining([
        ['chapter', 'c-1'],
        ['chapters', 's-1'],
        ['draft', 'd-1', 'detail'],
        ['chapter', 'c-1', 'drafts'],
      ]),
    );
  });
});

describe('useUpdateChapterSummaryMutation (draft-scoped)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('PUTs /drafts/:draftId/summary and invalidates all four keys', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(SUMMARY_RESPONSE_BODY, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateChapterSummaryMutation('d-1', 'c-1', 's-1'), {
      wrapper: wrapper(qc),
    });

    act(() => {
      result.current.mutate({ events: 'a', stateAtEnd: 'b', openThreads: 'c' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/drafts/d-1/summary'),
      expect.objectContaining({ method: 'PUT' }),
    );
    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => c[0]?.queryKey);
    expect(invalidatedKeys).toEqual(
      expect.arrayContaining([
        ['chapter', 'c-1'],
        ['chapters', 's-1'],
        ['draft', 'd-1', 'detail'],
        ['chapter', 'c-1', 'drafts'],
      ]),
    );
  });
});
