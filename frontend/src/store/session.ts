import { create } from 'zustand';
import { setAccessToken, setUnauthorizedHandler } from '@/lib/api';

export interface SessionUser {
  id: string;
  username: string;
  name: string;
}

export type SessionStatus = 'idle' | 'loading' | 'authenticated' | 'unauthenticated';

export interface SessionState {
  user: SessionUser | null;
  status: SessionStatus;
  // [F65] Set true when the api client gives up after a failed refresh during
  // an active session. LoginPage reads this to show a "session expired"
  // banner. Distinct from explicit logout / sign-out-everywhere / account-
  // deleted (which use location.state banners). Cleared on the next
  // successful login (setSession) or by an explicit acknowledge call.
  sessionExpired: boolean;
  setSession: (user: SessionUser, accessToken: string) => void;
  setUser: (user: SessionUser) => void;
  clearSession: () => void;
  setStatus: (status: SessionStatus) => void;
  acknowledgeSessionExpired: () => void;
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
  clearSession: () => {
    setAccessToken(null);
    set({ user: null, status: 'unauthenticated' });
  },
  setStatus: (status) => set({ status }),
  acknowledgeSessionExpired: () => set({ sessionExpired: false }),
}));

// When the api client gives up after a failed refresh, flip the store to
// unauthenticated so the router's RequireAuth guard can redirect, AND mark
// the session as terminally expired so LoginPage can show the banner.
// `useInitAuth` does NOT route through this handler (it uses the bare
// `refreshAccessToken` helper), so a cold-boot 401 lands as plain
// unauthenticated without the "session expired" banner — which is the
// intended UX (the user wasn't actively in a session).
setUnauthorizedHandler(() => {
  const state = useSessionStore.getState();
  state.clearSession();
  useSessionStore.setState({ sessionExpired: true });
});
