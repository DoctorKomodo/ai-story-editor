import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useTweaksStore } from '@/store/tweaks';

const DEFAULTS = {
  theme: 'paper' as const,
  layout: 'three-col' as const,
  proseFont: 'iowan' as const,
};

afterEach(() => {
  act(() => {
    useTweaksStore.getState().setTweaks(DEFAULTS);
  });
});

describe('useTweaksStore', () => {
  it('exposes the documented defaults', () => {
    const { result } = renderHook(() => useTweaksStore());
    expect(result.current.tweaks).toEqual(DEFAULTS);
  });

  it('setTweaks patches a single key without clobbering others', () => {
    const { result } = renderHook(() => useTweaksStore());
    act(() => {
      result.current.setTweaks({ theme: 'dark' });
    });
    expect(result.current.tweaks).toEqual({ ...DEFAULTS, theme: 'dark' });
  });

  it('setTweaks patches multiple keys at once', () => {
    const { result } = renderHook(() => useTweaksStore());
    act(() => {
      result.current.setTweaks({ layout: 'focus', proseFont: 'garamond' });
    });
    expect(result.current.tweaks).toEqual({
      ...DEFAULTS,
      layout: 'focus',
      proseFont: 'garamond',
    });
  });

  it('successive patches accumulate', () => {
    const { result } = renderHook(() => useTweaksStore());
    act(() => {
      result.current.setTweaks({ theme: 'sepia' });
    });
    act(() => {
      result.current.setTweaks({ proseFont: 'plex-serif' });
    });
    expect(result.current.tweaks).toEqual({
      ...DEFAULTS,
      theme: 'sepia',
      proseFont: 'plex-serif',
    });
  });
});
