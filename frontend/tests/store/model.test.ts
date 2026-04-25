import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useModelStore } from '@/store/model';

afterEach(() => {
  act(() => {
    useModelStore.getState().setModelId(null);
  });
});

describe('useModelStore', () => {
  it('defaults to { id: null }', () => {
    const { result } = renderHook(() => useModelStore());
    expect(result.current.model).toEqual({ id: null });
  });

  it('setModelId updates the model id', () => {
    const { result } = renderHook(() => useModelStore());
    act(() => {
      result.current.setModelId('venice-llama-3.1-405b');
    });
    expect(result.current.model).toEqual({ id: 'venice-llama-3.1-405b' });
  });

  it('can clear back to null', () => {
    const { result } = renderHook(() => useModelStore());
    act(() => {
      result.current.setModelId('m');
    });
    act(() => {
      result.current.setModelId(null);
    });
    expect(result.current.model.id).toBeNull();
  });
});
