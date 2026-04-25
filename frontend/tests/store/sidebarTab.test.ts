import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useSidebarTabStore } from '@/store/sidebarTab';

afterEach(() => {
  act(() => {
    useSidebarTabStore.getState().setSidebarTab('chapters');
  });
});

describe('useSidebarTabStore', () => {
  it("defaults to 'chapters'", () => {
    const { result } = renderHook(() => useSidebarTabStore());
    expect(result.current.sidebarTab).toBe('chapters');
  });

  it('switches tabs', () => {
    const { result } = renderHook(() => useSidebarTabStore());
    act(() => {
      result.current.setSidebarTab('cast');
    });
    expect(result.current.sidebarTab).toBe('cast');
    act(() => {
      result.current.setSidebarTab('outline');
    });
    expect(result.current.sidebarTab).toBe('outline');
  });
});
