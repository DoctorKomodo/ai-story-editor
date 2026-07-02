import { useEffect, useRef } from 'react';
import { apiKeepalivePatch } from '@/lib/api';

export interface UnloadFlushArgs {
  storyId: string;
  chapterId: string;
  bodyJson: unknown;
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
 * is idempotent; after Task 3 it carries `expectedUpdatedAt`, so a keepalive
 * flush that landed makes the follow-up 409 — a rare, acceptable
 * self-conflict the Task 3 banner handles like any other conflict.
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

      const serialized = JSON.stringify({ bodyJson: pending.bodyJson });
      if (lastFlushedBodyRef.current === serialized) return;

      const path = `/stories/${encodeURIComponent(pending.storyId)}/chapters/${encodeURIComponent(pending.chapterId)}`;
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
