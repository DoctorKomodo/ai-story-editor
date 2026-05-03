import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useUiStore } from '@/store/ui';

afterEach(() => {
  act(() => {
    useUiStore.getState().setLayout('three-col');
  });
});

describe('useUiStore', () => {
  it('defaults layout to three-col', () => {
    const { result } = renderHook(() => useUiStore());
    expect(result.current.layout).toBe('three-col');
  });

  it('setLayout updates layout', () => {
    const { result } = renderHook(() => useUiStore());
    act(() => {
      result.current.setLayout('focus');
    });
    expect(result.current.layout).toBe('focus');
  });

  it('layout accepts the three documented values', () => {
    const { result } = renderHook(() => useUiStore());
    act(() => {
      result.current.setLayout('nochat');
    });
    expect(result.current.layout).toBe('nochat');
    act(() => {
      result.current.setLayout('three-col');
    });
    expect(result.current.layout).toBe('three-col');
  });
});
