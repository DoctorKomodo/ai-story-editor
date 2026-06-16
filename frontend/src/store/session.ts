import { create } from 'zustand';
import { setUnauthorizedHandler } from '@/lib/api';
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
  // Set true ONLY by the terminal-401 handler (below). LoginPage reads this
  // to show a "session expired" banner. Distinct from explicit logout /
  // sign-out-everywhere / account-deleted (which use location.state banners).
  // Cleared on the next successful login (setSession) AND on every
  // clearSession — so the only path that sets it true is the handler, and
  // the flag never lingers across deliberate session changes.
  sessionExpired: boolean;
  setSession: (user: SessionUser) => void;
  setUser: (user: SessionUser) => void;
  clearSession: (opts?: { expired?: boolean }) => void;
  setStatus: (status: SessionStatus) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  user: null,
  status: 'idle',
  sessionExpired: false,
  setSession: (user) => {
    set({ user, status: 'authenticated', sessionExpired: false });
  },
  setUser: (user) => {
    // Used by mutations that update profile fields (e.g. display name)
    // without touching session status. Keeps status === 'authenticated'.
    set({ user });
  },
  clearSession: (opts) => {
    set({
      user: null,
      status: 'unauthenticated',
      sessionExpired: opts?.expired ?? false,
    });
  },
  setStatus: (status) => set({ status }),
}));

// When the api client receives a terminal 401 during an active session, flip
// the store to unauthenticated so RequireAuth can redirect, AND mark the
// session as expired so LoginPage shows the banner.
//
// The guard below ensures this only fires for an ACTIVE session. A 401 on
// the login attempt (status='unauthenticated') or during cold-boot /auth/me
// (status='loading') is NOT a mid-session expiry — the guard returns early so
// the "session expired" banner never appears in those cases.
//
// `clearSession({ expired: true })` issues a single Zustand `set` — so user,
// status, and sessionExpired are written atomically. React 18's automatic
// batching may not coalesce two separate zustand mutations from a non-React
// callback, which would briefly flash /login without the "session expired"
// banner — hence delegating to clearSession rather than any two-call approach.
//
// Exported so tests can install the production wiring after
// `resetApiClientForTests` strips it; otherwise tests would have to inline
// a near-duplicate of the same body and silently drift if this changes.
export function handleUnauthorizedAccess(): void {
  // Only a 401 that interrupts an ACTIVE session is a real expiry. A 401 on
  // the login attempt or during cold-boot /auth/me is not — guarding here
  // keeps the "session expired" banner off the login page.
  if (useSessionStore.getState().status !== 'authenticated') return;
  // Fire-and-forget: the registry call is async (cancelQueries), but
  // clearSession below must remain synchronous so the single-setState
  // contract is preserved (avoids a render where the user is unauthenticated
  // but sessionExpired is still false).
  void resetClientStateUsingRegistered();
  useSessionStore.getState().clearSession({ expired: true });
}

setUnauthorizedHandler(handleUnauthorizedAccess);
