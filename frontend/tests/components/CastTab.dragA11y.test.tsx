import { describe, expect, it } from 'vitest';
import type { Character } from '@/hooks/useCharacters';
import { computeReorderedCharacters } from '@/hooks/useCharacters';

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

describe('Cast reorder — keyboard-shift index math', () => {
  it('moves a row down by 1', () => {
    const list = [meta('a', 0), meta('b', 1), meta('c', 2)];
    const next = computeReorderedCharacters(list, 'a', 'b');
    expect(next?.map((c) => c.id)).toEqual(['b', 'a', 'c']);
    expect(next?.map((c) => c.orderIndex)).toEqual([0, 1, 2]);
  });

  it('moves a row up by 1', () => {
    const list = [meta('a', 0), meta('b', 1), meta('c', 2)];
    const next = computeReorderedCharacters(list, 'c', 'b');
    expect(next?.map((c) => c.id)).toEqual(['a', 'c', 'b']);
  });

  it('returns null when active === over', () => {
    expect(computeReorderedCharacters([meta('a', 0)], 'a', 'a')).toBeNull();
  });

  it('returns null when overId is null', () => {
    expect(computeReorderedCharacters([meta('a', 0)], 'a', null)).toBeNull();
  });
});

describe('CastTab — KeyboardSensor wiring', () => {
  it('imports KeyboardSensor + sortableKeyboardCoordinates from dnd-kit', async () => {
    const core = await import('@dnd-kit/core');
    const sortable = await import('@dnd-kit/sortable');
    expect(core.KeyboardSensor).toBeDefined();
    expect(core.TouchSensor).toBeDefined();
    expect(sortable.sortableKeyboardCoordinates).toBeDefined();
  });
});
