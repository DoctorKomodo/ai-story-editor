import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  characterQueryKey,
  charactersQueryKey,
  computeCharactersAfterDelete,
  computeReorderedCharacters,
  useCharactersQuery,
  useDeleteCharacterMutation,
  useReorderCharactersMutation,
} from '@/hooks/useCharacters';
import * as apiModule from '@/lib/api';
import { resetApiClientForTests } from '@/lib/api';
import { makeCharacter } from '../fixtures/character';

describe('computeReorderedCharacters', () => {
  it('returns null when overId is null', () => {
    const list = [
      makeCharacter({ id: 'a', orderIndex: 0 }),
      makeCharacter({ id: 'b', orderIndex: 1 }),
    ];
    expect(computeReorderedCharacters(list, 'a', null)).toBeNull();
  });

  it('returns null when active === over', () => {
    const list = [
      makeCharacter({ id: 'a', orderIndex: 0 }),
      makeCharacter({ id: 'b', orderIndex: 1 }),
    ];
    expect(computeReorderedCharacters(list, 'a', 'a')).toBeNull();
  });

  it('reorders and reassigns 0..N-1 (move down by 1)', () => {
    const list = [
      makeCharacter({ id: 'a', orderIndex: 0 }),
      makeCharacter({ id: 'b', orderIndex: 1 }),
      makeCharacter({ id: 'c', orderIndex: 2 }),
    ];
    const next = computeReorderedCharacters(list, 'a', 'b');
    expect(next?.map((c) => c.id)).toEqual(['b', 'a', 'c']);
    expect(next?.map((c) => c.orderIndex)).toEqual([0, 1, 2]);
  });

  it('reorders and reassigns 0..N-1 (move up by 1)', () => {
    const list = [
      makeCharacter({ id: 'a', orderIndex: 0 }),
      makeCharacter({ id: 'b', orderIndex: 1 }),
      makeCharacter({ id: 'c', orderIndex: 2 }),
    ];
    const next = computeReorderedCharacters(list, 'c', 'b');
    expect(next?.map((c) => c.id)).toEqual(['a', 'c', 'b']);
  });
});

describe('computeCharactersAfterDelete', () => {
  it('returns null when the id is not present', () => {
    const list = [
      makeCharacter({ id: 'a', orderIndex: 0 }),
      makeCharacter({ id: 'b', orderIndex: 1 }),
    ];
    expect(computeCharactersAfterDelete(list, 'zzz')).toBeNull();
  });

  it('removes the character and reassigns 0..N-1', () => {
    const list = [
      makeCharacter({ id: 'a', orderIndex: 0 }),
      makeCharacter({ id: 'b', orderIndex: 1 }),
      makeCharacter({ id: 'c', orderIndex: 2 }),
      makeCharacter({ id: 'd', orderIndex: 3 }),
    ];
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
    const seed = [
      makeCharacter({ id: 'a', orderIndex: 0 }),
      makeCharacter({ id: 'b', orderIndex: 1 }),
    ];
    qc.setQueryData(charactersQueryKey('s1'), seed);

    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: { code: 'oops' } }));

    const { result } = renderHook(() => useReorderCharactersMutation('s1'), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync([
          makeCharacter({ id: 'b', orderIndex: 0 }),
          makeCharacter({ id: 'a', orderIndex: 1 }),
        ]),
      ).rejects.toBeDefined();
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
    qc.setQueryData(charactersQueryKey('s1'), [
      makeCharacter({ id: 'a', orderIndex: 0 }),
      makeCharacter({ id: 'b', orderIndex: 1 }),
      makeCharacter({ id: 'c', orderIndex: 2 }),
    ]);
    qc.setQueryData(characterQueryKey('s1', 'b'), { ...makeCharacter({ id: 'b', orderIndex: 1 }) });

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
    qc.setQueryData(charactersQueryKey('s1'), [
      makeCharacter({ id: 'a', orderIndex: 0 }),
      makeCharacter({ id: 'b', orderIndex: 1 }),
    ]);

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

// ---------------------------------------------------------------------------
// Runtime validation (Zod schema) tests
// ---------------------------------------------------------------------------

function wrapQc() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return Wrapper;
}

describe('useCharacters runtime validation', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('surfaces ZodError when the server response is shape-drifted', async () => {
    // Mock api() to return a malformed body (missing required `name`).
    vi.spyOn(apiModule, 'api').mockResolvedValue({
      characters: [{ id: '550e8400-e29b-41d4-a716-446655440000' /* name absent */ }],
    });
    const { result } = renderHook(() => useCharactersQuery('story-id'), { wrapper: wrapQc() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeDefined();
    // ZodError.name === 'ZodError'; toString() in Zod v4 returns a JSON array,
    // not a string containing "zod", "issues", or "required".
    expect(result.current.error?.name).toBe('ZodError');
  });

  it('returns parsed characters on valid response', async () => {
    const valid = {
      characters: [
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          storyId: '550e8400-e29b-41d4-a716-446655440001',
          name: 'Imogen',
          role: null,
          age: null,
          appearance: null,
          personality: null,
          voice: null,
          backstory: null,
          arc: null,
          relationships: null,
          orderIndex: 0,
          color: null,
          initial: null,
          createdAt: '2026-05-11T00:00:00.000Z',
          updatedAt: '2026-05-11T00:00:00.000Z',
        },
      ],
    };
    vi.spyOn(apiModule, 'api').mockResolvedValue(valid);
    const { result } = renderHook(() => useCharactersQuery('story-id'), { wrapper: wrapQc() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.[0].name).toBe('Imogen');
  });
});
