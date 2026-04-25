import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { type AttachedSelectionValue, useAttachedSelectionStore } from '@/store/attachedSelection';

afterEach(() => {
  act(() => {
    useAttachedSelectionStore.getState().clear();
  });
});

describe('useAttachedSelectionStore', () => {
  it('defaults to null', () => {
    const { result } = renderHook(() => useAttachedSelectionStore());
    expect(result.current.attachedSelection).toBeNull();
  });

  it('sets an attached selection', () => {
    const { result } = renderHook(() => useAttachedSelectionStore());
    const value: AttachedSelectionValue = {
      text: 'snippet',
      chapter: { id: 'c1', number: 3, title: 'The Reckoning' },
    };
    act(() => {
      result.current.setAttachedSelection(value);
    });
    expect(result.current.attachedSelection).toEqual(value);
  });

  it('clear() resets to null', () => {
    const { result } = renderHook(() => useAttachedSelectionStore());
    act(() => {
      result.current.setAttachedSelection({
        text: 'x',
        chapter: { id: 'c2', number: 1, title: 'Intro' },
      });
    });
    act(() => {
      result.current.clear();
    });
    expect(result.current.attachedSelection).toBeNull();
  });
});
