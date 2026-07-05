import { useEffect, useRef } from 'react';
import { apiKeepalivePatch } from '@/lib/api';

export interface UnloadFlushArgs {
  draftId: string;
  bodyJson: unknown;
  /** The viewed draft's last-seen updatedAt — the flush is preconditioned so a
   * stale buffer can only no-op (409 unobserved), never clobber. */
  expectedUpdatedAt: string | null;
}

/**
 * Attaches `pagehide` + `visibilitychange('hidden')` listeners and fires a
 * best-effort keepalive PATCH of the pending autosave payload.
 *
 * `pagehide` (not `beforeunload`) is used because `beforeunload` is
 * unreliable on mobile and defeats the back/forward cache; `visibilitychange`
 * covers the tab-hidden-but-not-closed case (switching apps on mobile).
 *
 * Dedupes: the same serialized body is flushed at most once per
 * hidden-transition — `visibilitychange` then `pagehide` both fire on tab
 * close, and without the dedupe that's two PATCHes for one edit.
 *
 * The keepalive response is never observed — if the page survives (tab
 * re-shown), the normal debounce/retry re-PATCHes the same body. That PATCH
 * is idempotent; it carries `expectedUpdatedAt` against the DRAFT's
 * updatedAt, so a keepalive flush that landed makes the follow-up 409 — a
 * rare, acceptable self-conflict the conflict banner handles like any other.
 */
export function useUnloadFlush(getPending: () => UnloadFlushArgs | null): void {
  const getPendingRef = useRef(getPending);
  useEffect(() => {
    getPendingRef.current = getPending;
  }, [getPending]);

  useEffect(() => {
    const lastFlushedBodyRef = { current: null as string | null };

    const flush = (): void => {
      const pending = getPendingRef.current();
      if (pending === null) return;

      const serialized = JSON.stringify({
        bodyJson: pending.bodyJson,
        ...(pending.expectedUpdatedAt !== null
          ? { expectedUpdatedAt: pending.expectedUpdatedAt }
          : {}),
      });
      if (lastFlushedBodyRef.current === serialized) return;

      const path = `/drafts/${encodeURIComponent(pending.draftId)}`;
      const sent = apiKeepalivePatch(path, serialized);
      if (sent) lastFlushedBodyRef.current = serialized;
    };

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') flush();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', flush);
    };
  }, []);
}
