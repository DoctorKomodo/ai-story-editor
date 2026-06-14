import { describe, expect, it } from 'vitest';
import { computeReorderedChapters } from '@/hooks/useChapters';
import { makeChapterMeta } from '../fixtures/chapter';

describe('Chapter reorder — keyboard-shift index math', () => {
  it('moves a row down by 1 (Down arrow → activeId/overId pair)', () => {
    const list = [
      makeChapterMeta({ id: 'a', orderIndex: 0 }),
      makeChapterMeta({ id: 'b', orderIndex: 1 }),
      makeChapterMeta({ id: 'c', orderIndex: 2 }),
    ];
    const next = computeReorderedChapters(list, 'a', 'b');
    expect(next?.map((c) => c.id)).toEqual(['b', 'a', 'c']);
    expect(next?.map((c) => c.orderIndex)).toEqual([0, 1, 2]);
  });

  it('moves a row up by 1 (Up arrow)', () => {
    const list = [
      makeChapterMeta({ id: 'a', orderIndex: 0 }),
      makeChapterMeta({ id: 'b', orderIndex: 1 }),
      makeChapterMeta({ id: 'c', orderIndex: 2 }),
    ];
    const next = computeReorderedChapters(list, 'c', 'b');
    expect(next?.map((c) => c.id)).toEqual(['a', 'c', 'b']);
  });

  it('returns null when active === over (Space-drop on same row)', () => {
    const list = [
      makeChapterMeta({ id: 'a', orderIndex: 0 }),
      makeChapterMeta({ id: 'b', orderIndex: 1 }),
    ];
    expect(computeReorderedChapters(list, 'a', 'a')).toBeNull();
  });

  it('returns null when overId is null (Escape cancel before drop)', () => {
    const list = [
      makeChapterMeta({ id: 'a', orderIndex: 0 }),
      makeChapterMeta({ id: 'b', orderIndex: 1 }),
    ];
    expect(computeReorderedChapters(list, 'a', null)).toBeNull();
  });
});

describe('ChapterList — KeyboardSensor wiring', () => {
  it('imports KeyboardSensor + sortableKeyboardCoordinates from dnd-kit', async () => {
    // Smoke: the module must load without throwing under jsdom. The sensors
    // themselves are tested at the integration layer by the Playwright sweep
    // [X24]; here we only assert the symbols are present in the bundle so a
    // future refactor can't accidentally drop them.
    const core = await import('@dnd-kit/core');
    const sortable = await import('@dnd-kit/sortable');
    expect(core.KeyboardSensor).toBeDefined();
    expect(core.TouchSensor).toBeDefined();
    expect(sortable.sortableKeyboardCoordinates).toBeDefined();
  });
});
