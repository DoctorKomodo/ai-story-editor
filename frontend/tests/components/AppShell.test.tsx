// [F25] AppShell tests — slot rendering, `data-layout` mapping to the tweaks
// store, and the focus-mode toggle hook. Visibility (`display: none`) is not
// asserted because jsdom doesn't honour stylesheet computation; that's E2E
// territory. The unit-level contract is the `data-layout` attribute + the
// hook's pure state transitions.
import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AppShell } from '@/components/AppShell';
import { useFocusToggle } from '@/hooks/useFocusToggle';
import { useTweaksStore } from '@/store/tweaks';

function resetTweaks(): void {
  useTweaksStore.setState({
    tweaks: { theme: 'paper', layout: 'three-col', proseFont: 'iowan' },
  });
}

function renderShell(): void {
  render(
    <AppShell
      topbar={<div data-testid="slot-topbar">TOPBAR</div>}
      sidebar={<div data-testid="slot-sidebar">SIDEBAR</div>}
      editor={<div data-testid="slot-editor">EDITOR</div>}
      chat={<div data-testid="slot-chat">CHAT</div>}
    />,
  );
}

describe('AppShell', () => {
  afterEach(() => {
    resetTweaks();
  });

  it('renders all four slot children', () => {
    renderShell();
    expect(screen.getByTestId('slot-topbar')).toHaveTextContent('TOPBAR');
    expect(screen.getByTestId('slot-sidebar')).toHaveTextContent('SIDEBAR');
    expect(screen.getByTestId('slot-editor')).toHaveTextContent('EDITOR');
    expect(screen.getByTestId('slot-chat')).toHaveTextContent('CHAT');
  });

  it('applies data-layout="three-col" by default', () => {
    renderShell();
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-layout', 'three-col');
  });

  it('reflects layout="nochat" from the tweaks store', () => {
    renderShell();
    act(() => {
      useTweaksStore.getState().setTweaks({ layout: 'nochat' });
    });
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-layout', 'nochat');
  });

  it('reflects layout="focus" from the tweaks store', () => {
    renderShell();
    act(() => {
      useTweaksStore.getState().setTweaks({ layout: 'focus' });
    });
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-layout', 'focus');
  });

  it('uses semantic landmarks (header, main, two asides)', () => {
    renderShell();
    expect(screen.getByRole('banner')).toBeInTheDocument(); // <header>
    expect(screen.getByRole('main')).toBeInTheDocument(); // <main>
    // Two <aside> elements (sidebar + chat) — query DOM directly.
    expect(document.querySelectorAll('aside')).toHaveLength(2);
  });
});

describe('useFocusToggle', () => {
  afterEach(() => {
    resetTweaks();
  });

  it('flips layout from three-col to focus and back', () => {
    const { result } = renderHook(() => useFocusToggle());

    expect(result.current.isFocus).toBe(false);

    act(() => {
      result.current.toggleFocus();
    });
    expect(useTweaksStore.getState().tweaks.layout).toBe('focus');
    expect(result.current.isFocus).toBe(true);

    act(() => {
      result.current.toggleFocus();
    });
    expect(useTweaksStore.getState().tweaks.layout).toBe('three-col');
    expect(result.current.isFocus).toBe(false);
  });

  it('switches from nochat to focus on toggle (not back to three-col)', () => {
    act(() => {
      useTweaksStore.getState().setTweaks({ layout: 'nochat' });
    });
    const { result } = renderHook(() => useFocusToggle());

    act(() => {
      result.current.toggleFocus();
    });
    expect(useTweaksStore.getState().tweaks.layout).toBe('focus');

    act(() => {
      result.current.toggleFocus();
    });
    // From focus, toggle restores to the canonical three-col, per spec.
    expect(useTweaksStore.getState().tweaks.layout).toBe('three-col');
  });

  it('Cmd/Ctrl+Shift+F keyboard shortcut toggles focus mode', () => {
    renderShell();
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-layout', 'three-col');

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'F', ctrlKey: true, shiftKey: true, bubbles: true }),
      );
    });
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-layout', 'focus');

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'F', metaKey: true, shiftKey: true, bubbles: true }),
      );
    });
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-layout', 'three-col');
  });

  it('does not toggle on plain F or on Ctrl+F (without Shift)', () => {
    renderShell();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', bubbles: true }));
    });
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-layout', 'three-col');

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'F', ctrlKey: true, bubbles: true }),
      );
    });
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-layout', 'three-col');
  });
});
