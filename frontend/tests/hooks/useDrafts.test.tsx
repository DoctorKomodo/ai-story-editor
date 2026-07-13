import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import type { Draft, DraftMeta } from 'story-editor-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chapterQueryKey, chaptersQueryKey } from '@/hooks/useChapters';
import {
  activeDraftIdOf,
  draftDisplayLabel,
  draftQueryKey,
  draftsQueryKey,
  isDraftConflictError,
  positionalDraftLabel,
  useCreateDraftMutation,
  useDeleteDraftMutation,
  useDraftQuery,
  useDraftsQuery,
  useSetActiveDraftMutation,
  useUpdateDraftMutation,
} from '@/hooks/useDrafts';
import { ApiError, resetApiClientForTests } from '@/lib/api';
import { getDraft, putDraft } from '@/lib/chapterDrafts';
import { useSessionStore } from '@/store/session';

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
  chatCount: 0,
};

const draftMetaFixtureInactive: DraftMeta = {
  ...draftMetaFixture,
  id: 'd-2',
  isActive: false,
  orderIndex: 1,
};

const { chatCount: _draftMetaFixtureChatCount, ...draftMetaFixtureCore } = draftMetaFixture;

const draftFixture: Draft = {
  ...draftMetaFixtureCore,
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

describe('positionalDraftLabel / draftDisplayLabel', () => {
  it('letters A..Z for orderIndex 0..25, then numeric', () => {
    expect(positionalDraftLabel(0)).toBe('Draft A');
    expect(positionalDraftLabel(1)).toBe('Draft B');
    expect(positionalDraftLabel(25)).toBe('Draft Z');
    // Deliberate discontinuity: Z is the 26th; "Draft 26" never appears.
    expect(positionalDraftLabel(26)).toBe('Draft 27');
    expect(positionalDraftLabel(99)).toBe('Draft 100');
  });

  it('custom label wins; null label falls back to positional', () => {
    expect(draftDisplayLabel({ label: 'Grimdark ending', orderIndex: 3 })).toBe('Grimdark ending');
    expect(draftDisplayLabel({ label: null, orderIndex: 3 })).toBe('Draft D');
  });
});

describe('useCreateDraftMutation', () => {
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

  it('POSTs mode+label, seeds the record cache, invalidates drafts list + chapters list', async () => {
    const created: Draft = { ...draftFixture, id: 'd-new', orderIndex: 2, isActive: false };
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { draft: created }));
    const { wrapper, qc } = withClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useCreateDraftMutation(), { wrapper });
    await result.current.mutateAsync({
      chapterId: 'ch-1',
      storyId: 'story-1',
      input: { mode: 'fork', label: 'Alt ending' },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/chapters/ch-1/drafts');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ mode: 'fork', label: 'Alt ending' });

    expect(qc.getQueryData(draftQueryKey('d-new'))).toEqual(created);
    const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(draftsQueryKey('ch-1')));
    expect(keys).toContain(JSON.stringify(chaptersQueryKey('story-1')));
  });
});

describe('useSetActiveDraftMutation', () => {
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

  it('PUTs the active-draft pointer and invalidates the five affected keys', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { wrapper, qc } = withClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useSetActiveDraftMutation(), { wrapper });
    await result.current.mutateAsync({
      chapterId: 'ch-1',
      storyId: 'story-1',
      draftId: 'd-2',
      previousActiveDraftId: 'd-1',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/chapters/ch-1/active-draft');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ draftId: 'd-2' });

    const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(draftsQueryKey('ch-1')));
    expect(keys).toContain(JSON.stringify(chaptersQueryKey('story-1')));
    // Chapter detail GET serves the ACTIVE draft's summary (step-6 D5).
    expect(keys).toContain(JSON.stringify(chapterQueryKey('ch-1')));
    // Both flipped records.
    expect(keys).toContain(JSON.stringify(draftQueryKey('d-2')));
    expect(keys).toContain(JSON.stringify(draftQueryKey('d-1')));
  });

  it('skips the previous-record invalidation when previousActiveDraftId is null', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { wrapper, qc } = withClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useSetActiveDraftMutation(), { wrapper });
    await result.current.mutateAsync({
      chapterId: 'ch-1',
      storyId: 'story-1',
      draftId: 'd-2',
      previousActiveDraftId: null,
    });

    const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).not.toContain(JSON.stringify(draftQueryKey('null')));
    expect(keys.filter((k) => k.includes('"detail"')).length).toBe(1);
  });
});

describe('useDeleteDraftMutation', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetApiClientForTests();
    useSessionStore.setState({
      user: { id: 'u1', username: 'alice', name: 'Alice' },
      status: 'authenticated',
    });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientForTests();
    act(() => {
      useSessionStore.setState({ user: null, status: 'idle' });
    });
  });

  it('DELETEs, prefix-removes the draft cache tree, invalidates lists, purges the IDB row', async () => {
    // Seed a local recovery row for the doomed draft.
    await putDraft({
      userId: 'u1',
      storyId: 'story-1',
      chapterId: 'ch-1',
      draftId: 'd-2',
      bodyJson: { type: 'doc', content: [] },
      baseUpdatedAt: '2026-06-01T00:00:00.000Z',
      savedAt: Date.now(),
    });

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { wrapper, qc } = withClient();
    qc.setQueryData(draftQueryKey('d-2'), draftFixture);
    qc.setQueryData(['draft', 'd-2', 'chats', 'ask'], []);
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useDeleteDraftMutation(), { wrapper });
    await result.current.mutateAsync({ chapterId: 'ch-1', storyId: 'story-1', draftId: 'd-2' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/drafts/d-2');
    expect(init.method).toBe('DELETE');

    // Prefix removal: record + chat lists (message caches are a different
    // prefix, deliberately left to gcTime).
    expect(qc.getQueryData(draftQueryKey('d-2'))).toBeUndefined();
    expect(qc.getQueryData(['draft', 'd-2', 'chats', 'ask'])).toBeUndefined();

    const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(draftsQueryKey('ch-1')));
    expect(keys).toContain(JSON.stringify(chaptersQueryKey('story-1')));

    await waitFor(async () => {
      expect(await getDraft('u1', 'ch-1', 'd-2')).toBeNull();
    });
  });
});
