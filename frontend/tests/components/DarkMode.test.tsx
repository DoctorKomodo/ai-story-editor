// [F21] Dark mode toggle + `useDarkMode` hook tests.
//
// Scope: the button's aria-checked state, the `dark` class on
// `document.documentElement`, localStorage read/write, and hydration from a
// pre-existing localStorage value. Also a direct `renderHook` cover for the
// hook's imperative API (`toggle` + `setEnabled`).
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

function resetDom(): void {
  try {
    localStorage.clear();
  } catch {
    // jsdom never throws here, but mirror the hook's defensive posture.
  }
  document.documentElement.classList.remove('dark');
}

describe('DarkModeToggle', () => {
  beforeEach(() => {
    resetDom();
  });

  afterEach(() => {
    resetDom();
  });

  it('starts unchecked with no class when localStorage is empty', () => {
    render(<DarkModeToggle />);
    const toggle = screen.getByRole('switch', { name: /dark mode/i });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveTextContent(/dark:\s*off/i);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('clicking flips aria-checked to true and adds the `dark` class', async () => {
    const user = userEvent.setup();
    render(<DarkModeToggle />);
    const toggle = screen.getByRole('switch', { name: /dark mode/i });

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(toggle).toHaveTextContent(/dark:\s*on/i);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('a second click removes the class and flips back to unchecked', async () => {
    const user = userEvent.setup();
    render(<DarkModeToggle />);
    const toggle = screen.getByRole('switch', { name: /dark mode/i });

    await user.click(toggle);
    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('hydrates from localStorage `inkwell:darkMode` === "true"', () => {
    localStorage.setItem(STORAGE_KEY, 'true');

    render(<DarkModeToggle />);
    const toggle = screen.getByRole('switch', { name: /dark mode/i });

    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
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

  it('toggle() and setEnabled(true) both update state and the `dark` class', () => {
    const { result } = renderHook(() => useDarkMode());

    expect(result.current.enabled).toBe(false);
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    act(() => {
      result.current.toggle();
    });
    expect(result.current.enabled).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true');

    act(() => {
      result.current.setEnabled(false);
    });
    expect(result.current.enabled).toBe(false);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('false');

    act(() => {
      result.current.setEnabled(true);
    });
    expect(result.current.enabled).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
