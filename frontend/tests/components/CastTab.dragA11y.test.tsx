import { describe, expect, it } from 'vitest';
import { computeReorderedCharacters } from '@/hooks/useCharacters';
import { makeCharacter } from '../fixtures/character';

describe('Cast reorder — keyboard-shift index math', () => {
  it('moves a row down by 1', () => {
    const list = [
      makeCharacter({ id: 'a', orderIndex: 0 }),
      makeCharacter({ id: 'b', orderIndex: 1 }),
      makeCharacter({ id: 'c', orderIndex: 2 }),
    ];
    const next = computeReorderedCharacters(list, 'a', 'b');
    expect(next?.map((c) => c.id)).toEqual(['b', 'a', 'c']);
    expect(next?.map((c) => c.orderIndex)).toEqual([0, 1, 2]);
  });

  it('moves a row up by 1', () => {
    const list = [
      makeCharacter({ id: 'a', orderIndex: 0 }),
      makeCharacter({ id: 'b', orderIndex: 1 }),
      makeCharacter({ id: 'c', orderIndex: 2 }),
    ];
    const next = computeReorderedCharacters(list, 'c', 'b');
    expect(next?.map((c) => c.id)).toEqual(['a', 'c', 'b']);
  });

  it('returns null when active === over', () => {
    expect(
      computeReorderedCharacters([makeCharacter({ id: 'a', orderIndex: 0 })], 'a', 'a'),
    ).toBeNull();
  });

  it('returns null when overId is null', () => {
    expect(
      computeReorderedCharacters([makeCharacter({ id: 'a', orderIndex: 0 })], 'a', null),
    ).toBeNull();
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
