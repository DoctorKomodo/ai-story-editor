# Account & Privacy Modal — Rotate Recovery Code Redesign + Delete Account

## Problem

Two issues bundled because both touch the same modal surface:

1. **Rotate recovery code embeds the full signup interstitial.** Inside `Account & privacy → Rotate recovery code`, pressing "Generate new code" embeds the entire signup-time recovery-code interstitial inside the section card. The signup interstitial is a full-page `<main className="auth-screen">` with the Inkwell hero pane (logo + blockquote + version footer) on the left and the recovery card on the right; nesting that two-column layout inside a modal section card produces an inflated, broken-looking surface (see screenshot in the issue).

   Root cause: [`frontend/src/components/RecoveryCodeHandoff.tsx`](../../../frontend/src/components/RecoveryCodeHandoff.tsx) was built as a full-page interstitial for [F59] and reused verbatim from [`frontend/src/components/AccountPrivacyModal.tsx`](../../../frontend/src/components/AccountPrivacyModal.tsx) for [F61]'s rotate-recovery-code flow. The reuse comment at the top of `AccountPrivacyModal.tsx` already acknowledges this. There is no compact / layout-agnostic variant.

2. **Delete account is an unwired placeholder.** The "Delete account" section in the same modal renders a disabled red button with the copy "Coming with [X3]. This will require typing your password and the word DELETE." `[X3]` part (b) calls for actually wiring this. Since we're already restructuring the modal to host a takeover, delete-account gets the same takeover treatment now.

## Goal

1. Replace the embedded full-page recovery interstitial with a modal-takeover: while a freshly-issued recovery code is on screen the entire `AccountPrivacyModal` becomes the surface for it (header, description, and body all swap).
2. Wire delete-account end-to-end. Add `DELETE /api/users/me` on the backend. Frontend: the placeholder section becomes a real entry point that opens a delete-account takeover with a password + typed-`DELETE` confirmation, fires the mutation on confirm, clears the session, and navigates to `/login` with a banner.

Both takeovers share the same shell mechanism (a discriminated `Takeover` state), giving the modal one consistent surface-takeover pattern instead of two ad-hoc flows.

This spec covers `[X3]` part (b) — delete account — and the rotate-recovery redesign. `[X3]` part (a) (display-name editor) is **not** in scope; it's a separate kind of work (new section, no destructive surface) and would dilute the focus.

## Non-Goals

- Visual restyle of the code box, action buttons, warning copy, or confirm checkbox. The current visual treatment is correct; only the surface that hosts it changes.
- Changes to the other Account & privacy sections (change password, sign-out everywhere).
- Changes to `POST /api/auth/rotate-recovery-code` or any other existing backend behaviour.
- Changes to the signup-time recovery-code handoff (`/register` interstitial). It must look and behave identically to today.
- Display-name / username editing (`[X3]` part (a)).
- Soft-delete / grace period / account-restoration. Hard delete only.
- Email-confirmation step on delete. Password + typed-`DELETE` is the entire gate; the project has no transactional-email infrastructure.

## Architecture

Three components in play, with one new shared atom:

### `RecoveryCodeCard` (new — shared atom)

Layout-agnostic component containing the universally-shared innards of the recovery-code reveal:

- Code box (`recovery-code-box`, `user-select: all` monospace).
- "Copy" and "Download as .txt" buttons.
- Inline copy-failure fallback note ("Copy isn't available in this browser. Use Download, or select the code above and copy it manually.").
- "I have stored my recovery code somewhere safe." confirm checkbox.
- Primary button gated on the checkbox; label is a prop.

It does **not** render a heading, intro paragraph, or "Show once" warning callout. Those are chrome the consumer chooses.

Props:

```ts
interface RecoveryCodeCardProps {
  recoveryCode: string;
  username: string;
  primaryLabel: string;
  onConfirm: () => void;
  /** Test seam: see existing RecoveryCodeHandoff for rationale. */
  onDownload?: (filename: string, content: string) => void;
}
```

The copy/download internals (clipboard guard, `COPIED_FLASH_MS`, `buildDownloadBody`) move from `RecoveryCodeHandoff.tsx` into `RecoveryCodeCard.tsx` unchanged.

### `RecoveryCodeHandoff` (existing — slimmed)

Continues to own the signup-time full-page interstitial. After the refactor it composes `RecoveryCodeCard` inside its right pane and keeps the rest of its existing chrome:

- `<main className="auth-screen">` shell.
- `<aside className="auth-hero">` left pane with the feather icon, "Inkwell" wordmark, blockquote, and self-hosted version footer.
- Right pane heading (`<h1>Save your recovery code</h1>`), intro paragraph ("This is the only thing that can unlock your stories…"), and `recovery-code-warning` callout ("Show once. Inkwell does not store this anywhere it can read…").
- Composes `<RecoveryCodeCard primaryLabel="Continue to Inkwell" onConfirm={onContinue} ... />` for the code box + actions + checkbox + button.

The component's external props (`recoveryCode`, `username`, `onContinue`, `onDownload`) are unchanged. Visual result on the signup interstitial is pixel-identical to today.

### `AccountPrivacyModal` (existing — modal-takeover added, two variants)

Gains an explicit takeover state at modal-shell level:

```ts
type Takeover =
  | { kind: 'recovery-code'; code: string }
  | { kind: 'delete-account' }
  | null;
```

The discriminated-union shape lets the shell branch on variant without ad-hoc booleans. Both variants share the same close-gating policy (`dismissable=false`, X disabled while takeover is on) and the same return-to-normal-shell mechanic.

Behaviour:

- When `takeover === null` the modal renders today's normal shell (header "Account & privacy" with the existing description, body containing the section list).
- When `takeover.kind === 'recovery-code'`:
  - **Title:** `"Save your new recovery code"`
  - **Description:** `"Show once. Inkwell does not store this anywhere it can read. Lose your password and this code, and your stories are gone for good."` (the same string today's `recovery-code-warning` callout uses)
  - **Body:** `<RecoveryCodeCard primaryLabel="Done" onConfirm={dismissTakeover} recoveryCode={takeover.code} username={username} />`
  - **Sections list is not rendered.**
  - **Only exit:** the gated "Done" button after the confirm checkbox. Escape, backdrop, and X are all disabled.
- When `takeover.kind === 'delete-account'`:
  - **Title:** `"Delete your account"`
  - **Description:** `"This permanently deletes your account, all stories, chapters, characters, and chats. This cannot be undone."`
  - **Body:** `<DeleteAccountConfirmForm onCancel={dismissTakeover} onDeleted={handleDeleted} />`
  - **Sections list is not rendered.**
  - **Exits:** the form's "Cancel" button (returns to normal shell via `dismissTakeover`), or the destructive "Permanently delete account" button (fires mutation; on success the modal unmounts as part of session-clear + navigation). Escape, backdrop, and X are all disabled — the user must consciously choose Cancel or Confirm.
- `dismissTakeover` sets `takeover = null` and increments a `formKey: number` that's threaded into `RotateRecoverySection` as a React `key` so the section remounts with a clean password field. No effects, no refs.

The existing `closeBlocked` state and the `setCloseBlocked` plumbing through `RotateRecoverySection` are removed — close-blocking is derived directly from `takeover !== null` at the modal shell. One source of truth.

### `RotateRecoverySection` (existing — slimmed)

Loses local `issuedCode` state and its `RecoveryCodeHandoff` render branch. After the refactor it is a thin form:

- Password input with the existing `INPUT_CLASS` styling.
- Inline error display (`<div role="alert" className="auth-error">…</div>`) using the existing `mapApiError` plumbing.
- "Generate new code" button wired to `useRotateRecoveryCodeMutation`.

On mutation success it calls a new prop `onCodeIssued(code: string)` rather than setting local state. The parent (`AccountPrivacyModal`) sets the takeover. The section never sees the takeover shell directly.

Props become:

```ts
interface RotateRecoverySectionProps {
  username: string; // unchanged
  onCodeIssued: (code: string) => void; // new — replaces onShowRecoveryCode
}
```

`onShowRecoveryCode` is removed.

### `DeleteAccountSection` (rewrite of placeholder)

Replaces today's disabled placeholder. Renders a brief warning paragraph + a red "Delete account…" button. Click sets `takeover = { kind: 'delete-account' }`. The section itself holds no transient state (the destructive form lives in the takeover body), so it's a pure render of the trigger.

Props:

```ts
interface DeleteAccountSectionProps {
  onTrigger: () => void;
}
```

The Section copy stays in the `Section` component's `hint` slot — same as today's modal pattern for the other sections — so the body of the section is just the trigger button itself. (The current placeholder's body paragraph "Coming with [X3]…" is deleted; it was a placeholder.)

### `DeleteAccountConfirmForm` (new)

Co-located inside `AccountPrivacyModal.tsx` (same file, kept private — same pattern as `RotateRecoverySection`, `ChangePasswordSection`, etc.). Rendered as the takeover body when `takeover.kind === 'delete-account'`.

Renders:

- Password input (`autoComplete="current-password"`).
- "Type DELETE to confirm" input — case-sensitive match against the literal string `DELETE`.
- Inline error display via the existing `mapApiError` helper for mutation rejection.
- "Cancel" button — calls `props.onCancel` (which is the modal's `dismissTakeover`).
- Destructive "Permanently delete account" button — gated on `password.length > 0 && confirmText === 'DELETE'`. Submitting calls `useDeleteAccountMutation().mutateAsync({ password })`. On success calls `props.onDeleted()` which clears `useSessionStore`, clears the React Query cache, and navigates to `/login?reason=account-deleted`.

Props:

```ts
interface DeleteAccountConfirmFormProps {
  onCancel: () => void;
  onDeleted: () => void;
}
```

### Backend: `DELETE /api/users/me`

New endpoint added to `backend/src/routes/auth.routes.ts` (account-management ops cluster there alongside change-password / rotate-recovery-code / sign-out-everywhere; the file's already the right place).

Contract:

- Method: `DELETE`
- Path: `/api/users/me`
- Auth: required (existing auth middleware)
- Body: `{ password: string }` (Zod-validated; `password.min(1)` is enough at this layer — actual length policy is enforced at change-password / register, never here)
- Rate limit: existing `SENSITIVE_AUTH_LIMIT_OPTIONS` bucket
- Success: 204 No Content + `Set-Cookie` clearing the refresh-token cookie (same shape as `[B12]`'s sign-out-everywhere).
- Failure (wrong password): 401 with the same error body shape and same wall-clock timing as `[AU15]` change-password's wrong-password path. Equalisation uses an argon2id verify against a fixed dummy hash, identical pattern to `auth.service.ts`'s existing equalisation in `[AU10]` / `[AU15]`.

Service flow (`auth.service.ts` gains `deleteAccount(userId, password)`):

1. Look up user by `userId`.
2. `argon2.verify(user.passwordHash, password)`. Wrong password → throw `WrongPasswordError`. Equalise timing on the not-found path with a dummy verify.
3. Inside a single Prisma `$transaction`:
   - `prisma.refreshToken.deleteMany({ where: { userId } })`
   - `prisma.user.delete({ where: { id: userId } })` — schema cascade deletes Story → Chapter → Chat → Message and Story → Character / OutlineItem in the same statement set. The explicit `refreshToken.deleteMany` first is redundant given the cascade but documents intent and survives a future schema change that drops the cascade.
4. Return — the route handler clears the refresh cookie and responds 204.

The user's narrative content is encrypted with their DEK; deleting the user row drops both the wraps (on `User`) and the ciphertext (on cascaded child rows). No special crypto teardown — data is unrecoverable post-delete by design.

Plaintext password never logged or echoed. Standard 401 body on wrong password (no oracle that the user exists; the user *is* the caller, but the 401 still protects against a stolen access-token mid-session).

### Backend: `auth.service.ts` exports

Adds:

```ts
export async function deleteAccount(userId: string, password: string): Promise<void>;
```

Throws `WrongPasswordError` (the existing class used by `[AU15]` change-password) on bad password. Other errors propagate to the global error handler.

### Frontend: API client + hook

`frontend/src/lib/api.ts` gains:

```ts
export async function apiDeleteAccount(body: { password: string }): Promise<void>;
```

`frontend/src/hooks/useAccount.ts` gains:

```ts
export function useDeleteAccountMutation(): UseMutationResult<void, ApiError, { password: string }>;
```

Sits beside `useRotateRecoveryCodeMutation`, `useChangePasswordMutation`, `useSignOutEverywhereMutation`. No `onSuccess` invalidation is needed — the user is gone; the session-clear + navigation handles cache teardown.

### Frontend: post-delete navigation

`onDeleted` in `DeleteAccountConfirmForm` does:

1. `useSessionStore.getState().clear()` (or whichever method the store exposes — match `useSignOutEverywhereMutation`'s post-success path).
2. `queryClient.clear()`.
3. `navigate('/login?reason=account-deleted', { replace: true })`.

`/login` page renders a banner above the form when `reason === 'account-deleted'`: `"Your account has been deleted."` Inline in the existing login page; no new toast component.

## Data Flow

### Rotate recovery code

1. User opens the user menu → "Account & privacy" → modal opens with `takeover = null`.
2. In the Rotate section: enters password → clicks "Generate new code" → `useRotateRecoveryCodeMutation` runs.
3. On success the section calls `props.onCodeIssued(res.recoveryCode)`.
4. `AccountPrivacyModal` sets `takeover = { kind: 'recovery-code', code: res.recoveryCode }`. Render branches to takeover shell.
5. User copies and/or downloads the code, ticks the "I have stored my recovery code somewhere safe" checkbox, clicks "Done".
6. `RecoveryCodeCard` calls `onConfirm` → modal sets `takeover = null`, increments `formKey`.
7. Modal renders the normal shell again. `RotateRecoverySection` remounts (because `formKey` changed) with an empty password field. Other sections are visible again.

Failure path (wrong password, server error, network error): the mutation rejects with a mapped error. `RotateRecoverySection` displays the inline error message; `onCodeIssued` is not called; the modal stays in its normal shell. Identical to today's failure UX.

### Delete account

1. User opens the user menu → "Account & privacy" → modal opens with `takeover = null`.
2. In the Delete section: clicks "Delete account…" → modal sets `takeover = { kind: 'delete-account' }`.
3. Modal renders the delete-account takeover shell. User enters their password and types `DELETE` in the confirm field.
4. User clicks "Permanently delete account" → `useDeleteAccountMutation().mutateAsync({ password })` runs.
5. On success: form's `onDeleted` clears `useSessionStore`, clears the React Query cache, navigates to `/login?reason=account-deleted`. The modal unmounts as part of the route change. The login page shows a banner: "Your account has been deleted."
6. On failure (wrong password → 401, network error, rate-limit 429): inline error is shown in the takeover form; modal stays in delete-account takeover; user can fix the password or click Cancel.
7. Cancel path (any time before submit, or after a failure): user clicks "Cancel" → modal sets `takeover = null`, increments `formKey`. Returns to normal shell with all sections visible again. The delete form's local state is discarded with the unmounting form.

## Component / File Inventory

### Frontend

| Path | Action |
|---|---|
| `frontend/src/components/RecoveryCodeCard.tsx` | **Create** |
| `frontend/src/components/RecoveryCodeHandoff.tsx` | **Modify** — delegate code-box/actions/checkbox/button to `RecoveryCodeCard`; keep auth-screen + hero + heading/intro/warning |
| `frontend/src/components/AccountPrivacyModal.tsx` | **Modify** — Takeover discriminated union (recovery-code + delete-account), header/description/body switch by variant, close-gating derived from `takeover`, `RotateRecoverySection` slimmed to a form, new `DeleteAccountConfirmForm` co-located, `DeleteAccountSection` rewritten from placeholder to real trigger |
| `frontend/src/components/AccountPrivacyModal.stories.tsx` | **Modify** — add "Rotate takeover" and "Delete-account takeover" stories |
| `frontend/src/lib/api.ts` | **Modify** — `apiDeleteAccount({ password })` |
| `frontend/src/hooks/useAccount.ts` | **Modify** — `useDeleteAccountMutation` |
| `frontend/src/pages/LoginPage.tsx` | **Modify** — read `?reason=account-deleted` from the URL, render a banner above the form when present |
| `frontend/tests/components/RecoveryCodeCard.test.tsx` | **Create** — unit tests for the new atom |
| `frontend/tests/components/AccountPrivacyModal.test.tsx` | **Modify** — extend with takeover-mode behaviour tests for both variants |
| `frontend/tests/pages/recovery-code-handoff.test.tsx` | **Verify unchanged** — must continue to pass; the page composition is internally different but externally identical |
| `frontend/tests/pages/login.test.tsx` (or equivalent) | **Modify** — assert the `?reason=account-deleted` banner renders |
| `frontend/src/index.css` | **No change** — `.recovery-code-card`, `.recovery-code-warning`, `.recovery-code-box`, `.recovery-code-actions`, `.recovery-code-confirm` are reused as-is. The `.auth-screen` / `.auth-hero` rules stay too — only the signup-side `RecoveryCodeHandoff` uses them |

### Backend

| Path | Action |
|---|---|
| `backend/src/routes/auth.routes.ts` | **Modify** — add `DELETE /api/users/me` |
| `backend/src/services/auth.service.ts` | **Modify** — add `deleteAccount(userId, password)` with timing-equalised wrong-password path |
| `backend/tests/auth/delete-account.test.ts` | **Create** — happy path, wrong-password 401 with timing equalisation assertion, rate-limit 429, cascade verification (user's stories / chapters / characters / outline-items / chats / messages / refresh-tokens are deleted; another user's rows untouched), refresh cookie cleared on success |

## Testing

### `RecoveryCodeCard` (new)

- Renders the supplied `recoveryCode` inside `[data-testid="recovery-code-box"]`.
- Renders `primaryLabel` on the primary button.
- Primary button is `disabled` until the confirm checkbox is checked.
- Clicking primary button after confirming calls `onConfirm` once.
- Copy button: in jsdom-with-clipboard-mocked, success path flips the button label to "Copied" then back after `COPIED_FLASH_MS`.
- Copy button: when `navigator.clipboard?.writeText` is undefined or rejects, surfaces the fallback note ("Copy isn't available in this browser…") via `role="status"` and does not throw.
- Download button: with `onDownload` prop supplied, calls it with `inkwell-recovery-code-${username}.txt` and the documented body shape.

### `AccountPrivacyModal` (extended — recovery-code takeover)

- Initial render: title is "Account & privacy", section list visible, no takeover.
- Issuing a code (mock the mutation to resolve with `{ recoveryCode: 'TEST-CODE' }`): title swaps to "Save your new recovery code", description swaps to the "Show once" copy, sections list is no longer in the DOM, the code box contains `TEST-CODE`.
- While recovery-code takeover is on:
  - Pressing Escape does **not** close the modal.
  - Clicking the backdrop does **not** close the modal.
  - Clicking the X close button does **not** close the modal.
- "Done" after ticking the confirm checkbox: takeover dismisses, normal shell returns, password field in Rotate section is empty.
- Issuing a code, dismissing, then issuing a second code in the same modal session: works (verifies `formKey` remount).
- Mutation failure (mock rejection): error message is shown inline in the Rotate section; modal stays in normal shell; takeover does not trigger.

### `AccountPrivacyModal` (extended — delete-account takeover)

- Initial render: Delete section button is enabled (was disabled in placeholder).
- Click "Delete account…": modal swaps to delete-account takeover. Title is "Delete your account", description is the irreversible-loss warning, sections list is no longer in the DOM, password and DELETE inputs are visible.
- Destructive button is disabled until `password.length > 0 && confirmText === 'DELETE'` (case-sensitive).
- While delete-account takeover is on:
  - Pressing Escape does **not** close the modal.
  - Clicking the backdrop does **not** close the modal.
  - Clicking the X close button does **not** close the modal.
- Clicking "Cancel" returns to the normal shell with sections visible again.
- Submitting (mock mutation success): `useSessionStore.clear` is called, `queryClient.clear` is called, navigation to `/login?reason=account-deleted` happens.
- Submitting (mock 401 wrong-password): inline error appears in the form; modal stays in delete-account takeover; password field is not cleared so user can fix and retry.

### Backend `DELETE /api/users/me` (`backend/tests/auth/delete-account.test.ts`)

- Auth-required: anonymous request returns 401.
- Happy path: authenticated user with correct password → 204; refresh cookie cleared in `Set-Cookie`; user row gone; the user's stories, chapters, characters, outline items, chats, messages, refresh tokens are all gone (Prisma cascade); another seeded user's rows are untouched.
- Wrong password: 401 with the same body shape as `[AU15]`'s wrong-password response. Wall-clock timing within tolerance of the happy path's pre-delete verify (use the existing `[AU15]` timing-equalisation pattern; reuse its tolerance constant if exposed, otherwise mirror the test's existing percentile-based assertion).
- Rate limit: hammering the endpoint past `SENSITIVE_AUTH_LIMIT_OPTIONS` returns 429.
- Plaintext password is not present in any log line emitted during the test (assertion against the test logger sink already used by `[AU15]` / `[AU17]` tests).

### Existing tests

- `frontend/tests/pages/recovery-code-handoff.test.tsx` is run unchanged and must pass — composition is internally different but the externally-observable behaviour (page renders, copy/download/checkbox/continue all work) is preserved.

### Storybook

- `AccountPrivacyModal.stories.tsx` gains:
  - `RotateTakeover` — modal in recovery-code takeover with a hard-coded code.
  - `DeleteAccountTakeover` — modal in delete-account takeover with empty inputs and the destructive button disabled.

## Edge Cases & Behaviours

- **Multiple rotations in one session** — `formKey` increments on every takeover dismiss. Each rotation produces a fresh, empty password form via React's `key` semantics. No effect / ref dance.
- **Future takeovers** — `Takeover` is typed as a discriminated union so additional takeover kinds can be added without rewriting the shell switch. Two ship now (`recovery-code`, `delete-account`).
- **Close-block source of truth** — derived from `takeover !== null`. The previous `closeBlocked` state and the `onShowRecoveryCode` prop on `RotateRecoverySection` are deleted; there is exactly one place that decides whether the modal can close.
- **Description text duplication** — the "Show once" warning text exists in exactly two places after the refactor: the modal description (when recovery-code takeover is on) and the right-pane warning callout in `RecoveryCodeHandoff` (signup interstitial). It is not repeated inside `RecoveryCodeCard`. Two surfaces, one copy each.
- **Cancel during in-flight delete** — the destructive button stays disabled while the mutation is pending (`mutation.isPending`); Cancel remains enabled. If the user clicks Cancel mid-flight, the takeover dismisses and the mutation is allowed to resolve in the background. If it succeeds, the user is navigated away anyway (the form's `onDeleted` is wired through the mutation's `onSuccess`, not local state). If it fails, the error has nowhere to surface — acceptable; the user explicitly aborted.
- **Concurrent session use** — if the same user has another tab open when delete completes, that tab's next API call will 401 (refresh cookie cleared, refresh token rows gone, user gone). `useInitAuth` / the api client's existing 401 handling routes that tab to `/login` on its next interaction. No special cross-tab coordination needed.
- **Cascade scope** — Prisma schema cascade covers User → Story → Chapter → Chat → Message and User → Story → Character / OutlineItem and User → RefreshToken. No orphaned rows possible. Schema confirmed in `backend/prisma/schema.prisma` lines 13, 54, 60, 84, 93, 113, 124, 167, 176, 194, 201, 213, 220, 247, 253, 260.
- **Encryption teardown** — the user's DEK wraps live on the User row (`contentDekPassword*` and `contentDekRecovery*` columns). Deleting the User row drops the wraps; cascading deletes drop the ciphertext. No re-encryption / wipe pass needed; both halves of the envelope are gone in the same transaction.

## Out of Scope

- Visual changes to the code box, buttons, warning copy, or any colour/typography token.
- Touching the change-password / sign-out-everywhere sections.
- Changes to the signup interstitial's user-visible behaviour.
- Display-name editor (`[X3]` part (a)).
- Soft-delete / undo-delete grace window.

## Security Review

This change touches `auth.routes.ts`, `auth.service.ts`, and adds a new authenticated destructive endpoint that re-verifies the password and clears the refresh cookie. Per `CLAUDE.md`'s Security Review section, `security-reviewer` is required before ticking the delete-account task. Scope to confirm:

1. Decrypted password never logged or echoed.
2. 401 wall-clock equalisation matches `[AU15]`'s pattern (dummy argon2id verify on the not-found path, or equivalent).
3. Rate-limit bucket is the existing `SENSITIVE_AUTH_LIMIT_OPTIONS`, not a new looser one.
4. Refresh cookie is cleared on success with the same flags as login/logout (`Set-Cookie` Path=/, HttpOnly, SameSite, Max-Age=0).
5. Cascade deletes everything tied to the user — including the encrypted DEK wraps and ciphertext rows — in a single transaction.
6. No path leaks the cleartext password to the response, error envelope, or stack trace in production.

## Risks

- **Existing test for `RecoveryCodeHandoff` breaks if it asserts on internal DOM structure.** Mitigation: keep the same testids (`recovery-code-box`) and aria semantics; the test currently asserts on user-visible behaviour (copy, download, checkbox, continue), which is preserved.
- **`closeBlocked` plumbing removal.** The current implementation passes `setCloseBlocked` into `RotateRecoverySection` as `onShowRecoveryCode`; both names disappear. Mitigation: search-and-replace audit in the modal file as part of the refactor task; existing tests that exercise the close-block behaviour will catch a regression.
- **Delete-account UX is destructive and shipped behind only password + typed-DELETE.** No grace period, no email confirmation. Mitigation: takeover requires explicit click-through twice (button to enter takeover, then password + DELETE + destructive-coloured button); modal close paths during takeover are all disabled to prevent muscle-memory accidental confirms; close-on-success is via navigation, not Escape, so no risk of "Escape → oh I was about to confirm".
- **Cascade gap** — if the schema ever adds a new child entity referencing `User` without `onDelete: Cascade`, the delete will fail with a foreign-key violation. Mitigation: the test asserts every existing child table is empty for the deleted user, and the leak-test pattern (`[E12]`) already enumerates narrative tables.
