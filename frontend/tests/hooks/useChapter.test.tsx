import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type Chapter,
  chaptersQueryKey,
  useChapterQuery,
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

  it('returns the chapter from the chapters-list cache when present (no extra fetch)', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const cached = makeChapter();
    client.setQueryData(chaptersQueryKey('s1'), [cached]);

    const { result } = renderHook(() => useChapterQuery('c1', 's1'), {
      wrapper: makeWrapper(client),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual(cached);
    expect(fetchMock).not.toHaveBeenCalled();
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
  });
});
