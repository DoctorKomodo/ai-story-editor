# [F59] Recovery-Code Handoff at Signup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the one-time `recoveryCode` returned by `POST /api/auth/register` as a dedicated post-signup interstitial that the user must explicitly acknowledge ("I have stored this — continue") before they reach the dashboard. Provide copy-to-clipboard and download-as-`.txt` actions. Persist nothing client-side.

**Architecture:**
- Three pieces: (1) a mockup committed to `mockups/frontend-prototype/design/` per the **[design-first]** rule; (2) a presentational `<RecoveryCodeHandoff>` component that is reused unchanged by F61 (rotate-recovery-code); (3) a small state machine inside `RegisterPage` (`idle → showingRecoveryCode → loggingIn → done`) that holds the `recoveryCode` and the credentials used at signup in component state only — never in localStorage, sessionStorage, the session store, or React Query cache.
- The current backend contract is `POST /api/auth/register` → `201 { user, recoveryCode }` with **no** `accessToken` and **no** refresh cookie. The frontend currently destructures a non-existent `accessToken` and writes `undefined` into the session store — that path is broken and gets fixed as part of F59. After acknowledgement, the page calls `POST /api/auth/login` with the same credentials to obtain the access token + refresh cookie, then `setSession` and `Navigate('/')`.
- The interstitial is rendered as a full-screen view inside `RegisterPage`, **not** as a modal over the auth form. Reason: the user is not yet authenticated and there is no app shell to overlay; a full-screen view also makes accidental dismissal (clicking the backdrop) impossible. Escape is intentionally not wired to dismiss.

**Tech Stack:** React 18, TypeScript strict, Tailwind, Zustand (`useSessionStore`), TanStack Query (unused on this surface), Vitest + Testing Library, react-router-dom v6.

**Source-of-truth references:**
- Backend register handler: `backend/src/routes/auth.routes.ts:128-148`
- Auth hook (currently broken on register): `frontend/src/hooks/useAuth.ts:84-94`
- Auth form (`onSubmit` returns `Promise<unknown>`): `frontend/src/components/AuthForm.tsx:9-12`, `:182-197`
- Existing register page (will be rewritten): `frontend/src/pages/RegisterPage.tsx`
- Mockup styles + auth shell: `mockups/frontend-prototype/design/styles.css`, `mockups/frontend-prototype/design/auth.jsx`
- Design tokens already wired into `frontend/src/index.css` (`--ink`, `--ink-2`, `--ink-3`, `--ink-4`, `--bg`, `--bg-elevated`, `--bg-sunken`, `--line`, `--line-2`, `--surface-hover`, `--radius`, `--danger`, `--success` if present)
- TXT download utility (reused): `frontend/src/lib/downloadTxt.ts`

---

## File Structure

**Create:**
- `mockups/frontend-prototype/design/recovery-code-handoff.jsx` — JSX reference for the interstitial (not production code; matches the convention of `auth.jsx`, `editor.jsx`, etc.)
- `mockups/frontend-prototype/design/recovery-code-handoff.notes.md` — short addendum describing the surface (per the F-series header rule about addenda for screens not in the original prototype)
- `frontend/src/components/RecoveryCodeHandoff.tsx` — presentational component, no router awareness, no API awareness. Props in / events out.
- `frontend/tests/components/RecoveryCodeHandoff.test.tsx` — unit tests for the component (rendering, copy, download, gating behaviour)
- `frontend/tests/pages/recovery-code-handoff.test.tsx` — page-level test that drives the full register → interstitial → ack → login → dashboard flow (this is the verify-command target)

**Modify:**
- `frontend/src/hooks/useAuth.ts` — `register` returns `{ user, recoveryCode }` instead of `SessionUser`, and does **not** call `setSession`. The login helper stays as-is. Type widens: add `RegisterResult` and update `UseAuthResult.register`.
- `frontend/src/components/AuthForm.tsx` — `onSubmit` already returns `Promise<unknown>`; no signature change needed, but the register-mode caller in `RegisterPage` needs the credentials echoed back so it can re-use them for the post-ack login. Add an optional prop `onSubmitSuccess?: (creds: Credentials) => void` or have the page pass an `onSubmit` that captures the credentials before delegating to `register()`. Picked: the page wraps `register` and captures credentials locally, no AuthForm change required (keeps the form pure).
- `frontend/src/pages/RegisterPage.tsx` — rewrite as a stateful page that switches between `<AuthForm>` and `<RecoveryCodeHandoff>` based on local state.
- `frontend/src/index.css` — add a small `.recovery-code-screen` block for the layout pieces that don't express well as Tailwind utilities (mono code-card border, the warning-banner triangular accent), mirroring the existing `[F24] Auth screen` block (`frontend/src/index.css:140-220`).

**Tests modified:**
- `frontend/tests/pages/auth.test.tsx` — the F4 register test that asserts a redirect to `/` immediately after submission must be **updated** (not deleted): the post-submit destination is now the recovery-code interstitial, then redirect to `/` after acknowledgement. The existing "register-page validates + submits" test is rewritten to stop on the interstitial; a separate test in the new `recovery-code-handoff.test.tsx` covers the full happy path. The 409 "username already taken" test stays unchanged.

**Not touched:**
- Backend (`backend/src/routes/auth.routes.ts`, `backend/src/services/auth.service.ts`) — already returns `{ user, recoveryCode }` correctly.
- `frontend/src/store/session.ts` — the session store is only written after the post-ack login.
- `frontend/src/router.tsx` — no new route. The interstitial lives at `/register` (state-driven), not a separate path. Reason: a separate URL would let the user navigate directly back to it after the code is gone; keeping it state-driven on `/register` makes that impossible without re-registering.

---

## Task 1: Mockup the recovery-code interstitial (design-first prerequisite)

**Files:**
- Create: `mockups/frontend-prototype/design/recovery-code-handoff.jsx`
- Create: `mockups/frontend-prototype/design/recovery-code-handoff.notes.md`

The original prototype (`auth.jsx`) shows login/signup but not the recovery-code handoff. The F-series header requires a mockup for `[design-first]` tasks before the implementation plan starts coding.

- [ ] **Step 1: Write the mockup JSX**

Create `mockups/frontend-prototype/design/recovery-code-handoff.jsx` matching the existing prototype style (raw JSX, classnames from `styles.css`, no real React imports):

```jsx
// Recovery-code handoff — shown immediately after successful signup.
// Full-screen, no app chrome (the user is not yet logged in to the SPA).
// Mirrors the .auth-screen split layout but the right pane is the handoff card.

function RecoveryCodeHandoff({ recoveryCode, username, onContinue }) {
  const [copied, setCopied] = React.useState(false);
  const [confirmed, setConfirmed] = React.useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(recoveryCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const download = () => {
    const blob = new Blob(
      [`Inkwell recovery code\nUsername: ${username}\nRecovery code: ${recoveryCode}\n\nKeep this somewhere safe. Without it AND your password, your encrypted stories cannot be recovered.\n`],
      { type: "text/plain;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inkwell-recovery-code-${username}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="auth-screen">
      <aside className="auth-hero">
        <div className="auth-brand">
          <FeatherIcon />
          <span>Inkwell</span>
        </div>
        <blockquote className="auth-quote">
          "Keep this code somewhere only you can reach. It is the second of two
          locks on your stories — your password is the first."
          <cite>— inkwell handbook</cite>
        </blockquote>
        <div className="auth-foot">
          <span>Self-hosted · v0.4.2</span>
          <span>·</span>
          <span>inkwell-01</span>
        </div>
      </aside>

      <div className="auth-pane">
        <div className="recovery-code-card">
          <h1 className="auth-title">Save your recovery code</h1>
          <p className="auth-sub">
            This is the only thing that can unlock your stories if you forget your
            password. We will not show it again.
          </p>

          <div className="recovery-code-warning" role="note">
            <strong>Show once.</strong> Inkwell does not store this anywhere it can
            read. Lose your password and this code, and your stories are gone for good.
          </div>

          <div className="recovery-code-box" data-testid="recovery-code-box">
            <code>{recoveryCode}</code>
          </div>

          <div className="recovery-code-actions">
            <button type="button" className="btn-secondary" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" className="btn-secondary" onClick={download}>
              Download as .txt
            </button>
          </div>

          <label className="recovery-code-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>I have stored my recovery code somewhere safe.</span>
          </label>

          <button
            type="button"
            disabled={!confirmed}
            className="btn-primary"
            onClick={onContinue}
          >
            Continue to Inkwell
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the addendum note**

Create `mockups/frontend-prototype/design/recovery-code-handoff.notes.md`:

```markdown
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
```

- [ ] **Step 3: Commit the mockup**

```bash
git add mockups/frontend-prototype/design/recovery-code-handoff.jsx \
       mockups/frontend-prototype/design/recovery-code-handoff.notes.md
git commit -m "[F59] mockup: recovery-code handoff interstitial"
```

---

## Task 2: Widen `useAuth.register` to surface the recovery code

**Files:**
- Modify: `frontend/src/hooks/useAuth.ts:10-13, 19-25, 84-94`
- Modify: `frontend/tests/lib/...` (no existing test directly covers `useAuth.register` — covered transitively by the page test in Task 7)

The current `register` types its response as `AuthResponse = { user, accessToken }` and writes a `setSession(user, undefined)` because the backend never returns `accessToken` for `/auth/register`. We narrow this to the actual contract.

- [ ] **Step 1: Write the failing typecheck/test**

Update the existing F4 register test in `frontend/tests/pages/auth.test.tsx` (lines that mock register's response). Find the block:

```tsx
fetchMock.mockResolvedValueOnce(
  jsonResponse(200, { user: { id: 'u2', username: 'bob' }, accessToken: 'tok-2' }),
);
```

Replace with the real backend shape (and bump the status code to 201, which is what the backend returns):

```tsx
// Backend returns 201 with { user, recoveryCode } only — no accessToken,
// no refresh cookie. The page is responsible for the post-ack login.
fetchMock.mockResolvedValueOnce(
  jsonResponse(201, {
    user: { id: 'u2', username: 'bob' },
    recoveryCode: 'horse-battery-staple-correct-glow-mint-velvet-pearl-orbit-quiet-amber-crisp',
  }),
);
```

And replace the assertion that expects an immediate redirect to `/`:

```tsx
// Old:
//   await waitFor(() => {
//     expect(screen.getByRole('heading', { name: /your stories/i })).toBeInTheDocument();
//   });
// New: the user lands on the recovery-code interstitial.
await waitFor(() => {
  expect(
    screen.getByRole('heading', { name: /save your recovery code/i }),
  ).toBeInTheDocument();
});
expect(screen.getByText(/horse-battery-staple/)).toBeInTheDocument();
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend && npm run test:frontend -- --run tests/pages/auth.test.tsx
```

Expected: FAIL — the test expects the new heading, but the current page renders the dashboard heading. Will also fail typecheck on `recoveryCode` not being part of `AuthResponse` if the test stack runs `tsc`.

- [ ] **Step 3: Update the hook to return the recovery code**

Replace `frontend/src/hooks/useAuth.ts` lines 10-13:

```ts
interface LoginResponse {
  user: SessionUser;
  accessToken: string;
}

interface RegisterResponse {
  user: SessionUser;
  recoveryCode: string;
}

export interface RegisterResult {
  user: SessionUser;
  recoveryCode: string;
}
```

Replace `UseAuthResult.register` (line 23):

```ts
register: (creds: Credentials) => Promise<RegisterResult>;
```

Replace the `register` callback (lines 84-94):

```ts
const register = useCallback(
  async ({ username, password }: Credentials): Promise<RegisterResult> => {
    const res = await api<RegisterResponse>('/auth/register', {
      method: 'POST',
      body: { username, password },
    });
    // Intentionally do NOT call setSession — the backend has not issued an
    // access token or refresh cookie yet. The page must show the recovery
    // code, get acknowledgement, then call login() with the same creds.
    return { user: res.user, recoveryCode: res.recoveryCode };
  },
  [],
);
```

The `setSession` import is still used by `login`; leave it. Remove `setSession` from the `register` dependency list — none.

- [ ] **Step 4: Run the test to verify it still fails (now on UI, not types)**

```bash
cd frontend && npm run test:frontend -- --run tests/pages/auth.test.tsx
```

Expected: FAIL — types now compile, but the test expects "Save your recovery code" which the page doesn't yet render. We fix the page in Task 4.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useAuth.ts frontend/tests/pages/auth.test.tsx
git commit -m "[F59] useAuth.register returns { user, recoveryCode } (no setSession)"
```

---

## Task 3: Add CSS for the interstitial

**Files:**
- Modify: `frontend/src/index.css` (append after the existing `[F24] Auth screen` block)

The existing `auth-screen` and `auth-hero` classes are reused as-is. New rules cover only the right-pane card pieces.

- [ ] **Step 1: Write the failing test**

Open `frontend/tests/pages/recovery-code-handoff.test.tsx` (the file is created in Task 7; for now, write a placeholder there to lock the contract). Add this test at the top of the file:

```tsx
it('renders the recovery code in a monospaced code box', async () => {
  // ...full setup is in Task 7; for now, the existence of `.recovery-code-box`
  // with `font-family: var(--mono)` is what we assert.
  // Setup deferred to Task 7 — this skeleton just locks the className contract.
});
```

(This is a marker, not a real test; the real test arrives in Task 7. We're only doing this so the CSS change has an obvious place to land.)

- [ ] **Step 2: Add the CSS block**

Append to `frontend/src/index.css` after the `auth-spinner` keyframe (around line 213, before the `@media (max-width: 720px)` block — check current line numbers since insertion shifts them):

```css
/* [F59] Recovery-code handoff — extends the .auth-screen layout from [F24].
   Pure styling of the right-pane card; the .auth-screen / .auth-hero rules
   already cover the page chrome, so don't redefine them. */
.recovery-code-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 420px;
}
.recovery-code-warning {
  padding: 10px 12px;
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--danger) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--danger) 22%, transparent);
  color: var(--ink-2);
  font-size: 12.5px;
  line-height: 1.5;
}
.recovery-code-warning strong {
  color: var(--danger);
  font-weight: 600;
}
.recovery-code-box {
  padding: 14px 16px;
  border-radius: var(--radius);
  background: var(--bg-elevated);
  border: 1px solid var(--line-2);
  font-family: var(--mono);
  font-size: 14px;
  line-height: 1.6;
  letter-spacing: 0.04em;
  color: var(--ink);
  word-break: break-all;
  user-select: all;
}
.recovery-code-actions {
  display: flex;
  gap: 8px;
}
.recovery-code-confirm {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12.5px;
  color: var(--ink-2);
  line-height: 1.5;
}
.recovery-code-confirm input[type="checkbox"] {
  margin-top: 2px;
}
```

- [ ] **Step 3: Verify build succeeds**

```bash
cd frontend && npm run build
```

Expected: PASS (production build). The `var(--mono)` token is already defined in `frontend/src/index.css:37` (`--mono: "JetBrains Mono", "SF Mono", "Menlo", "Consolas", ui-monospace, monospace;`). Do not add it again.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/index.css
git commit -m "[F59] css: recovery-code interstitial card styles"
```

---

## Task 4: Build the `<RecoveryCodeHandoff>` component (presentational)

**Files:**
- Create: `frontend/src/components/RecoveryCodeHandoff.tsx`
- Create: `frontend/tests/components/RecoveryCodeHandoff.test.tsx`

The component is a pure view: takes the recovery code + username + an `onContinue` callback, owns its own `confirmed` checkbox state, renders copy/download buttons. Knows nothing about routing, the session store, the API, or `useAuth`.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/components/RecoveryCodeHandoff.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecoveryCodeHandoff } from '@/components/RecoveryCodeHandoff';

describe('<RecoveryCodeHandoff>', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function renderHandoff(overrides: Partial<React.ComponentProps<typeof RecoveryCodeHandoff>> = {}) {
    const onContinue = vi.fn();
    render(
      <RecoveryCodeHandoff
        recoveryCode="horse-battery-staple-correct-glow-mint-velvet-pearl-orbit-quiet-amber-crisp"
        username="alice"
        onContinue={onContinue}
        {...overrides}
      />,
    );
    return { onContinue };
  }

  it('renders the recovery code, the warning, and the brand', () => {
    renderHandoff();
    expect(screen.getByRole('heading', { name: /save your recovery code/i })).toBeInTheDocument();
    expect(screen.getByText(/show once/i)).toBeInTheDocument();
    expect(screen.getByText(/horse-battery-staple/)).toBeInTheDocument();
  });

  it('continue button is disabled until the confirmation checkbox is ticked', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onContinue } = renderHandoff();

    const continueBtn = screen.getByRole('button', { name: /continue to inkwell/i });
    expect(continueBtn).toBeDisabled();

    await user.click(continueBtn);
    expect(onContinue).not.toHaveBeenCalled();

    await user.click(screen.getByRole('checkbox', { name: /i have stored/i }));
    expect(continueBtn).not.toBeDisabled();

    await user.click(continueBtn);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('copy button writes the recovery code to the clipboard and flashes "Copied"', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderHandoff();

    const copyBtn = screen.getByRole('button', { name: /^copy$/i });
    await user.click(copyBtn);

    expect(writeText).toHaveBeenCalledWith(
      'horse-battery-staple-correct-glow-mint-velvet-pearl-orbit-quiet-amber-crisp',
    );
    expect(await screen.findByRole('button', { name: /copied/i })).toBeInTheDocument();

    // Label reverts after the flash window.
    vi.advanceTimersByTime(2100);
    expect(await screen.findByRole('button', { name: /^copy$/i })).toBeInTheDocument();
  });

  it('download button calls the injected download function with a sensible filename and body', async () => {
    const onDownload = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderHandoff({ onDownload });

    await user.click(screen.getByRole('button', { name: /download as \.txt/i }));

    expect(onDownload).toHaveBeenCalledTimes(1);
    const [filename, content] = onDownload.mock.calls[0] as [string, string];
    expect(filename).toBe('inkwell-recovery-code-alice.txt');
    expect(content).toContain('horse-battery-staple');
    expect(content).toContain('Username: alice');
    expect(content).toContain('without it AND your password');
  });

  it('does not respond to Escape (cannot dismiss)', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onContinue } = renderHandoff();
    await user.keyboard('{Escape}');
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('shows a fallback note when navigator.clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderHandoff();

    await user.click(screen.getByRole('button', { name: /^copy$/i }));

    expect(
      await screen.findByText(/copy isn.t available in this browser/i),
    ).toBeInTheDocument();
    // Continue gate is still reachable — failure does not break the flow.
    expect(screen.getByRole('button', { name: /continue to inkwell/i })).toBeInTheDocument();
  });

  it('shows a fallback note when navigator.clipboard.writeText rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('permission denied'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderHandoff();

    await user.click(screen.getByRole('button', { name: /^copy$/i }));

    expect(
      await screen.findByText(/copy isn.t available in this browser/i),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npm run test:frontend -- --run tests/components/RecoveryCodeHandoff.test.tsx
```

Expected: FAIL with "Cannot find module '@/components/RecoveryCodeHandoff'".

- [ ] **Step 3: Write the component**

Create `frontend/src/components/RecoveryCodeHandoff.tsx`:

```tsx
import type { JSX } from 'react';
import { useState } from 'react';
import { downloadTxt } from '@/lib/downloadTxt';

export interface RecoveryCodeHandoffProps {
  recoveryCode: string;
  username: string;
  onContinue: () => void;
  /**
   * Test seam: lets the page-level test verify download contents without
   * mocking Blob / URL.createObjectURL / anchor.click. Defaults to the
   * existing downloadTxt utility used elsewhere in the app.
   */
  onDownload?: (filename: string, content: string) => void;
}

const COPIED_FLASH_MS = 2000;

function buildDownloadBody(username: string, recoveryCode: string): string {
  return [
    'Inkwell recovery code',
    `Username: ${username}`,
    `Recovery code: ${recoveryCode}`,
    '',
    'Keep this somewhere safe. Without it AND your password, your encrypted',
    'stories cannot be recovered.',
    '',
  ].join('\n');
}

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

export function RecoveryCodeHandoff({
  recoveryCode,
  username,
  onContinue,
  onDownload,
}: RecoveryCodeHandoffProps): JSX.Element {
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);

  const [copyFailed, setCopyFailed] = useState(false);

  const copy = async (): Promise<void> => {
    // navigator.clipboard is undefined in non-secure contexts (HTTP self-host
    // without TLS). Guard before calling so we surface the same fallback
    // path as a runtime rejection.
    if (!navigator.clipboard?.writeText) {
      setCopyFailed(true);
      return;
    }
    try {
      await navigator.clipboard.writeText(recoveryCode);
      setCopied(true);
      setCopyFailed(false);
      window.setTimeout(() => {
        setCopied(false);
      }, COPIED_FLASH_MS);
    } catch {
      // Permissions denied, etc. Surface a small note pointing the user at
      // Download (which always works) and the manual select-all on the box
      // (the box has `user-select: all`). Never throw — the gating button
      // must remain reachable.
      setCopyFailed(true);
    }
  };

  const download = (): void => {
    const filename = `inkwell-recovery-code-${username}.txt`;
    const body = buildDownloadBody(username, recoveryCode);
    if (onDownload) {
      onDownload(filename, body);
    } else {
      downloadTxt(filename, body);
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
          “Keep this code somewhere only you can reach. It is the second of two
          locks on your stories — your password is the first.”
          <cite className="block mt-3.5 font-sans not-italic text-[12px] text-[var(--ink-4)] tracking-[0.04em] uppercase">
            — inkwell handbook
          </cite>
        </blockquote>
        <div className="flex gap-2 font-mono text-[11px] text-[var(--ink-4)]">
          <span>Self-hosted · v0.4.2</span>
          <span>·</span>
          <span>inkwell-01</span>
        </div>
      </aside>

      <div className="grid place-items-center p-9">
        <div className="recovery-code-card">
          <h1 className="font-serif text-[28px] font-medium leading-tight tracking-[-0.01em] text-[var(--ink)] m-0">
            Save your recovery code
          </h1>
          <p className="text-[13px] text-[var(--ink-3)] leading-relaxed m-0">
            This is the only thing that can unlock your stories if you forget your
            password. We will not show it again.
          </p>

          <div className="recovery-code-warning" role="note">
            <strong>Show once.</strong> Inkwell does not store this anywhere it can
            read. Lose your password and this code, and your stories are gone for
            good.
          </div>

          <div
            className="recovery-code-box"
            data-testid="recovery-code-box"
            aria-label="Your recovery code"
          >
            <code>{recoveryCode}</code>
          </div>

          <div className="recovery-code-actions">
            <button
              type="button"
              onClick={() => {
                void copy();
              }}
              aria-live="polite"
              className="inline-flex items-center justify-center px-3 py-2 text-[12.5px] font-medium font-sans bg-[var(--bg-elevated)] text-[var(--ink)] border border-[var(--line-2)] rounded-[var(--radius)] hover:bg-[var(--surface-hover)] transition-colors"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={download}
              className="inline-flex items-center justify-center px-3 py-2 text-[12.5px] font-medium font-sans bg-[var(--bg-elevated)] text-[var(--ink)] border border-[var(--line-2)] rounded-[var(--radius)] hover:bg-[var(--surface-hover)] transition-colors"
            >
              Download as .txt
            </button>
          </div>

          {copyFailed ? (
            <p role="status" className="text-[12px] text-[var(--ink-3)] m-0">
              Copy isn’t available in this browser. Use Download, or select the
              code above and copy it manually.
            </p>
          ) : null}

          <label className="recovery-code-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => {
                setConfirmed(e.target.checked);
              }}
            />
            <span>I have stored my recovery code somewhere safe.</span>
          </label>

          <button
            type="button"
            disabled={!confirmed}
            onClick={onContinue}
            className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 mt-1 text-[13px] font-medium font-sans bg-[var(--ink)] text-[var(--bg)] rounded-[var(--radius)] hover:bg-[var(--ink-2)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Continue to Inkwell
          </button>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd frontend && npm run test:frontend -- --run tests/components/RecoveryCodeHandoff.test.tsx
```

Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/RecoveryCodeHandoff.tsx \
       frontend/tests/components/RecoveryCodeHandoff.test.tsx
git commit -m "[F59] component: <RecoveryCodeHandoff> with copy/download/gating"
```

---

## Task 5: Wire `RegisterPage` as a state machine: form → handoff → login

**Files:**
- Modify: `frontend/src/pages/RegisterPage.tsx` (full rewrite — current file is 12 lines)
- Read: `frontend/src/components/AuthForm.tsx:182-197` (to understand the `onSubmit` contract — `handleSubmit` already trims+lowercases the username before calling, so the page receives the canonical value)

The page owns three pieces of state: `phase` (`'form' | 'handoff' | 'logging-in'`), `pending` (the `{ user, recoveryCode, credentials }` triple kept in memory only between phases), and `loginError` (rare post-ack login failure). It never writes the recovery code or password to a store.

- [ ] **Step 1: Write the page-level test**

Create `frontend/tests/pages/recovery-code-handoff.test.tsx`:

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

describe('recovery-code handoff (F59)', () => {
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

  it('after a successful register, shows the recovery-code interstitial (not the dashboard) and gates Continue on the checkbox', async () => {
    primeUnauthenticatedInit(fetchMock);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, {
        user: { id: 'u2', username: 'bob' },
        recoveryCode: 'horse-battery-staple-correct',
      }),
    );

    const user = userEvent.setup();
    renderAt('/register');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /create account/i })).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/username/i), 'bob');
    await user.type(screen.getByLabelText(/password/i), 'hunter2hunter2');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /save your recovery code/i }),
      ).toBeInTheDocument();
    });

    expect(screen.getByText(/horse-battery-staple-correct/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /your stories/i })).not.toBeInTheDocument();

    const continueBtn = screen.getByRole('button', { name: /continue to inkwell/i });
    expect(continueBtn).toBeDisabled();

    // Tick the checkbox to release the gate.
    await user.click(screen.getByRole('checkbox', { name: /i have stored/i }));
    expect(continueBtn).not.toBeDisabled();
  });

  it('after acknowledgement, calls /auth/login with the original credentials and redirects to /', async () => {
    primeUnauthenticatedInit(fetchMock);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, {
        user: { id: 'u2', username: 'bob' },
        recoveryCode: 'horse-battery-staple-correct',
      }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        user: { id: 'u2', username: 'bob' },
        accessToken: 'tok-2',
        accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    );

    const user = userEvent.setup();
    renderAt('/register');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /create account/i })).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/username/i), 'bob');
    await user.type(screen.getByLabelText(/password/i), 'hunter2hunter2');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /save your recovery code/i }),
      ).toBeInTheDocument();
    });
    await user.click(screen.getByRole('checkbox', { name: /i have stored/i }));
    await user.click(screen.getByRole('button', { name: /continue to inkwell/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /your stories/i })).toBeInTheDocument();
    });

    const loginCall = fetchMock.mock.calls.find(([url]: [string]) => url === '/api/auth/login');
    expect(loginCall).toBeDefined();
    const [, init] = loginCall as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ username: 'bob', password: 'hunter2hunter2' }));
  });

  it('does NOT persist the recovery code to localStorage, sessionStorage, or the session store', async () => {
    primeUnauthenticatedInit(fetchMock);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, {
        user: { id: 'u2', username: 'bob' },
        recoveryCode: 'horse-battery-staple-correct',
      }),
    );

    const user = userEvent.setup();
    renderAt('/register');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /create account/i })).toBeInTheDocument();
    });
    await user.type(screen.getByLabelText(/username/i), 'bob');
    await user.type(screen.getByLabelText(/password/i), 'hunter2hunter2');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /save your recovery code/i }),
      ).toBeInTheDocument();
    });

    // Scan localStorage and sessionStorage for the code or any near-substring.
    const allLocal = JSON.stringify({ ...localStorage });
    const allSession = JSON.stringify({ ...sessionStorage });
    expect(allLocal).not.toContain('horse-battery');
    expect(allSession).not.toContain('horse-battery');

    // The session store must not hold the code anywhere on its state.
    const storeJson = JSON.stringify(useSessionStore.getState());
    expect(storeJson).not.toContain('horse-battery');
  });

  it('remounting /register after the handoff is shown returns the user to the form (no leaked code)', async () => {
    primeUnauthenticatedInit(fetchMock);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, {
        user: { id: 'u2', username: 'bob' },
        recoveryCode: 'horse-battery-staple-correct',
      }),
    );

    const user = userEvent.setup();
    const { unmount } = renderAt('/register');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /create account/i })).toBeInTheDocument();
    });
    await user.type(screen.getByLabelText(/username/i), 'bob');
    await user.type(screen.getByLabelText(/password/i), 'hunter2hunter2');
    await user.click(screen.getByRole('button', { name: /create account/i }));
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /save your recovery code/i }),
      ).toBeInTheDocument();
    });

    // Simulate a tab reload by unmounting and re-priming a fresh init.
    unmount();
    primeUnauthenticatedInit(fetchMock);
    renderAt('/register');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /create account/i })).toBeInTheDocument();
    });
    expect(screen.queryByText(/horse-battery-staple/)).not.toBeInTheDocument();
  });

  it('post-ack login failure shows an inline error and a "Sign in" link as fallback', async () => {
    primeUnauthenticatedInit(fetchMock);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, {
        user: { id: 'u2', username: 'bob' },
        recoveryCode: 'horse-battery-staple-correct',
      }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { message: 'Invalid credentials', code: 'invalid_credentials' } }),
    );

    const user = userEvent.setup();
    renderAt('/register');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /create account/i })).toBeInTheDocument();
    });
    await user.type(screen.getByLabelText(/username/i), 'bob');
    await user.type(screen.getByLabelText(/password/i), 'hunter2hunter2');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /save your recovery code/i }),
      ).toBeInTheDocument();
    });
    await user.click(screen.getByRole('checkbox', { name: /i have stored/i }));
    await user.click(screen.getByRole('button', { name: /continue to inkwell/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/sign in failed/i);
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend && npm run test:frontend -- --run tests/pages/recovery-code-handoff.test.tsx
```

Expected: FAIL — the page still redirects to `/` immediately on register; the interstitial is never rendered.

- [ ] **Step 3: Rewrite `RegisterPage`**

Replace `frontend/src/pages/RegisterPage.tsx` entirely with the version below. The state machine carries `recoveryCode` on every post-form variant so the handoff component always has a real value to render:

```tsx
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
          if (phase.kind !== 'handoff') return; // re-entrancy guard
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
```

Three behaviours pinned by this code that the engineer must not "fix" away:

1. **Re-entrancy guard.** Once Continue is clicked, `phase.kind` is `'logging-in'` and the next click is a no-op. We don't disable the button visually because the round-trip is fast and a flicker is worse than a no-op click.
2. **No `ApiError` discrimination on the catch branch.** The user-visible message is identical for 401 / 5xx / network — we never want to surface "your password is wrong" here, because the password is the one we just registered with. Treat all failures as "go to /login".
3. **Reload + back/forward fall through to the form.** `useState` resets on remount, so a reload of `/register` re-renders the form (the recovery code is already gone — that's by design and matches the addendum's "If the user closes the tab, the recovery code is irretrievable" rule). No additional code needed; this is verified in the smoke checklist.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd frontend && npm run test:frontend -- --run tests/pages/recovery-code-handoff.test.tsx
```

Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/RegisterPage.tsx \
       frontend/tests/pages/recovery-code-handoff.test.tsx
git commit -m "[F59] RegisterPage: form → recovery-code handoff → auto-login"
```

---

## Task 6: Update the F4 register test to match the new flow

**Files:**
- Modify: `frontend/tests/pages/auth.test.tsx` (the "register page validates + submits" test, plus its 409 sibling)

The 201 + `recoveryCode` change in Task 2 partially updated this file, but the test originally asserted "lands on /". That's now wrong: the test must assert "lands on the recovery-code interstitial." The 409 test is unchanged — duplicate-username errors are surfaced inline on the form before the recovery-code phase ever fires.

- [ ] **Step 1: Audit the existing test file**

Open `frontend/tests/pages/auth.test.tsx` and confirm the F4 register tests reflect the change Task 2 introduced. The 200/201 status code mismatch is already fixed in Task 2; verify the test now asserts the interstitial heading and not the dashboard heading. If Task 2's edit did not also remove the redirect-to-`/` assertion, do it here.

- [ ] **Step 2: Run the test to verify it passes**

```bash
cd frontend && npm run test:frontend -- --run tests/pages/auth.test.tsx
```

Expected: PASS for all `auth pages (F4)` tests, including the rewritten register-success path and the unchanged 409 path.

- [ ] **Step 3: Commit**

If Task 2 already produced the right state and this task is a no-op, skip the commit. Otherwise:

```bash
git add frontend/tests/pages/auth.test.tsx
git commit -m "[F59] auth.test: register success now lands on recovery-code interstitial"
```

---

## Task 7: Tick the box and run the verify command

**Files:**
- Modify: `TASKS.md` (only after the verify command passes)

- [ ] **Step 1: Run the task's exact verify command via the project skill**

```bash
/task-verify F59
```

Or directly:

```bash
cd frontend && npm run test:frontend -- --run tests/pages/recovery-code-handoff.test.tsx
```

Expected: exit code 0 with all four tests passing.

- [ ] **Step 2: Run the surrounding suites that touch the same surface**

```bash
cd frontend && npm run test:frontend -- --run \
  tests/pages/auth.test.tsx \
  tests/pages/recovery-code-handoff.test.tsx \
  tests/components/RecoveryCodeHandoff.test.tsx
```

Expected: all green.

- [ ] **Step 3: Manual smoke (UI, per CLAUDE.md)**

Per CLAUDE.md: "For UI or frontend changes, start the dev server and use the feature in a browser before reporting the task as complete."

```bash
make dev
```

In a browser at http://localhost:3000/register: register a new account (e.g. `smoketest_<timestamp>` / `hunter2hunter2`). Confirm:
1. The recovery-code screen renders.
2. Copy and Download both work — paste the clipboard into a scratch buffer and inspect the `.txt`.
3. The Continue button is disabled until the checkbox is ticked.
4. Continue → dashboard loads (`/`) and the user is signed in.
5. localStorage and sessionStorage do not contain the recovery code (browser devtools → Application tab).
6. Refreshing on the recovery-code screen redirects you out — once the page reloads the in-memory code is gone, the user is unauthenticated, and `/register` re-renders the form.

If any of these fails, fix the code (not the test) and re-run.

- [ ] **Step 4: Tick `[F59]` in `TASKS.md`**

The pre-edit hook (`.claude/hooks/pre-tasks-edit.sh`) auto-ticks tasks when their verify passes. If it has not, change `- [ ] **[F59]**` to `- [x] **[F59]**` in `TASKS.md`.

- [ ] **Step 5: Final commit**

```bash
git add TASKS.md
git commit -m "[F59] tick — recovery-code handoff complete"
```

---

## Self-Review Notes

- **Spec coverage:**
  - "Surface as a dedicated full-screen interstitial" → Task 4/5 (state-driven, on `/register`, full-viewport `.auth-screen` layout).
  - "Explicit 'I have stored this — continue' gating" → Task 4 checkbox + disabled button (tested).
  - "Copy-to-clipboard + download-as-`.txt` actions" → Task 4 (component) + Task 4 tests, including non-secure-context and rejection fallback.
  - "Warning that the code is shown ONCE" → Task 4 `.recovery-code-warning` block.
  - "No nav until the user confirms" → checkbox-gated button, Escape no-op, no second URL.
  - "Persist nothing client-side" → Task 5 has explicit tests asserting no localStorage / sessionStorage / session-store leakage AND that a remount of `/register` returns to the form with no recovery-code text in the DOM.
  - "Required prerequisite for `[F60]`" → component is reusable; F60 will compose its own page that can hand the user back into login state directly. No extra work needed in F59.
  - "Design must mock the interstitial first" → Task 1 commits a JSX mockup + an addendum `.notes.md` to `mockups/frontend-prototype/design/`.
  - "verify: cd frontend && npm run test:frontend -- --run tests/pages/recovery-code-handoff.test.tsx" → Task 5 creates exactly that file.

- **Implementation completeness check (no follow-up TBDs):**
  - Backend contract is verified (`POST /api/auth/register` returns 201 `{ user, recoveryCode }`, no token); plan does not require backend changes.
  - `--mono` token already exists at `frontend/src/index.css:37`; CSS task references it without re-defining.
  - Clipboard fallback is implemented and tested — non-secure context (`navigator.clipboard === undefined`) and `writeText` rejection both surface the same fallback note pointing to Download + manual select.
  - Reload / tab-restore behaviour is pinned by `useState` in `RegisterPage`; tested via unmount + remount.
  - Phase type ships in its final shape only — no "wrong then refined" intermediate state.
  - No `accessTokenExpiresAt` handling required: the existing `useAuth.login` already only consumes `accessToken`; the field is in the response body and ignored, no code change needed.

- **Placeholder scan:** none — every step contains the actual file content or command. The only piece deliberately re-stated mid-task is the `Phase` type refinement in Task 5 step 3, where I show both the wrong-and-fixed shape so the engineer can see the reasoning. The plan calls out "ship the refined version, not the empty-string version" explicitly.

- **Type consistency:** `RegisterResult { user, recoveryCode }` is defined in Task 2 and used in Task 5; `RecoveryCodeHandoffProps` defined in Task 4 is consumed in Task 5. `Credentials` is the existing `useAuth` export. No drift.

- **Open follow-up (out of F59 scope):** if `[F61]` (rotate recovery code) ships before this UX is reused for that flow, the `<RecoveryCodeHandoff>` component is reusable as-is — it only needs a different `onContinue` (close the modal instead of login). That's a F61 task, not an F59 one.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/F59-recovery-code-handoff.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks, fastest iteration.

**2. Inline Execution** — run the tasks in this session via `superpowers:executing-plans` with checkpoints.

Which approach?
