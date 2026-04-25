import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetShortcutsForTests,
  useAltEnter,
  useEscape,
  useKeyboardShortcut,
  useModEnter,
} from '@/hooks/useKeyboardShortcuts';

function fireKey(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  document.dispatchEvent(event);
  return event;
}

describe('useKeyboardShortcuts', () => {
  beforeEach(() => {
    __resetShortcutsForTests();
  });

  afterEach(() => {
    __resetShortcutsForTests();
  });

  it('invokes a single registered handler when its key fires', () => {
    const handler = vi.fn();
    renderHook(() => useEscape(handler));

    fireKey({ key: 'Escape' });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('calls the highest-priority handler first; returning true stops propagation', () => {
    const calls: string[] = [];
    const high = vi.fn(() => {
      calls.push('high');
      return true;
    });
    const low = vi.fn(() => {
      calls.push('low');
    });

    renderHook(() => useEscape(low, { priority: 0 }));
    renderHook(() => useEscape(high, { priority: 10 }));

    fireKey({ key: 'Escape' });

    expect(calls).toEqual(['high']);
    expect(low).not.toHaveBeenCalled();
  });

  it('returning false / void lets the next-priority handler fire', () => {
    const calls: string[] = [];
    const high = vi.fn(() => {
      calls.push('high');
      // implicit void return
    });
    const low = vi.fn(() => {
      calls.push('low');
    });

    renderHook(() => useEscape(low, { priority: 0 }));
    renderHook(() => useEscape(high, { priority: 10 }));

    fireKey({ key: 'Escape' });

    expect(calls).toEqual(['high', 'low']);
  });

  it('explicit return false also lets the next handler fire', () => {
    const order: string[] = [];
    const a = vi.fn(() => {
      order.push('a');
      return false;
    });
    const b = vi.fn(() => {
      order.push('b');
      return true;
    });

    renderHook(() => useEscape(a, { priority: 5 }));
    renderHook(() => useEscape(b, { priority: 1 }));

    fireKey({ key: 'Escape' });

    expect(order).toEqual(['a', 'b']);
  });

  it('unmount removes the registration', () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useEscape(handler));

    fireKey({ key: 'Escape' });
    expect(handler).toHaveBeenCalledTimes(1);

    unmount();

    fireKey({ key: 'Escape' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('enabled: false does not register a handler', () => {
    const handler = vi.fn();
    renderHook(() => useEscape(handler, { enabled: false }));

    fireKey({ key: 'Escape' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('toggling enabled re-registers', () => {
    const handler = vi.fn();
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useEscape(handler, { enabled }),
      { initialProps: { enabled: false } },
    );

    fireKey({ key: 'Escape' });
    expect(handler).not.toHaveBeenCalled();

    rerender({ enabled: true });
    fireKey({ key: 'Escape' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('Cmd+Enter (metaKey) matches mod+enter', () => {
    const handler = vi.fn();
    renderHook(() => useModEnter(handler));

    fireKey({ key: 'Enter', metaKey: true });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+Enter (ctrlKey) matches mod+enter', () => {
    const handler = vi.fn();
    renderHook(() => useModEnter(handler));

    fireKey({ key: 'Enter', ctrlKey: true });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('Alt+Enter matches alt+enter', () => {
    const handler = vi.fn();
    renderHook(() => useAltEnter(handler));

    fireKey({ key: 'Enter', altKey: true });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('plain Enter does not trigger mod+enter, alt+enter, or escape', () => {
    const mod = vi.fn();
    const alt = vi.fn();
    const esc = vi.fn();
    renderHook(() => useModEnter(mod));
    renderHook(() => useAltEnter(alt));
    renderHook(() => useEscape(esc));

    fireKey({ key: 'Enter' });

    expect(mod).not.toHaveBeenCalled();
    expect(alt).not.toHaveBeenCalled();
    expect(esc).not.toHaveBeenCalled();
  });

  it('alt+enter does not also fire mod+enter handlers', () => {
    const mod = vi.fn();
    const alt = vi.fn();
    renderHook(() => useModEnter(mod));
    renderHook(() => useAltEnter(alt));

    fireKey({ key: 'Enter', altKey: true });

    expect(mod).not.toHaveBeenCalled();
    expect(alt).toHaveBeenCalledTimes(1);
  });

  it('Escape with a modifier still matches escape (modifier-agnostic)', () => {
    const handler = vi.fn();
    renderHook(() => useEscape(handler));

    fireKey({ key: 'Escape', metaKey: true });
    fireKey({ key: 'Escape', shiftKey: true });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('handler ref updates without re-registering on every render', () => {
    const first = vi.fn();
    const second = vi.fn();

    const { rerender } = renderHook(({ h }: { h: (e: KeyboardEvent) => void }) => useEscape(h), {
      initialProps: { h: first },
    });

    fireKey({ key: 'Escape' });
    expect(first).toHaveBeenCalledTimes(1);

    rerender({ h: second });
    fireKey({ key: 'Escape' });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('useKeyboardShortcut directly with mod+enter routes correctly', () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut('mod+enter', handler, { priority: 3 }));

    fireKey({ key: 'Enter', metaKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
