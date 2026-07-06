import type { QueryClient } from '@tanstack/react-query';
import { abortAllStreams } from '@/lib/streamRegistry';
import { useActiveChapterStore } from '@/store/activeChapter';
import { useAttachedSelectionStore } from '@/store/attachedSelection';
import { useCharRefSuggestionStore } from '@/store/charRefSuggestion';
import { useChatDraftStore } from '@/store/chatDraft';
import { useComposerDraftStore } from '@/store/composerDraft';
import { useErrorStore } from '@/store/errors';
import { useInlineAIResultStore } from '@/store/inlineAIResult';
import { useSelectedCharacterStore } from '@/store/selectedCharacter';
import { useSelectedDraftStore } from '@/store/selectedDraft';
import { useSelectionStore } from '@/store/selection';
import { type SessionUser, useSessionStore } from '@/store/session';

/**
 * Per-user store registry. Every entry exposes a `reset()` action that
 * returns the store to its `initialState` shape (Task 0.5 convention).
 *
 * **Adding a store?** Add it here AND to the `PER_USER_STORES` allowlist
 * in the enumeration test (`frontend/tests/lib/sessionReset.test.ts`).
 * The test fails on unclassified stores. The helper has zero shape
 * knowledge — it just iterates this list.
 */
interface ResettableStore {
  getState: () => { reset: () => void };
}

export const PER_USER_STORES: readonly ResettableStore[] = [
  useAttachedSelectionStore,
  useInlineAIResultStore,
  useComposerDraftStore,
  useChatDraftStore,
  useSelectionStore,
  useActiveChapterStore,
  useSelectedDraftStore,
  useSelectedCharacterStore,
  useCharRefSuggestionStore,
  useErrorStore,
];

/**
 * Reset all per-user client state on auth transition.
 *
 * **Ordering invariant:** on the LOGIN path, `resetClientState` MUST run
 * before `setSession`. Between them, any subscriber reading `user.id`
 * triggers a refetch under the WRONG identity and repopulates the cache.
 * Use `swapSession` (below) for login so the order is unreachable from
 * call sites.
 *
 * **In-flight fetch race:** `cancelQueries` fires the AbortSignal on any
 * pending queryFn so it can bail early. `clear()` then removes all cache
 * entries so a late-resolving fetch from the previous session has no key
 * to write back into. `clear()` alone would eventually also abort via
 * `query.destroy()`, but explicitly cancelling first ensures the signal
 * is aborted before the entry is removed — giving the queryFn a chance
 * to observe it synchronously before the key disappears.
 *
 * **Storage gotcha:** if you add a Zustand store using the `persist`
 * middleware, `getState().reset()` does NOT clear the mirrored
 * localStorage entry — call `useFooStore.persist.clearStorage()` from
 * this helper too. None of the current stores use persist; the helper
 * has no `clearStorage()` calls today.
 */
export async function resetClientState(queryClient: QueryClient): Promise<void> {
  // Abort in-flight SSE streams BEFORE tearing down the stores they write into
  // (chatDraft / inlineAIResult are reset below). Aborting first stops any
  // further chunk from repopulating a freshly-reset store under the next
  // session.
  abortAllStreams();
  await queryClient.cancelQueries();
  queryClient.clear();
  for (const store of PER_USER_STORES) {
    store.getState().reset();
  }
}

/**
 * Atomically swap from the previous session to a new one.
 *
 * Used on the login path. Does cancelQueries → clear → reset stores →
 * setSession in order, so call sites can't reorder them. The fused helper
 * makes the ordering foot-gun unreachable.
 */
export async function swapSession(queryClient: QueryClient, user: SessionUser): Promise<void> {
  await resetClientState(queryClient);
  useSessionStore.getState().setSession(user);
}

// ─── Non-React-context registration ──────────────────────────────────────────
//
// `handleUnauthorizedAccess` in `store/session.ts` runs from the api-client's
// terminal-401 handler — non-React, non-component. It can't call
// `useQueryClient()`. App boot calls `registerSessionResetQueryClient(qc)`
// once; the unauth handler calls `resetClientStateUsingRegistered()`.
//
// Mirrors the established `setUnauthorizedHandler` pattern in
// `store/session.ts` — same module-level singleton shape, same lifetime.
// If a third such registry lands, that's the moment to extract a shared
// `createBootRegistry<T>()` utility.
//
// If registration hasn't run yet (or tests reset it), the function is a
// no-op — the foreground tab still redirects to /login via the session
// slice flip; the cache stays stale until the next login() clears it.
// This registration just hardens that path against background-tab leaks
// and concurrent-render slop.

let registeredQueryClient: QueryClient | null = null;

export function registerSessionResetQueryClient(queryClient: QueryClient): void {
  registeredQueryClient = queryClient;
}

export async function resetClientStateUsingRegistered(): Promise<void> {
  if (registeredQueryClient !== null) {
    await resetClientState(registeredQueryClient);
  }
}

/** Test-only. Do not call from app code. */
export function _unsafeResetSessionResetRegistryForTests(): void {
  registeredQueryClient = null;
}
