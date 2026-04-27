// [F61] Account & Privacy mutations.
//
// - useChangePasswordMutation         → POST /api/auth/change-password   ([AU15])
// - useRotateRecoveryCodeMutation     → POST /api/auth/rotate-recovery-code ([AU17])
// - useSignOutEverywhereMutation      → POST /api/auth/sign-out-everywhere ([B12])
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
import { type UseMutationResult, useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { useSessionStore } from '@/store/session';

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
  const clearSession = useSessionStore((s) => s.clearSession);

  return useMutation<void, Error, void>({
    mutationFn: async (): Promise<void> => {
      await api<void>('/auth/sign-out-everywhere', { method: 'POST' });
    },
    onSuccess: () => {
      clearSession();
      navigate('/login', { replace: true, state: { signedOutEverywhere: true } });
    },
  });
}
