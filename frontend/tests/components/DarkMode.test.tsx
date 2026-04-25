// [F21] Dark mode toggle + `useDarkMode` hook tests.
//
// Scope: the button's aria-checked state, the `data-theme="dark"` attribute on
// `document.documentElement`, localStorage read/write, and hydration from a
// pre-existing localStorage value. Also a direct `renderHook` cover for the
// hook's imperative API (`toggle` + `setEnabled`).
//
// [F23] updated the DOM-write target from the old `html.dark` class to the
// `data-theme` attribute so the new token system swaps palettes. The
// localStorage key (`inkwell:darkMode`) and serialised values are unchanged.
//
// F46 later replaces this with a three-way Paper/Sepia/Dark theme picker
// driven by server-persisted settings (B11). Until then this toggle owns the
// localStorage key `inkwell:darkMode`.
import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DarkModeToggle } from '@/components/DarkModeToggle';
import { useDarkMode } from '@/hooks/useDarkMode';

const STORAGE_KEY = 'inkwell:darkMode';

function isDark(): boolean {
  return document.documentElement.dataset.theme === 'dark';
}

function resetDom(): void {
  try {
    localStorage.clear();
  } catch {
    // jsdom never throws here, but mirror the hook's defensive posture.
  }
  delete document.documentElement.dataset.theme;
  document.documentElement.classList.remove('dark');
}

describe('DarkModeToggle', () => {
  beforeEach(() => {
    resetDom();
  });

  afterEach(() => {
    resetDom();
  });

  it('starts unchecked with no data-theme when localStorage is empty', () => {
    render(<DarkModeToggle />);
    const toggle = screen.getByRole('switch', { name: /dark mode/i });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveTextContent(/dark:\s*off/i);
    expect(isDark()).toBe(false);
  });

  it('clicking flips aria-checked to true and sets data-theme="dark"', async () => {
    const user = userEvent.setup();
    render(<DarkModeToggle />);
    const toggle = screen.getByRole('switch', { name: /dark mode/i });

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(toggle).toHaveTextContent(/dark:\s*on/i);
    expect(isDark()).toBe(true);
  });

  it('a second click clears data-theme and flips back to unchecked', async () => {
    const user = userEvent.setup();
    render(<DarkModeToggle />);
    const toggle = screen.getByRole('switch', { name: /dark mode/i });

    await user.click(toggle);
    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(isDark()).toBe(false);
  });

  it('hydrates from localStorage `inkwell:darkMode` === "true"', () => {
    localStorage.setItem(STORAGE_KEY, 'true');

    render(<DarkModeToggle />);
    const toggle = screen.getByRole('switch', { name: /dark mode/i });

    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(isDark()).toBe(true);
  });

  it('persists toggled state to localStorage', async () => {
    const user = userEvent.setup();
    render(<DarkModeToggle />);
    const toggle = screen.getByRole('switch', { name: /dark mode/i });

    await user.click(toggle);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true');

    await user.click(toggle);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('false');
  });
});

describe('useDarkMode hook', () => {
  beforeEach(() => {
    resetDom();
  });

  afterEach(() => {
    resetDom();
  });

  it('toggle() and setEnabled(true) both update state and the data-theme attr', () => {
    const { result } = renderHook(() => useDarkMode());

    expect(result.current.enabled).toBe(false);
    expect(isDark()).toBe(false);

    act(() => {
      result.current.toggle();
    });
    expect(result.current.enabled).toBe(true);
    expect(isDark()).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true');

    act(() => {
      result.current.setEnabled(false);
    });
    expect(result.current.enabled).toBe(false);
    expect(isDark()).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('false');

    act(() => {
      result.current.setEnabled(true);
    });
    expect(result.current.enabled).toBe(true);
    expect(isDark()).toBe(true);
  });
});
