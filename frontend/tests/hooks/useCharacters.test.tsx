import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type Character,
  characterQueryKey,
  charactersQueryKey,
  computeCharactersAfterDelete,
  computeReorderedCharacters,
  useDeleteCharacterMutation,
  useReorderCharactersMutation,
} from '@/hooks/useCharacters';
import { resetApiClientForTests, setAccessToken } from '@/lib/api';

function meta(id: string, orderIndex: number): Character {
  return {
    id,
    storyId: 's',
    name: id,
    role: null,
    age: null,
    appearance: null,
    voice: null,
    arc: null,
    personality: null,
    orderIndex,
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
  };
}

describe('computeReorderedCharacters', () => {
  it('returns null when overId is null', () => {
    const list = [meta('a', 0), meta('b', 1)];
    expect(computeReorderedCharacters(list, 'a', null)).toBeNull();
  });

  it('returns null when active === over', () => {
    const list = [meta('a', 0), meta('b', 1)];
    expect(computeReorderedCharacters(list, 'a', 'a')).toBeNull();
  });

  it('reorders and reassigns 0..N-1 (move down by 1)', () => {
    const list = [meta('a', 0), meta('b', 1), meta('c', 2)];
    const next = computeReorderedCharacters(list, 'a', 'b');
    expect(next?.map((c) => c.id)).toEqual(['b', 'a', 'c']);
    expect(next?.map((c) => c.orderIndex)).toEqual([0, 1, 2]);
  });

  it('reorders and reassigns 0..N-1 (move up by 1)', () => {
    const list = [meta('a', 0), meta('b', 1), meta('c', 2)];
    const next = computeReorderedCharacters(list, 'c', 'b');
    expect(next?.map((c) => c.id)).toEqual(['a', 'c', 'b']);
  });
});

describe('computeCharactersAfterDelete', () => {
  it('returns null when the id is not present', () => {
    const list = [meta('a', 0), meta('b', 1)];
    expect(computeCharactersAfterDelete(list, 'zzz')).toBeNull();
  });

  it('removes the character and reassigns 0..N-1', () => {
    const list = [meta('a', 0), meta('b', 1), meta('c', 2), meta('d', 3)];
    const next = computeCharactersAfterDelete(list, 'b');
    expect(next?.map((c) => [c.id, c.orderIndex])).toEqual([
      ['a', 0],
      ['c', 1],
      ['d', 2],
    ]);
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

describe('useReorderCharactersMutation', () => {
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

  function makeWrapper(qc: QueryClient): React.FC<{ children: React.ReactNode }> {
    const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    return Wrapper;
  }

  it('PATCHes /characters/reorder and writes optimistic cache; rolls back on 500', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const seed = [meta('a', 0), meta('b', 1)];
    qc.setQueryData(charactersQueryKey('s1'), seed);

    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: { code: 'oops' } }));

    const { result } = renderHook(() => useReorderCharactersMutation('s1'), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await expect(result.current.mutateAsync([meta('b', 0), meta('a', 1)])).rejects.toBeDefined();
    });

    // Cache rolled back to original.
    expect(qc.getQueryData<typeof seed>(charactersQueryKey('s1'))?.map((c) => c.id)).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('useDeleteCharacterMutation — optimistic reassign', () => {
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

  function makeWrapper(qc: QueryClient): React.FC<{ children: React.ReactNode }> {
    const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    return Wrapper;
  }

  it('removes optimistically with sequential reassign; evicts per-character cache on success', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(charactersQueryKey('s1'), [meta('a', 0), meta('b', 1), meta('c', 2)]);
    qc.setQueryData(characterQueryKey('s1', 'b'), { ...meta('b', 1) });

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const { result } = renderHook(() => useDeleteCharacterMutation('s1'), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync({ id: 'b' });
    });

    expect(qc.getQueryData(characterQueryKey('s1', 'b'))).toBeUndefined();

    await waitFor(() => {
      const list = qc.getQueryData<{ id: string; orderIndex: number }[]>(charactersQueryKey('s1'));
      expect(list?.map((c) => [c.id, c.orderIndex])).toEqual([
        ['a', 0],
        ['c', 1],
      ]);
    });
  });

  it('rolls back the cache on 500', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(charactersQueryKey('s1'), [meta('a', 0), meta('b', 1)]);

    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: { code: 'oops' } }));

    const { result } = renderHook(() => useDeleteCharacterMutation('s1'), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await expect(result.current.mutateAsync({ id: 'b' })).rejects.toBeDefined();
    });

    expect(qc.getQueryData<{ id: string }[]>(charactersQueryKey('s1'))?.map((c) => c.id)).toEqual([
      'a',
      'b',
    ]);
  });
});
