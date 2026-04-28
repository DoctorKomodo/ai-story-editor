import { useEffect, useRef, useState } from 'react';

/**
 * [F9] Autosave primitive.
 *
 * Debounces `payload` changes and calls `save(payload)` after `debounceMs` of
 * quiet. On failure, performs ONE retry after `debounceMs * 2`. Rapid edits
 * during the retry window cancel the retry and resume normal debounced saving.
 *
 * The initial non-null `payload` is treated as a baseline — it does not
 * trigger a save. This matches the UX of a freshly-loaded chapter.
 *
 * Note: F9 says 2s debounce; F48 supersedes to 4s — default here is 4000ms.
 */

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface UseAutosaveOptions<T> {
  /** `null` means "nothing to save yet" (e.g. not loaded). */
  payload: T | null;
  save: (payload: T) => Promise<void>;
  /** Default 4000ms (per F48 supersession of F9). */
  debounceMs?: number;
  /** Default `Object.is`. */
  equals?: (a: T, b: T) => boolean;
}

export interface UseAutosaveResult {
  status: AutosaveStatus;
  /** Wall-clock ms (Date.now()) of the last successful save, or null. */
  savedAt: number | null;
  /** Wall-clock ms (Date.now()) at which the next retry will fire, or null. */
  retryAt: number | null;
}

export function useAutosave<T>(opts: UseAutosaveOptions<T>): UseAutosaveResult {
  const { payload, save, debounceMs = 4000, equals = Object.is } = opts;

  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [retryAt, setRetryAt] = useState<number | null>(null);

  // Refs for stable access inside timers.
  const saveRef = useRef(save);
  const equalsRef = useRef(equals);
  const debounceMsRef = useRef(debounceMs);

  // Track the most recent payload we've observed and the last one saved
  // (so we can diff), and whether we've seen the baseline yet.
  const latestPayloadRef = useRef<T | null>(payload);
  const lastSavedPayloadRef = useRef<T | null>(null);
  const baselineSetRef = useRef(false);

  // Timer + in-flight state.
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const pendingFollowupRef = useRef(false);
  const mountedRef = useRef(true);

  // Keep callback refs fresh without retriggering the effect.
  useEffect(() => {
    saveRef.current = save;
  }, [save]);
  useEffect(() => {
    equalsRef.current = equals;
  }, [equals]);
  useEffect(() => {
    debounceMsRef.current = debounceMs;
  }, [debounceMs]);

  // React to payload changes.
  useEffect(() => {
    latestPayloadRef.current = payload;

    const clearDebounce = (): void => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
    const clearRetry = (): void => {
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
        if (mountedRef.current) setRetryAt(null);
      }
    };
    const safeSetStatus = (next: AutosaveStatus): void => {
      if (mountedRef.current) setStatus(next);
    };

    const runSave = async (): Promise<void> => {
      const payloadToSave = latestPayloadRef.current;
      if (payloadToSave === null) return;

      savingRef.current = true;
      safeSetStatus('saving');

      try {
        await saveRef.current(payloadToSave);
        lastSavedPayloadRef.current = payloadToSave;
        if (!mountedRef.current) return;

        savingRef.current = false;
        if (mountedRef.current) {
          setSavedAt(Date.now());
          setRetryAt(null);
        }
        safeSetStatus('saved');

        // If the payload changed while the save was in flight, schedule a
        // debounced follow-up with the newest value.
        if (
          pendingFollowupRef.current &&
          latestPayloadRef.current !== null &&
          !equalsRef.current(latestPayloadRef.current, payloadToSave)
        ) {
          pendingFollowupRef.current = false;
          scheduleDebouncedSave();
        } else {
          pendingFollowupRef.current = false;
        }
      } catch {
        if (!mountedRef.current) return;
        savingRef.current = false;
        safeSetStatus('error');

        // If the payload changed while the failing save was in flight,
        // treat it as a normal debounced edit (implicit retry).
        if (
          pendingFollowupRef.current &&
          latestPayloadRef.current !== null &&
          !equalsRef.current(latestPayloadRef.current, payloadToSave)
        ) {
          pendingFollowupRef.current = false;
          scheduleDebouncedSave();
          return;
        }
        pendingFollowupRef.current = false;

        // One-shot retry after 2 * debounceMs.
        clearRetry();
        const retryDelay = debounceMsRef.current * 2;
        if (mountedRef.current) {
          setRetryAt(Date.now() + retryDelay);
        }
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          if (!mountedRef.current) return;
          setRetryAt(null);
          void runSave();
        }, retryDelay);
      }
    };

    const scheduleDebouncedSave = (): void => {
      clearDebounce();
      clearRetry();
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        if (!mountedRef.current) return;
        void runSave();
      }, debounceMsRef.current);
    };

    if (payload === null) return;

    // First non-null payload = baseline. Don't save.
    if (!baselineSetRef.current) {
      baselineSetRef.current = true;
      lastSavedPayloadRef.current = payload;
      return;
    }

    // No change vs last-saved — ignore.
    if (
      lastSavedPayloadRef.current !== null &&
      equalsRef.current(payload, lastSavedPayloadRef.current)
    ) {
      return;
    }

    // Edit during an in-flight save: queue a follow-up (handled in runSave).
    if (savingRef.current) {
      pendingFollowupRef.current = true;
      return;
    }

    // Edit during a retry wait: cancel the retry, debounce normally.
    if (retryTimerRef.current !== null) {
      clearRetry();
    }

    scheduleDebouncedSave();
  }, [payload]);

  // Unmount cleanup. The setup intentionally re-asserts mountedRef.current
  // = true: under React.StrictMode dev, useEffect runs setup → cleanup →
  // setup, and without this re-assertion the cleanup's `mountedRef.current
  // = false` would persist into the live mount and silently suppress every
  // scheduled save (`if (!mountedRef.current) return;` in runSave).
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debounceTimerRef.current !== null) clearTimeout(debounceTimerRef.current);
      if (retryTimerRef.current !== null) clearTimeout(retryTimerRef.current);
    };
  }, []);

  return { status, savedAt, retryAt };
}
