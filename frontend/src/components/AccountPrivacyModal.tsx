// [F61] Account & Privacy modal — opened from the user menu's
// "Account & privacy" entry. Mirrors the F43 SettingsModal shell (720px,
// centered, Escape via the F47/F57 priority dispatcher, backdrop click,
// keyframe-compatible centring transform from F58).
//
// Sectioned (NOT tabbed) — four short sections in vertical order:
//   1. Change password               → POST /api/auth/change-password    [AU15]
//   2. Rotate recovery code          → POST /api/auth/rotate-recovery-code [AU17]
//      (re-uses <RecoveryCodeHandoff> from F59 verbatim for the result UI)
//   3. Sign out everywhere           → POST /api/auth/sign-out-everywhere [B12]
//      (two-click confirm; success → clearSession + Navigate('/login'))
//   4. Delete account placeholder    → disabled red button referencing [X3]
//
// No auto-save: each section has its own explicit submit. The footer's
// "Done" just closes the modal; it does not save anything.
import type { JSX, MouseEvent, ReactNode } from 'react';
import { useId, useState } from 'react';
import {
  type ChangePasswordInput,
  useChangePasswordMutation,
  useRotateRecoveryCodeMutation,
  useSignOutEverywhereMutation,
} from '@/hooks/useAccount';
import { useEscape } from '@/hooks/useKeyboardShortcuts';
import { ApiError } from '@/lib/api';
import { RecoveryCodeHandoff } from './RecoveryCodeHandoff';

export interface AccountPrivacyModalProps {
  open: boolean;
  onClose: () => void;
  username: string;
}

const PASSWORD_MIN = 8;
const PASSWORD_MIN_ERROR = `Password must be at least ${String(PASSWORD_MIN)} characters.`;
const MISMATCH = 'Passwords do not match.';
const ERR_GENERIC = 'Something went wrong. Please try again.';
const ERR_RATE = 'Too many attempts. Try again in a minute.';
const ERR_PW_INCORRECT = 'Current password is incorrect.';
const ERR_RECOVERY_PW_INCORRECT = 'Password is incorrect.';

function CloseIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6L6 18" />
      <path d="M6 6l12 12" />
    </svg>
  );
}

interface SectionProps {
  title: string;
  hint?: string;
  danger?: boolean;
  children: ReactNode;
}
function Section({ title, hint, danger = false, children }: SectionProps): JSX.Element {
  // <section aria-label="..."> implicitly carries role="region"; using the
  // semantic element keeps biome's a11y rules happy without an explicit role.
  return (
    <section
      aria-label={title}
      className={[
        'flex flex-col gap-2 py-5 border-b border-[var(--line)] last:border-b-0',
        danger ? 'opacity-90' : '',
      ]
        .join(' ')
        .trim()}
    >
      <h3
        className={[
          'font-serif text-[16px] font-medium m-0',
          danger ? 'text-[var(--danger)]' : 'text-[var(--ink)]',
        ].join(' ')}
      >
        {title}
      </h3>
      {hint ? <p className="text-[12.5px] text-[var(--ink-3)] m-0">{hint}</p> : null}
      <div className="mt-2">{children}</div>
    </section>
  );
}

const INPUT_CLASS =
  'w-full px-2.5 py-2 text-[13.5px] font-mono bg-[var(--bg-elevated)] ' +
  'border border-[var(--line-2)] rounded-[var(--radius)] text-[var(--ink)] ' +
  'placeholder:text-[var(--ink-4)] ' +
  'focus:outline-none focus:border-[var(--ink-3)] transition-colors';

const BTN_PRIMARY =
  'inline-flex items-center justify-center px-3 py-2 text-[13px] font-medium font-sans bg-[var(--ink)] text-[var(--bg)] rounded-[var(--radius)] hover:bg-[var(--ink-2)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

const BTN_SECONDARY =
  'inline-flex items-center justify-center px-3 py-2 text-[12.5px] font-medium font-sans bg-[var(--bg-elevated)] text-[var(--ink)] border border-[var(--line-2)] rounded-[var(--radius)] hover:bg-[var(--surface-hover)] transition-colors';

const BTN_DANGER =
  'inline-flex items-center justify-center px-3 py-2 text-[13px] font-medium font-sans bg-[var(--danger)] text-white rounded-[var(--radius)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

function mapApiError(err: unknown, on401: string): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return on401;
    if (err.status === 429) return ERR_RATE;
    return ERR_GENERIC;
  }
  return ERR_GENERIC;
}

// ---------- Section 1: Change password ----------
function ChangePasswordSection(): JSX.Element {
  const oldPasswordId = useId();
  const newPasswordId = useId();
  const confirmId = useId();

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const mutation = useChangePasswordMutation();

  const newTooShort = newPassword.length > 0 && newPassword.length < PASSWORD_MIN;
  const mismatch = confirm.length > 0 && confirm !== newPassword;
  const formInvalid =
    oldPassword.length === 0 ||
    newPassword.length < PASSWORD_MIN ||
    confirm.length === 0 ||
    confirm !== newPassword;
  const submitDisabled = formInvalid || mutation.isPending;

  const submit = async (): Promise<void> => {
    setErr(null);
    setSuccess(false);
    if (formInvalid) return;
    try {
      const input: ChangePasswordInput = { oldPassword, newPassword };
      await mutation.mutateAsync(input);
      setOldPassword('');
      setNewPassword('');
      setConfirm('');
      setSuccess(true);
    } catch (e) {
      setErr(mapApiError(e, ERR_PW_INCORRECT));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor={oldPasswordId} className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-[var(--ink-2)]">Current password</span>
        <input
          id={oldPasswordId}
          type="password"
          autoComplete="current-password"
          value={oldPassword}
          onChange={(e) => {
            setOldPassword(e.target.value);
            if (success) setSuccess(false);
            if (err) setErr(null);
          }}
          className={INPUT_CLASS}
        />
      </label>
      <label htmlFor={newPasswordId} className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-[var(--ink-2)]">New password</span>
        <input
          id={newPasswordId}
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => {
            setNewPassword(e.target.value);
            if (success) setSuccess(false);
            if (err) setErr(null);
          }}
          aria-invalid={newTooShort}
          className={INPUT_CLASS}
        />
        {newTooShort ? (
          <span className="text-[12px] text-[var(--danger)]">{PASSWORD_MIN_ERROR}</span>
        ) : null}
      </label>
      <label htmlFor={confirmId} className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-[var(--ink-2)]">Confirm new password</span>
        <input
          id={confirmId}
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            if (success) setSuccess(false);
            if (err) setErr(null);
          }}
          aria-invalid={mismatch}
          className={INPUT_CLASS}
        />
        {mismatch ? <span className="text-[12px] text-[var(--danger)]">{MISMATCH}</span> : null}
      </label>

      {err ? (
        <div role="alert" className="auth-error">
          {err}
        </div>
      ) : null}
      {success ? (
        <div role="status" className="text-[12.5px] text-[var(--ink-2)]">
          Password updated.{' '}
          <span className="text-[var(--ink-3)]">Other sessions have been signed out.</span>
        </div>
      ) : null}

      <div className="flex justify-end">
        <button
          type="button"
          disabled={submitDisabled}
          onClick={() => {
            void submit();
          }}
          className={BTN_PRIMARY}
        >
          {mutation.isPending ? 'Updating…' : 'Update password'}
        </button>
      </div>
    </div>
  );
}

// ---------- Section 2: Rotate recovery code ----------
function RotateRecoverySection({ username }: { username: string }): JSX.Element {
  const passwordId = useId();
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  const mutation = useRotateRecoveryCodeMutation();

  const submitDisabled = password.length === 0 || mutation.isPending;

  const submit = async (): Promise<void> => {
    setErr(null);
    if (password.length === 0) return;
    try {
      const res = await mutation.mutateAsync({ password });
      setIssuedCode(res.recoveryCode);
    } catch (e) {
      setErr(mapApiError(e, ERR_RECOVERY_PW_INCORRECT));
    }
  };

  if (issuedCode !== null) {
    return (
      <RecoveryCodeHandoff
        recoveryCode={issuedCode}
        username={username}
        onContinue={() => {
          setIssuedCode(null);
          setPassword('');
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor={passwordId} className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-[var(--ink-2)]">Password</span>
        <input
          id={passwordId}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (err) setErr(null);
          }}
          className={INPUT_CLASS}
        />
      </label>

      {err ? (
        <div role="alert" className="auth-error">
          {err}
        </div>
      ) : null}

      <div className="flex justify-end">
        <button
          type="button"
          disabled={submitDisabled}
          onClick={() => {
            void submit();
          }}
          className={BTN_PRIMARY}
        >
          {mutation.isPending ? 'Generating…' : 'Generate new code'}
        </button>
      </div>
    </div>
  );
}

// ---------- Section 3: Sign out everywhere ----------
function SignOutEverywhereSection(): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const mutation = useSignOutEverywhereMutation();

  const fire = async (): Promise<void> => {
    setErr(null);
    try {
      await mutation.mutateAsync();
      // useSignOutEverywhereMutation already navigates + clearSession on success.
    } catch (e) {
      setErr(mapApiError(e, ERR_GENERIC));
      setConfirming(false);
    }
  };

  if (!confirming) {
    return (
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            setConfirming(true);
          }}
          className={BTN_SECONDARY}
        >
          Sign out other sessions
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3 rounded-[var(--radius)] bg-[var(--bg-elevated)] border border-[var(--line-2)]">
      <p className="text-[12.5px] text-[var(--ink-2)] m-0">
        Are you sure? This will end this session too.
      </p>
      {err ? (
        <div role="alert" className="auth-error">
          {err}
        </div>
      ) : null}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
          }}
          className={BTN_SECONDARY}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={mutation.isPending}
          onClick={() => {
            void fire();
          }}
          className={BTN_DANGER}
        >
          {mutation.isPending ? 'Signing out…' : 'Yes, sign out everywhere'}
        </button>
      </div>
    </div>
  );
}

// ---------- Section 4: Delete account placeholder ----------
function DeleteAccountSection(): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12.5px] text-[var(--ink-3)] m-0">
        Coming with [X3]. This will require typing your password and the word DELETE.
      </p>
      <div className="flex justify-end">
        <button type="button" disabled className={BTN_DANGER}>
          Delete account…
        </button>
      </div>
    </div>
  );
}

// ---------- Modal shell ----------
export function AccountPrivacyModal({
  open,
  onClose,
  username,
}: AccountPrivacyModalProps): JSX.Element | null {
  const titleId = useId();

  // Escape handling uses the F47/F57 priority-aware dispatcher. Priority 100
  // matches the other modals (Settings, StoryPicker, ModelPicker) so an open
  // Account & Privacy modal swallows Escape before any popover or the
  // selection bubble (priority 50 / 10) sees it. The hook is a no-op when
  // `enabled: false`, so we gate on `open` rather than checking inside.
  useEscape(
    () => {
      onClose();
      return true;
    },
    { enabled: open, priority: 100 },
  );

  if (!open) return null;

  const handleBackdrop = (e: MouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      role="presentation"
      data-testid="ap-backdrop"
      onMouseDown={handleBackdrop}
      className="t-backdrop-in fixed inset-0 z-50 bg-[rgba(20,18,12,.4)] backdrop-blur-[3px]"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="account-privacy-modal"
        className="t-modal-in fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[720px] max-w-[94vw] max-h-[85vh] flex flex-col overflow-hidden rounded-[var(--radius-lg)] border border-line-2 bg-bg-elevated shadow-pop"
      >
        <header className="flex items-start justify-between px-[18px] py-[14px] border-b border-line gap-3">
          <div>
            <h2
              id={titleId}
              className="font-serif text-[18px] font-medium tracking-[-0.005em] m-0 text-ink"
            >
              Account &amp; privacy
            </h2>
            <p className="text-[12px] text-ink-4 font-sans m-0 mt-[2px]">
              Manage credentials, recovery, and sessions for{' '}
              <span className="font-mono text-ink-3">@{username}</span>.
            </p>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close"
            data-testid="account-privacy-close"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-[18px]">
          <Section
            title="Change password"
            hint="Use your current password to set a new one. Other sessions will be signed out."
          >
            <ChangePasswordSection />
          </Section>
          <Section
            title="Rotate recovery code"
            hint="Generate a new recovery code. The old code becomes invalid the moment you confirm."
          >
            <RotateRecoverySection username={username} />
          </Section>
          <Section
            title="Sign out everywhere"
            hint="Revoke every active session, including this one. You'll need to sign in again."
          >
            <SignOutEverywhereSection />
          </Section>
          <Section
            title="Delete account"
            hint="Permanently remove your account and every story, chapter, character, and chat you've written."
            danger
          >
            <DeleteAccountSection />
          </Section>
        </div>

        <footer className="flex justify-end px-[18px] py-3 border-t border-line">
          <button
            type="button"
            data-testid="account-privacy-done"
            onClick={onClose}
            className={BTN_SECONDARY}
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
