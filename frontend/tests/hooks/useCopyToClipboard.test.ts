import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';

describe('useCopyToClipboard', () => {
  const originalClipboard = navigator.clipboard;
  const originalExecCommand = document.execCommand;
  const originalIsSecureContext = window.isSecureContext;

  function setSecureContext(value: boolean): void {
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value,
    });
  }

  beforeEach(() => {
    // shouldAdvanceTime: true lets waitFor()'s internal real-setTimeout polling
    // fire even under fake timers — without it waitFor hangs until the 5 s
    // vitest default test timeout.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // jsdom defaults window.isSecureContext to false; tests that exercise
    // the modern path must opt in explicitly.
    setSecureContext(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
    document.execCommand = originalExecCommand;
    setSecureContext(originalIsSecureContext);
  });

  it('starts in idle status', () => {
    const { result } = renderHook(() => useCopyToClipboard());
    expect(result.current.status).toBe('idle');
  });

  it('clipboard API success → status becomes "copied" then auto-resets to "idle"', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const { result } = renderHook(() => useCopyToClipboard({ resetMs: 1500 }));
    await act(async () => {
      await result.current.copy('hello');
    });

    expect(writeText).toHaveBeenCalledWith('hello');
    expect(result.current.status).toBe('copied');

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });
  });

  it('clipboard API undefined → falls back to execCommand, status becomes "copied"', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    const exec = vi.fn().mockReturnValue(true);
    document.execCommand = exec as unknown as typeof document.execCommand;

    const { result } = renderHook(() => useCopyToClipboard());
    await act(async () => {
      await result.current.copy('lan-text');
    });

    expect(exec).toHaveBeenCalledWith('copy');
    expect(result.current.status).toBe('copied');
  });

  it('non-secure context → skips clipboard API entirely and falls back', async () => {
    setSecureContext(false);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const exec = vi.fn().mockReturnValue(true);
    document.execCommand = exec as unknown as typeof document.execCommand;

    const { result } = renderHook(() => useCopyToClipboard());
    await act(async () => {
      await result.current.copy('lan-ip-text');
    });

    expect(writeText).not.toHaveBeenCalled();
    expect(exec).toHaveBeenCalledWith('copy');
    expect(result.current.status).toBe('copied');
  });

  it('clipboard API rejects → falls back to execCommand', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('not focused'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const exec = vi.fn().mockReturnValue(true);
    document.execCommand = exec as unknown as typeof document.execCommand;

    const { result } = renderHook(() => useCopyToClipboard());
    await act(async () => {
      await result.current.copy('text');
    });

    expect(writeText).toHaveBeenCalled();
    expect(exec).toHaveBeenCalledWith('copy');
    expect(result.current.status).toBe('copied');
  });

  it('both paths fail → status becomes "failed"', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('blocked'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const exec = vi.fn().mockReturnValue(false);
    document.execCommand = exec as unknown as typeof document.execCommand;

    const { result } = renderHook(() => useCopyToClipboard());
    await act(async () => {
      await result.current.copy('text');
    });

    expect(result.current.status).toBe('failed');
  });

  it('a second copy() resets the timer (no premature flip back to idle)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const { result } = renderHook(() => useCopyToClipboard({ resetMs: 1500 }));
    await act(async () => {
      await result.current.copy('a');
    });
    expect(result.current.status).toBe('copied');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    await act(async () => {
      await result.current.copy('b');
    });
    // 1000ms more — total 2000ms since first copy, but only 1000ms since second
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.status).toBe('copied');
  });
});
