import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import type { Draft, DraftMeta } from 'story-editor-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chaptersQueryKey } from '@/hooks/useChapters';
import {
  activeDraftIdOf,
  draftQueryKey,
  draftsQueryKey,
  isDraftConflictError,
  useDraftQuery,
  useDraftsQuery,
  useUpdateDraftMutation,
} from '@/hooks/useDrafts';
import { ApiError, resetApiClientForTests } from '@/lib/api';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function withClient(): {
  wrapper: (p: { children: ReactNode }) => JSX.Element;
  qc: QueryClient;
} {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { wrapper, qc };
}

const draftMetaFixture: DraftMeta = {
  id: 'd-1',
  chapterId: 'ch-1',
  label: null,
  wordCount: 120,
  orderIndex: 0,
  isActive: true,
  hasSummary: false,
  summaryIsStale: false,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T01:00:00.000Z',
};

const draftMetaFixtureInactive: DraftMeta = {
  ...draftMetaFixture,
  id: 'd-2',
  isActive: false,
  orderIndex: 1,
};

const draftFixture: Draft = {
  ...draftMetaFixture,
  bodyJson: { type: 'doc', content: [] },
  summary: null,
  summaryUpdatedAt: null,
};

describe('useDraftsQuery', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetApiClientForTests();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientForTests();
  });

  it('GETs /api/chapters/:chapterId/drafts and returns DraftMeta[]', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { drafts: [draftMetaFixture, draftMetaFixtureInactive] }),
    );
    const { wrapper } = withClient();
    const { result } = renderHook(() => useDraftsQuery('ch-1'), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data).toEqual([draftMetaFixture, draftMetaFixtureInactive]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/chapters/ch-1/drafts');
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('is disabled when chapterId is null (fetch not called)', () => {
    const { wrapper } = withClient();
    const { result } = renderHook(() => useDraftsQuery(null), { wrapper });

    expect(result.current.fetchStatus).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('useDraftQuery', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetApiClientForTests();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientForTests();
  });

  it('GETs /api/drafts/:draftId and returns the parsed Draft', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { draft: draftFixture }));
    const { wrapper } = withClient();
    const { result } = renderHook(() => useDraftQuery('d-1'), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data).toEqual(draftFixture);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/drafts/d-1');
  });

  it('is disabled when draftId is null (fetch not called)', () => {
    const { wrapper } = withClient();
    const { result } = renderHook(() => useDraftQuery(null), { wrapper });

    expect(result.current.fetchStatus).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('useUpdateDraftMutation', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetApiClientForTests();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientForTests();
  });

  it('PATCHes /api/drafts/:draftId with the given input and updates caches on success', async () => {
    const updatedDraft: Draft = { ...draftFixture, wordCount: 150 };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { draft: updatedDraft }));

    const { wrapper, qc } = withClient();
    // Pre-seed both invalidation targets so `getQueryState` has an existing
    // entry to flip `isInvalidated` on — an untouched key has no query state
    // at all, invalidated or otherwise.
    qc.setQueryData(draftsQueryKey('ch-1'), [draftMetaFixture]);
    qc.setQueryData(chaptersQueryKey('s-1'), []);
    const { result } = renderHook(() => useUpdateDraftMutation(), { wrapper });

    await result.current.mutateAsync({
      draftId: 'd-1',
      chapterId: 'ch-1',
      storyId: 's-1',
      input: { bodyJson: { type: 'doc', content: [] }, expectedUpdatedAt: draftFixture.updatedAt },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/drafts/d-1');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({
      bodyJson: { type: 'doc', content: [] },
      expectedUpdatedAt: draftFixture.updatedAt,
    });

    expect(qc.getQueryData(draftQueryKey('d-1'))).toEqual(updatedDraft);
    expect(qc.getQueryState(draftsQueryKey('ch-1'))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(chaptersQueryKey('s-1'))?.isInvalidated).toBe(true);
  });
});

describe('isDraftConflictError', () => {
  it('returns true for a 409 ApiError with code "conflict"', () => {
    expect(
      isDraftConflictError(new ApiError(409, 'Draft was modified elsewhere', 'conflict')),
    ).toBe(true);
  });

  it('returns false for a 409 ApiError with a different code', () => {
    expect(
      isDraftConflictError(new ApiError(409, 'Venice key required', 'venice_key_required')),
    ).toBe(false);
  });

  it('returns false for a non-409 ApiError', () => {
    expect(isDraftConflictError(new ApiError(400, 'Bad request', 'validation_error'))).toBe(false);
  });

  it('returns false for a plain Error', () => {
    expect(isDraftConflictError(new Error('boom'))).toBe(false);
  });

  it('returns false for a non-error value', () => {
    expect(isDraftConflictError(null)).toBe(false);
    expect(isDraftConflictError(undefined)).toBe(false);
    expect(isDraftConflictError('conflict')).toBe(false);
  });
});

describe('activeDraftIdOf', () => {
  it('picks the isActive entry', () => {
    expect(activeDraftIdOf([draftMetaFixtureInactive, draftMetaFixture])).toBe('d-1');
  });

  it('returns null on undefined', () => {
    expect(activeDraftIdOf(undefined)).toBeNull();
  });

  it('returns null on an empty list', () => {
    expect(activeDraftIdOf([])).toBeNull();
  });
});
