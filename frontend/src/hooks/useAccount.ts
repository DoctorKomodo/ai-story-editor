// [F61] Account & Privacy mutations.
//
// - useChangePasswordMutation         → POST /api/auth/change-password   ([AU15])
// - useRotateRecoveryCodeMutation     → POST /api/auth/rotate-recovery-code ([AU17])
// - useSignOutEverywhereMutation      → POST /api/auth/sign-out-everywhere ([B12])
// - useDeleteAccountMutation          → DELETE /api/auth/delete-account     ([X3])
//   Clears local session + cache and navigates to /login on success.
//
// On success of sign-out-everywhere we clear the local session and
// navigate('/login') with a non-sensitive `signedOutEverywhere` flag in
// router state — the LoginPage banner reads that flag to render the
// "you have been signed out everywhere" notice.
//
// Change-password and rotate-recovery do NOT log the current tab out: the
// access token is short-lived and still valid until expiry, after which
// the global setUnauthorizedHandler in `frontend/src/store/session.ts`
// will redirect on the next failed refresh.
import {
  type QueryClient,
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { type NavigateFunction, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { resetClientState } from '@/lib/sessionReset';
import { type SessionUser, useSessionStore } from '@/store/session';

type LoggedOutBannerKind = 'signedOutEverywhere' | 'accountDeleted';

async function goLoggedOut(
  queryClient: QueryClient,
  navigate: NavigateFunction,
  kind: LoggedOutBannerKind,
): Promise<void> {
  await resetClientState(queryClient);
  useSessionStore.getState().clearSession();
  navigate('/login', { replace: true, state: { [kind]: true } });
}

export interface ChangePasswordInput {
  oldPassword: string;
  newPassword: string;
}

export interface RotateRecoveryCodeInput {
  password: string;
}

export interface RotateRecoveryCodeResponse {
  recoveryCode: string;
  warning: string;
}

export function useChangePasswordMutation(): UseMutationResult<void, Error, ChangePasswordInput> {
  return useMutation<void, Error, ChangePasswordInput>({
    mutationFn: async (input: ChangePasswordInput): Promise<void> => {
      await api<void>('/auth/change-password', {
        method: 'POST',
        body: input,
      });
    },
  });
}

export function useRotateRecoveryCodeMutation(): UseMutationResult<
  RotateRecoveryCodeResponse,
  Error,
  RotateRecoveryCodeInput
> {
  return useMutation<RotateRecoveryCodeResponse, Error, RotateRecoveryCodeInput>({
    mutationFn: async (input: RotateRecoveryCodeInput): Promise<RotateRecoveryCodeResponse> =>
      api<RotateRecoveryCodeResponse>('/auth/rotate-recovery-code', {
        method: 'POST',
        body: input,
      }),
  });
}

/**
 * Sign-out-everywhere clears the local session AND navigates to /login on
 * success. Encapsulating the post-success steps inside the hook keeps the
 * caller (the section component) free of router / store wiring.
 */
export function useSignOutEverywhereMutation(): UseMutationResult<void, Error, void> {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  return useMutation<void, Error, void>({
    mutationFn: async (): Promise<void> => {
      await api<void>('/auth/sign-out-everywhere', { method: 'POST' });
    },
    onSuccess: () => goLoggedOut(queryClient, navigate, 'signedOutEverywhere'),
  });
}

export interface DeleteAccountInput {
  password: string;
}

/**
 * Delete-account clears the local session AND navigates to /login on success.
 * Encapsulating the post-success steps in the hook keeps the takeover form
 * free of router / store / cache wiring. Pattern matches
 * useSignOutEverywhereMutation.
 */
export function useDeleteAccountMutation(): UseMutationResult<void, Error, DeleteAccountInput> {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  return useMutation<void, Error, DeleteAccountInput>({
    mutationFn: async (input: DeleteAccountInput): Promise<void> => {
      await api<void>('/auth/delete-account', {
        method: 'DELETE',
        body: input,
      });
    },
    onSuccess: () => goLoggedOut(queryClient, navigate, 'accountDeleted'),
  });
}

export interface UpdateProfileInput {
  name: string;
}

export interface UpdateProfileResponse {
  user: SessionUser;
}

/**
 * Update-profile mutation ([X3]). On success, mirrors the returned user
 * into the session store so anywhere that reads from useSessionStore (TopBar,
 * UserMenu, AccountPrivacyModal) re-renders with the new display name. The
 * backend response shape matches GET /api/auth/me so we reuse SessionUser.
 */
export function useUpdateProfileMutation(): UseMutationResult<
  UpdateProfileResponse,
  Error,
  UpdateProfileInput
> {
  const setUser = useSessionStore((s) => s.setUser);
  return useMutation<UpdateProfileResponse, Error, UpdateProfileInput>({
    mutationFn: async (input: UpdateProfileInput): Promise<UpdateProfileResponse> =>
      api<UpdateProfileResponse>('/auth/update-profile', {
        method: 'POST',
        body: input,
      }),
    onSuccess: ({ user }) => {
      setUser(user);
    },
  });
}
