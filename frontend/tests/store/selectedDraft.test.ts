import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useSelectedDraftStore } from '@/store/selectedDraft';

afterEach(() => {
  act(() => {
    useSelectedDraftStore.getState().setSelectedDraftId(null);
  });
});

describe('useSelectedDraftStore', () => {
  it('defaults to null', () => {
    const { result } = renderHook(() => useSelectedDraftStore());
    expect(result.current.selectedDraftId).toBeNull();
  });

  it('sets the selected draft id', () => {
    const { result } = renderHook(() => useSelectedDraftStore());
    act(() => {
      result.current.setSelectedDraftId('draft-9');
    });
    expect(result.current.selectedDraftId).toBe('draft-9');
  });

  it('can clear back to null', () => {
    const { result } = renderHook(() => useSelectedDraftStore());
    act(() => {
      result.current.setSelectedDraftId('draft-9');
    });
    act(() => {
      result.current.setSelectedDraftId(null);
    });
    expect(result.current.selectedDraftId).toBeNull();
  });

  it('reset() returns data fields to initialState', () => {
    const { result } = renderHook(() => useSelectedDraftStore());
    act(() => {
      result.current.setSelectedDraftId('draft-42');
    });
    act(() => {
      result.current.reset();
    });
    expect(result.current.selectedDraftId).toBeNull();
  });
});
