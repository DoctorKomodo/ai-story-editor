import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { useSoftDelete } from '@/hooks/useSoftDelete';

describe('useSoftDelete', () => {
  let removeFn: Mock<(id: string) => Promise<unknown>>;

  beforeEach(() => {
    removeFn = vi.fn<(id: string) => Promise<unknown>>().mockResolvedValue(undefined);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('scheduleDelete adds the entry to pending', () => {
    const { result } = renderHook(() => useSoftDelete(removeFn));
    act(() => {
      result.current.scheduleDelete('id1', 'Session A');
    });
    expect(result.current.pending.has('id1')).toBe(true);
    expect(result.current.pending.get('id1')?.title).toBe('Session A');
    expect(result.current.isPending('id1')).toBe(true);
  });

  it('fires remove() after the timeout and clears the pending entry', () => {
    const { result } = renderHook(() => useSoftDelete(removeFn, { timeoutMs: 1000 }));
    act(() => {
      result.current.scheduleDelete('id1', 'Session A');
    });
    expect(result.current.isPending('id1')).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(removeFn).toHaveBeenCalledWith('id1');
    expect(result.current.isPending('id1')).toBe(false);
  });

  it('undo() cancels the timer and remove() is NOT called', () => {
    const { result } = renderHook(() => useSoftDelete(removeFn, { timeoutMs: 1000 }));
    act(() => {
      result.current.scheduleDelete('id1', 'Session A');
    });
    act(() => {
      result.current.undo('id1');
    });
    expect(result.current.isPending('id1')).toBe(false);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(removeFn).not.toHaveBeenCalled();
  });

  it('cancels all pending timers on unmount without firing remove()', () => {
    const { result, unmount } = renderHook(() => useSoftDelete(removeFn, { timeoutMs: 1000 }));
    act(() => {
      result.current.scheduleDelete('id1', 'Session A');
      result.current.scheduleDelete('id2', 'Session B');
    });
    unmount();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(removeFn).not.toHaveBeenCalled();
  });
});
