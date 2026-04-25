import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useActiveChapterStore } from '@/store/activeChapter';

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
});
