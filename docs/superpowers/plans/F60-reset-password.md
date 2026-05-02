# [F60] Forgot-password / Reset-with-Recovery-Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Forgot password?" link on the login screen that routes to a new `/reset-password` page where the user enters their username, their recovery code, and a new password (with confirmation). On success → navigate to `/login` and show a success banner; failure surfaces a generic "invalid credentials" message that does **not** leak whether the username exists.

**Architecture:**
- New route `/reset-password` rendered by a new `ResetPasswordPage` component using a new `ResetPasswordForm` (NOT a mode of the existing `AuthForm` — the field set is different and the submit semantics differ enough that bolting it onto `AuthForm` would obscure both flows).
- New thin API helper `resetPassword({ username, recoveryCode, newPassword })` in `frontend/src/lib/api.ts` style call. No new module — call `api()` directly from a hook in `useAuth.ts` (`resetPassword`) for consistency with `login` / `register`.
- Success → `Navigate('/login', { state: { resetSuccess: true } })`. The login page reads `location.state` and shows a one-time success banner above the form. No toast infrastructure needed — there is none in this app today and adding it for one banner is scope creep.
- The existing "Forgot password?" link is added to `AuthForm.tsx` only when `mode === 'login'`. It uses `<Link to="/reset-password">` from react-router.

**Decision points pinned in the plan:**
1. **No auto-login after reset.** The endpoint returns 204 and deletes all refresh tokens server-side. The user must type their new password again on `/login`. Reason: matches the security posture of the endpoint (it explicitly invalidates all sessions) and confirms the user actually remembers the new password. Reflected in the plan as a `Navigate` to `/login`, not a session-store mutation.
2. **Recovery-code input is a single multi-line textarea.** `[AU16]` accepts `recoveryCode: string` opaquely. The .txt download from F59 contains the code as a single line; users may paste from that file or transcribe by hand. A textarea handles both formats robustly. Whitespace is collapsed (`.replace(/\s+/g, ' ').trim()`) and case is preserved (the recovery code may be base32 with case-significant chars; the F59 code formatter writes it verbatim, so we don't lowercase). If `[E14]` later pins a word-list format, the input can be swapped without changing the API contract.
3. **Username is shown but not auto-filled from `/login`.** The user is on `/login` because they couldn't sign in; their last-typed username may be wrong (or might leak via the URL if we put it in a query param). Type it again. Inkwell is single-user for many self-hosters, so the friction is low.
4. **Generic 401 message.** Per the route comment in `backend/src/routes/auth.routes.ts:233-236`, the backend returns identical body + timing for "user not found" vs "wrong recovery code". The frontend mirrors that: the inline error never says "username not found" — only "Invalid username, recovery code, or both."

**Tech Stack:** React 18, TypeScript strict, Tailwind, react-router-dom v6 (`Navigate`, `Link`, `useNavigate`, `useLocation`), Vitest + Testing Library.

**Source-of-truth references:**
- Backend route: `backend/src/routes/auth.routes.ts:213-243` — `POST /api/auth/reset-password` returns 204 on success, 400 on Zod errors, 401 with `{ error: { message: 'Invalid credentials', code: 'invalid_credentials' } }` on user-not-found OR wrong recovery code (indistinguishable by design).
- Backend service: `backend/src/services/auth.service.ts:556-611` — `resetPassword` deletes all refresh tokens for the user.
- Existing AuthForm pattern: `frontend/src/components/AuthForm.tsx` — validation rules to mirror (`USERNAME_PATTERN`, `PASSWORD_MIN`, error mapping via `ApiError`).
- LoginPage: `frontend/src/pages/LoginPage.tsx` — minimal shell; we add a banner without rewriting it.
- Router: `frontend/src/router.tsx` — adds `/reset-password` route alongside `/login` and `/register`.
- Mockup convention: `mockups/archive/v1-2025-11/design/auth.jsx` — design-first sibling.

---

## File Structure

**Create:**
- `mockups/archive/v1-2025-11/design/reset-password.jsx` — JSX reference for the reset page (matches `auth.jsx` style)
- `mockups/archive/v1-2025-11/design/reset-password.notes.md` — addendum spec
- `frontend/src/components/ResetPasswordForm.tsx` — presentational form (username, recovery-code textarea, new-password, confirm-password)
- `frontend/src/pages/ResetPasswordPage.tsx` — page wiring (reads `useAuth.resetPassword`, navigates on success)
- `frontend/tests/components/ResetPasswordForm.test.tsx` — unit tests for validation, error mapping, and submit
- `frontend/tests/pages/reset-password.test.tsx` — page-level test (the verify-command target)

**Modify:**
- `frontend/src/components/AuthForm.tsx` — add a "Forgot password?" link visible only when `mode === 'login'`. Insert it between the "No account?" footer block and the auth-meta line. No change to login behaviour.
- `frontend/src/hooks/useAuth.ts` — add a `resetPassword({ username, recoveryCode, newPassword }) => Promise<void>` callback. Does NOT call `setSession` — the endpoint returns 204, no token.
- `frontend/src/pages/LoginPage.tsx` — read `useLocation().state?.resetSuccess` and render a one-time success banner above the form. Clear `location.state` on dismissal (or accept that React-router replaces state on next navigation; the banner stays until the user navigates away, which is fine).
- `frontend/src/router.tsx` — add `<Route path="/reset-password" element={<ResetPasswordPage />} />` alongside the existing public routes.

**Modify (tests):**
- `frontend/tests/pages/auth.test.tsx` — add a small assertion that the login page renders a "Forgot password?" link pointing at `/reset-password`. The existing tests are otherwise unchanged.

**Not touched:**
- Backend (`backend/src/routes/auth.routes.ts`, `backend/src/services/auth.service.ts`) — already shipped under [AU16].
- `frontend/src/store/session.ts` — reset does not authenticate.
- `frontend/src/lib/api.ts` — no new helper needed; call via `api<void>('/auth/reset-password', ...)`.

---

## Task 1: Mockup the reset-password screen (design-first prerequisite)

**Files:**
- Create: `mockups/archive/v1-2025-11/design/reset-password.jsx`
- Create: `mockups/archive/v1-2025-11/design/reset-password.notes.md`

The original prototype's `auth.jsx` does not show a reset flow. Per the F-series header, mock first.

- [ ] **Step 1: Write the mockup JSX**

Create `mockups/archive/v1-2025-11/design/reset-password.jsx`:

```jsx
// Reset-password screen — reached via "Forgot password?" on the login page.
// Reuses .auth-screen / .auth-hero from auth.jsx; the right-pane card is
// the recovery-code input + new password.

function ResetPasswordScreen({ onSubmit }) {
  const [username, setUsername] = React.useState("");
  const [recoveryCode, setRecoveryCode] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [showPw, setShowPw] = React.useState(false);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const submit = (e) => {
    e.preventDefault();
    setError("");
    if (!username.trim()) return setError("Username required.");
    if (!recoveryCode.trim()) return setError("Recovery code required.");
    if (newPassword.length < 8) return setError("Password must be at least 8 characters.");
    if (newPassword !== confirm) return setError("Passwords do not match.");
    setBusy(true);
    setTimeout(() => { setBusy(false); onSubmit(); }, 600);
  };

  return (
    <div className="auth-screen">
      <aside className="auth-hero">
        <div className="auth-brand">
          <FeatherIcon />
          <span>Inkwell</span>
        </div>
        <blockquote className="auth-quote">
          "If you have your recovery code, your stories are still yours."
          <cite>— inkwell handbook</cite>
        </blockquote>
        <div className="auth-foot">
          <span>Self-hosted · v0.4.2</span>
        </div>
      </aside>

      <div className="auth-pane">
        <form className="auth-card" onSubmit={submit}>
          <h1 className="auth-title">Reset your password</h1>
          <p className="auth-sub">
            Use the recovery code we showed you at signup to set a new password.
            All other sessions will be signed out.
          </p>

          <Field label="Username">
            <input className="text-input" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} autoFocus />
          </Field>

          <Field label="Recovery code" hint="The code we showed you at signup. Spaces and line breaks are fine.">
            <textarea className="text-input mono" rows="3" value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value)} />
          </Field>

          <Field label="New password">
            <div className="pw-row">
              <input className="text-input" type={showPw ? "text" : "password"} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              <button type="button" className="icon-btn" onClick={() => setShowPw(v => !v)}>{showPw ? <EyeOffIcon /> : <EyeIcon />}</button>
            </div>
          </Field>

          <Field label="Confirm new password">
            <input className="text-input" type={showPw ? "text" : "password"} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>

          {error && <div className="auth-error" role="alert">{error}</div>}

          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? <span className="auth-spinner" /> : null}
            <span>Reset password</span>
          </button>

          <p className="auth-link-row">
            <a href="/login">Back to sign in</a>
          </p>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the addendum**

Create `mockups/archive/v1-2025-11/design/reset-password.notes.md`:

```markdown
# Reset password (addendum to auth.jsx)

Reached from the "Forgot password?" link on the login screen. Calls
`POST /api/auth/reset-password` ([AU16]) and on success returns the user
to /login with a one-time success banner.

## Layout
- Reuses `.auth-screen` 50/50 split; right-pane card is `.auth-card` style
  (same vertical rhythm as login/register, max-width 360px).
- Field order: username, recovery code (textarea, mono, 3 rows), new password,
  confirm new password.
- The recovery-code field uses `.text-input.mono` so a pasted .txt body wraps
  legibly. Visible label + hint: "Spaces and line breaks are fine."

## Behaviour rules (do not skip in implementation)
1. Client-side validation mirrors AuthForm: username matches `/^[a-z0-9_-]{3,32}$/`,
   new password ≥ 8 chars (production) / ≥ 4 (dev), confirm must equal new.
2. Recovery-code field accepts any whitespace; the page collapses runs of
   whitespace to a single space and trims before submit. Case is preserved
   (the format may be case-sensitive base32; F59's .txt download writes it
   verbatim).
3. The submit button is disabled when (a) any field is empty, (b) any field
   has a current validation error, or (c) the request is in flight.
4. On 401 from the server, the inline error reads exactly:
   "Invalid username, recovery code, or both." It must NOT say "username not
   found" — the backend deliberately makes those two cases indistinguishable.
5. On 400 (Zod), surface the server's message verbatim (it's a developer
   error if Zod rejects what the client thought was valid; surfacing the
   message helps diagnosis without leaking anything sensitive).
6. On 429, show "Too many attempts. Try again in a minute."
7. On any other status (5xx, network), show "Something went wrong. Please
   try again."
8. On success, `Navigate('/login', { replace: true, state: { resetSuccess: true } })`
   so Back doesn't return to /reset-password.
9. There is no "remember me" / "save form" / autosave for this page. If the
   user navigates away mid-flow, the values are gone. Recovery codes are
   sensitive — do not persist.

## What we deliberately do NOT do
- Auto-fill the username from the previous failed login (no query param,
  no localStorage). The user types it again.
- Auto-login after success. The endpoint deliberately invalidates all
  refresh tokens; the user signs in fresh.
- Prefill the recovery-code field from a clipboard read. The browser would
  prompt; do not.
- Surface a "Resend recovery code" affordance. The recovery code is shown
  once at signup and only the user has it. Implementing a resend would
  require server-side recovery state, which we explicitly do not have.
```

- [ ] **Step 3: Commit**

```bash
git add mockups/archive/v1-2025-11/design/reset-password.jsx \
       mockups/archive/v1-2025-11/design/reset-password.notes.md
git commit -m "[F60] mockup: reset-password screen"
```

---

## Task 2: Add `resetPassword` to `useAuth`

**Files:**
- Modify: `frontend/src/hooks/useAuth.ts`

- [ ] **Step 1: Update the `UseAuthResult` interface**

Edit `frontend/src/hooks/useAuth.ts:19-25`:

```ts
export interface ResetPasswordInput {
  username: string;
  recoveryCode: string;
  newPassword: string;
}

export interface UseAuthResult {
  user: SessionUser | null;
  status: ReturnType<typeof useSessionStore.getState>['status'];
  login: (creds: Credentials) => Promise<SessionUser>;
  register: (creds: Credentials) => Promise<RegisterResult>;
  logout: () => Promise<void>;
  resetPassword: (input: ResetPasswordInput) => Promise<void>;
}
```

(`RegisterResult` is the F59 export — already in this file by the time F60 starts.)

- [ ] **Step 2: Add the callback inside `useAuth()`**

Insert after the `register` callback (around line 94):

```ts
const resetPassword = useCallback(
  async ({ username, recoveryCode, newPassword }: ResetPasswordInput): Promise<void> => {
    // Backend returns 204 with no body — do NOT call setSession. The user
    // must re-authenticate on /login after this resolves.
    await api<void>('/auth/reset-password', {
      method: 'POST',
      body: { username, recoveryCode, newPassword },
    });
  },
  [],
);
```

And include it in the returned object:

```ts
return { user, status, login, register, logout, resetPassword };
```

- [ ] **Step 3: Verify the file compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: PASS — no test fails because no test consumes `resetPassword` yet. Type-only change is intentional at this stage.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/useAuth.ts
git commit -m "[F60] useAuth: add resetPassword callback"
```

---

## Task 3: Build `<ResetPasswordForm>` (presentational)

**Files:**
- Create: `frontend/src/components/ResetPasswordForm.tsx`
- Create: `frontend/tests/components/ResetPasswordForm.test.tsx`

The component owns its own state. The page wraps it with the actual `resetPassword` mutation.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/components/ResetPasswordForm.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ResetPasswordForm } from '@/components/ResetPasswordForm';

describe('<ResetPasswordForm>', () => {
  function setup(overrides: Partial<React.ComponentProps<typeof ResetPasswordForm>> = {}) {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ResetPasswordForm onSubmit={onSubmit} {...overrides} />);
    return { onSubmit };
  }

  it('renders the four required fields and the submit button', () => {
    setup();
    expect(screen.getByRole('heading', { name: /reset your password/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^username$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/recovery code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^new password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm new password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset password/i })).toBeInTheDocument();
  });

  it('disables submit until all fields are valid', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    const submit = screen.getByRole('button', { name: /reset password/i });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/^username$/i), 'alice');
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(/recovery code/i), 'horse-battery-staple');
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(/^new password$/i), 'hunter2hunter2');
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(/confirm new password/i), 'hunter2hunter2');
    expect(submit).not.toBeDisabled();

    await user.click(submit);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('shows "Passwords do not match" when confirm differs from newPassword', async () => {
    const user = userEvent.setup();
    setup();

    await user.type(screen.getByLabelText(/^username$/i), 'alice');
    await user.type(screen.getByLabelText(/recovery code/i), 'horse-battery-staple');
    await user.type(screen.getByLabelText(/^new password$/i), 'hunter2hunter2');
    await user.type(screen.getByLabelText(/confirm new password/i), 'different');
    await user.tab();

    expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset password/i })).toBeDisabled();
  });

  it('rejects a username that violates /^[a-z0-9_-]{3,32}$/', async () => {
    const user = userEvent.setup();
    setup();

    await user.type(screen.getByLabelText(/^username$/i), 'BadName!');
    await user.tab();

    const usernameInput = screen.getByLabelText(/^username$/i);
    expect(usernameInput).toHaveAttribute('aria-invalid', 'true');
  });

  it('rejects a new password shorter than 8 characters', async () => {
    const user = userEvent.setup();
    setup();

    await user.type(screen.getByLabelText(/^new password$/i), 'short');
    await user.tab();

    const pwInput = screen.getByLabelText(/^new password$/i);
    expect(pwInput).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/at least 8/i)).toBeInTheDocument();
  });

  it('collapses whitespace and trims the recovery code before passing it to onSubmit', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.type(screen.getByLabelText(/^username$/i), 'alice');
    // userEvent.type doesn't insert literal newlines — paste instead.
    await user.click(screen.getByLabelText(/recovery code/i));
    await user.paste('  horse-battery\n  staple   correct  \n');
    await user.type(screen.getByLabelText(/^new password$/i), 'hunter2hunter2');
    await user.type(screen.getByLabelText(/confirm new password/i), 'hunter2hunter2');
    await user.click(screen.getByRole('button', { name: /reset password/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      username: 'alice',
      recoveryCode: 'horse-battery staple correct',
      newPassword: 'hunter2hunter2',
    });
  });

  it('lowercases and trims the username before passing it to onSubmit', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.type(screen.getByLabelText(/^username$/i), '  Alice  ');
    await user.tab();
    await user.type(screen.getByLabelText(/recovery code/i), 'horse-battery-staple');
    await user.type(screen.getByLabelText(/^new password$/i), 'hunter2hunter2');
    await user.type(screen.getByLabelText(/confirm new password/i), 'hunter2hunter2');
    await user.click(screen.getByRole('button', { name: /reset password/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      username: 'alice',
      recoveryCode: 'horse-battery-staple',
      newPassword: 'hunter2hunter2',
    });
  });

  it('renders a server error passed via the errorMessage prop', () => {
    setup({ errorMessage: 'Invalid username, recovery code, or both.' });
    expect(screen.getByRole('alert')).toHaveTextContent(/invalid username, recovery code/i);
  });

  it('shows the pending label while pending=true and disables submit', () => {
    setup({ pending: true });
    const submit = screen.getByRole('button', { name: /resetting/i });
    expect(submit).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend && npm run test:frontend -- --run tests/components/ResetPasswordForm.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Create `frontend/src/components/ResetPasswordForm.tsx`:

```tsx
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
            Use the recovery code we showed you at signup to set a new password.
            All other sessions will be signed out.
          </p>

          <Field label="Username" htmlFor="rp-username">
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
            {showUsernameError ? (
              <span id="rp-username-error" className="text-[12px] text-[var(--danger)] mt-0.5">
                {usernameError}
              </span>
            ) : null}
          </Field>

          <Field
            label="Recovery code"
            hint="Spaces and line breaks are fine."
            htmlFor="rp-recovery"
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
            {showRecoveryError ? (
              <span id="rp-recovery-error" className="text-[12px] text-[var(--danger)] mt-0.5">
                {recoveryError}
              </span>
            ) : null}
          </Field>

          <Field label="New password" htmlFor="rp-pw">
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
            {showPwError ? (
              <span id="rp-pw-error" className="text-[12px] text-[var(--danger)] mt-0.5">
                {pwError}
              </span>
            ) : null}
          </Field>

          <Field label="Confirm new password" htmlFor="rp-confirm">
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
            {showConfirmError ? (
              <span id="rp-confirm-error" className="text-[12px] text-[var(--danger)] mt-0.5">
                {confirmError}
              </span>
            ) : null}
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
            <Link to="/login" className="text-[var(--ink)] underline underline-offset-2 font-medium">
              Back to sign in
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd frontend && npm run test:frontend -- --run tests/components/ResetPasswordForm.test.tsx
```

Expected: PASS (all 9 tests).

The `<Link>` component in this presentational form requires the test to wrap in a router. Add this top-level wrapper to the test file's `render` call:

```tsx
import { MemoryRouter } from 'react-router-dom';
// ...
render(
  <MemoryRouter>
    <ResetPasswordForm onSubmit={onSubmit} {...overrides} />
  </MemoryRouter>,
);
```

(Apply this to the `setup()` helper at the top of the test file before running. The plan tests above assume this wrapping; add it now if you wrote the test as-shown without it.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ResetPasswordForm.tsx \
       frontend/tests/components/ResetPasswordForm.test.tsx
git commit -m "[F60] component: <ResetPasswordForm> with normalisation + validation"
```

---

## Task 4: Build `ResetPasswordPage` and route + page test

**Files:**
- Create: `frontend/src/pages/ResetPasswordPage.tsx`
- Create: `frontend/tests/pages/reset-password.test.tsx`
- Modify: `frontend/src/router.tsx`

- [ ] **Step 1: Add the route**

Edit `frontend/src/router.tsx`. Above the existing `/register` route line, add the import:

```ts
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
```

Inside `<Routes>`, after `<Route path="/register" .../>`, add:

```tsx
<Route path="/reset-password" element={<ResetPasswordPage />} />
```

- [ ] **Step 2: Write the failing page test**

Create `frontend/tests/pages/reset-password.test.tsx`:

```tsx
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetApiClientForTests, setUnauthorizedHandler } from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';
import { AppRouter } from '@/router';
import { useSessionStore } from '@/store/session';

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

function renderAt(path: string): ReturnType<typeof render> {
  const client = createQueryClient();
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRouter queryClient={client} />
    </MemoryRouter>,
  );
}

function primeUnauthenticatedInit(fetchMock: FetchMock): void {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
}

describe('reset-password (F60)', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    resetApiClientForTests();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setUnauthorizedHandler(() => {
      useSessionStore.getState().clearSession();
    });
    useSessionStore.setState({ user: null, status: 'idle' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    act(() => {
      useSessionStore.setState({ user: null, status: 'idle' });
    });
  });

  it('renders the form at /reset-password and links back to /login', async () => {
    primeUnauthenticatedInit(fetchMock);
    renderAt('/reset-password');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /reset your password/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute('href', '/login');
  });

  it('login page exposes a Forgot password? link pointing at /reset-password', async () => {
    primeUnauthenticatedInit(fetchMock);
    renderAt('/login');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: /forgot password\?/i })).toHaveAttribute(
      'href',
      '/reset-password',
    );
  });

  it('successful reset POSTs the normalised body, redirects to /login, and shows the success banner', async () => {
    primeUnauthenticatedInit(fetchMock);
    fetchMock.mockResolvedValueOnce(emptyResponse(204));

    const user = userEvent.setup();
    renderAt('/reset-password');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /reset your password/i })).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/^username$/i), 'alice');
    await user.click(screen.getByLabelText(/recovery code/i));
    await user.paste('  horse-battery\n  staple   correct  ');
    await user.type(screen.getByLabelText(/^new password$/i), 'hunter2hunter2');
    await user.type(screen.getByLabelText(/confirm new password/i), 'hunter2hunter2');
    await user.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    });

    const call = fetchMock.mock.calls.find(([url]: [string]) => url === '/api/auth/reset-password');
    expect(call).toBeDefined();
    const [, init] = call as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(
      JSON.stringify({
        username: 'alice',
        recoveryCode: 'horse-battery staple correct',
        newPassword: 'hunter2hunter2',
      }),
    );

    expect(
      screen.getByRole('status', { name: /password reset/i }) ||
        screen.getByText(/password updated/i),
    ).toBeInTheDocument();
  });

  it('on 401 shows the generic "invalid username, recovery code, or both" error and stays on the page', async () => {
    primeUnauthenticatedInit(fetchMock);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, {
        error: { message: 'Invalid credentials', code: 'invalid_credentials' },
      }),
    );

    const user = userEvent.setup();
    renderAt('/reset-password');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /reset your password/i })).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/^username$/i), 'alice');
    await user.type(screen.getByLabelText(/recovery code/i), 'wrong-code');
    await user.type(screen.getByLabelText(/^new password$/i), 'hunter2hunter2');
    await user.type(screen.getByLabelText(/confirm new password/i), 'hunter2hunter2');
    await user.click(screen.getByRole('button', { name: /reset password/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/invalid username, recovery code, or both/i);
    expect(alert.textContent).not.toMatch(/not found/i);
    expect(alert.textContent).not.toMatch(/exists/i);
    expect(screen.getByRole('heading', { name: /reset your password/i })).toBeInTheDocument();
  });

  it('on 429 shows a rate-limit message', async () => {
    primeUnauthenticatedInit(fetchMock);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(429, { error: { message: 'Too Many Requests', code: 'rate_limited' } }),
    );

    const user = userEvent.setup();
    renderAt('/reset-password');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /reset your password/i })).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/^username$/i), 'alice');
    await user.type(screen.getByLabelText(/recovery code/i), 'foo');
    await user.type(screen.getByLabelText(/^new password$/i), 'hunter2hunter2');
    await user.type(screen.getByLabelText(/confirm new password/i), 'hunter2hunter2');
    await user.click(screen.getByRole('button', { name: /reset password/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/too many attempts/i);
  });

  it('on 5xx / network shows a generic try-again message', async () => {
    primeUnauthenticatedInit(fetchMock);
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const user = userEvent.setup();
    renderAt('/reset-password');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /reset your password/i })).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/^username$/i), 'alice');
    await user.type(screen.getByLabelText(/recovery code/i), 'foo');
    await user.type(screen.getByLabelText(/^new password$/i), 'hunter2hunter2');
    await user.type(screen.getByLabelText(/confirm new password/i), 'hunter2hunter2');
    await user.click(screen.getByRole('button', { name: /reset password/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/something went wrong/i);
  });

  it('an authenticated user redirected to /reset-password sees the form (not a redirect to /)', async () => {
    // Prime init to succeed: refresh OK then /auth/me.
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { accessToken: 'tok-1' }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { user: { id: 'u1', username: 'alice' } }),
    );
    renderAt('/reset-password');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /reset your password/i })).toBeInTheDocument();
    });
  });

  it('does not persist any form values in localStorage / sessionStorage', async () => {
    primeUnauthenticatedInit(fetchMock);
    fetchMock.mockResolvedValueOnce(emptyResponse(204));

    const user = userEvent.setup();
    renderAt('/reset-password');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /reset your password/i })).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/^username$/i), 'alice');
    await user.type(screen.getByLabelText(/recovery code/i), 'horse-battery-staple');
    await user.type(screen.getByLabelText(/^new password$/i), 'hunter2hunter2');
    await user.type(screen.getByLabelText(/confirm new password/i), 'hunter2hunter2');

    expect(JSON.stringify({ ...localStorage })).not.toContain('horse-battery');
    expect(JSON.stringify({ ...localStorage })).not.toContain('hunter2hunter2');
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('horse-battery');
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('hunter2hunter2');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd frontend && npm run test:frontend -- --run tests/pages/reset-password.test.tsx
```

Expected: FAIL — page module not found, route not registered, login page lacks the link.

- [ ] **Step 4: Write the page**

Create `frontend/src/pages/ResetPasswordPage.tsx`:

```tsx
import type { JSX } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ResetPasswordForm,
  type ResetPasswordFormValues,
} from '@/components/ResetPasswordForm';
import { useAuth } from '@/hooks/useAuth';
import { ApiError } from '@/lib/api';

const ERROR_INVALID_CREDS = 'Invalid username, recovery code, or both.';
const ERROR_RATE_LIMITED = 'Too many attempts. Try again in a minute.';
const ERROR_GENERIC = 'Something went wrong. Please try again.';

function mapResetError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return ERROR_INVALID_CREDS;
    if (err.status === 429) return ERROR_RATE_LIMITED;
    // 400 from Zod surfaces the server's message — useful for debugging
    // genuine bad requests, doesn't leak anything sensitive.
    if (err.status === 400) return err.message || ERROR_GENERIC;
    return ERROR_GENERIC;
  }
  return ERROR_GENERIC;
}

export function ResetPasswordPage(): JSX.Element {
  const { resetPassword } = useAuth();
  const navigate = useNavigate();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSubmit = async (values: ResetPasswordFormValues): Promise<void> => {
    setErrorMessage(null);
    setPending(true);
    try {
      await resetPassword(values);
      navigate('/login', { replace: true, state: { resetSuccess: true } });
    } catch (err) {
      setErrorMessage(mapResetError(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <ResetPasswordForm
      onSubmit={handleSubmit}
      errorMessage={errorMessage}
      pending={pending}
    />
  );
}
```

- [ ] **Step 5: Add the success banner to LoginPage**

Replace `frontend/src/pages/LoginPage.tsx`:

```tsx
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
```

- [ ] **Step 6: Add the "Forgot password?" link to AuthForm**

Edit `frontend/src/components/AuthForm.tsx`. Find the block (currently around line 312-321):

```tsx
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
```

Replace the login branch with:

```tsx
{mode === 'login' ? (
  <>
    <p className="text-[12.5px] text-center text-[var(--ink-3)] font-sans m-0">
      <Link
        to="/reset-password"
        className="text-[var(--ink-3)] underline underline-offset-2"
      >
        Forgot password?
      </Link>
    </p>
    <p className="text-[12.5px] text-center text-[var(--ink-3)] font-sans m-0">
      No account?{' '}
      <Link
        to="/register"
        className="text-[var(--ink)] underline underline-offset-2 font-medium"
      >
        Create one
      </Link>
    </p>
  </>
) : (
```

(Leave the `register` branch unchanged. The `</>` closes the login branch wrapper.)

- [ ] **Step 7: Run the page tests to verify they pass**

```bash
cd frontend && npm run test:frontend -- --run tests/pages/reset-password.test.tsx
```

Expected: PASS (all 8 tests).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/ResetPasswordPage.tsx \
       frontend/src/pages/LoginPage.tsx \
       frontend/src/components/AuthForm.tsx \
       frontend/src/router.tsx \
       frontend/tests/pages/reset-password.test.tsx
git commit -m "[F60] page: /reset-password + login banner + forgot-password link"
```

---

## Task 5: Surrounding test guard

**Files:**
- Modify: `frontend/tests/pages/auth.test.tsx`

The existing F4 auth test does not assert the presence of the new "Forgot password?" link. Add one assertion so a future edit that removes it fails loudly.

- [ ] **Step 1: Add the assertion**

Find the test `'login page renders username and password fields'` in `frontend/tests/pages/auth.test.tsx`. After its existing assertions, add:

```tsx
expect(
  screen.getByRole('link', { name: /forgot password\?/i }),
).toHaveAttribute('href', '/reset-password');
```

- [ ] **Step 2: Run it to verify it passes**

```bash
cd frontend && npm run test:frontend -- --run tests/pages/auth.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/tests/pages/auth.test.tsx
git commit -m "[F60] auth.test: assert forgot-password link on login"
```

---

## Task 6: Verify and tick

- [ ] **Step 1: Run the task's exact verify command**

```bash
/task-verify F60
```

Or directly:

```bash
cd frontend && npm run test:frontend -- --run tests/pages/reset-password.test.tsx
```

Expected: exit code 0.

- [ ] **Step 2: Run the surrounding suites**

```bash
cd frontend && npm run test:frontend -- --run \
  tests/pages/auth.test.tsx \
  tests/pages/reset-password.test.tsx \
  tests/components/ResetPasswordForm.test.tsx
```

Expected: all green.

- [ ] **Step 3: Manual smoke (per CLAUDE.md UI rule)**

```bash
make dev
```

In a browser:
1. Visit http://localhost:3000/login. Confirm "Forgot password?" link is visible and links to `/reset-password`.
2. Click it. Confirm the reset form renders with all four fields, label rules match, the submit button is disabled until all fields are valid, and confirm-mismatch shows the inline error.
3. Use a real account: register a fresh user via `/register` (run F59 first if not done), copy the recovery code, sign out, then go to `/reset-password` and reset the password.
4. After success → confirm redirect to `/login` with the green-bannered "Password updated…" message visible at top centre.
5. Sign in with the new password — confirm the dashboard loads.
6. Try an invalid recovery code — confirm the generic 401 message ("Invalid username, recovery code, or both.") and that the page does not redirect.
7. Devtools → Application: confirm localStorage and sessionStorage hold none of the typed values.
8. Open the running session in another tab, then reset the password from the original tab. After the next request fires from the second tab, that tab should be redirected to `/login` (because the backend deleted all refresh tokens). This is the [AU16] "all sessions sign out" behaviour and is verified end-to-end by step 8.

If any step fails, fix the code and re-run.

- [ ] **Step 4: Tick `[F60]` in `TASKS.md`**

The pre-edit hook auto-ticks on verify pass. If not, change `- [ ] **[F60]**` to `- [x] **[F60]**` manually.

- [ ] **Step 5: Final commit**

```bash
git add TASKS.md
git commit -m "[F60] tick — reset-password flow complete"
```

---

## Self-Review Notes

- **Spec coverage:**
  - "Add a 'Forgot password?' link on the login screen" → Task 4 step 6, with a regression test in Task 5.
  - "Routes to `/reset-password`" → Task 4 step 1 router edit; tested in Task 4 step 2.
  - "Collects username + recovery code + new password (with confirmation)" → Task 3 component with full validation.
  - "On success, navigate to `/login` with a success toast" → Task 4 step 4 + 5; banner via `location.state.resetSuccess`. No toast library — inline banner because there's no toast infra to extend, and adding one for one banner would be scope creep.
  - "Surface clear failure copy for the recovery-code-mismatch case (DON'T leak whether the username exists)" → `ERROR_INVALID_CREDS = 'Invalid username, recovery code, or both.'` + tests asserting `not.toMatch(/not found/i)` and `not.toMatch(/exists/i)`.
  - "Mock the page first" → Task 1.
  - "verify: cd frontend && npm run test:frontend -- --run tests/pages/reset-password.test.tsx" → Task 4 step 2 creates exactly that file.

- **Implementation completeness check (no follow-up TBDs):**
  - Backend contract pinned: 204 on success, 401 generic, 429 from rate limiter, 400 from Zod. All four mapped in `mapResetError`.
  - Recovery-code normalisation is an explicit pure function (`normaliseRecoveryCode`) with a dedicated test.
  - No toast library — inline banner via `location.state`. Decision recorded in plan, no "wire up toast lib" TBD.
  - "All other sessions signed out" is a *backend* effect (refresh tokens deleted). The frontend doesn't need to do anything to make this work — any second tab will get a 401 on its next API call and the global `setUnauthorizedHandler` will clear that tab's session and redirect. No new code needed; just verified in the smoke list.
  - Authenticated user visiting `/reset-password` is allowed (test asserts this) — there is no auth guard on the public route, intentional: a logged-in user might still want to reset because they remember the recovery code but want a new password they can remember (the change-password route exists for the in-session case [AU15], but if the user lands here we don't redirect them away — we let them complete the flow, which will sign all sessions out).
  - `confirm.length === 0` is included in `formInvalid` so the submit button is disabled before the user has touched the confirm field. Without this, a user who fills the first three fields and then clicks submit would dispatch with an empty confirm; the validator would catch it but the UX would be worse.
  - The "Forgot password?" link uses a muted style (`text-[var(--ink-3)]`) deliberately weaker than "Create one" (`text-[var(--ink)]`) — the primary action on login is to sign in or register, not to reset. Pinned in the markup.

- **Type consistency:** `ResetPasswordInput` (hook) ↔ `ResetPasswordFormValues` (component) are structurally identical. They are kept as separate types so the form can be reused on a future "rotate-from-out-of-session" path without dragging in `useAuth`. If the engineer wants to dedupe, they can `export type ResetPasswordInput = ResetPasswordFormValues;` — the plan doesn't require this and the duplication is small.

- **Security checklist (mirror of `security-reviewer` concerns even though the backend is unchanged):**
  - No password / recovery-code logged in any code path the plan introduces.
  - No mutation persisted to localStorage / sessionStorage / IndexedDB / cookie; smoke step + automated test both check.
  - Generic 401 message; never says "username not found"; test asserts substrings.
  - Rate-limit message routed via the 429 branch; the user is told to wait, not given a count or a window.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/F60-reset-password.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks.

**2. Inline Execution** — run tasks in this session via `superpowers:executing-plans` with checkpoints.

Which approach?
