import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useComposerDraftStore } from '@/store/composerDraft';

afterEach(() => {
  act(() => {
    useComposerDraftStore.setState({ draft: null, focusToken: 0 });
  });
});

describe('useComposerDraftStore', () => {
  it('defaults to null draft and focusToken 0', () => {
    const { result } = renderHook(() => useComposerDraftStore());
    expect(result.current.draft).toBeNull();
    expect(result.current.focusToken).toBe(0);
  });

  it('setDraft sets the draft string', () => {
    const { result } = renderHook(() => useComposerDraftStore());
    act(() => {
      result.current.setDraft('hello there');
    });
    expect(result.current.draft).toBe('hello there');
  });

  it('clearDraft resets the draft to null', () => {
    const { result } = renderHook(() => useComposerDraftStore());
    act(() => {
      result.current.setDraft('temporary');
    });
    expect(result.current.draft).toBe('temporary');
    act(() => {
      result.current.clearDraft();
    });
    expect(result.current.draft).toBeNull();
  });

  it('requestFocus increments focusToken on each call', () => {
    const { result } = renderHook(() => useComposerDraftStore());
    expect(result.current.focusToken).toBe(0);
    act(() => {
      result.current.requestFocus();
    });
    expect(result.current.focusToken).toBe(1);
    act(() => {
      result.current.requestFocus();
    });
    expect(result.current.focusToken).toBe(2);
  });

  it('clearDraft does not affect focusToken', () => {
    const { result } = renderHook(() => useComposerDraftStore());
    act(() => {
      result.current.requestFocus();
      result.current.requestFocus();
    });
    const tokenBefore = result.current.focusToken;
    act(() => {
      result.current.clearDraft();
    });
    expect(result.current.focusToken).toBe(tokenBefore);
  });
});
