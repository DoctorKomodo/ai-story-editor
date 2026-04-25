import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { type InlineAIResultValue, useInlineAIResultStore } from '@/store/inlineAIResult';

afterEach(() => {
  act(() => {
    useInlineAIResultStore.getState().clear();
  });
});

describe('useInlineAIResultStore', () => {
  it('defaults to null', () => {
    const { result } = renderHook(() => useInlineAIResultStore());
    expect(result.current.inlineAIResult).toBeNull();
  });

  it('sets an inline AI result', () => {
    const { result } = renderHook(() => useInlineAIResultStore());
    const value: InlineAIResultValue = {
      action: 'rewrite',
      text: 'hello',
      status: 'streaming',
      output: 'partial',
    };
    act(() => {
      result.current.setInlineAIResult(value);
    });
    expect(result.current.inlineAIResult).toEqual(value);
  });

  it('clear() resets to null', () => {
    const { result } = renderHook(() => useInlineAIResultStore());
    act(() => {
      result.current.setInlineAIResult({
        action: 'ask',
        text: 't',
        status: 'thinking',
        output: '',
      });
    });
    act(() => {
      result.current.clear();
    });
    expect(result.current.inlineAIResult).toBeNull();
  });
});
