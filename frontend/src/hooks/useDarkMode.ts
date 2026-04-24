/**
 * [F21] Dark-mode state backed by localStorage.
 *
 * Mirrors the shape of `useSelectedModel` (F13): lazy-init from storage,
 * try/catch around every storage call so private-mode Safari / disabled
 * storage still produces a working in-memory value.
 *
 * Side effect: when `enabled` changes, toggles the `dark` class on
 * `document.documentElement` so Tailwind's `dark:` variants (darkMode:
 * 'class' in tailwind.config.js) activate application-wide.
 *
 * F46 later replaces this with a three-way Paper/Sepia/Dark theme picker
 * persisted via the server settings flow (B11). The localStorage key stays
 * readable for one release so migrations don't flash the wrong theme.
 */
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'inkwell:darkMode';

function readFromStorage(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeToStorage(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Swallow — Safari private mode etc. State still updates in memory so
    // the toggle works for the current session.
  }
}

function applyDarkClass(enabled: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', enabled);
}

export interface UseDarkModeResult {
  enabled: boolean;
  toggle: () => void;
  setEnabled: (next: boolean) => void;
}

export function useDarkMode(): UseDarkModeResult {
  const [enabled, setEnabledState] = useState<boolean>(() => readFromStorage());

  // Mirror the desired class onto <html> whenever state changes (including
  // the initial render, so hydration from localStorage "true" actually lights
  // up the UI without a click).
  useEffect(() => {
    applyDarkClass(enabled);
  }, [enabled]);

  const setEnabled = useCallback((next: boolean): void => {
    setEnabledState(next);
    writeToStorage(next);
  }, []);

  const toggle = useCallback((): void => {
    setEnabledState((prev) => {
      const next = !prev;
      writeToStorage(next);
      return next;
    });
  }, []);

  return { enabled, toggle, setEnabled };
}
