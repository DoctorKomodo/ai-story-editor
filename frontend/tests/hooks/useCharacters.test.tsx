import { describe, expect, it } from 'vitest';
import {
  type Character,
  computeCharactersAfterDelete,
  computeReorderedCharacters,
} from '@/hooks/useCharacters';

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
