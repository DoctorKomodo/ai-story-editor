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
  /**
   * When supplied, a change in this key resets the baseline state — the next
   * non-null `payload` is treated as a fresh baseline (no save fires). Use it
   * to avoid spurious saves when the same hook is reused across logically
   * distinct documents (e.g. chapter switches in the editor). Any in-flight
   * timer or pending follow-up for the previous key is cancelled.
   */
  resetKey?: string | number | null;
}

export interface UseAutosaveResult {
  status: AutosaveStatus;
  /** Wall-clock ms (Date.now()) of the last successful save, or null. */
  savedAt: number | null;
  /** Wall-clock ms (Date.now()) at which the next retry will fire, or null. */
  retryAt: number | null;
}

export function useAutosave<T>(opts: UseAutosaveOptions<T>): UseAutosaveResult {
  const { payload, save, debounceMs = 4000, equals = Object.is, resetKey } = opts;

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
  // The save callback snapshotted at debounce-schedule time, so a pending
  // debounce can be flushed against the *original* callback even after the
  // parent has rerendered with a new one (e.g. chapter switch).
  const debounceSaveRef = useRef<((p: T) => Promise<void>) | null>(null);
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

  // Reset baseline state when `resetKey` changes (e.g. chapter switch in the
  // editor). Declared *before* the payload effect so that on a render where
  // both `resetKey` and `payload` change in the same tick (chapter switch
  // immediately seeds the new chapter's body), the flush observes the
  // previous chapter's snapshotted save + typed payload before the payload
  // effect overwrites them.
  //
  // Without this, `lastSavedPayloadRef` keeps the previous chapter's body;
  // the new chapter's freshly-loaded body then differs from it and schedules
  // a spurious PATCH. We also cancel any pending debounce / retry / follow-up
  // so an in-flight save for the previous key can't resurface as a save
  // under the new key.
  const lastResetKeyRef = useRef<typeof resetKey>(resetKey);
  useEffect(() => {
    if (Object.is(lastResetKeyRef.current, resetKey)) return;
    lastResetKeyRef.current = resetKey;

    // Flush a pending debounce against the snapshotted save fn before we
    // discard it. Without this, a typed-but-not-yet-saved edit would be
    // silently dropped when the user switches to another chapter inside the
    // debounce window. The snapshotted callback was captured when the
    // debounce was scheduled and is still closed over the *previous* key
    // (e.g. the chapter id the user typed in), so the PATCH lands under the
    // correct id even after the parent rerenders with a new save fn.
    const pendingSave = debounceSaveRef.current;
    const pendingPayload = latestPayloadRef.current;
    if (debounceTimerRef.current !== null && pendingSave !== null && pendingPayload !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
      debounceSaveRef.current = null;
      // Fire-and-forget: the user has moved on, blocking the chapter switch
      // on a network round-trip is the wrong UX. A failed flush is no worse
      // than a failed in-flight save — the typed text is gone either way and
      // the user can re-enter it.
      void pendingSave(pendingPayload).catch(() => {});
    } else if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
      debounceSaveRef.current = null;
    }

    baselineSetRef.current = false;
    lastSavedPayloadRef.current = null;
    pendingFollowupRef.current = false;
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (mountedRef.current) {
      setStatus('idle');
      setRetryAt(null);
    }
  }, [resetKey]);

  // React to payload changes.
  useEffect(() => {
    latestPayloadRef.current = payload;

    const clearDebounce = (): void => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      debounceSaveRef.current = null;
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

    // The save function is snapshotted at debounce-schedule time and passed
    // through `runSave` (and its retry). Otherwise — if `runSave` dereffed
    // `saveRef.current` itself — a save scheduled while the parent was looking
    // at chapter A could pick up the new `handleSave` (closed over chapter B's
    // id) when its timer fires after a chapter switch. The `resetKey` reset
    // already cancels timers on switch, but the snapshot makes the invariant
    // explicit: a scheduled save is locked to the callback that was current
    // when it was scheduled.
    const runSave = async (saveFn: (p: T) => Promise<void>): Promise<void> => {
      const payloadToSave = latestPayloadRef.current;
      if (payloadToSave === null) return;

      savingRef.current = true;
      safeSetStatus('saving');

      try {
        await saveFn(payloadToSave);
        lastSavedPayloadRef.current = payloadToSave;
        if (!mountedRef.current) return;

        savingRef.current = false;
        if (mountedRef.current) {
          setSavedAt(Date.now());
          setRetryAt(null);
        }
        safeSetStatus('saved');

        // If the payload changed while the save was in flight, schedule a
        // debounced follow-up with the newest value. Reuse the *snapshotted*
        // save fn so the follow-up cannot drift onto a different chapter
        // when the user switched chapters during the in-flight window:
        // `saveRef.current` was updated to the new chapter's `handleSave`
        // by the time the promise resolved, but the typed payload still
        // belongs to the previous chapter and must PATCH that id.
        if (
          pendingFollowupRef.current &&
          latestPayloadRef.current !== null &&
          !equalsRef.current(latestPayloadRef.current, payloadToSave)
        ) {
          pendingFollowupRef.current = false;
          scheduleDebouncedSave(saveFn);
        } else {
          pendingFollowupRef.current = false;
        }
      } catch {
        if (!mountedRef.current) return;
        savingRef.current = false;
        safeSetStatus('error');

        // If the payload changed while the failing save was in flight,
        // treat it as a normal debounced edit (implicit retry). Same
        // snapshot reuse as the success branch — the retry must stay on
        // the original chapter id.
        if (
          pendingFollowupRef.current &&
          latestPayloadRef.current !== null &&
          !equalsRef.current(latestPayloadRef.current, payloadToSave)
        ) {
          pendingFollowupRef.current = false;
          scheduleDebouncedSave(saveFn);
          return;
        }
        pendingFollowupRef.current = false;

        // One-shot retry after 2 * debounceMs. Reuse the same snapshotted
        // save function so the retry can't drift onto a different chapter.
        clearRetry();
        const retryDelay = debounceMsRef.current * 2;
        if (mountedRef.current) {
          setRetryAt(Date.now() + retryDelay);
        }
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          if (!mountedRef.current) return;
          setRetryAt(null);
          void runSave(saveFn);
        }, retryDelay);
      }
    };

    const scheduleDebouncedSave = (overrideSave?: (p: T) => Promise<void>): void => {
      clearDebounce();
      clearRetry();
      // Caller can pass an explicit save fn to keep a follow-up locked to the
      // chapter the original save was scheduled for; otherwise re-snapshot.
      const snapshotSave = overrideSave ?? saveRef.current;
      debounceSaveRef.current = snapshotSave;
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        debounceSaveRef.current = null;
        if (!mountedRef.current) return;
        void runSave(snapshotSave);
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
