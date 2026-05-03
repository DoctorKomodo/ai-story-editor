/**
 * Single-source debug-mode resolver.
 *
 * `isDebugMode()` returns true when either:
 *  - `import.meta.env.DEV` is true (Vite dev server / `vite build --mode development`)
 *  - `localStorage['inkwell:debug'] === '1'` (manual opt-in for inspecting a prod build)
 *
 * Read on every call — no module-level caching — so toggling via the
 * `setDebugMode` helper or directly from DevTools is reflected immediately.
 *
 * `window.__inkwell.debug` exposes `setDebugMode` for one-line console toggling.
 */

const STORAGE_KEY = 'inkwell:debug';

export function isDebugMode(): boolean {
  if (import.meta.env.DEV === true) return true;
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setDebugMode(on: boolean): void {
  try {
    if (on) {
      localStorage.setItem(STORAGE_KEY, '1');
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Swallow — Safari private mode etc.
  }
}

// Expose a tiny console-driven toggle. Idempotent: re-import is safe.
declare global {
  interface Window {
    __inkwell?: { debug?: { set: (on: boolean) => void; get: () => boolean } };
  }
}

if (typeof window !== 'undefined') {
  window.__inkwell ??= {};
  window.__inkwell.debug = {
    set: setDebugMode,
    get: isDebugMode,
  };
}
