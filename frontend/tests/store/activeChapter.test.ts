import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveActiveChapterId, useActiveChapterStore } from '@/store/activeChapter';

const chapters = [
  { id: 'b', orderIndex: 1 },
  { id: 'a', orderIndex: 0 },
  { id: 'c', orderIndex: 2 },
];

describe('resolveActiveChapterId', () => {
  it('keeps the current selection when it belongs to the list', () => {
    expect(resolveActiveChapterId(chapters, 'c')).toBe('c');
  });

  it('selects the lowest-orderIndex chapter when current is null', () => {
    expect(resolveActiveChapterId(chapters, null)).toBe('a');
  });

  it('replaces a stale selection (not in the list) with the first chapter', () => {
    expect(resolveActiveChapterId(chapters, 'from-another-story')).toBe('a');
  });

  it('returns null for an empty chapter list', () => {
    expect(resolveActiveChapterId([], 'anything')).toBeNull();
  });
});

afterEach(() => {
  act(() => {
    useActiveChapterStore.getState().setActiveChapterId(null);
  });
});

describe('useActiveChapterStore', () => {
  it('defaults to null', () => {
    const { result } = renderHook(() => useActiveChapterStore());
    expect(result.current.activeChapterId).toBeNull();
  });

  it('sets the active chapter id', () => {
    const { result } = renderHook(() => useActiveChapterStore());
    act(() => {
      result.current.setActiveChapterId('chapter-9');
    });
    expect(result.current.activeChapterId).toBe('chapter-9');
  });

  it('can clear back to null', () => {
    const { result } = renderHook(() => useActiveChapterStore());
    act(() => {
      result.current.setActiveChapterId('chapter-9');
    });
    act(() => {
      result.current.setActiveChapterId(null);
    });
    expect(result.current.activeChapterId).toBeNull();
  });

  it('reset() returns data fields to initialState', () => {
    const { result } = renderHook(() => useActiveChapterStore());
    act(() => {
      result.current.setActiveChapterId('chapter-42');
    });
    act(() => {
      result.current.reset();
    });
    expect(result.current.activeChapterId).toBeNull();
  });
});
