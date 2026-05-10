import { create } from 'zustand';
import { setAccessToken, setUnauthorizedHandler } from '@/lib/api';
import { resetClientStateUsingRegistered } from '@/lib/sessionReset';

export interface SessionUser {
  id: string;
  username: string;
  name: string;
}

export type SessionStatus = 'idle' | 'loading' | 'authenticated' | 'unauthenticated';

export interface SessionState {
  user: SessionUser | null;
  status: SessionStatus;
  // [F65] Set true ONLY by the api client's terminal-401 handler (below).
  // LoginPage reads this to show a "session expired" banner. Distinct from
  // explicit logout / sign-out-everywhere / account-deleted (which use
  // location.state banners). Cleared on the next successful login
  // (setSession) AND on every clearSession — so the only path that sets it
  // true is the handler, and the flag never lingers across deliberate
  // session changes.
  sessionExpired: boolean;
  setSession: (user: SessionUser, accessToken: string) => void;
  setUser: (user: SessionUser) => void;
  clearSession: (opts?: { expired?: boolean }) => void;
  setStatus: (status: SessionStatus) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  user: null,
  status: 'idle',
  sessionExpired: false,
  setSession: (user, accessToken) => {
    // The token is the source-of-truth in the api-client module; the slice
    // intentionally does NOT mirror it here to avoid drift.
    setAccessToken(accessToken);
    set({ user, status: 'authenticated', sessionExpired: false });
  },
  setUser: (user) => {
    // Used by mutations that update profile fields (e.g. display name)
    // without rotating the access token. Keeps status === 'authenticated'.
    set({ user });
  },
  clearSession: (opts) => {
    setAccessToken(null);
    set({
      user: null,
      status: 'unauthenticated',
      sessionExpired: opts?.expired ?? false,
    });
  },
  setStatus: (status) => set({ status }),
}));

// When the api client gives up after a failed refresh, flip the store to
// unauthenticated so the router's RequireAuth guard can redirect, AND mark
// the session as terminally expired so LoginPage can show the banner.
// `useInitAuth` does NOT route through this handler (it uses the bare
// `refreshAccessToken` helper), so a cold-boot 401 lands as plain
// unauthenticated without the "session expired" banner — which is the
// intended UX (the user wasn't actively in a session).
//
// Single setState (rather than clearSession() + setState) avoids a render
// where the user is unauthenticated but sessionExpired is still false —
// React 18's automatic batching may not coalesce two zustand mutations
// dispatched from a non-React callback, which would briefly flash /login
// without the banner.
//
// Exported so tests can install the production wiring after
// `resetApiClientForTests` strips it; otherwise tests would have to inline
// a near-duplicate of the same body and silently drift if this changes.
export function handleUnauthorizedAccess(): void {
  // Fire-and-forget: the registry call is async (cancelQueries), but
  // clearSession below must remain synchronous so the existing single-
  // setState contract is preserved (avoids a render where the user is
  // unauthenticated but sessionExpired is still false). Awaiting here
  // would split the state change across a microtask. Promise rejection
  // here is unreachable in practice — cancelQueries / clear are infallible.
  void resetClientStateUsingRegistered();
  useSessionStore.getState().clearSession({ expired: true });
}

setUnauthorizedHandler(handleUnauthorizedAccess);
