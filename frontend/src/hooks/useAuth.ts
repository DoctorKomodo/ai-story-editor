import { useCallback, useEffect, useRef } from 'react';
import { api, refreshAccessToken } from '@/lib/api';
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
 */
export async function initAuth(): Promise<void> {
  const { setStatus, setSession, clearSession } = useSessionStore.getState();
  setStatus('loading');
  try {
    // Use the bare refresh helper so a 401 here doesn't re-enter the
    // api-client's 401-retry loop (which would itself call /auth/refresh).
    const newToken = await refreshAccessToken();
    if (!newToken) {
      clearSession();
      return;
    }
    // api() will now pick up this token on subsequent calls.
    const me = await api<MeResponse>('/auth/me', {
      headers: { Authorization: `Bearer ${newToken}` },
    });
    setSession(me.user, newToken);
  } catch {
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
 * Mount-time effect component: kicks off `initAuth()` exactly once. Use this
 * near the router root so the guard can show a `loading` placeholder until the
 * refresh attempt resolves.
 */
export function useInitAuth(): void {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void initAuth();
  }, []);
}
