import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useModelStore } from '@/store/model';

afterEach(() => {
  act(() => {
    useModelStore.getState().setModelId(null);
  });
});

describe('useModelStore', () => {
  it('defaults modelId to null', () => {
    const { result } = renderHook(() => useModelStore());
    expect(result.current.modelId).toBeNull();
  });

  it('setModelId updates the model id', () => {
    const { result } = renderHook(() => useModelStore());
    act(() => {
      result.current.setModelId('venice-uncensored-1.5');
    });
    expect(result.current.modelId).toBe('venice-uncensored-1.5');
  });

  it('can clear back to null', () => {
    const { result } = renderHook(() => useModelStore());
    act(() => {
      result.current.setModelId('venice-uncensored-1.5');
    });
    act(() => {
      result.current.setModelId(null);
    });
    expect(result.current.modelId).toBeNull();
  });
});
