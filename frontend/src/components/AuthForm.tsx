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

export function AuthForm({ mode, onSubmit }: AuthFormProps): JSX.Element {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const usernameError = validateUsername(username);
  const passwordError = validatePassword(password);
  const showUsernameError = usernameTouched && usernameError !== null;
  const showPasswordError = passwordTouched && passwordError !== null;

  const formInvalid = usernameError !== null || passwordError !== null;
  const submitDisabled = formInvalid || pending;

  const heading = mode === 'login' ? 'Sign in' : 'Create account';
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
    <main className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
      <form
        onSubmit={handleSubmit}
        noValidate
        className="flex flex-col gap-4 w-full max-w-sm bg-white border border-neutral-200 rounded-lg shadow-sm p-6"
      >
        <h1 className="text-2xl font-semibold">{heading}</h1>

        <label htmlFor="auth-username" className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Username</span>
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
            className="border border-neutral-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {showUsernameError ? (
            <span id="auth-username-error" className="text-sm text-red-600">
              {usernameError}
            </span>
          ) : null}
        </label>

        <label htmlFor="auth-password" className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Password</span>
          <input
            id="auth-password"
            name="password"
            type="password"
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
            className="border border-neutral-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {showPasswordError ? (
            <span id="auth-password-error" className="text-sm text-red-600">
              {passwordError}
            </span>
          ) : null}
        </label>

        {formError ? (
          <p role="alert" className="text-sm text-red-600">
            {formError}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitDisabled}
          className="bg-blue-600 text-white rounded px-3 py-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
        >
          {submitLabel}
        </button>

        {mode === 'login' ? (
          <p className="text-sm text-neutral-600">
            No account?{' '}
            <Link to="/register" className="text-blue-600 hover:underline">
              Create one
            </Link>
          </p>
        ) : (
          <p className="text-sm text-neutral-600">
            Already have one?{' '}
            <Link to="/login" className="text-blue-600 hover:underline">
              Sign in
            </Link>
          </p>
        )}
      </form>
    </main>
  );
}
