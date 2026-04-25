import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { type SelectionValue, useSelectionStore } from '@/store/selection';

afterEach(() => {
  act(() => {
    useSelectionStore.getState().clear();
  });
});

describe('useSelectionStore', () => {
  it('defaults to null', () => {
    const { result } = renderHook(() => useSelectionStore());
    expect(result.current.selection).toBeNull();
  });

  it('sets a selection (text/range/rect)', () => {
    const { result } = renderHook(() => useSelectionStore());
    const value: SelectionValue = {
      text: 'hello',
      range: null,
      rect: null,
    };
    act(() => {
      result.current.setSelection(value);
    });
    expect(result.current.selection).toEqual(value);
  });

  it('clear() resets to null', () => {
    const { result } = renderHook(() => useSelectionStore());
    act(() => {
      result.current.setSelection({ text: 'x', range: null, rect: null });
    });
    act(() => {
      result.current.clear();
    });
    expect(result.current.selection).toBeNull();
  });
});
