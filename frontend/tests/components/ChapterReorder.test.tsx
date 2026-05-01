import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  arrayMove,
  type ChapterMeta,
  chaptersQueryKey,
  computeReorderedChapters,
  useReorderChaptersMutation,
} from '@/hooks/useChapters';
import { resetApiClientForTests, setAccessToken, setUnauthorizedHandler } from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';
import { useSessionStore } from '@/store/session';

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function chap(id: string, orderIndex: number): ChapterMeta {
  return {
    id,
    storyId: 'story-1',
    title: `Chapter ${String(orderIndex + 1)}`,
    wordCount: 0,
    orderIndex,
    status: 'draft',
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
  };
}

describe('arrayMove', () => {
  it('moves first to last', () => {
    expect(arrayMove(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });

  it('moves last to first', () => {
    expect(arrayMove(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });

  it('is a no-op when indices are equal', () => {
    expect(arrayMove(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
  });

  it('returns a copy on out-of-range indices rather than mutating', () => {
    const input = ['a', 'b', 'c'];
    const result = arrayMove(input, -1, 0);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
  });
});

describe('computeReorderedChapters', () => {
  const list = [chap('a', 0), chap('b', 1), chap('c', 2)];

  it('returns null when overId is null', () => {
    expect(computeReorderedChapters(list, 'a', null)).toBeNull();
  });

  it('returns null when activeId === overId', () => {
    expect(computeReorderedChapters(list, 'b', 'b')).toBeNull();
  });

  it('returns null when an id is unknown', () => {
    expect(computeReorderedChapters(list, 'zzz', 'b')).toBeNull();
  });

  it('moves the active item to the over position and resequences orderIndex', () => {
    const next = computeReorderedChapters(list, 'a', 'c');
    expect(next).not.toBeNull();
    expect(next?.map((c) => c.id)).toEqual(['b', 'c', 'a']);
    expect(next?.map((c) => c.orderIndex)).toEqual([0, 1, 2]);
  });
});

describe('useReorderChaptersMutation', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    resetApiClientForTests();
    setUnauthorizedHandler(() => {
      useSessionStore.getState().clearSession();
    });
    useSessionStore.setState({ user: { id: 'u1', username: 'alice' }, status: 'authenticated' });
    setAccessToken('test-token');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientForTests();
    useSessionStore.getState().clearSession();
  });

  function wrapper(qc = createQueryClient()): {
    qc: ReturnType<typeof createQueryClient>;
    Wrapper: ({ children }: { children: ReactNode }) => JSX.Element;
  } {
    const Wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    return { qc, Wrapper };
  }

  it('optimistically updates the cache before the PATCH resolves', async () => {
    const original = [chap('a', 0), chap('b', 1), chap('c', 2)];
    const { qc, Wrapper } = wrapper();
    qc.setQueryData(chaptersQueryKey('story-1'), original);

    let resolvePatch!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolvePatch = resolve;
        }),
    );

    const { result } = renderHook(() => useReorderChaptersMutation('story-1'), {
      wrapper: Wrapper,
    });

    const reordered = computeReorderedChapters(original, 'a', 'c');
    expect(reordered).not.toBeNull();

    act(() => {
      result.current.mutate(reordered!);
    });

    await waitFor(() => {
      const cached = qc.getQueryData<ChapterMeta[]>(chaptersQueryKey('story-1'));
      expect(cached?.map((c) => c.id)).toEqual(['b', 'c', 'a']);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/stories\/story-1\/chapters\/reorder$/);
    expect(init.method).toBe('PATCH');
    const body = JSON.parse(init.body as string) as {
      chapters: Array<{ id: string; orderIndex: number }>;
    };
    expect(body.chapters).toEqual([
      { id: 'b', orderIndex: 0 },
      { id: 'c', orderIndex: 1 },
      { id: 'a', orderIndex: 2 },
    ]);

    resolvePatch(new Response(null, { status: 204 }));
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
  });

  it('rolls back the cache when the server returns 500', async () => {
    const original = [chap('a', 0), chap('b', 1), chap('c', 2)];
    const { qc, Wrapper } = wrapper();
    qc.setQueryData(chaptersQueryKey('story-1'), original);

    // First call = the PATCH that fails; potential invalidate refetches also
    // resolve to a shape the query can consume.
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/reorder')) {
        return jsonResponse(500, { error: { message: 'boom', code: 'internal' } });
      }
      return jsonResponse(200, { chapters: original });
    });

    const { result } = renderHook(() => useReorderChaptersMutation('story-1'), {
      wrapper: Wrapper,
    });

    const reordered = computeReorderedChapters(original, 'a', 'c');

    act(() => {
      result.current.mutate(reordered!);
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    const cached = qc.getQueryData<ChapterMeta[]>(chaptersQueryKey('story-1'));
    expect(cached?.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps the new order in the cache when the PATCH succeeds', async () => {
    const original = [chap('a', 0), chap('b', 1), chap('c', 2)];
    const reordered = computeReorderedChapters(original, 'a', 'c')!;
    const { qc, Wrapper } = wrapper();
    qc.setQueryData(chaptersQueryKey('story-1'), original);

    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/reorder')) {
        return new Response(null, { status: 204 });
      }
      // onSettled invalidates; server responds with the new order.
      return jsonResponse(200, { chapters: reordered });
    });

    const { result } = renderHook(() => useReorderChaptersMutation('story-1'), {
      wrapper: Wrapper,
    });

    act(() => {
      result.current.mutate(reordered);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    await waitFor(() => {
      const cached = qc.getQueryData<ChapterMeta[]>(chaptersQueryKey('story-1'));
      expect(cached?.map((c) => c.id)).toEqual(['b', 'c', 'a']);
    });
  });
});
