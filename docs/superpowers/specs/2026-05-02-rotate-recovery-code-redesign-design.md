# Rotate Recovery Code Redesign

## Problem

Inside `Account & privacy → Rotate recovery code`, pressing "Generate new code" embeds the entire signup-time recovery-code interstitial inside the section card. The signup interstitial is a full-page `<main className="auth-screen">` with the Inkwell hero pane (logo + blockquote + version footer) on the left and the recovery card on the right; nesting that two-column layout inside a modal section card produces an inflated, broken-looking surface (see screenshot in the issue).

Root cause: [`frontend/src/components/RecoveryCodeHandoff.tsx`](../../../frontend/src/components/RecoveryCodeHandoff.tsx) was built as a full-page interstitial for [F59] and reused verbatim from [`frontend/src/components/AccountPrivacyModal.tsx`](../../../frontend/src/components/AccountPrivacyModal.tsx) for [F61]'s rotate-recovery-code flow. The reuse comment at the top of `AccountPrivacyModal.tsx` already acknowledges this. There is no compact / layout-agnostic variant.

## Goal

Replace the embedded full-page interstitial with a modal-takeover. While a freshly-issued recovery code is on screen the entire `AccountPrivacyModal` becomes the surface for it: the modal header, description, and body all swap, and dismissal is blocked until the user explicitly confirms they have saved the code.

## Non-Goals

- Visual restyle of the code box, action buttons, warning copy, or confirm checkbox. The current visual treatment is correct; only the surface that hosts it changes.
- Changes to the other Account & privacy sections (change password, sign-out everywhere, delete account placeholder).
- Changes to `POST /api/auth/rotate-recovery-code` or any backend behaviour.
- Changes to the signup-time recovery-code handoff (`/register` interstitial). It must look and behave identically to today.

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

### `AccountPrivacyModal` (existing — modal-takeover added)

Gains an explicit takeover state at modal-shell level:

```ts
type Takeover = { kind: 'recovery-code'; code: string } | null;
```

The discriminated-union shape leaves room for future takeovers (e.g. a future "sign-out everywhere" confirmation) without rewriting the shell, but only the `recovery-code` variant ships now.

Behaviour:

- When `takeover === null` the modal renders today's normal shell (header "Account & privacy" with the existing description, body containing the section list).
- When `takeover` is set, the modal renders a takeover shell instead:
  - **Title:** `"Save your new recovery code"`
  - **Description:** `"Show once. Inkwell does not store this anywhere it can read. Lose your password and this code, and your stories are gone for good."` (the same string today's `recovery-code-warning` callout uses)
  - **Body:** `<RecoveryCodeCard primaryLabel="Done" onConfirm={dismissTakeover} recoveryCode={takeover.code} username={username} />`
  - **Sections list is not rendered.**
- While `takeover !== null`, all three implicit-close paths are disabled: Escape, backdrop click, and the modal's X button. The only exit is the gated "Done" button after the confirm checkbox.
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

## Data Flow

1. User opens the user menu → "Account & privacy" → modal opens with `takeover = null`.
2. In the Rotate section: enters password → clicks "Generate new code" → `useRotateRecoveryCodeMutation` runs.
3. On success the section calls `props.onCodeIssued(res.recoveryCode)`.
4. `AccountPrivacyModal` sets `takeover = { kind: 'recovery-code', code: res.recoveryCode }`. Render branches to takeover shell.
5. User copies and/or downloads the code, ticks the "I have stored my recovery code somewhere safe" checkbox, clicks "Done".
6. `RecoveryCodeCard` calls `onConfirm` → modal sets `takeover = null`, increments `formKey`.
7. Modal renders the normal shell again. `RotateRecoverySection` remounts (because `formKey` changed) with an empty password field. Other sections are visible again.

Failure path (wrong password, server error, network error): the mutation rejects with a mapped error. `RotateRecoverySection` displays the inline error message; `onCodeIssued` is not called; the modal stays in its normal shell. Identical to today's failure UX.

## Component / File Inventory

| Path | Action |
|---|---|
| `frontend/src/components/RecoveryCodeCard.tsx` | **Create** |
| `frontend/src/components/RecoveryCodeHandoff.tsx` | **Modify** — delegate code-box/actions/checkbox/button to `RecoveryCodeCard`; keep auth-screen + hero + heading/intro/warning |
| `frontend/src/components/AccountPrivacyModal.tsx` | **Modify** — hoist `issuedCode` to modal-shell `takeover` state, swap header/description/body when takeover is on, derive close-block from `takeover`, drop `closeBlocked` / `setCloseBlocked` / `onShowRecoveryCode` |
| `frontend/src/components/AccountPrivacyModal.stories.tsx` | **Modify** — add a "Rotate takeover" story rendering the modal mid-takeover |
| `frontend/tests/components/RecoveryCodeCard.test.tsx` | **Create** — unit tests for the new atom |
| `frontend/tests/components/AccountPrivacyModal.test.tsx` | **Modify** — extend with takeover-mode behaviour tests |
| `frontend/tests/pages/recovery-code-handoff.test.tsx` | **Verify unchanged** — must continue to pass; the page composition is internally different but externally identical |
| `frontend/src/index.css` | **No change** — `.recovery-code-card`, `.recovery-code-warning`, `.recovery-code-box`, `.recovery-code-actions`, `.recovery-code-confirm` are reused as-is. The `.auth-screen` / `.auth-hero` rules stay too — only the signup-side `RecoveryCodeHandoff` uses them |

## Testing

### `RecoveryCodeCard` (new)

- Renders the supplied `recoveryCode` inside `[data-testid="recovery-code-box"]`.
- Renders `primaryLabel` on the primary button.
- Primary button is `disabled` until the confirm checkbox is checked.
- Clicking primary button after confirming calls `onConfirm` once.
- Copy button: in jsdom-with-clipboard-mocked, success path flips the button label to "Copied" then back after `COPIED_FLASH_MS`.
- Copy button: when `navigator.clipboard?.writeText` is undefined or rejects, surfaces the fallback note ("Copy isn't available in this browser…") via `role="status"` and does not throw.
- Download button: with `onDownload` prop supplied, calls it with `inkwell-recovery-code-${username}.txt` and the documented body shape.

### `AccountPrivacyModal` (extended)

- Initial render: title is "Account & privacy", section list visible, no takeover.
- Issuing a code (mock the mutation to resolve with `{ recoveryCode: 'TEST-CODE' }`): title swaps to "Save your new recovery code", description swaps to the "Show once" copy, sections list is no longer in the DOM, the code box contains `TEST-CODE`.
- While takeover is on:
  - Pressing Escape does **not** close the modal.
  - Clicking the backdrop does **not** close the modal.
  - Clicking the X close button does **not** close the modal.
- "Done" after ticking the confirm checkbox: takeover dismisses, normal shell returns, password field in Rotate section is empty.
- Issuing a code, dismissing, then issuing a second code in the same modal session: works (verifies `formKey` remount).
- Mutation failure (mock rejection): error message is shown inline in the Rotate section; modal stays in normal shell; takeover does not trigger.

### Existing tests

- `frontend/tests/pages/recovery-code-handoff.test.tsx` is run unchanged and must pass — composition is internally different but the externally-observable behaviour (page renders, copy/download/checkbox/continue all work) is preserved.

### Storybook

- `AccountPrivacyModal.stories.tsx` gains a `RotateTakeover` story that renders the modal in takeover mode with a hard-coded code so the takeover layout can be visually reviewed.

## Edge Cases & Behaviours

- **Multiple rotations in one session** — `formKey` increments on every takeover dismiss. Each rotation produces a fresh, empty password form via React's `key` semantics. No effect / ref dance.
- **Future takeovers** — `Takeover` is typed as a discriminated union so additional takeover kinds can be added without rewriting the shell switch. None ship now.
- **Close-block source of truth** — derived from `takeover !== null`. The previous `closeBlocked` state and the `onShowRecoveryCode` prop on `RotateRecoverySection` are deleted; there is exactly one place that decides whether the modal can close.
- **Description text duplication** — the "Show once" warning text exists in exactly two places after the refactor: the modal description (when takeover is on) and the right-pane warning callout in `RecoveryCodeHandoff` (signup interstitial). It is not repeated inside `RecoveryCodeCard`. Two surfaces, one copy each.

## Out of Scope

- Visual changes to the code box, buttons, warning copy, or any colour/typography token.
- Touching other Account & privacy sections.
- Backend changes.
- Changes to the signup interstitial's user-visible behaviour.

## Risks

- **Existing test for `RecoveryCodeHandoff` breaks if it asserts on internal DOM structure.** Mitigation: keep the same testids (`recovery-code-box`) and aria semantics; the test currently asserts on user-visible behaviour (copy, download, checkbox, continue), which is preserved.
- **`closeBlocked` plumbing removal.** The current implementation passes `setCloseBlocked` into `RotateRecoverySection` as `onShowRecoveryCode`; both names disappear. Mitigation: search-and-replace audit in the modal file as part of the refactor task; existing tests that exercise the close-block behaviour will catch a regression.
