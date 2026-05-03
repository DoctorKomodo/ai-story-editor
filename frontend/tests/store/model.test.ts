import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useModelStore } from '@/store/model';

const STORAGE_KEY = 'inkwell:selectedModelId';

beforeEach(() => {
  localStorage.removeItem(STORAGE_KEY);
});

afterEach(() => {
  act(() => {
    useModelStore.getState().setModelId(null);
  });
  localStorage.removeItem(STORAGE_KEY);
});

describe('useModelStore', () => {
  it('defaults modelId to null when localStorage is empty', () => {
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

  it('persists setModelId to localStorage', () => {
    const { result } = renderHook(() => useModelStore());
    act(() => {
      result.current.setModelId('venice-uncensored-1.5');
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe('venice-uncensored-1.5');
  });

  it('setModelId(null) removes the localStorage entry', () => {
    const { result } = renderHook(() => useModelStore());
    act(() => {
      result.current.setModelId('venice-uncensored-1.5');
    });
    act(() => {
      result.current.setModelId(null);
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
