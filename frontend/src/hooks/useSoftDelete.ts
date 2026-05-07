/**
 * useSoftDelete — generic soft-delete state manager with undo.
 *
 * On `scheduleDelete(id, title)`:
 *   1. Adds the entry to `pending` (callers hide the item immediately).
 *   2. Starts a timer; when it fires, calls `remove(id)` and clears the entry.
 *
 * On `undo(id)`:
 *   1. Cancels the timer.
 *   2. Removes the entry from `pending` (caller re-shows the item).
 *
 * On unmount all pending timers are cancelled so stale API deletes never fire.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_TIMEOUT_MS = 5_000;

export interface SoftDeleteEntry {
  title: string;
}

export interface UseSoftDeleteReturn {
  /** Map of id → entry for items awaiting deletion. */
  pending: Map<string, SoftDeleteEntry>;
  /** Returns true when the given id has a pending delete. */
  isPending: (id: string) => boolean;
  /** Hides the item and schedules the real API delete after timeoutMs. */
  scheduleDelete: (id: string, title: string) => void;
  /** Cancels the timer and restores the item. */
  undo: (id: string) => void;
}

export function useSoftDelete(
  remove: (id: string) => Promise<unknown> | void,
  options?: { timeoutMs?: number },
): UseSoftDeleteReturn {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const [pending, setPending] = useState<Map<string, SoftDeleteEntry & { timer: number }>>(
    new Map(),
  );
  // Track all pending timer IDs so we can cancel them on unmount.
  const pendingTimersRef = useRef<number[]>([]);

  useEffect(() => {
    return () => {
      pendingTimersRef.current.forEach((t) => {
        window.clearTimeout(t);
      });
    };
  }, []);

  const scheduleDelete = useCallback(
    (id: string, title: string) => {
      const timer = window.setTimeout(() => {
        pendingTimersRef.current = pendingTimersRef.current.filter((t) => t !== timer);
        void remove(id);
        setPending((prev) => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
      }, timeoutMs);
      pendingTimersRef.current.push(timer);
      setPending((prev) => {
        const next = new Map(prev);
        next.set(id, { title, timer });
        return next;
      });
    },
    [remove, timeoutMs],
  );

  const undo = useCallback((id: string) => {
    setPending((prev) => {
      const entry = prev.get(id);
      if (entry) {
        window.clearTimeout(entry.timer);
        pendingTimersRef.current = pendingTimersRef.current.filter((t) => t !== entry.timer);
      }
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const isPending = useCallback((id: string) => pending.has(id), [pending]);

  // Expose a pending map without the internal `timer` field.
  const publicPending = new Map<string, SoftDeleteEntry>();
  for (const [id, entry] of pending) {
    publicPending.set(id, { title: entry.title });
  }

  return { pending: publicPending, isPending, scheduleDelete, undo };
}
