import { useEffect, useRef } from 'react';

/**
 * Single-listener keyboard shortcut registry.
 *
 * Components register interest in a shortcut via {@link useKeyboardShortcut};
 * a single document-level `keydown` listener (installed lazily on first
 * registration) dispatches the event to matching handlers in priority order.
 * A handler returns `true` to mark the event handled and stop propagation
 * to lower-priority handlers; returning `false` / `undefined` lets the next
 * handler fire.
 *
 * The priority knob is what makes "Escape closes the open modal first, only
 * then the selection bubble / inline AI card" work without per-component
 * coordination — modals register at a high priority and return `true`.
 */

export type ShortcutKey = 'mod+enter' | 'alt+enter' | 'escape';

export interface UseKeyboardShortcutOptions {
  /** When false the registration is skipped entirely. Default: true. */
  enabled?: boolean;
  /** Higher fires earlier. Default: 0. */
  priority?: number;
}

interface Registration {
  id: number;
  key: ShortcutKey;
  handler: (e: KeyboardEvent) => boolean | undefined;
  priority: number;
}

const registrations: Registration[] = [];
let nextId = 1;
let listenerAttached = false;

function matchKey(e: KeyboardEvent): ShortcutKey | null {
  if (e.key === 'Escape') return 'escape';
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) return 'mod+enter';
  if (e.key === 'Enter' && e.altKey) return 'alt+enter';
  return null;
}

function dispatch(e: KeyboardEvent): void {
  const key = matchKey(e);
  if (!key) return;
  // Snapshot the matching registrations so unmount-during-dispatch is safe.
  const sorted = registrations.filter((r) => r.key === key).sort((a, b) => b.priority - a.priority);
  for (const r of sorted) {
    const handled = r.handler(e);
    if (handled === true) return;
  }
}

function ensureListener(): void {
  if (listenerAttached) return;
  if (typeof document === 'undefined') return;
  document.addEventListener('keydown', dispatch);
  listenerAttached = true;
}

/**
 * Test-only: clear the registry and detach the document listener so each
 * test starts with a clean slate. Module-level state otherwise persists
 * across `renderHook` invocations within the same test file.
 */
export function __resetShortcutsForTests(): void {
  registrations.length = 0;
  nextId = 1;
  if (listenerAttached && typeof document !== 'undefined') {
    document.removeEventListener('keydown', dispatch);
  }
  listenerAttached = false;
}

/**
 * Register a keyboard shortcut handler. The handler reference is captured
 * via a ref, so re-renders that produce a new function identity do NOT
 * cause re-registration — only `enabled`, `key`, and `priority` changes do.
 */
export function useKeyboardShortcut(
  key: ShortcutKey,
  handler: (e: KeyboardEvent) => boolean | undefined,
  options?: UseKeyboardShortcutOptions,
): void {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  const enabled = options?.enabled ?? true;
  const priority = options?.priority ?? 0;

  useEffect(() => {
    if (!enabled) return;
    ensureListener();
    const id = nextId++;
    const reg: Registration = {
      id,
      key,
      handler: (e) => handlerRef.current(e),
      priority,
    };
    registrations.push(reg);
    return () => {
      const idx = registrations.findIndex((r) => r.id === id);
      if (idx >= 0) registrations.splice(idx, 1);
    };
  }, [enabled, key, priority]);
}

export function useEscape(
  handler: (e: KeyboardEvent) => boolean | undefined,
  options?: UseKeyboardShortcutOptions,
): void {
  useKeyboardShortcut('escape', handler, options);
}

export function useModEnter(
  handler: (e: KeyboardEvent) => boolean | undefined,
  options?: UseKeyboardShortcutOptions,
): void {
  useKeyboardShortcut('mod+enter', handler, options);
}

export function useAltEnter(
  handler: (e: KeyboardEvent) => boolean | undefined,
  options?: UseKeyboardShortcutOptions,
): void {
  useKeyboardShortcut('alt+enter', handler, options);
}
