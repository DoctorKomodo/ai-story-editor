import { afterEach, describe, expect, it } from 'vitest';
import { resetCharRefSuggestionStore, useCharRefSuggestionStore } from '@/store/charRefSuggestion';

describe('useCharRefSuggestionStore', () => {
  afterEach(() => {
    resetCharRefSuggestionStore();
  });

  it('starts closed with no items, query empty, activeIndex 0', () => {
    const s = useCharRefSuggestionStore.getState();
    expect(s.open).toBe(false);
    expect(s.items).toEqual([]);
    expect(s.activeIndex).toBe(0);
    expect(s.query).toBe('');
    expect(s.clientRect).toBeNull();
  });

  it('openMenu() sets the full state in one update', () => {
    const onSelect = (): void => undefined;
    useCharRefSuggestionStore.getState().openMenu({
      items: [{ id: 'c1', name: 'Elena' }],
      query: 'el',
      clientRect: new DOMRect(10, 20, 0, 16),
      onSelect,
    });
    const s = useCharRefSuggestionStore.getState();
    expect(s.open).toBe(true);
    expect(s.items.length).toBe(1);
    expect(s.activeIndex).toBe(0);
    expect(s.onSelect).toBe(onSelect);
  });

  it('moveDown / moveUp wrap around', () => {
    useCharRefSuggestionStore.getState().openMenu({
      items: [
        { id: '1', name: 'A' },
        { id: '2', name: 'B' },
        { id: '3', name: 'C' },
      ],
      query: '',
      clientRect: null,
      onSelect: () => undefined,
    });
    const { moveDown, moveUp } = useCharRefSuggestionStore.getState();
    moveDown();
    expect(useCharRefSuggestionStore.getState().activeIndex).toBe(1);
    moveDown();
    moveDown();
    expect(useCharRefSuggestionStore.getState().activeIndex).toBe(0); // wrapped
    moveUp();
    expect(useCharRefSuggestionStore.getState().activeIndex).toBe(2); // wrapped
  });

  it('moveDown / moveUp on empty items keep activeIndex at 0 (no-op)', () => {
    useCharRefSuggestionStore.getState().openMenu({
      items: [],
      query: '',
      clientRect: null,
      onSelect: () => undefined,
    });
    useCharRefSuggestionStore.getState().moveDown();
    expect(useCharRefSuggestionStore.getState().activeIndex).toBe(0);
  });

  it('updateItems replaces items and resets activeIndex when the list shrinks past it', () => {
    useCharRefSuggestionStore.getState().openMenu({
      items: [
        { id: '1', name: 'A' },
        { id: '2', name: 'B' },
        { id: '3', name: 'C' },
      ],
      query: '',
      clientRect: null,
      onSelect: () => undefined,
    });
    useCharRefSuggestionStore.getState().moveDown();
    useCharRefSuggestionStore.getState().moveDown(); // activeIndex = 2
    useCharRefSuggestionStore
      .getState()
      .updateItems({ items: [{ id: '1', name: 'A' }], query: 'a', clientRect: null });
    const s = useCharRefSuggestionStore.getState();
    expect(s.items).toHaveLength(1);
    expect(s.activeIndex).toBe(0);
    expect(s.query).toBe('a');
  });

  it('close() resets to the initial state', () => {
    useCharRefSuggestionStore.getState().openMenu({
      items: [{ id: '1', name: 'A' }],
      query: 'a',
      clientRect: new DOMRect(0, 0, 0, 0),
      onSelect: () => undefined,
    });
    useCharRefSuggestionStore.getState().close();
    const s = useCharRefSuggestionStore.getState();
    expect(s.open).toBe(false);
    expect(s.items).toEqual([]);
    expect(s.query).toBe('');
    expect(s.activeIndex).toBe(0);
    expect(s.clientRect).toBeNull();
  });
});
