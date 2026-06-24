import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { api } from '@/lib/api';
import { resetClientState, swapSession } from '@/lib/sessionReset';
import { type SessionUser, useSessionStore } from '@/store/session';

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface RegisterCredentials {
  name: string;
  username: string;
  password: string;
}

interface LoginResponse {
  user: SessionUser;
}

interface RegisterResponse {
  user: SessionUser;
  recoveryCode: string;
}

export interface RegisterResult {
  user: SessionUser;
  recoveryCode: string;
}

interface MeResponse {
  user: SessionUser;
}

export interface ResetPasswordInput {
  username: string;
  recoveryCode: string;
  newPassword: string;
}

export interface UseAuthResult {
  user: SessionUser | null;
  status: ReturnType<typeof useSessionStore.getState>['status'];
  login: (creds: LoginCredentials) => Promise<SessionUser>;
  register: (creds: RegisterCredentials) => Promise<RegisterResult>;
  logout: () => Promise<void>;
  resetPassword: (input: ResetPasswordInput) => Promise<void>;
}

/**
 * Probe `/auth/me` to bootstrap an authenticated session from the httpOnly
 * session cookie. Called once at app load. On 200, populates the session
 * store. On 401 (no cookie / expired) or any other error, clears it.
 *
 * `signal` lets `useInitAuth` cancel side-effects on unmount: if the signal
 * aborts after a step resolves but before we mutate the store, we bail
 * without touching session state.
 */
export async function initAuth(signal?: AbortSignal): Promise<void> {
  const { setStatus, setSession, clearSession } = useSessionStore.getState();
  if (signal?.aborted) return;
  setStatus('loading');
  try {
    const me = await api<MeResponse>('/auth/me'); // cookie rides along
    if (signal?.aborted) return;
    setSession(me.user);
  } catch {
    if (signal?.aborted) return;
    clearSession();
  }
}

export function useAuth(): UseAuthResult {
  const user = useSessionStore((s) => s.user);
  const status = useSessionStore((s) => s.status);
  const clearSession = useSessionStore((s) => s.clearSession);
  const queryClient = useQueryClient();

  const login = useCallback(
    async ({ username, password }: LoginCredentials): Promise<SessionUser> => {
      const res = await api<LoginResponse>('/auth/login', {
        method: 'POST',
        body: { username, password },
      });
      // swapSession does cancelQueries → clear → reset stores → setSession
      // atomically. The ordering invariant (reset before setSession) is
      // unreachable from this call site.
      await swapSession(queryClient, res.user);
      return res.user;
    },
    [queryClient],
  );

  const register = useCallback(
    async ({ name, username, password }: RegisterCredentials): Promise<RegisterResult> => {
      const res = await api<RegisterResponse>('/auth/register', {
        method: 'POST',
        body: { name, username, password },
      });
      // Intentionally do NOT call setSession — the backend has not issued a
      // session cookie yet. The page must show the recovery code, get
      // acknowledgement, then call login() with the same creds.
      return { user: res.user, recoveryCode: res.recoveryCode };
    },
    [],
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      await api<void>('/auth/logout', { method: 'POST' });
    } catch {
      // Ignore errors on logout — we clear local state regardless.
    } finally {
      // resetClientState awaits cancelQueries first, so any in-flight fetch
      // from this session is aborted before clear() runs and before the
      // session slice flips to unauthenticated.
      await resetClientState(queryClient);
      clearSession();
    }
  }, [clearSession, queryClient]);

  const resetPassword = useCallback(
    async ({ username, recoveryCode, newPassword }: ResetPasswordInput): Promise<void> => {
      // Backend returns 204 with no body — do NOT call setSession. The user
      // must re-authenticate on /login after this resolves.
      await api<void>('/auth/reset-password', {
        method: 'POST',
        body: { username, recoveryCode, newPassword },
      });
    },
    [],
  );

  return { user, status, login, register, logout, resetPassword };
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
