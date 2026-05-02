import type { JSX } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AuthForm } from '@/components/AuthForm';
import { useAuth } from '@/hooks/useAuth';

interface LoginLocationState {
  resetSuccess?: boolean;
  // [F61] Set when navigating from sign-out-everywhere; LoginPage shows a
  // distinct banner so the user knows their session was revoked deliberately
  // rather than expired.
  signedOutEverywhere?: boolean;
  // [X3] Set when navigating from delete-account success; LoginPage shows a
  // distinct banner so the user knows their account was removed and there is
  // no "log back in" option for that identity.
  accountDeleted?: boolean;
}

interface BannerProps {
  ariaLabel: string;
  message: string;
}

function bannerProps(state: LoginLocationState | null): BannerProps | null {
  if (state?.signedOutEverywhere === true) {
    return {
      ariaLabel: 'Signed out everywhere',
      message: 'You have been signed out of every session. Sign in again to continue.',
    };
  }
  if (state?.resetSuccess === true) {
    return {
      ariaLabel: 'Password reset',
      message: 'Password updated. Sign in with your new password to continue.',
    };
  }
  if (state?.accountDeleted === true) {
    return {
      ariaLabel: 'Account deleted',
      message: 'Your account has been deleted.',
    };
  }
  return null;
}

export function LoginPage(): JSX.Element {
  const { user, login } = useAuth();
  const location = useLocation();
  const banner = bannerProps(location.state as LoginLocationState | null);

  if (user) return <Navigate to="/" replace />;

  return (
    <>
      {banner ? (
        <div
          role="status"
          aria-label={banner.ariaLabel}
          className="fixed top-3 left-1/2 -translate-x-1/2 z-50 px-4 py-2 text-[12.5px] font-sans bg-[var(--bg-elevated)] text-[var(--ink)] border border-[var(--line-2)] rounded-[var(--radius)] shadow-[0_4px_16px_rgba(0,0,0,0.08)]"
        >
          {banner.message}
        </div>
      ) : null}
      <AuthForm mode="login" onSubmit={login} />
    </>
  );
}
