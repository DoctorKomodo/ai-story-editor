import type { JSX } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AuthForm } from '@/components/AuthForm';
import { useAuth } from '@/hooks/useAuth';

interface LoginLocationState {
  resetSuccess?: boolean;
}

export function LoginPage(): JSX.Element {
  const { user, login } = useAuth();
  const location = useLocation();
  const state = location.state as LoginLocationState | null;
  const showResetBanner = state?.resetSuccess === true;

  if (user) return <Navigate to="/" replace />;

  return (
    <>
      {showResetBanner ? (
        <div
          role="status"
          aria-label="Password reset"
          className="fixed top-3 left-1/2 -translate-x-1/2 z-50 px-4 py-2 text-[12.5px] font-sans bg-[var(--bg-elevated)] text-[var(--ink)] border border-[var(--line-2)] rounded-[var(--radius)] shadow-[0_4px_16px_rgba(0,0,0,0.08)]"
        >
          Password updated. Sign in with your new password to continue.
        </div>
      ) : null}
      <AuthForm mode="login" onSubmit={login} />
    </>
  );
}
