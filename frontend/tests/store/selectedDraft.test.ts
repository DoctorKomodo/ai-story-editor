import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useSelectedDraftStore } from '@/store/selectedDraft';

afterEach(() => {
  act(() => {
    useSelectedDraftStore.getState().reset();
  });
});

describe('useSelectedDraftStore', () => {
  it('defaults to null (follow the active draft)', () => {
    const { result } = renderHook(() => useSelectedDraftStore());
    expect(result.current.selected).toBeNull();
  });

  it('setSelectedDraft stores the chapter-scoped pair', () => {
    const { result } = renderHook(() => useSelectedDraftStore());
    act(() => {
      result.current.setSelectedDraft('ch-1', 'draft-9');
    });
    expect(result.current.selected).toEqual({ chapterId: 'ch-1', draftId: 'draft-9' });
  });

  it('clearSelectedDraft returns to follow-active', () => {
    const { result } = renderHook(() => useSelectedDraftStore());
    act(() => {
      result.current.setSelectedDraft('ch-1', 'draft-9');
    });
    act(() => {
      result.current.clearSelectedDraft();
    });
    expect(result.current.selected).toBeNull();
  });

  it('a later setSelectedDraft overwrites the previous pair (one selection app-wide)', () => {
    const { result } = renderHook(() => useSelectedDraftStore());
    act(() => {
      result.current.setSelectedDraft('ch-1', 'draft-9');
    });
    act(() => {
      result.current.setSelectedDraft('ch-2', 'draft-3');
    });
    expect(result.current.selected).toEqual({ chapterId: 'ch-2', draftId: 'draft-3' });
  });

  it('reset() returns data fields to initialState', () => {
    const { result } = renderHook(() => useSelectedDraftStore());
    act(() => {
      result.current.setSelectedDraft('ch-1', 'draft-42');
    });
    act(() => {
      result.current.reset();
    });
    expect(result.current.selected).toBeNull();
  });
});
