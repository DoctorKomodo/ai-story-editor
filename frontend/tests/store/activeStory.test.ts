import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useActiveStoryStore } from '@/store/activeStory';

afterEach(() => {
  act(() => {
    useActiveStoryStore.getState().setActiveStoryId(null);
  });
});

describe('useActiveStoryStore', () => {
  it('defaults to null', () => {
    const { result } = renderHook(() => useActiveStoryStore());
    expect(result.current.activeStoryId).toBeNull();
  });

  it('sets the active story id', () => {
    const { result } = renderHook(() => useActiveStoryStore());
    act(() => {
      result.current.setActiveStoryId('story-123');
    });
    expect(result.current.activeStoryId).toBe('story-123');
  });

  it('can clear back to null', () => {
    const { result } = renderHook(() => useActiveStoryStore());
    act(() => {
      result.current.setActiveStoryId('story-123');
    });
    act(() => {
      result.current.setActiveStoryId(null);
    });
    expect(result.current.activeStoryId).toBeNull();
  });
});
