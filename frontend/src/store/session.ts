import { create } from 'zustand';
import { setAccessToken, setUnauthorizedHandler } from '@/lib/api';

export interface SessionUser {
  id: string;
  username: string;
}

export type SessionStatus = 'idle' | 'loading' | 'authenticated' | 'unauthenticated';

export interface SessionState {
  user: SessionUser | null;
  accessToken: string | null;
  status: SessionStatus;
  setSession: (user: SessionUser, accessToken: string) => void;
  clearSession: () => void;
  setStatus: (status: SessionStatus) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  user: null,
  accessToken: null,
  status: 'idle',
  setSession: (user, accessToken) => {
    setAccessToken(accessToken);
    set({ user, accessToken, status: 'authenticated' });
  },
  clearSession: () => {
    setAccessToken(null);
    set({ user: null, accessToken: null, status: 'unauthenticated' });
  },
  setStatus: (status) => set({ status }),
}));

// When the api client gives up after a failed refresh, flip the store to
// unauthenticated so the router's RequireAuth guard can redirect.
setUnauthorizedHandler(() => {
  useSessionStore.getState().clearSession();
});
