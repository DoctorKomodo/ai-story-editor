import type { JSX, ReactNode } from 'react';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Credentials } from '@/hooks/useAuth';
import { ApiError } from '@/lib/api';

export type AuthMode = 'login' | 'register';

export interface AuthFormProps {
  mode: AuthMode;
  onSubmit: (creds: Credentials) => Promise<unknown>;
}

const USERNAME_PATTERN = /^[a-z0-9_-]+$/;
const USERNAME_MIN = 3;
const USERNAME_MAX = 32;
const PASSWORD_MIN = 8;

const USERNAME_ERROR =
  'Username must be 3–32 characters, lowercase letters, numbers, underscores, or hyphens.';
const PASSWORD_ERROR = `Password must be at least ${String(PASSWORD_MIN)} characters.`;

function validateUsername(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (value.length < USERNAME_MIN || value.length > USERNAME_MAX) return USERNAME_ERROR;
  if (!USERNAME_PATTERN.test(value)) return USERNAME_ERROR;
  return null;
}

function validatePassword(raw: string): string | null {
  if (raw.length < PASSWORD_MIN) return PASSWORD_ERROR;
  return null;
}

function mapSubmitError(mode: AuthMode, err: unknown): string {
  if (err instanceof ApiError) {
    if (mode === 'login' && err.status === 401) return 'Invalid username or password';
    if (mode === 'register' && err.status === 409) return 'Username is already taken';
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return mode === 'login' ? 'Login failed' : 'Registration failed';
}

/* Inline SVG icons — kept local to avoid pulling in a new dependency. */
function FeatherIcon(): JSX.Element {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />
      <line x1="16" y1="8" x2="2" y2="22" />
      <line x1="17.5" y1="15" x2="9" y2="15" />
    </svg>
  );
}

function EyeIcon(): JSX.Element {
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
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon(): JSX.Element {
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
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a19.79 19.79 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a19.79 19.79 0 0 1-3.16 4.19" />
      <path d="M14.12 14.12A3 3 0 1 1 9.88 9.88" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function ShieldIcon(): JSX.Element {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  htmlFor: string;
  children: ReactNode;
}

function Field({ label, hint, htmlFor, children }: FieldProps): JSX.Element {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-1.5">
      <span className="flex justify-between items-baseline gap-2 text-[12px] font-medium font-sans text-[var(--ink-2)]">
        <span>{label}</span>
        {hint ? <span className="text-[11px] font-normal text-[var(--ink-4)]">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

const INPUT_CLASS =
  'w-full px-2.5 py-2 text-[13.5px] font-mono bg-[var(--bg-elevated)] ' +
  'border border-[var(--line-2)] rounded-[var(--radius)] text-[var(--ink)] ' +
  'placeholder:text-[var(--ink-4)] ' +
  'focus:outline-none focus:border-[var(--ink-3)] transition-colors';

export function AuthForm({ mode, onSubmit }: AuthFormProps): JSX.Element {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const usernameError = validateUsername(username);
  const passwordError = validatePassword(password);
  const showUsernameError = usernameTouched && usernameError !== null;
  const showPasswordError = passwordTouched && passwordError !== null;

  const formInvalid = usernameError !== null || passwordError !== null;
  const submitDisabled = formInvalid || pending;

  // F4-test asserts these exact heading strings: keep them.
  const heading = mode === 'login' ? 'Sign in' : 'Create account';
  const subtitle =
    mode === 'login'
      ? 'Sign in to continue your stories.'
      : 'A single account holds all your drafts, chapters, and characters.';
  const submitLabel =
    mode === 'login'
      ? pending
        ? 'Signing in…'
        : 'Sign in'
      : pending
        ? 'Creating…'
        : 'Create account';
  const passwordAutoComplete = mode === 'login' ? 'current-password' : 'new-password';

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setUsernameTouched(true);
    setPasswordTouched(true);
    setFormError(null);
    if (formInvalid) return;

    setPending(true);
    try {
      await onSubmit({ username: username.trim().toLowerCase(), password });
    } catch (err) {
      setFormError(mapSubmitError(mode, err));
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="auth-screen">
      <aside className="auth-hero hidden md:flex flex-col justify-between p-9 md:p-11 bg-[var(--bg-sunken)] border-r border-[var(--line)]">
        <div className="flex items-center gap-2.5 font-serif italic text-[22px] text-[var(--ink)]">
          <FeatherIcon />
          <span>Inkwell</span>
        </div>
        <blockquote className="font-serif italic text-[22px] leading-[1.5] text-[var(--ink-2)] max-w-[440px] m-0">
          “A story is a letter the writer writes to themself, to tell themself things they would be
          unable to confront in plain speech.”
          <cite className="block mt-3.5 font-sans not-italic text-[12px] text-[var(--ink-4)] tracking-[0.04em] uppercase">
            — stray marginalia
          </cite>
        </blockquote>
        <div className="flex gap-2 font-mono text-[11px] text-[var(--ink-4)]">
          <span>Self-hosted · v0.4.2</span>
          <span>·</span>
          <span>inkwell-01</span>
        </div>
      </aside>

      <div className="grid place-items-center p-9">
        <form
          onSubmit={handleSubmit}
          noValidate
          className="flex flex-col gap-4 w-full max-w-[360px]"
        >
          <h1 className="font-serif text-[28px] font-medium leading-tight tracking-[-0.01em] text-[var(--ink)] m-0">
            {heading}
          </h1>
          <p className="text-[13px] text-[var(--ink-3)] leading-relaxed mb-2 m-0">{subtitle}</p>

          <Field
            label="Username"
            hint={mode === 'register' ? 'Used to sign in. Lowercase, no spaces.' : undefined}
            htmlFor="auth-username"
          >
            <input
              id="auth-username"
              name="username"
              autoComplete="username"
              value={username}
              aria-invalid={showUsernameError}
              aria-describedby={showUsernameError ? 'auth-username-error' : undefined}
              onChange={(e) => {
                setUsername(e.target.value);
                if (formError) setFormError(null);
              }}
              onBlur={() => {
                setUsernameTouched(true);
                setUsername((prev) => prev.trim().toLowerCase());
              }}
              className={INPUT_CLASS}
            />
            {showUsernameError ? (
              <span id="auth-username-error" className="text-[12px] text-[var(--danger)] mt-0.5">
                {usernameError}
              </span>
            ) : null}
          </Field>

          <Field label="Password" htmlFor="auth-password">
            <div className="flex gap-1.5 items-stretch">
              <input
                id="auth-password"
                name="password"
                type={showPw ? 'text' : 'password'}
                autoComplete={passwordAutoComplete}
                value={password}
                aria-invalid={showPasswordError}
                aria-describedby={showPasswordError ? 'auth-password-error' : undefined}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (formError) setFormError(null);
                }}
                onBlur={() => {
                  setPasswordTouched(true);
                }}
                className={`${INPUT_CLASS} flex-1`}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? 'Hide' : 'Show'}
                aria-pressed={showPw}
                title={showPw ? 'Hide' : 'Show'}
                className="inline-flex items-center justify-center w-7 h-7 self-center rounded-[var(--radius)] text-[var(--ink-3)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)] transition-colors"
              >
                {showPw ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
            {showPasswordError ? (
              <span id="auth-password-error" className="text-[12px] text-[var(--danger)] mt-0.5">
                {passwordError}
              </span>
            ) : null}
          </Field>

          {formError ? (
            <div role="alert" className="auth-error">
              {formError}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={submitDisabled}
            className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 mt-1 text-[13px] font-medium font-sans bg-[var(--ink)] text-[var(--bg)] rounded-[var(--radius)] hover:bg-[var(--ink-2)] disabled:opacity-70 disabled:cursor-default transition-colors"
          >
            {pending ? <span className="auth-spinner" aria-hidden="true" /> : null}
            <span>{submitLabel}</span>
          </button>

          {mode === 'login' ? (
            <p className="text-[12.5px] text-center text-[var(--ink-3)] font-sans m-0">
              No account?{' '}
              <Link
                to="/register"
                className="text-[var(--ink)] underline underline-offset-2 font-medium"
              >
                Create one
              </Link>
            </p>
          ) : (
            <p className="text-[12.5px] text-center text-[var(--ink-3)] font-sans m-0">
              Already have one?{' '}
              <Link
                to="/login"
                className="text-[var(--ink)] underline underline-offset-2 font-medium"
              >
                Sign in
              </Link>
            </p>
          )}

          <div className="auth-meta flex gap-1.5 items-center justify-center text-[11px] text-[var(--ink-4)] font-mono pt-2.5 mt-1.5">
            <ShieldIcon />
            <span>Authenticated against your self-hosted Inkwell server.</span>
          </div>
        </form>
      </div>
    </main>
  );
}
