import type { JSX } from 'react';
import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { AuthForm } from '@/components/AuthForm';
import { RecoveryCodeHandoff } from '@/components/RecoveryCodeHandoff';
import { type Credentials, useAuth } from '@/hooks/useAuth';

type Phase =
  | { kind: 'form' }
  | { kind: 'handoff'; recoveryCode: string; credentials: Credentials }
  | { kind: 'logging-in'; recoveryCode: string; credentials: Credentials }
  | {
      kind: 'login-failed';
      recoveryCode: string;
      message: string;
      credentials: Credentials;
    };

const POST_ACK_LOGIN_FAIL_MESSAGE =
  'Sign in failed. Your account was created — please sign in to continue.';

export function RegisterPage(): JSX.Element {
  const { user, register, login } = useAuth();
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });

  // If a successful post-ack login has flipped the session to authenticated,
  // the router's RequireAuth will pick it up on the next render — but a
  // Navigate here makes the redirect immediate and survives any race with
  // the parent's loading state.
  if (user) return <Navigate to="/" replace />;

  if (phase.kind === 'login-failed') {
    return (
      <main className="auth-screen">
        <div className="grid place-items-center p-9 col-span-2">
          <div className="flex flex-col gap-3 max-w-[420px]">
            <div role="alert" className="auth-error">
              {phase.message}
            </div>
            <Link
              to="/login"
              className="inline-flex items-center justify-center px-3.5 py-2.5 text-[13px] font-medium font-sans bg-[var(--ink)] text-[var(--bg)] rounded-[var(--radius)] hover:bg-[var(--ink-2)] transition-colors no-underline"
            >
              Sign in
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (phase.kind === 'handoff' || phase.kind === 'logging-in') {
    const onContinue = async (): Promise<void> => {
      // Re-entrancy guard: only the 'handoff' phase advances forward.
      if (phase.kind !== 'handoff') return;
      const creds = phase.credentials;
      const code = phase.recoveryCode;
      setPhase({ kind: 'logging-in', recoveryCode: code, credentials: creds });
      try {
        await login(creds);
        // setSession → status='authenticated' → next render returns Navigate.
      } catch {
        // Any thrown error here is treated as a soft failure: the account
        // exists, we just couldn't log in for this round-trip. Send the
        // user to the login page with a clear message.
        setPhase({
          kind: 'login-failed',
          recoveryCode: code,
          message: POST_ACK_LOGIN_FAIL_MESSAGE,
          credentials: creds,
        });
      }
    };

    return (
      <RecoveryCodeHandoff
        recoveryCode={phase.recoveryCode}
        username={phase.credentials.username}
        onContinue={() => {
          void onContinue();
        }}
      />
    );
  }

  const handleRegister = async (creds: Credentials): Promise<void> => {
    const { recoveryCode } = await register(creds);
    setPhase({ kind: 'handoff', recoveryCode, credentials: creds });
  };

  return <AuthForm mode="register" onSubmit={handleRegister} />;
}
