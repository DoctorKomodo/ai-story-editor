# Recovery-code handoff (addendum to auth.jsx)

Surfaced after a successful `POST /api/auth/register`. The original prototype
predates the envelope-encryption recovery-code flow ([AU9]/[E3]), so this
addendum extends the auth screen rather than replacing it.

## Layout
- Reuses the `.auth-screen` 50/50 split from `auth.jsx`: hero on the left
  (same brand, same quote slot but with a handbook-themed line), card on
  the right.
- Right-pane card is `.recovery-code-card` — same vertical rhythm as
  `.auth-card`, max-width 360px (matches `AuthForm.tsx`).
- The recovery-code value renders inside `.recovery-code-box` (mono,
  letter-spacing 0.05em, 14px line-height 1.5). Word-wrap on so a
  BIP-39-style 12-word code or a 32-char base32 string both render
  legibly without horizontal overflow.

## Behaviour rules (do not skip in implementation)
1. The "Continue to Inkwell" button is disabled until the checkbox is
   ticked. No keyboard shortcut bypasses this — Escape does nothing,
   Enter on the focused button is the only way forward.
2. There is no Back / Cancel. The signup transaction is already committed
   server-side; there is no useful "back" target. If the user closes the
   tab, the recovery code is irretrievable; that is the point.
3. Copy and Download both surface the same value verbatim — no formatting
   differences, no line-wrapping, no leading whitespace. The .txt
   download contains the username so the user knows which account it's
   for if they store multiple.
4. Copy feedback flashes "Copied" for ~2s then reverts. Download does
   not flash — the browser's own download UI is the feedback.
5. After "Continue", the page transitions back to a loading state while
   it issues `POST /api/auth/login` with the original credentials. On
   success → `/`. On failure (vanishingly rare — same creds we just
   registered with) → show the auth error inline and offer a "Sign in"
   link as a fallback.

## What we deliberately do NOT do
- Persist the code anywhere reachable by JS we can re-read (no localStorage,
  no sessionStorage, no IndexedDB, no service-worker cache).
- Render a "show again later" affordance.
- Send the code through any third-party service (no clipboard managers
  beyond the browser API, no email).
- Place this on a separate URL (e.g. `/recovery-code`). State-only on
  `/register` so it cannot be re-reached after the code falls out of memory.
