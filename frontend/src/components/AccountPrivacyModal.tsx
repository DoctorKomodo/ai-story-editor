// [F61] Account & Privacy modal — opened from the user menu's
// "Account & privacy" entry. Sectioned (NOT tabbed) — four short sections
// in vertical order:
//   1. Change password               → POST /api/auth/change-password    [AU15]
//   2. Rotate recovery code          → POST /api/auth/rotate-recovery-code [AU17]
//      (re-uses <RecoveryCodeHandoff> from F59 verbatim for the result UI)
//   3. Sign out everywhere           → POST /api/auth/sign-out-everywhere [B12]
//      (two-click confirm; success → clearSession + Navigate('/login'))
//   4. Delete account placeholder    → disabled red button referencing [X3]
//
// No auto-save: each section has its own explicit submit. The footer's
// "Done" just closes the modal; it does not save anything.
//
// [X22] Ported onto the `<Modal>` primitive — backdrop, Escape, click-outside,
// and focus management all live in the primitive now. The recovery-code-
// handoff close gate uses `dismissable={!closeBlocked}` plus the close-X
// `closeDisabled` to block all dismissal paths while a freshly issued
// recovery code is on screen.
import type { JSX, ReactNode } from 'react';
import { useEffect, useId, useState } from 'react';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from '@/design/primitives';
import {
  type ChangePasswordInput,
  useChangePasswordMutation,
  useRotateRecoveryCodeMutation,
  useSignOutEverywhereMutation,
} from '@/hooks/useAccount';
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
  'inline-flex items-center justify-center px-3 py-2 text-[13px] font-medium font-sans bg-danger text-bg rounded-[var(--radius)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

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
interface RotateRecoverySectionProps {
  username: string;
  /**
   * Called whenever a new recovery code is being shown (or the user has
   * acknowledged it). The modal shell uses this to disable Escape and
   * backdrop dismissal while the code is on screen — Escape-dismissing the
   * modal would silently destroy the new code.
   */
  onShowRecoveryCode: (showing: boolean) => void;
}

function RotateRecoverySection({
  username,
  onShowRecoveryCode,
}: RotateRecoverySectionProps): JSX.Element {
  const passwordId = useId();
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  const mutation = useRotateRecoveryCodeMutation();

  useEffect(() => {
    onShowRecoveryCode(issuedCode !== null);
    return () => {
      // If this section unmounts while a code is still on screen, the modal
      // is being torn down; release the close gate so the user isn't stuck.
      onShowRecoveryCode(false);
    };
  }, [issuedCode, onShowRecoveryCode]);

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
  // True while RotateRecoverySection is showing a freshly-issued recovery
  // code via <RecoveryCodeHandoff>. The new code replaces the old one on
  // the backend the moment AU17 returns, so dismissing the modal before the
  // user has copied / acknowledged it would silently destroy the only copy.
  // We disable Escape, backdrop click, and the X / Done buttons in that
  // window; the user's only exit is RecoveryCodeHandoff's own checkbox-
  // gated Continue button.
  const [closeBlocked, setCloseBlocked] = useState(false);

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      size="lg"
      dismissable={!closeBlocked}
      testId="account-privacy-modal"
      backdropTestId="ap-backdrop"
    >
      <ModalHeader
        titleId={titleId}
        title="Account & privacy"
        subtitle={
          <>
            Manage credentials, recovery, and sessions for{' '}
            <span className="font-mono text-ink-3">@{username}</span>.
          </>
        }
        onClose={onClose}
        closeDisabled={closeBlocked}
        closeTestId="account-privacy-close"
      />

      <ModalBody className="flex-1 overflow-y-auto !py-0 px-[18px]">
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
          <RotateRecoverySection username={username} onShowRecoveryCode={setCloseBlocked} />
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
      </ModalBody>

      <ModalFooter>
        <Button
          variant="ghost"
          data-testid="account-privacy-done"
          onClick={onClose}
          disabled={closeBlocked}
        >
          Done
        </Button>
      </ModalFooter>
    </Modal>
  );
}
