import type { JSX, ReactNode } from 'react';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';

export interface ResetPasswordFormValues {
  username: string;
  recoveryCode: string;
  newPassword: string;
}

export interface ResetPasswordFormProps {
  onSubmit: (values: ResetPasswordFormValues) => Promise<void> | void;
  /** Server / network error to render in the alert region. */
  errorMessage?: string | null;
  /** True while the parent's submit is in flight. */
  pending?: boolean;
}

const USERNAME_PATTERN = /^[a-z0-9_-]+$/;
const USERNAME_MIN = 3;
const USERNAME_MAX = 32;
const PASSWORD_MIN = 8;

const USERNAME_ERROR =
  'Username must be 3–32 characters, lowercase letters, numbers, underscores, or hyphens.';
const PASSWORD_ERROR = `Password must be at least ${String(PASSWORD_MIN)} characters.`;
const MISMATCH_ERROR = 'Passwords do not match.';
const RECOVERY_ERROR = 'Recovery code is required.';

function validateUsername(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (v.length < USERNAME_MIN || v.length > USERNAME_MAX) return USERNAME_ERROR;
  if (!USERNAME_PATTERN.test(v)) return USERNAME_ERROR;
  return null;
}
function validatePassword(raw: string): string | null {
  if (raw.length < PASSWORD_MIN) return PASSWORD_ERROR;
  return null;
}
function validateConfirm(pw: string, confirm: string): string | null {
  if (confirm.length === 0) return null;
  if (pw !== confirm) return MISMATCH_ERROR;
  return null;
}
function validateRecovery(raw: string): string | null {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) return RECOVERY_ERROR;
  return null;
}
function normaliseRecoveryCode(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

interface FieldProps {
  label: string;
  hint?: string;
  htmlFor: string;
  children: ReactNode;
  error?: ReactNode;
}
function Field({ label, hint, htmlFor, children, error }: FieldProps): JSX.Element {
  // Note: the error node is rendered as a sibling of <label>, NOT a child.
  // Putting it inside <label> would make it part of the input's accessible
  // name and break `getByLabelText(/^username$/)` — the resolved name would
  // become "Username Username must be 3-32 characters...".
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="flex flex-col gap-1.5">
        <span className="flex justify-between items-baseline gap-2 text-[12px] font-medium font-sans text-[var(--ink-2)]">
          <span>{label}</span>
          {hint ? (
            <span className="text-[11px] font-normal text-[var(--ink-4)]">{hint}</span>
          ) : null}
        </span>
        {children}
      </label>
      {error}
    </div>
  );
}

const INPUT_CLASS =
  'w-full px-2.5 py-2 text-[13.5px] font-mono bg-[var(--bg-elevated)] ' +
  'border border-[var(--line-2)] rounded-[var(--radius)] text-[var(--ink)] ' +
  'placeholder:text-[var(--ink-4)] ' +
  'focus:outline-none focus:border-[var(--ink-3)] transition-colors';

export function ResetPasswordForm({
  onSubmit,
  errorMessage,
  pending,
}: ResetPasswordFormProps): JSX.Element {
  const [username, setUsername] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [recoveryTouched, setRecoveryTouched] = useState(false);
  const [pwTouched, setPwTouched] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(false);

  const usernameError = validateUsername(username);
  const recoveryError = validateRecovery(recoveryCode);
  const pwError = validatePassword(newPassword);
  const confirmError = validateConfirm(newPassword, confirm);

  const showUsernameError = usernameTouched && usernameError !== null;
  const showRecoveryError = recoveryTouched && recoveryError !== null;
  const showPwError = pwTouched && pwError !== null;
  const showConfirmError = confirmTouched && confirmError !== null;

  const formInvalid =
    usernameError !== null ||
    recoveryError !== null ||
    pwError !== null ||
    confirmError !== null ||
    confirm.length === 0;
  const submitDisabled = formInvalid || pending === true;

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setUsernameTouched(true);
    setRecoveryTouched(true);
    setPwTouched(true);
    setConfirmTouched(true);
    if (formInvalid) return;
    await onSubmit({
      username: username.trim().toLowerCase(),
      recoveryCode: normaliseRecoveryCode(recoveryCode),
      newPassword,
    });
  };

  return (
    <main className="auth-screen">
      <aside className="auth-hero hidden md:flex flex-col justify-between p-9 md:p-11 bg-[var(--bg-sunken)] border-r border-[var(--line)]">
        <div className="flex items-center gap-2.5 font-serif italic text-[22px] text-[var(--ink)]">
          <span>Inkwell</span>
        </div>
        <blockquote className="font-serif italic text-[22px] leading-[1.5] text-[var(--ink-2)] max-w-[440px] m-0">
          “If you have your recovery code, your stories are still yours.”
          <cite className="block mt-3.5 font-sans not-italic text-[12px] text-[var(--ink-4)] tracking-[0.04em] uppercase">
            — inkwell handbook
          </cite>
        </blockquote>
        <div className="flex gap-2 font-mono text-[11px] text-[var(--ink-4)]">
          <span>Self-hosted · v0.4.2</span>
        </div>
      </aside>

      <div className="grid place-items-center p-9">
        <form
          onSubmit={handleSubmit}
          noValidate
          className="flex flex-col gap-4 w-full max-w-[380px]"
        >
          <h1 className="font-serif text-[28px] font-medium leading-tight tracking-[-0.01em] text-[var(--ink)] m-0">
            Reset your password
          </h1>
          <p className="text-[13px] text-[var(--ink-3)] leading-relaxed mb-2 m-0">
            Use the recovery code we showed you at signup to set a new password. All other sessions
            will be signed out.
          </p>

          <Field
            label="Username"
            htmlFor="rp-username"
            error={
              showUsernameError ? (
                <span id="rp-username-error" className="text-[12px] text-[var(--danger)] mt-0.5">
                  {usernameError}
                </span>
              ) : null
            }
          >
            <input
              id="rp-username"
              name="username"
              autoComplete="username"
              value={username}
              aria-invalid={showUsernameError}
              aria-describedby={showUsernameError ? 'rp-username-error' : undefined}
              onChange={(e) => setUsername(e.target.value)}
              onBlur={() => {
                setUsernameTouched(true);
                setUsername((prev) => prev.trim().toLowerCase());
              }}
              className={INPUT_CLASS}
            />
          </Field>

          <Field
            label="Recovery code"
            hint="Spaces and line breaks are fine."
            htmlFor="rp-recovery"
            error={
              showRecoveryError ? (
                <span id="rp-recovery-error" className="text-[12px] text-[var(--danger)] mt-0.5">
                  {recoveryError}
                </span>
              ) : null
            }
          >
            <textarea
              id="rp-recovery"
              name="recoveryCode"
              rows={3}
              value={recoveryCode}
              aria-invalid={showRecoveryError}
              aria-describedby={showRecoveryError ? 'rp-recovery-error' : undefined}
              onChange={(e) => setRecoveryCode(e.target.value)}
              onBlur={() => setRecoveryTouched(true)}
              className={`${INPUT_CLASS} resize-y leading-[1.5]`}
            />
          </Field>

          <Field
            label="New password"
            htmlFor="rp-pw"
            error={
              showPwError ? (
                <span id="rp-pw-error" className="text-[12px] text-[var(--danger)] mt-0.5">
                  {pwError}
                </span>
              ) : null
            }
          >
            <input
              id="rp-pw"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              aria-invalid={showPwError}
              aria-describedby={showPwError ? 'rp-pw-error' : undefined}
              onChange={(e) => setNewPassword(e.target.value)}
              onBlur={() => setPwTouched(true)}
              className={INPUT_CLASS}
            />
          </Field>

          <Field
            label="Confirm new password"
            htmlFor="rp-confirm"
            error={
              showConfirmError ? (
                <span id="rp-confirm-error" className="text-[12px] text-[var(--danger)] mt-0.5">
                  {confirmError}
                </span>
              ) : null
            }
          >
            <input
              id="rp-confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              aria-invalid={showConfirmError}
              aria-describedby={showConfirmError ? 'rp-confirm-error' : undefined}
              onChange={(e) => setConfirm(e.target.value)}
              onBlur={() => setConfirmTouched(true)}
              className={INPUT_CLASS}
            />
          </Field>

          {errorMessage ? (
            <div role="alert" className="auth-error">
              {errorMessage}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={submitDisabled}
            className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 mt-1 text-[13px] font-medium font-sans bg-[var(--ink)] text-[var(--bg)] rounded-[var(--radius)] hover:bg-[var(--ink-2)] disabled:opacity-70 disabled:cursor-default transition-colors"
          >
            {pending === true ? <span className="auth-spinner" aria-hidden="true" /> : null}
            <span>{pending === true ? 'Resetting…' : 'Reset password'}</span>
          </button>

          <p className="text-[12.5px] text-center text-[var(--ink-3)] font-sans m-0">
            <Link
              to="/login"
              className="text-[var(--ink)] underline underline-offset-2 font-medium"
            >
              Back to sign in
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}
