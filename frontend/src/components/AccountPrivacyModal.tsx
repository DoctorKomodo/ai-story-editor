// [F61] Account & Privacy modal — opened from the user menu's
// "Account & privacy" entry. Sectioned (NOT tabbed) — four short sections
// in vertical order:
//   1. Change password               → POST /api/auth/change-password    [AU15]
//   2. Rotate recovery code          → POST /api/auth/rotate-recovery-code [AU17]
//      (issues a code, then the modal swaps to a takeover shell using
//      <RecoveryCodeCard> until the user confirms.)
//   3. Sign out everywhere           → POST /api/auth/sign-out-everywhere [B12]
//      (two-click confirm; success → clearSession + Navigate('/login'))
//   4. Delete account placeholder    → disabled red button referencing [X3]
//
// No auto-save: each section has its own explicit submit. The footer's
// "Done" just closes the modal; it does not save anything.
//
// [X22] Ported onto the `<Modal>` primitive — backdrop, Escape, click-outside,
// and focus management all live in the primitive now.
//
// Takeover model: when the rotate section issues a new recovery code, the
// modal flips into a single-purpose takeover shell — title, subtitle, and
// body all swap to a "Save your new recovery code" surface using
// <RecoveryCodeCard>. While takeover !== null, the modal is non-dismissable
// (Escape, backdrop, X all gated) and the footer's Done button isn't rendered
// at all. The user's only exit is the card's checkbox-gated Done button,
// which dismisses the takeover and remounts the rotate form (via formKey)
// with a clean password input.
import type { JSX, ReactNode } from 'react';
import { useId, useState } from 'react';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from '@/design/primitives';
import {
  type ChangePasswordInput,
  useChangePasswordMutation,
  useDeleteAccountMutation,
  useRotateRecoveryCodeMutation,
  useSignOutEverywhereMutation,
} from '@/hooks/useAccount';
import { ApiError } from '@/lib/api';
import { RecoveryCodeCard } from './RecoveryCodeCard';

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
const ERR_DELETE_PW_INCORRECT = 'Password is incorrect.';
const DELETE_CONFIRM_TEXT = 'DELETE';

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
  onCodeIssued: (code: string) => void;
}

function RotateRecoverySection({ onCodeIssued }: RotateRecoverySectionProps): JSX.Element {
  const passwordId = useId();
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const mutation = useRotateRecoveryCodeMutation();

  const submitDisabled = password.length === 0 || mutation.isPending;

  const submit = async (): Promise<void> => {
    setErr(null);
    if (password.length === 0) return;
    try {
      const res = await mutation.mutateAsync({ password });
      onCodeIssued(res.recoveryCode);
    } catch (e) {
      setErr(mapApiError(e, ERR_RECOVERY_PW_INCORRECT));
    }
  };

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

// ---------- Section 4: Delete account ----------
interface DeleteAccountConfirmFormProps {
  onCancel: () => void;
}

function DeleteAccountConfirmForm({ onCancel }: DeleteAccountConfirmFormProps): JSX.Element {
  const passwordId = useId();
  const confirmId = useId();
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const mutation = useDeleteAccountMutation();

  const submitDisabled =
    password.length === 0 || confirmText !== DELETE_CONFIRM_TEXT || mutation.isPending;

  const submit = async (): Promise<void> => {
    setErr(null);
    if (submitDisabled) return;
    try {
      await mutation.mutateAsync({ password });
      // The mutation's onSuccess clears session + cache and navigates to
      // /login. The modal will unmount as part of the route change; nothing
      // more to do here.
    } catch (e) {
      setErr(mapApiError(e, ERR_DELETE_PW_INCORRECT));
    }
  };

  return (
    <div className="flex flex-col gap-4">
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
          data-testid="delete-account-password"
        />
      </label>

      <label htmlFor={confirmId} className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-[var(--ink-2)]">
          Type <span className="font-mono">{DELETE_CONFIRM_TEXT}</span> to confirm
        </span>
        <input
          id={confirmId}
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={confirmText}
          onChange={(e) => {
            setConfirmText(e.target.value);
          }}
          className={INPUT_CLASS}
          data-testid="delete-account-confirm-text"
        />
      </label>

      {err ? (
        <div role="alert" className="auth-error">
          {err}
        </div>
      ) : null}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={mutation.isPending}
          className={BTN_SECONDARY}
          data-testid="delete-account-cancel"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            void submit();
          }}
          disabled={submitDisabled}
          className={BTN_DANGER}
          data-testid="delete-account-confirm"
        >
          {mutation.isPending ? 'Deleting…' : 'Permanently delete account'}
        </button>
      </div>
    </div>
  );
}

interface DeleteAccountSectionProps {
  onTrigger: () => void;
}
function DeleteAccountSection({ onTrigger }: DeleteAccountSectionProps): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <button type="button" onClick={onTrigger} className={BTN_DANGER}>
          Delete account…
        </button>
      </div>
    </div>
  );
}

// ---------- Modal shell ----------
type Takeover = { kind: 'recovery-code'; code: string } | { kind: 'delete-account' } | null;

const RECOVERY_TAKEOVER_SUBTITLE =
  'Show once. Inkwell does not store this anywhere it can read. Lose your password and this code, and your stories are gone for good.';

const DELETE_TAKEOVER_SUBTITLE =
  'This permanently deletes your account, all stories, chapters, characters, and chats. This cannot be undone.';

export function AccountPrivacyModal({
  open,
  onClose,
  username,
}: AccountPrivacyModalProps): JSX.Element | null {
  const titleId = useId();
  const [takeover, setTakeover] = useState<Takeover>(null);
  // Bumped on every takeover dismissal so RotateRecoverySection remounts
  // with a clean password input (no effect / ref dance).
  const [formKey, setFormKey] = useState(0);
  const closeBlocked = takeover !== null;

  const dismissTakeover = (): void => {
    setTakeover(null);
    setFormKey((k) => k + 1);
  };

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
      {takeover === null ? (
        <>
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
            closeTestId="account-privacy-close"
          />
          <ModalBody className="!py-0 px-[18px]">
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
              <RotateRecoverySection
                key={formKey}
                onCodeIssued={(code) => {
                  setTakeover({ kind: 'recovery-code', code });
                }}
              />
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
              <DeleteAccountSection
                onTrigger={() => {
                  setTakeover({ kind: 'delete-account' });
                }}
              />
            </Section>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" data-testid="account-privacy-done" onClick={onClose}>
              Done
            </Button>
          </ModalFooter>
        </>
      ) : takeover.kind === 'recovery-code' ? (
        <>
          <ModalHeader
            titleId={titleId}
            title="Save your new recovery code"
            subtitle={RECOVERY_TAKEOVER_SUBTITLE}
            onClose={onClose}
            closeDisabled
            closeTestId="account-privacy-close"
          />
          <ModalBody className="!py-6 px-[18px]">
            <div className="recovery-code-card">
              <RecoveryCodeCard
                recoveryCode={takeover.code}
                username={username}
                primaryLabel="Done"
                onConfirm={dismissTakeover}
              />
            </div>
          </ModalBody>
        </>
      ) : (
        <>
          <ModalHeader
            titleId={titleId}
            title="Delete your account"
            subtitle={DELETE_TAKEOVER_SUBTITLE}
            onClose={onClose}
            closeDisabled
            closeTestId="account-privacy-close"
          />
          <ModalBody className="!py-6 px-[18px]">
            <DeleteAccountConfirmForm onCancel={dismissTakeover} />
          </ModalBody>
        </>
      )}
    </Modal>
  );
}
