import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useParamsStore } from '@/store/params';

const DEFAULTS = {
  temperature: 0.85,
  topP: 0.95,
  maxTokens: 800,
  frequencyPenalty: 0,
};

afterEach(() => {
  act(() => {
    useParamsStore.getState().setParams(DEFAULTS);
  });
});

describe('useParamsStore', () => {
  it('exposes the documented defaults', () => {
    const { result } = renderHook(() => useParamsStore());
    expect(result.current.params).toEqual(DEFAULTS);
  });

  it('setParams patches a single key without clobbering others', () => {
    const { result } = renderHook(() => useParamsStore());
    act(() => {
      result.current.setParams({ temperature: 0.5 });
    });
    expect(result.current.params).toEqual({
      ...DEFAULTS,
      temperature: 0.5,
    });
  });

  it('setParams patches multiple keys at once', () => {
    const { result } = renderHook(() => useParamsStore());
    act(() => {
      result.current.setParams({ topP: 0.7, maxTokens: 2048 });
    });
    expect(result.current.params).toEqual({
      ...DEFAULTS,
      topP: 0.7,
      maxTokens: 2048,
    });
  });

  it('successive patches accumulate', () => {
    const { result } = renderHook(() => useParamsStore());
    act(() => {
      result.current.setParams({ frequencyPenalty: 0.4 });
    });
    act(() => {
      result.current.setParams({ temperature: 0.2 });
    });
    expect(result.current.params).toEqual({
      ...DEFAULTS,
      frequencyPenalty: 0.4,
      temperature: 0.2,
    });
  });
});
