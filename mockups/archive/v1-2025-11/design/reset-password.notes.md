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
   new password >= 8 chars (production) / >= 4 (dev), confirm must equal new.
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
