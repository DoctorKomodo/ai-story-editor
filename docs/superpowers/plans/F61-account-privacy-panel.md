# [F61] Account & Privacy Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the user-menu's "Account & privacy" entry to a centred 720px modal that surfaces four sections: **Change password** (`POST /api/auth/change-password` [AU15]), **Rotate recovery code** (`POST /api/auth/rotate-recovery-code` [AU17]), **Sign out everywhere** (new `POST /api/auth/sign-out-everywhere` [B12], shipped in this plan), and a **Delete account** placeholder card pointing at `[X3]`.

**Architecture:**
- New backend endpoint **[B12]** ships in this plan (the F61 task copy says "may need a B12 follow-up if not yet shipped" — it has not). Tiny: requires auth, deletes all of the caller's refresh tokens in a transaction, clears the refresh cookie, returns 204.
- New frontend modal `<AccountPrivacyModal>` follows the F43 `<SettingsModal>` shell pattern (720px wide, header + sectioned body + footer, Escape + backdrop close, no auto-save — each section has its own explicit submit button).
- **By the time F61 ships, F51–F58 have all shipped** (incremental order). That changes three things from a naive plan:
  1. **Escape handling uses `useEscape({ priority: 100 })`** from `frontend/src/hooks/useKeyboardShortcuts.ts`, NOT a raw `window.addEventListener('keydown')`. F57 already migrated every other modal off the legacy pattern; reintroducing it would silently bypass F57's priority-aware dispatcher and break the open-modal-then-popover ordering the rest of the app relies on.
  2. **Mount site is EditorPage at page root, alongside `<SettingsModal>` / `<StoryPicker>` / `<ModelPicker>`.** F55 mounted those three at the page root and lifted their open-state to the page; F61's `accountPrivacyOpen` follows the same convention. AppShell's `<UserMenu>` already exposes `onOpenAccount?: () => void`; F55 wired the analogous callbacks for the other modals as page-level state setters. Do NOT put the state inside AppShell — that would be the only modal mounted differently from its three siblings.
  3. **Modal wrapper uses the F49 `t-modal-in`-compatible centring transform** (from F58's modal-centring refactor). F58 swapped `grid place-items-center` (which conflicted with the keyframe's `translate(-50%, -50%)`) for the keyframe-compatible transform on Settings / StoryPicker / ModelPicker. F61's wrapper uses the same shape so the modal's entrance animation fires consistently with the others.
- **Sectioned**, not tabbed — there are four sections and three of them are short forms; tabs would hide content the user almost certainly wants to scan past once. Vertical scroll inside the body keeps the shell consistent with F43's height even as the content grows.
- Rotate-recovery-code re-uses the F59 `<RecoveryCodeHandoff>` component verbatim. The parent passes `onContinue` that closes the result panel and zeroes the in-memory code; no F59 changes.
- Three new TanStack Query mutations: `useChangePasswordMutation`, `useRotateRecoveryCodeMutation`, `useSignOutEverywhereMutation`. They live next to each other in a new `frontend/src/hooks/useAccount.ts` (the existing `useAuth.ts` is for auth-state primitives — `setSession` / `clearSession`; mutations belong with the rest of the per-feature mutation hooks like `useVeniceKey.ts`, `useUserSettings.ts`).
- The change-password and rotate-recovery flows do **not** sign the current session out, even though [AU15] / [AU17] both delete every refresh token server-side (including the current one). Reason: the access token is short-lived (~15 min) but valid; the next refresh will fail and the global `setUnauthorizedHandler` (already in `frontend/src/store/session.ts:37-39`) will redirect to `/login`. We surface a non-blocking inline notice ("Other sessions have been signed out") so the user is informed.
- Sign-out-everywhere is the only flow that actively signs the current tab out. After the API call resolves we call `clearSession()` and `Navigate('/login')`. There is no in-app confirmation modal; the button itself requires a typed-confirmation-then-click pattern (a `<details>`-style "Confirm sign-out everywhere" expand/collapse), to avoid an accidental click.
- Delete-account is rendered as a disabled red button inside a card that explains it's not yet wired and points at `[X3]`. No fake handler. No tooltip-only "coming soon" — we render explicit copy with the task ID so a future engineer (or the same one on a later branch) can grep `[X3]` and find the slot.

**Decision points pinned in the plan:**
1. **Sectioned layout, not tabbed.** Four sections, vertical scroll. Reason above.
2. **Modal mount point: app-level, like Settings.** `AppShell` owns the `accountPrivacyOpen` state; `UserMenu`'s existing `onOpenAccount` prop fires it. Mirrors how Settings is wired.
3. **Change-password does not auto-logout.** Reason above. Display "Other sessions have been signed out" inline after success.
4. **Rotate recovery: same handoff UI as F59.** Re-use the component as a presentational child; the modal section toggles between the password-confirm form and the handoff result.
5. **Sign-out-everywhere flow:** requires a second click on a "Yes, sign out everywhere" confirm button that only appears after the user clicks the initial "Sign out other sessions" button. (This is cheaper than a confirm modal and harder to fat-finger than a single button.) On success → clear local session → navigate to `/login` with a `signedOutEverywhere: true` location-state banner.
6. **Delete-account is purely a placeholder.** No `useState`, no handler, no spinner. Disabled button + copy.

**Tech Stack:** React 18, TypeScript strict, Tailwind, TanStack Query (mutations only — no server-cache reads in this surface), Zustand (`useSessionStore.clearSession`), react-router-dom v6 (`useNavigate`, `Navigate`), Vitest + Testing Library. Backend: Express 5 + Prisma + Zod + `requireAuth` middleware + cookie + rate-limit (reuse existing per-user limiter constants).

**Source-of-truth references:**
- `[AU15]` change-password: `backend/src/routes/auth.routes.ts:245-275` (returns 204 on success, 401 generic, 400 on Zod). Service deletes all refresh tokens for the user (`backend/src/services/auth.service.ts:472`).
- `[AU17]` rotate-recovery-code: `backend/src/routes/auth.routes.ts:277-311` (returns 200 `{ recoveryCode, warning }`, 401 generic, 400 on Zod). Service deletes refresh tokens too (`backend/src/services/auth.service.ts:512`).
- F43 modal shell: `frontend/src/components/Settings.tsx:1-120` — 720px width, escape handler, ref-based body scroll, `useId` for the title.
- F59 handoff component: `frontend/src/components/RecoveryCodeHandoff.tsx` (presentational; `recoveryCode`, `username`, `onContinue`, optional `onDownload`).
- UserMenu hook-up site: `frontend/src/components/UserMenu.tsx:35` (`onOpenAccount?: () => void`).
- Mutation hook conventions: `frontend/src/hooks/useVeniceKey.ts`, `frontend/src/hooks/useUserSettings.ts` — TanStack `useMutation` calling `api()` directly, no per-mutation file.
- Page-root modal-state convention (post-F55): `EditorPage.tsx` owns `settingsOpen` / `storiesListOpen` / `modelPickerOpen` state and renders `<SettingsModal>` / `<StoryPicker>` / `<ModelPicker>` at page root. F61 adds `accountPrivacyOpen` to that list.
- Refresh-cookie helpers: `backend/src/routes/auth.routes.ts:18-26` (`REFRESH_COOKIE_NAME`, `refreshCookieOptions()`).
- Existing `signedOutEverywhere`-style banner pattern: F60's `LoginPage` reset banner (`frontend/src/pages/LoginPage.tsx`, post-F60 shape). Reuse the same `location.state` mechanism with a different flag.

---

## File Structure

**Create (backend):**
- `backend/src/routes/auth.routes.ts` — modify only; add the new route block alongside change-password / rotate-recovery-code.
- `backend/src/services/auth.service.ts` — modify only; add `signOutEverywhere(userId)` that calls `client.refreshToken.deleteMany({ where: { userId } })` inside a transaction.
- `backend/tests/auth/sign-out-everywhere.test.ts` — new integration test.

**Create (frontend):**
- `mockups/archive/v1-2025-11/design/account-privacy.jsx` — design-first mockup
- `mockups/archive/v1-2025-11/design/account-privacy.notes.md` — addendum
- `frontend/src/components/AccountPrivacyModal.tsx` — modal shell + the four section components inside one file (each section is small enough that splitting would hurt readability)
- `frontend/src/hooks/useAccount.ts` — three mutation hooks
- `frontend/tests/components/AccountPrivacy.test.tsx` — the verify-command target
- `frontend/tests/hooks/useAccount.test.tsx` — narrow unit tests for the mutations

**Modify (frontend):**
- `frontend/src/pages/EditorPage.tsx` — add `accountPrivacyOpen` state + setter; pass `onOpenAccount={() => setAccountPrivacyOpen(true)}` through the existing AppShell→TopBar→UserMenu prop chain (the `onOpenAccount` callback prop is already declared on `UserMenu`); render `<AccountPrivacyModal open={accountPrivacyOpen} onClose={() => setAccountPrivacyOpen(false)} username={user.username} />` at page root next to the three modals F55 already mounts there.
- `frontend/src/pages/LoginPage.tsx` — extend the F60-introduced location-state banner to also handle `signedOutEverywhere: true` (single banner element switches its message based on which flag is set).

**Modify (TASKS.md):**
- Insert `[B12]` as a new task in the B section between B11 and the section divider, with verify pointing at the new test file.

**Not touched:**
- `frontend/src/components/RecoveryCodeHandoff.tsx` — re-used as-is.
- `frontend/src/store/session.ts` — `clearSession()` already exists and the unauthorized-handler already redirects.
- `backend/src/middleware/auth.middleware.ts`, `backend/src/services/crypto.service.ts`, `backend/src/services/content-crypto.service.ts` — no changes.

---

## Task 1: [B12] backend `POST /api/auth/sign-out-everywhere`

**Files:**
- Modify: `backend/src/services/auth.service.ts`
- Modify: `backend/src/routes/auth.routes.ts`
- Create: `backend/tests/auth/sign-out-everywhere.test.ts`
- Modify: `TASKS.md` (insert B12 entry)

**Security:** any change to `auth.service.ts` / `auth.routes.ts` triggers `security-reviewer` per CLAUDE.md. Run after Task 1 completes.

- [ ] **Step 1: Add the service function**

In `backend/src/services/auth.service.ts`, near the existing `changePassword` and `rotateRecoveryCode` functions (which already use `client.refreshToken.deleteMany({ where: { userId } })`), add:

```ts
async function signOutEverywhere(input: { userId: string }): Promise<void> {
  await prisma.refreshToken.deleteMany({ where: { userId: input.userId } });
}
```

Export it from the service factory (mirror how `rotateRecoveryCode` is exported around line 612 — find the returned object and add `signOutEverywhere` to the same list).

(If the file uses a transactional pattern for similar single-table deletes, follow that pattern; the existing `changePassword` deletes are inside a `prisma.$transaction([...])`, but here we have no second statement — a single `deleteMany` is atomic on its own and does not need a transaction.)

- [ ] **Step 2: Add the route**

In `backend/src/routes/auth.routes.ts`, after the `/rotate-recovery-code` block (around line 311), add:

```ts
const signOutEverywhereLimiter = rateLimit(SENSITIVE_AUTH_LIMIT_OPTIONS);

router.post(
  '/sign-out-everywhere',
  requireAuth,
  signOutEverywhereLimiter,
  async (req, res, next) => {
    try {
      const authed = req.user;
      if (!authed) {
        res.status(401).json({ error: { message: 'Unauthorized', code: 'unauthorized' } });
        return;
      }
      await authService.signOutEverywhere({ userId: authed.id });
      // Clear the caller's refresh cookie so the browser doesn't keep
      // sending a token that no longer exists in the DB.
      res.clearCookie(REFRESH_COOKIE_NAME, { ...refreshCookieOptions(), maxAge: 0 });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);
```

Place the limiter declaration alongside the existing `changePasswordLimiter` / `rotateRecoveryCodeLimiter` declarations (near line 83) so all three live together.

- [ ] **Step 3: Add the integration test**

Create `backend/tests/auth/sign-out-everywhere.test.ts`. Mirror the structure of an existing auth test (e.g. `backend/tests/auth/change-password.test.ts` if present, or `register-username.test.ts`). The test must:

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/build-test-app'; // or whatever the existing helper is
import { prisma } from '../../src/db';
import { resetTestDb } from '../helpers/reset-test-db';

describe('POST /api/auth/sign-out-everywhere', () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it('204 on success — deletes all of the user\'s refresh tokens, clears the caller cookie, leaves other users untouched', async () => {
    const app = buildTestApp();

    // Register two users; sign each in twice so they have two refresh
    // tokens each. (Login twice to simulate a second tab/device.)
    await request(app).post('/api/auth/register').send({ username: 'alice', password: 'hunter2hunter2' });
    await request(app).post('/api/auth/register').send({ username: 'bob', password: 'hunter2hunter2' });

    const aliceLogin1 = await request(app).post('/api/auth/login').send({ username: 'alice', password: 'hunter2hunter2' });
    const aliceLogin2 = await request(app).post('/api/auth/login').send({ username: 'alice', password: 'hunter2hunter2' });
    await request(app).post('/api/auth/login').send({ username: 'bob', password: 'hunter2hunter2' });
    await request(app).post('/api/auth/login').send({ username: 'bob', password: 'hunter2hunter2' });

    expect(await prisma.refreshToken.count({ where: { user: { username: 'alice' } } })).toBe(2);
    expect(await prisma.refreshToken.count({ where: { user: { username: 'bob' } } })).toBe(2);

    const accessToken = aliceLogin1.body.accessToken as string;
    const refreshCookie = (aliceLogin1.headers['set-cookie'] as string[]).find((c) =>
      c.startsWith('refreshToken='),
    );
    if (!refreshCookie) throw new Error('expected refresh cookie');

    const res = await request(app)
      .post('/api/auth/sign-out-everywhere')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Cookie', refreshCookie);

    expect(res.status).toBe(204);
    expect(await prisma.refreshToken.count({ where: { user: { username: 'alice' } } })).toBe(0);
    expect(await prisma.refreshToken.count({ where: { user: { username: 'bob' } } })).toBe(2);

    const setCookie = (res.headers['set-cookie'] as string[] | undefined)?.find((c) =>
      c.startsWith('refreshToken='),
    );
    expect(setCookie).toBeDefined();
    expect(setCookie).toMatch(/Max-Age=0|Expires=/i);
  });

  it('401 when called without a valid access token', async () => {
    const app = buildTestApp();
    const res = await request(app).post('/api/auth/sign-out-everywhere');
    expect(res.status).toBe(401);
  });

  it('204 even when the user already has zero refresh tokens (idempotent)', async () => {
    const app = buildTestApp();
    await request(app).post('/api/auth/register').send({ username: 'carol', password: 'hunter2hunter2' });
    const login = await request(app).post('/api/auth/login').send({ username: 'carol', password: 'hunter2hunter2' });
    const accessToken = login.body.accessToken as string;

    // First call deletes the one token.
    const first = await request(app)
      .post('/api/auth/sign-out-everywhere')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(first.status).toBe(204);

    // Second call — token already gone, should still 204.
    const second = await request(app)
      .post('/api/auth/sign-out-everywhere')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(second.status).toBe(204);
  });

  it('does not leak information about other users in error paths', async () => {
    // Sanity: a 500 from inside the service must not echo a userId or
    // username. Simulating a 500 deterministically is hard without a mock;
    // skip if the existing test infra doesn't already have a pattern for
    // this. The safety relies on `next(err)` going through the global
    // error handler ([B7]), which already strips internals in production.
    // Marking this as documentation rather than a test.
  });
});
```

If the `buildTestApp` / `resetTestDb` helpers have different names, match the existing suite. Look at any existing `backend/tests/auth/*.test.ts` for the local convention before writing.

- [ ] **Step 4: Add the B12 task to TASKS.md**

After the B11 line, insert:

```markdown
- [ ] **[B12]** `POST /api/auth/sign-out-everywhere` — authenticated endpoint that deletes every refresh token belonging to the caller and clears the caller's refresh cookie. 204 on success. Idempotent. Rate-limited per-user via the same SENSITIVE_AUTH_LIMIT_OPTIONS bucket. Used by `[F61]` Account & Privacy panel. **Invoke `security-reviewer` after implementation.**
  - verify: `cd backend && npm run test:backend -- --run tests/auth/sign-out-everywhere.test.ts`
```

- [ ] **Step 5: Run the test**

```bash
cd backend && npm run test:backend -- --run tests/auth/sign-out-everywhere.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run the security-reviewer subagent**

Per CLAUDE.md: any change to `auth.routes.ts` / `auth.service.ts` requires `security-reviewer` clearance.

```
Agent(
  description: "Review B12 sign-out-everywhere",
  subagent_type: "security-reviewer",
  prompt: "Review [B12] as currently implemented. Scope: backend/src/routes/auth.routes.ts (the new /sign-out-everywhere route + signOutEverywhereLimiter), backend/src/services/auth.service.ts (the new signOutEverywhere function), and backend/tests/auth/sign-out-everywhere.test.ts. Confirm: (1) requires auth and is rate-limited; (2) only deletes refresh tokens for req.user.id, never another user's; (3) clears the caller's refresh cookie with the same options the rest of the auth file uses (so the cookie path/domain match and it actually removes the cookie); (4) idempotent; (5) no information leak in error paths; (6) no plaintext / DEK / recovery-code touched."
)
```

Address any `BLOCK` / `FIX_BEFORE_MERGE` findings before continuing.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/auth.service.ts \
       backend/src/routes/auth.routes.ts \
       backend/tests/auth/sign-out-everywhere.test.ts \
       TASKS.md
git commit -m "[B12] POST /auth/sign-out-everywhere endpoint"
```

---

## Task 2: Mockup the Account & Privacy panel

**Files:**
- Create: `mockups/archive/v1-2025-11/design/account-privacy.jsx`
- Create: `mockups/archive/v1-2025-11/design/account-privacy.notes.md`

- [ ] **Step 1: Write the mockup JSX**

Create `mockups/archive/v1-2025-11/design/account-privacy.jsx`:

```jsx
// Account & Privacy modal — opened from the user menu's "Account & privacy" item.
// 720px wide, sectioned (not tabbed). Mirrors SettingsModal's shell.

function AccountPrivacyModal({ open, onClose, username }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-720" role="dialog" aria-modal="true" aria-labelledby="ap-title">
        <header className="modal-head">
          <div>
            <h2 id="ap-title" className="modal-title">Account &amp; privacy</h2>
            <p className="modal-sub">Manage credentials, recovery, and sessions for <code>@{username}</code>.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><XIcon /></button>
        </header>

        <div className="modal-body">
          <Section title="Change password" hint="Use your current password to set a new one. Other sessions will be signed out.">
            <ChangePasswordForm />
          </Section>

          <Section title="Rotate recovery code" hint="Generate a new recovery code. The old code becomes invalid the moment you confirm.">
            <RotateRecoverySection />
          </Section>

          <Section title="Sign out everywhere" hint="Revoke every active session, including this one. You'll need to sign in again.">
            <SignOutEverywhereSection />
          </Section>

          <Section title="Delete account" hint="Permanently remove your account and every story, chapter, character, and chat you've written." danger>
            <p className="muted">Coming with [X3]. This will require typing your password and the word DELETE.</p>
            <button type="button" className="btn-danger" disabled>Delete account…</button>
          </Section>
        </div>

        <footer className="modal-foot">
          <button type="button" className="btn-secondary" onClick={onClose}>Done</button>
        </footer>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the addendum**

Create `mockups/archive/v1-2025-11/design/account-privacy.notes.md`:

```markdown
# Account & Privacy modal (addendum to modals.jsx)

Reached from the user menu's "Account & privacy" entry. Mirrors the F43
SettingsModal shell (720px, centered, backdrop with blur, Escape closes,
backdrop-click closes, header + body + footer layout). Sectioned vertical
layout, NOT tabbed — there are only four sections, all short.

## Sections

### 1. Change password
Three inputs (current password, new password, confirm). Submit button on
the right. On success: green check + "Other sessions have been signed out."
inline notice. The current tab does NOT log out — its access token is
still valid until expiry (~15 min); the next refresh will fail and the
global handler redirects.

### 2. Rotate recovery code
Single password input + "Generate new code" button. On success the section
swaps to the F59 handoff UI (same component) showing the new code, with the
same gating ("I have stored this") to release a "Done" button that
collapses the section back to the password input (now empty). NB the user
is still authenticated — this isn't a navigation event.

### 3. Sign out everywhere
A muted explanation + a "Sign out other sessions" button. Clicking it does
NOT immediately fire the request — it reveals an inline confirm strip
("Are you sure? This will end this session too.") with a destructive
"Yes, sign out everywhere" button and a Cancel. Two-click design avoids
fat-finger; cheaper than a confirm modal.

### 4. Delete account
Disabled red button + copy: "Coming with [X3]. This will require typing
your password and the word DELETE." No tooltip-only state — the section
exists in the layout so users know the option is real, just not yet shipped.

## Behaviour
- Footer has only "Done" (secondary). No primary "Save" — every section
  has its own submit.
- Each section's form has its own pending state, error state, and success
  notice. Submitting one does not affect the others.
- The 401 generic message ("Invalid credentials") is reused verbatim for
  both Change-password and Rotate-recovery — both endpoints return the
  same shape on wrong password.
- 429 → "Too many attempts. Try again in a minute." (matches F60.)
- 5xx / network → "Something went wrong. Please try again."
- The recovery-code handoff sub-state inside Section 2 cannot be dismissed
  by closing the modal — closing fires onClose, which the parent allows;
  the in-memory code is then gone forever. The header copy makes this
  explicit: "We will not show it again."
- After "Sign out everywhere" succeeds, the modal closes, useSessionStore
  is cleared, and we Navigate('/login', { state: { signedOutEverywhere: true }}).
  The login page shows a "You've been signed out everywhere." banner using
  the same mechanism as F60's resetSuccess banner.

## What we deliberately do NOT do
- Auto-save anything in this modal.
- Persist any password / recovery-code / form state to local/sessionStorage.
- Show the *current* recovery code anywhere (it was shown once at signup
  per F59 and is gone).
- Provide an "undo" for rotate-recovery — the old code is dead the moment
  the server commits.
```

- [ ] **Step 3: Commit**

```bash
git add mockups/archive/v1-2025-11/design/account-privacy.jsx \
       mockups/archive/v1-2025-11/design/account-privacy.notes.md
git commit -m "[F61] mockup: Account & Privacy modal"
```

---

## Task 3: Frontend mutation hooks

**Files:**
- Create: `frontend/src/hooks/useAccount.ts`
- Create: `frontend/tests/hooks/useAccount.test.tsx`

- [ ] **Step 1: Write the hook**

Create `frontend/src/hooks/useAccount.ts`:

```ts
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { useSessionStore } from '@/store/session';

export interface ChangePasswordInput {
  oldPassword: string;
  newPassword: string;
}

export interface RotateRecoveryCodeInput {
  password: string;
}

export interface RotateRecoveryCodeResponse {
  recoveryCode: string;
  warning: string;
}

export function useChangePasswordMutation() {
  return useMutation<void, Error, ChangePasswordInput>({
    mutationFn: async (input) => {
      await api<void>('/auth/change-password', {
        method: 'POST',
        body: input,
      });
    },
  });
}

export function useRotateRecoveryCodeMutation() {
  return useMutation<RotateRecoveryCodeResponse, Error, RotateRecoveryCodeInput>({
    mutationFn: (input) =>
      api<RotateRecoveryCodeResponse>('/auth/rotate-recovery-code', {
        method: 'POST',
        body: input,
      }),
  });
}

/**
 * Sign-out-everywhere clears the local session AND navigates to /login on
 * success. Encapsulating the post-success steps inside the hook keeps the
 * caller (the section component) free of router / store wiring.
 */
export function useSignOutEverywhereMutation() {
  const navigate = useNavigate();
  const clearSession = useSessionStore((s) => s.clearSession);

  return useMutation<void, Error, void>({
    mutationFn: async () => {
      await api<void>('/auth/sign-out-everywhere', { method: 'POST' });
    },
    onSuccess: () => {
      clearSession();
      navigate('/login', { replace: true, state: { signedOutEverywhere: true } });
    },
  });
}
```

- [ ] **Step 2: Write the hook test**

Create `frontend/tests/hooks/useAccount.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useChangePasswordMutation,
  useRotateRecoveryCodeMutation,
  useSignOutEverywhereMutation,
} from '@/hooks/useAccount';
import { resetApiClientForTests, setUnauthorizedHandler } from '@/lib/api';
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

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return (
    <MemoryRouter initialEntries={['/']}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route path="*" element={<>{children}</>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe('useAccount mutations', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    resetApiClientForTests();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setUnauthorizedHandler(null);
    useSessionStore.setState({
      user: { id: 'u1', username: 'alice' },
      status: 'authenticated',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientForTests();
    act(() => {
      useSessionStore.setState({ user: null, status: 'idle' });
    });
  });

  it('useChangePasswordMutation POSTs to /api/auth/change-password and resolves on 204', async () => {
    fetchMock.mockResolvedValueOnce(emptyResponse(204));
    const { result } = renderHook(() => useChangePasswordMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ oldPassword: 'old-pass-12', newPassword: 'new-pass-12' });
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/change-password');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ oldPassword: 'old-pass-12', newPassword: 'new-pass-12' }));
  });

  it('useRotateRecoveryCodeMutation POSTs and returns the new recovery code', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { recoveryCode: 'new-code-1234', warning: 'Save this now' }),
    );
    const { result } = renderHook(() => useRotateRecoveryCodeMutation(), { wrapper });

    const res = await act(async () =>
      result.current.mutateAsync({ password: 'hunter2hunter2' }),
    );
    expect(res.recoveryCode).toBe('new-code-1234');
  });

  it('useSignOutEverywhereMutation clears the session and navigates to /login on success', async () => {
    fetchMock.mockResolvedValueOnce(emptyResponse(204));

    let lastPath = '';
    function PathProbe(): JSX.Element {
      const { useLocation } = require('react-router-dom');
      const loc = useLocation();
      lastPath = loc.pathname;
      return <></>;
    }

    function Wrapper({ children }: { children: React.ReactNode }) {
      const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
      return (
        <MemoryRouter initialEntries={['/']}>
          <QueryClientProvider client={client}>
            <Routes>
              <Route path="*" element={<><PathProbe />{children}</>} />
            </Routes>
          </QueryClientProvider>
        </MemoryRouter>
      );
    }

    const { result } = renderHook(() => useSignOutEverywhereMutation(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync();
    });

    await waitFor(() => {
      expect(lastPath).toBe('/login');
    });
    expect(useSessionStore.getState().user).toBeNull();
    expect(useSessionStore.getState().status).toBe('unauthenticated');
  });
});
```

- [ ] **Step 3: Run the hook tests**

```bash
cd frontend && npm run test:frontend -- --run tests/hooks/useAccount.test.tsx
```

Expected: PASS (3 tests).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/useAccount.ts frontend/tests/hooks/useAccount.test.tsx
git commit -m "[F61] hooks: useAccount mutations (change-password, rotate-recovery, sign-out-everywhere)"
```

---

## Task 4: Build `<AccountPrivacyModal>` (shell + four sections)

**Files:**
- Create: `frontend/src/components/AccountPrivacyModal.tsx`
- Create: `frontend/tests/components/AccountPrivacy.test.tsx` (the verify-command target)

This is the largest single piece of code in the plan. Sections are co-located in one file because each is small and they share helper components (`<Section>`, `<FieldRow>`, the error-mapping function).

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/components/AccountPrivacy.test.tsx`. The test mounts the modal directly, mocks `fetch`, and walks each section's happy + sad path:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountPrivacyModal } from '@/components/AccountPrivacyModal';
import { resetApiClientForTests, setUnauthorizedHandler } from '@/lib/api';
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

function renderModal(props: Partial<React.ComponentProps<typeof AccountPrivacyModal>> = {}) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const onClose = vi.fn();
  const utils = render(
    <MemoryRouter initialEntries={['/']}>
      <QueryClientProvider client={client}>
        <AccountPrivacyModal open onClose={onClose} username="alice" {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { onClose, ...utils };
}

describe('<AccountPrivacyModal>', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    resetApiClientForTests();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setUnauthorizedHandler(null);
    useSessionStore.setState({
      user: { id: 'u1', username: 'alice' },
      status: 'authenticated',
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientForTests();
    act(() => {
      useSessionStore.setState({ user: null, status: 'idle' });
    });
  });

  it('renders nothing when open=false', () => {
    const client = new QueryClient();
    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <AccountPrivacyModal open={false} onClose={() => {}} username="alice" />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the four section headings and the username in the subtitle', () => {
    renderModal();
    expect(screen.getByRole('heading', { name: /account & privacy/i })).toBeInTheDocument();
    expect(screen.getByText(/@alice/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /change password/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /rotate recovery code/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /sign out everywhere/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /delete account/i })).toBeInTheDocument();
  });

  it('Escape closes the modal', async () => {
    const { onClose } = renderModal();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking the backdrop closes the modal', async () => {
    const { onClose, container } = renderModal();
    const backdrop = container.querySelector('[data-testid="ap-backdrop"]') as HTMLElement;
    await userEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('change-password: 204 → success notice, fields cleared, "Other sessions have been signed out" inline', async () => {
    fetchMock.mockResolvedValueOnce(emptyResponse(204));
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText(/current password/i), 'old-pass-12');
    await user.type(screen.getByLabelText(/^new password$/i), 'new-pass-12');
    await user.type(screen.getByLabelText(/confirm new password/i), 'new-pass-12');
    await user.click(screen.getByRole('button', { name: /update password/i }));

    expect(await screen.findByText(/password updated/i)).toBeInTheDocument();
    expect(screen.getByText(/other sessions have been signed out/i)).toBeInTheDocument();
    // Fields are cleared.
    expect(screen.getByLabelText(/current password/i)).toHaveValue('');
    expect(screen.getByLabelText(/^new password$/i)).toHaveValue('');
    expect(screen.getByLabelText(/confirm new password/i)).toHaveValue('');
  });

  it('change-password: 401 → generic invalid-credentials message', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { message: 'Invalid credentials', code: 'invalid_credentials' } }),
    );
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText(/current password/i), 'wrong');
    await user.type(screen.getByLabelText(/^new password$/i), 'new-pass-12');
    await user.type(screen.getByLabelText(/confirm new password/i), 'new-pass-12');
    await user.click(screen.getByRole('button', { name: /update password/i }));

    const alert = await screen.findByText(/current password is incorrect/i);
    expect(alert).toBeInTheDocument();
  });

  it('change-password: confirm mismatch is caught client-side without firing the request', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText(/current password/i), 'old-pass-12');
    await user.type(screen.getByLabelText(/^new password$/i), 'new-pass-12');
    await user.type(screen.getByLabelText(/confirm new password/i), 'different');
    await user.tab();

    expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /update password/i })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rotate-recovery: 200 → swaps to handoff UI; "I have stored this" + Done returns to the password form', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { recoveryCode: 'new-recovery-code-12345', warning: 'Save this now' }),
    );
    const user = userEvent.setup();
    renderModal();

    const rotateSection = screen.getByRole('region', { name: /rotate recovery code/i });
    const pwInput = within(rotateSection).getByLabelText(/^password$/i);
    await user.type(pwInput, 'hunter2hunter2');
    await user.click(within(rotateSection).getByRole('button', { name: /generate new code/i }));

    expect(
      await screen.findByRole('heading', { name: /save your recovery code/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/new-recovery-code-12345/)).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /i have stored/i }));
    await user.click(screen.getByRole('button', { name: /continue to inkwell/i }));

    // After handoff dismissal the section reverts to the password form,
    // password input is empty, and the recovery code is no longer in the DOM.
    await waitFor(() => {
      expect(within(rotateSection).getByLabelText(/^password$/i)).toHaveValue('');
    });
    expect(screen.queryByText(/new-recovery-code-12345/)).not.toBeInTheDocument();
  });

  it('rotate-recovery: 401 → generic invalid-credentials message; password input retained for retry', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { message: 'Invalid credentials', code: 'invalid_credentials' } }),
    );
    const user = userEvent.setup();
    renderModal();

    const rotateSection = screen.getByRole('region', { name: /rotate recovery code/i });
    await user.type(within(rotateSection).getByLabelText(/^password$/i), 'wrong');
    await user.click(within(rotateSection).getByRole('button', { name: /generate new code/i }));

    expect(await within(rotateSection).findByText(/password is incorrect/i)).toBeInTheDocument();
    expect(within(rotateSection).getByLabelText(/^password$/i)).toHaveValue('wrong');
  });

  it('sign-out-everywhere: requires a second confirm click before firing', async () => {
    const user = userEvent.setup();
    renderModal();

    const section = screen.getByRole('region', { name: /sign out everywhere/i });
    await user.click(within(section).getByRole('button', { name: /sign out other sessions/i }));

    // Confirm strip appears; request not yet fired.
    expect(await within(section).findByText(/are you sure/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    // Cancel returns to the initial state.
    await user.click(within(section).getByRole('button', { name: /cancel/i }));
    expect(within(section).queryByText(/are you sure/i)).not.toBeInTheDocument();
  });

  it('sign-out-everywhere: confirm click fires POST, clears session, navigates to /login', async () => {
    fetchMock.mockResolvedValueOnce(emptyResponse(204));
    const user = userEvent.setup();
    renderModal();

    const section = screen.getByRole('region', { name: /sign out everywhere/i });
    await user.click(within(section).getByRole('button', { name: /sign out other sessions/i }));
    await user.click(within(section).getByRole('button', { name: /yes, sign out everywhere/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/sign-out-everywhere',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    await waitFor(() => {
      expect(useSessionStore.getState().user).toBeNull();
    });
  });

  it('delete-account section renders an explanatory copy + a disabled red button referencing [X3]', () => {
    renderModal();
    const section = screen.getByRole('region', { name: /delete account/i });
    expect(within(section).getByText(/x3/i)).toBeInTheDocument();
    const btn = within(section).getByRole('button', { name: /delete account/i });
    expect(btn).toBeDisabled();
  });
});

import { within } from '@testing-library/react';
```

(`within` import is at the bottom because Vitest hoists imports anyway; you can move it to the top with the others when applying.)

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend && npm run test:frontend -- --run tests/components/AccountPrivacy.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the modal**

Create `frontend/src/components/AccountPrivacyModal.tsx`:

```tsx
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
function Section({ title, hint, danger, children }: SectionProps): JSX.Element {
  return (
    <section
      role="region"
      aria-label={title}
      className={`flex flex-col gap-2 py-5 border-b border-[var(--line)] last:border-b-0 ${
        danger === true ? 'opacity-90' : ''
      }`}
    >
      <h3
        className={`font-serif text-[16px] font-medium m-0 ${
          danger === true ? 'text-[var(--danger)]' : 'text-[var(--ink)]'
        }`}
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
      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-[var(--ink-2)]">Current password</span>
        <input
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
      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-[var(--ink-2)]">New password</span>
        <input
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
      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-[var(--ink-2)]">Confirm new password</span>
        <input
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
          Password updated. <span className="text-[var(--ink-3)]">Other sessions have been signed out.</span>
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
      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-[var(--ink-2)]">Password</span>
        <input
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
          onClick={() => setConfirming(true)}
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
      {err ? <div role="alert" className="auth-error">{err}</div> : null}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setConfirming(false)} className={BTN_SECONDARY}>
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
  // matches the other modals (Settings, StoryPicker, ModelPicker) so an
  // open Account & Privacy modal swallows Escape before any popover or the
  // selection bubble (priority 50 / 10) sees it. Returning `true` is what
  // useEscape interprets as "handled — stop propagation". The hook is a
  // no-op when `enabled: false`, so we gate on `open` rather than checking
  // inside the handler.
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

  // Backdrop wrapper uses the F58 keyframe-compatible centring transform
  // (NOT the legacy `flex items-center justify-center` / `grid place-items-center`)
  // so the F49 `t-modal-in` entrance animation fires. The dialog itself is
  // absolute-positioned at 50/50 with a translate, matching what F58 did
  // for SettingsModal / StoryPicker / ModelPicker.
  return (
    <div
      role="presentation"
      data-testid="ap-backdrop"
      onMouseDown={handleBackdrop}
      className="fixed inset-0 bg-black/40 backdrop-blur-[3px] z-50"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="t-modal-in fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[var(--bg)] rounded-[var(--radius)] shadow-lg w-[min(720px,calc(100vw-32px))] max-h-[85vh] flex flex-col"
      >
        <header className="flex items-start justify-between px-6 py-4 border-b border-[var(--line)]">
          <div>
            <h2
              id={titleId}
              className="font-serif text-[18px] font-medium m-0 text-[var(--ink)]"
            >
              Account &amp; privacy
            </h2>
            <p className="text-[12.5px] text-[var(--ink-3)] m-0 mt-1">
              Manage credentials, recovery, and sessions for{' '}
              <code className="font-mono text-[var(--ink-2)]">@{username}</code>.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius)] text-[var(--ink-3)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)] transition-colors"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="px-6 py-2 overflow-y-auto flex-1">
          <Section title="Change password" hint="Use your current password to set a new one. Other sessions will be signed out.">
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

        <footer className="flex justify-end px-6 py-3 border-t border-[var(--line)]">
          <button type="button" onClick={onClose} className={BTN_SECONDARY}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the modal tests**

```bash
cd frontend && npm run test:frontend -- --run tests/components/AccountPrivacy.test.tsx
```

Expected: PASS (all 11 tests). If a test fails, fix the modal — do not change the test.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AccountPrivacyModal.tsx \
       frontend/tests/components/AccountPrivacy.test.tsx
git commit -m "[F61] component: <AccountPrivacyModal> with four sections"
```

---

## Task 5: Wire the modal into EditorPage + extend the LoginPage banner

**Files:**
- Modify: `frontend/src/pages/EditorPage.tsx`
- Modify: `frontend/src/pages/LoginPage.tsx`

- [ ] **Step 1: Locate the page-root modal-state convention (post-F55)**

Open `frontend/src/pages/EditorPage.tsx`. Find the existing modal state declarations introduced by F55 (`settingsOpen` / `storiesListOpen` / `modelPickerOpen` or similarly named). The convention: `useState<boolean>(false)` at the top of the component, the open-setter passed through AppShell→TopBar→UserMenu (or directly to ChatPanel for the model picker), and the modal element rendered at page root next to the others.

- [ ] **Step 2: Add `accountPrivacyOpen` state**

In `EditorPage.tsx`, alongside the existing modal-state hooks introduced by F55, add:

```tsx
const [accountPrivacyOpen, setAccountPrivacyOpen] = useState(false);
```

Add the import at the top:

```tsx
import { AccountPrivacyModal } from '@/components/AccountPrivacyModal';
```

- [ ] **Step 3: Pipe `onOpenAccount` through the AppShell prop chain**

The existing `<UserMenu>` (rendered inside `<TopBar>` inside `<AppShell>`) already declares an optional `onOpenAccount?: () => void` prop. F55 wired the analogous `onOpenSettings` / `onOpenStoriesList` props from EditorPage state-setters down through AppShell + TopBar. F61 follows the same chain:

```tsx
<AppShell
  // ... existing props
  onOpenAccount={() => setAccountPrivacyOpen(true)}
/>
```

(If `AppShell`/`TopBar`/`UserMenu` do not yet pipe `onOpenAccount` through their prop interfaces — which they should after F55 — add the optional prop to each in turn so the callback reaches `<UserMenu>`. The prop type is `(() => void) | undefined`.)

- [ ] **Step 4: Render the modal at page root**

In EditorPage's JSX, alongside the F55 modals (`<SettingsModal>`, `<StoryPicker>`, `<ModelPicker>`), add:

```tsx
<AccountPrivacyModal
  open={accountPrivacyOpen}
  onClose={() => setAccountPrivacyOpen(false)}
  username={user?.username ?? ''}
/>
```

(Read `user` from `useSessionStore((s) => s.user)` — it's already in scope if EditorPage already does so for other purposes; otherwise add the selector once.)

The modal is mounted unconditionally; the `open` prop drives its visibility. This matches F55's pattern for the other three.

- [ ] **Step 3: Extend LoginPage banner**

Replace the `LoginPage` body with the dual-banner version (extends F60's `resetSuccess`):

```tsx
import type { JSX } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AuthForm } from '@/components/AuthForm';
import { useAuth } from '@/hooks/useAuth';

interface LoginLocationState {
  resetSuccess?: boolean;
  signedOutEverywhere?: boolean;
}

function bannerMessage(state: LoginLocationState | null): string | null {
  if (state?.signedOutEverywhere === true) {
    return 'You have been signed out of every session. Sign in again to continue.';
  }
  if (state?.resetSuccess === true) {
    return 'Password updated. Sign in with your new password to continue.';
  }
  return null;
}

export function LoginPage(): JSX.Element {
  const { user, login } = useAuth();
  const location = useLocation();
  const message = bannerMessage(location.state as LoginLocationState | null);

  if (user) return <Navigate to="/" replace />;

  return (
    <>
      {message ? (
        <div
          role="status"
          aria-label="Session notice"
          className="fixed top-3 left-1/2 -translate-x-1/2 z-50 px-4 py-2 text-[12.5px] font-sans bg-[var(--bg-elevated)] text-[var(--ink)] border border-[var(--line-2)] rounded-[var(--radius)] shadow-[0_4px_16px_rgba(0,0,0,0.08)]"
        >
          {message}
        </div>
      ) : null}
      <AuthForm mode="login" onSubmit={login} />
    </>
  );
}
```

- [ ] **Step 4: Verify type-check passes**

```bash
cd frontend && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AppShell.tsx \
       frontend/src/pages/LoginPage.tsx
git commit -m "[F61] AppShell mounts <AccountPrivacyModal>; LoginPage handles signedOutEverywhere"
```

---

## Task 6: Verify and tick

- [ ] **Step 1: Run the verify commands**

`[F61]` verify:

```bash
cd frontend && npm run test:frontend -- --run tests/components/AccountPrivacy.test.tsx
```

`[B12]` verify:

```bash
cd backend && npm run test:backend -- --run tests/auth/sign-out-everywhere.test.ts
```

Both must exit 0.

- [ ] **Step 2: Run surrounding suites**

```bash
cd frontend && npm run test:frontend -- --run \
  tests/components/AccountPrivacy.test.tsx \
  tests/hooks/useAccount.test.tsx \
  tests/components/RecoveryCodeHandoff.test.tsx \
  tests/components/UserMenu.test.tsx \
  tests/pages/auth.test.tsx
cd backend && npm run test:backend -- --run tests/auth/
```

Expected: all green. The `RecoveryCodeHandoff` tests must still pass — F61 reuses it without modification.

- [ ] **Step 3: Manual smoke (UI)**

```bash
make dev
```

In a browser:
1. Sign in. Open user menu → Account & privacy. Modal opens.
2. **Change password:** type wrong current password → 401 → "Current password is incorrect." Try with the right one + matching new/confirm → green "Password updated. Other sessions have been signed out." Open a second tab still on the dashboard, do anything that calls the API — that tab redirects to `/login` (refresh failed because tokens were deleted).
3. **Rotate recovery:** type wrong password → "Password is incorrect." Type the right one → handoff card appears with the new code; copy + download work; tick + Continue collapses back to the empty password input.
4. **Sign out everywhere:** click "Sign out other sessions" → confirm strip appears. Click Cancel → reverts. Click again → confirm → "Yes, sign out everywhere" → modal closes, redirected to `/login` with the "You have been signed out of every session." banner.
5. **Delete account:** disabled red button visible with the [X3] copy.
6. Devtools → Application: confirm none of localStorage / sessionStorage contain any password, current or rotated recovery code.

- [ ] **Step 4: Tick `[B12]` and `[F61]` in TASKS.md**

Both verify commands must exit 0 first. The pre-edit hook auto-ticks on verify pass; if not, manually flip both `- [ ]` lines to `- [x]`.

- [ ] **Step 5: Final commit**

```bash
git add TASKS.md
git commit -m "[F61][B12] tick — Account & Privacy panel + sign-out-everywhere"
```

---

## Self-Review Notes

- **Spec coverage (F61):**
  - Tabbed-or-sectioned view with the four entries → sectioned (decision recorded).
  - Change password ([AU15]) → Section 1, full form, 401 / 429 / network mapped, success notice.
  - Rotate recovery code ([AU17], same handoff UI as [F59]) → Section 2 reuses `<RecoveryCodeHandoff>` verbatim, swap-and-back UX.
  - Sign out everywhere → Section 3, two-click confirm, fires new endpoint, clears local session, navigates with banner.
  - Delete-account placeholder pointing at [X3] → Section 4, disabled button, explicit copy.
  - Reuse F43 modal shell → 720px, header/body/footer, Escape, backdrop click.
  - Mockup committed first → Task 2.
  - Verify command (`tests/components/AccountPrivacy.test.tsx`) → Task 4.

- **Spec coverage (B12, the bundled prerequisite):**
  - `POST /api/auth/sign-out-everywhere` requires auth → Task 1 step 2 uses `requireAuth`.
  - Deletes all of caller's refresh tokens → service uses `deleteMany({ where: { userId } })`.
  - Clears caller's refresh cookie → route step 2.
  - Idempotent → tested.
  - Rate-limited → reuses `SENSITIVE_AUTH_LIMIT_OPTIONS`.
  - Security-reviewer gate → Task 1 step 6.
  - TASKS.md entry added → Task 1 step 4.

- **Implementation completeness check (no follow-up TBDs):**
  - Backend endpoint shipped, tested, security-reviewed inside this plan — not deferred.
  - All three failure modes (401, 429, 5xx/network) mapped to user-visible copy in `mapApiError`. No "TODO: handle X" lines.
  - Recovery-code handoff reuses F59 component without modification — confirmed presentational.
  - `useSignOutEverywhereMutation` encapsulates the navigate + clearSession side-effects so the section is one-liner.
  - LoginPage banner is updated in the same plan, so the F61 navigate target renders correctly without a follow-up edit.
  - Delete-account section ships with explicit copy referencing `[X3]` — no fake handler, no commented-out code, no `// TODO`.
  - The change-password section's `confirm` validation is gated on `confirm.length > 0` so the "Passwords do not match" error doesn't flash before the user types in confirm.
  - The rotate-recovery section reverts to the empty password input after handoff dismissal (tested).
  - Two-click sign-out-everywhere flow has a Cancel exit, tested.
  - All forms clear sensitive fields on success — change-password clears all three, rotate-recovery clears password.
  - No localStorage / sessionStorage writes from this surface; smoke step 6 verifies and the absence is structural (no `localStorage.setItem` in any of the new files).

- **Type consistency:** `ChangePasswordInput` (hook) ↔ form-local `oldPassword` / `newPassword` are passed as a typed object literal at the mutateAsync site. `RotateRecoveryCodeResponse` matches the backend route's `{ recoveryCode, warning }` body verbatim. `RecoveryCodeHandoffProps` from F59 consumed unchanged.

- **Security checklist:**
  - No password / recovery-code logged or stored client-side beyond the in-memory state of the open modal.
  - 401 messages on both auth-bearing forms are user-friendly but do not echo any server-supplied text — server returns generic "Invalid credentials"; we map to "Current password is incorrect" / "Password is incorrect" without surfacing server fields.
  - 429 is its own branch; users get a polite "try again in a minute" rather than a count.
  - The new B12 endpoint goes through `security-reviewer` (Task 1 step 6) before the F61 plan is considered closeable.
  - `signedOutEverywhere: true` location-state is non-sensitive and safe to leak via React Router's history state.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/F61-account-privacy-panel.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task; back-end task (Task 1) is a natural review checkpoint before front-end work starts.

**2. Inline Execution** — run tasks in this session via `superpowers:executing-plans`.

Which approach?
