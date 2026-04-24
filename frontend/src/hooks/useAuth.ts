import { useCallback, useEffect } from 'react';
import { api, refreshAccessToken, setAccessToken } from '@/lib/api';
import { useSessionStore, type SessionUser } from '@/store/session';

export interface Credentials {
  username: string;
  password: string;
}

interface AuthResponse {
  user: SessionUser;
  accessToken: string;
}

interface MeResponse {
  user: SessionUser;
}

export interface UseAuthResult {
  user: SessionUser | null;
  status: ReturnType<typeof useSessionStore.getState>['status'];
  login: (creds: Credentials) => Promise<SessionUser>;
  register: (creds: Credentials) => Promise<SessionUser>;
  logout: () => Promise<void>;
}

/**
 * Attempt to bootstrap an authenticated session from the httpOnly refresh
 * cookie. Called once at app load. On success, the access token is in the
 * store and the user record is populated. On failure, status becomes
 * `unauthenticated`.
 *
 * `signal` lets `useInitAuth` cancel the side-effects on unmount: if the
 * signal aborts after a step resolves but before we mutate the store, we
 * bail without touching session state.
 */
export async function initAuth(signal?: AbortSignal): Promise<void> {
  const { setStatus, setSession, clearSession } = useSessionStore.getState();
  if (signal?.aborted) return;
  setStatus('loading');
  try {
    // Use the bare refresh helper so a 401 here doesn't re-enter the
    // api-client's 401-retry loop (which would itself call /auth/refresh).
    const newToken = await refreshAccessToken();
    if (signal?.aborted) return;
    if (!newToken) {
      clearSession();
      return;
    }
    // Push the token into the api-client BEFORE issuing /auth/me so any
    // concurrent api() call during this window picks up the bearer instead
    // of firing unauthenticated and triggering its own refresh cycle. Abort
    // gate goes immediately before the mutation so a post-refresh abort
    // doesn't leave the module-level token out of sync with the store.
    if (signal?.aborted) return;
    setAccessToken(newToken);
    const me = await api<MeResponse>('/auth/me');
    if (signal?.aborted) return;
    setSession(me.user, newToken);
  } catch {
    if (signal?.aborted) return;
    clearSession();
  }
}

export function useAuth(): UseAuthResult {
  const user = useSessionStore((s) => s.user);
  const status = useSessionStore((s) => s.status);
  const setSession = useSessionStore((s) => s.setSession);
  const clearSession = useSessionStore((s) => s.clearSession);

  const login = useCallback(
    async ({ username, password }: Credentials): Promise<SessionUser> => {
      const res = await api<AuthResponse>('/auth/login', {
        method: 'POST',
        body: { username, password },
      });
      setSession(res.user, res.accessToken);
      return res.user;
    },
    [setSession],
  );

  const register = useCallback(
    async ({ username, password }: Credentials): Promise<SessionUser> => {
      const res = await api<AuthResponse>('/auth/register', {
        method: 'POST',
        body: { username, password },
      });
      setSession(res.user, res.accessToken);
      return res.user;
    },
    [setSession],
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      await api<void>('/auth/logout', { method: 'POST' });
    } catch {
      // Ignore errors on logout — we clear local state regardless.
    } finally {
      clearSession();
    }
  }, [clearSession]);

  return { user, status, login, register, logout };
}

/**
 * Mount-time effect component: kicks off `initAuth()` exactly once. Uses an
 * `AbortController` so a StrictMode double-invoke (or a fast unmount) cannot
 * stomp the store after the component is gone.
 */
export function useInitAuth(): void {
  useEffect(() => {
    const controller = new AbortController();
    void initAuth(controller.signal);
    return () => {
      controller.abort();
    };
  }, []);
}
