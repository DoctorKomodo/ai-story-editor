import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useErrorStore } from '@/store/errors';

afterEach(() => {
  act(() => {
    useErrorStore.getState().clear();
  });
});

describe('useErrorStore', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => useErrorStore());
    expect(result.current.errors).toEqual([]);
  });

  it('push adds an error with a generated id and timestamp; newest first', () => {
    const { result } = renderHook(() => useErrorStore());
    let id1 = '';
    let id2 = '';
    act(() => {
      id1 = result.current.push({
        severity: 'error',
        source: 'ai.complete',
        code: 'venice_key_invalid',
        message: 'first',
      });
      id2 = result.current.push({
        severity: 'warn',
        source: 'chat.send',
        code: 'no_model',
        message: 'second',
      });
    });
    expect(result.current.errors).toHaveLength(2);
    expect(result.current.errors[0].id).toBe(id2);
    expect(result.current.errors[0].message).toBe('second');
    expect(result.current.errors[1].id).toBe(id1);
    expect(typeof result.current.errors[0].at).toBe('number');
    expect(id1).not.toBe(id2);
  });

  it('dismiss removes the entry by id', () => {
    const { result } = renderHook(() => useErrorStore());
    let id = '';
    act(() => {
      id = result.current.push({
        severity: 'error',
        source: 'ai.complete',
        code: null,
        message: 'gone',
      });
    });
    act(() => {
      result.current.dismiss(id);
    });
    expect(result.current.errors).toEqual([]);
  });

  it('clear empties the store', () => {
    const { result } = renderHook(() => useErrorStore());
    act(() => {
      result.current.push({ severity: 'error', source: 'a', code: null, message: 'x' });
      result.current.push({ severity: 'error', source: 'b', code: null, message: 'y' });
    });
    act(() => {
      result.current.clear();
    });
    expect(result.current.errors).toEqual([]);
  });

  it('caps at 50 entries; oldest dropped on overflow', () => {
    const { result } = renderHook(() => useErrorStore());
    act(() => {
      for (let i = 0; i < 55; i++) {
        result.current.push({
          severity: 'error',
          source: 'test',
          code: null,
          message: String(i),
        });
      }
    });
    expect(result.current.errors).toHaveLength(50);
    // Newest first: most recent push (54) at index 0.
    expect(result.current.errors[0].message).toBe('54');
    // Oldest survivor is push #5 (0..4 dropped).
    expect(result.current.errors[49].message).toBe('5');
  });
});
