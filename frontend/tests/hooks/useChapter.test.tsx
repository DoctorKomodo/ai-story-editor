import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type Chapter,
  type ChapterMeta,
  chapterQueryKey,
  chaptersQueryKey,
  computeChaptersAfterDelete,
  useChapterQuery,
  useDeleteChapterMutation,
  useUpdateChapterMutation,
} from '@/hooks/useChapters';
import { resetApiClientForTests, setAccessToken } from '@/lib/api';

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeWrapper(client: QueryClient): (props: { children: ReactNode }) => JSX.Element {
  return function Wrapper({ children }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function makeChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: 'c1',
    storyId: 's1',
    title: 'Opening',
    orderIndex: 0,
    wordCount: 42,
    status: 'draft',
    bodyJson: { type: 'doc', content: [] },
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-24T00:00:00.000Z',
    ...overrides,
  };
}

describe('useChapterQuery', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    resetApiClientForTests();
    setAccessToken('tok');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientForTests();
  });

  it('does NOT short-circuit off the chapters-list cache (list is metadata-only)', async () => {
    // The list cache is body-less by design; reading from it would feed null
    // bodies into Paper. The single-chapter GET must always fire on a cold
    // per-chapter cache, even when a metadata entry for the same id is in
    // the chapters-list cache.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Seed only the metadata-shaped list — no `bodyJson`.
    client.setQueryData(chaptersQueryKey('s1'), [
      {
        id: 'c1',
        storyId: 's1',
        title: 'Opening',
        orderIndex: 0,
        wordCount: 42,
        status: 'draft' as const,
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-24T00:00:00.000Z',
      },
    ]);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        chapter: makeChapter({ bodyJson: { type: 'doc', content: [{ type: 'paragraph' }] } }),
      }),
    );

    const { result } = renderHook(() => useChapterQuery('c1', 's1'), {
      wrapper: makeWrapper(client),
    });

    await waitFor(() => expect(result.current.data?.bodyJson).toBeDefined());
    // GET /chapters/c1 must have been called — no short-circuit off the list.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('/api/stories/s1/chapters/c1');
  });

  it('falls back to a single-chapter GET when the cache is cold', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { chapter: makeChapter() }));

    const { result } = renderHook(() => useChapterQuery('c1', 's1'), {
      wrapper: makeWrapper(client),
    });

    await waitFor(() => expect(result.current.data?.id).toBe('c1'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('/api/stories/s1/chapters/c1');
  });

  it('returns undefined data while chapterId is null', () => {
    const client = new QueryClient();
    const { result } = renderHook(() => useChapterQuery(null), { wrapper: makeWrapper(client) });
    expect(result.current.data).toBeUndefined();
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useUpdateChapterMutation', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    resetApiClientForTests();
    setAccessToken('tok');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientForTests();
  });

  it('PATCHes the chapter with bodyJson + wordCount', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { chapter: makeChapter({ wordCount: 5, bodyJson: { type: 'doc' } }) }),
    );

    const { result } = renderHook(() => useUpdateChapterMutation(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        storyId: 's1',
        chapterId: 'c1',
        input: { bodyJson: { type: 'doc' }, wordCount: 5 },
      });
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/stories/s1/chapters/c1');
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe(JSON.stringify({ bodyJson: { type: 'doc' }, wordCount: 5 }));
  });

  it('updates the chapters-list cache with the response on success', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    client.setQueryData(chaptersQueryKey('s1'), [makeChapter({ wordCount: 0 })]);

    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { chapter: makeChapter({ wordCount: 5, bodyJson: { type: 'doc' } }) }),
    );

    const { result } = renderHook(() => useUpdateChapterMutation(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        storyId: 's1',
        chapterId: 'c1',
        input: { bodyJson: { type: 'doc' }, wordCount: 5 },
      });
    });

    const list = client.getQueryData(chaptersQueryKey('s1')) as Chapter[];
    expect(list[0]?.wordCount).toBe(5);
    // List cache is metadata-only — `onSuccess` must strip `bodyJson` from
    // the response before merging it in. If a future change drops the
    // destructure-and-spread, this assertion fails.
    expect(Object.keys(list[0] as Record<string, unknown>)).not.toContain('bodyJson');
  });
});

function meta(id: string, orderIndex: number): ChapterMeta {
  return {
    id,
    storyId: 's',
    title: id,
    wordCount: 0,
    orderIndex,
    status: 'draft',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
  };
}

describe('computeChaptersAfterDelete', () => {
  it('returns null when the chapter id is not present', () => {
    const list = [meta('a', 0), meta('b', 1)];
    expect(computeChaptersAfterDelete(list, 'zzz')).toBeNull();
  });

  it('removes the chapter and reassigns orderIndex 0..N-1', () => {
    const list = [meta('a', 0), meta('b', 1), meta('c', 2), meta('d', 3)];
    const next = computeChaptersAfterDelete(list, 'b');
    expect(next).not.toBeNull();
    expect(next?.map((c) => [c.id, c.orderIndex])).toEqual([
      ['a', 0],
      ['c', 1],
      ['d', 2],
    ]);
  });

  it('preserves existing orderIndex when no shift is needed', () => {
    const list = [meta('a', 0), meta('b', 1), meta('c', 2)];
    const next = computeChaptersAfterDelete(list, 'c');
    expect(next?.map((c) => [c.id, c.orderIndex])).toEqual([
      ['a', 0],
      ['b', 1],
    ]);
  });
});

describe('useDeleteChapterMutation', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    resetApiClientForTests();
    setAccessToken('tok-1');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientForTests();
  });

  it('DELETEs the chapter, evicts the per-chapter cache, and reassigns the list cache optimistically', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(chaptersQueryKey('s1'), [meta('a', 0), meta('b', 1), meta('c', 2)]);
    qc.setQueryData(chapterQueryKey('b'), { ...meta('b', 1), bodyJson: null });

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const { result } = renderHook(() => useDeleteChapterMutation('s1'), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync({ chapterId: 'b' });
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/stories/s1/chapters/b');
    expect((init as RequestInit).method).toBe('DELETE');

    expect(qc.getQueryData(chapterQueryKey('b'))).toBeUndefined();

    await waitFor(() => {
      const list = qc.getQueryData<ChapterMeta[]>(chaptersQueryKey('s1'));
      expect(list?.map((c) => c.id)).toEqual(['a', 'c']);
    });
  });

  it('rolls back the cache on 500', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(chaptersQueryKey('s1'), [meta('a', 0), meta('b', 1)]);

    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: { code: 'oops' } }));

    const { result } = renderHook(() => useDeleteChapterMutation('s1'), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await expect(result.current.mutateAsync({ chapterId: 'b' })).rejects.toBeDefined();
    });

    expect(qc.getQueryData<ChapterMeta[]>(chaptersQueryKey('s1'))?.map((c) => c.id)).toEqual([
      'a',
      'b',
    ]);
  });
});
