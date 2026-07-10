# ConfirmDialog Primitive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract a shared `ConfirmDialog` primitive and migrate the three bespoke modal confirm dialogs onto it, so `story-editor-6ze` cannot add a fourth.

**Architecture:** `ConfirmDialog` is a *presentational* component in `frontend/src/design/primitives.tsx`, composed from the existing `Modal` / `ModalHeader` / `ModalBody` / `ModalFooter` / `Button` primitives. It owns its heading id (`useId`) and nothing else — `pending` and `error` are props, so each call site keeps its own mutation, error-mapping, and close-vs-stay-open behavior. It is the modal sibling of the existing non-modal `InlineConfirm`.

**Tech Stack:** React 19, TypeScript strict, Tailwind v4 (CSS-first tokens), Vitest + @testing-library/react (jsdom), Storybook (CSF3).

**Spec:** `docs/superpowers/specs/2026-07-10-confirm-dialog-primitive-design.md`
**bd issue:** `story-editor-8hb`

---

## Global Constraints

- TypeScript strict mode. No `any`.
- Design tokens only. `frontend/scripts/lint-design.mjs` (`npm --prefix frontend run lint:design`) rejects raw hex, Tailwind palette colors (`red-500`), `bg-white`/`text-black`, `shadow-md`, `focus:ring-*`, and bare `rgb()`/`hsl()`. `text-danger` and `bg-[var(--token)]` are permitted.
- Storybook is the UI source of truth. New primitives get a `Primitives/<Name>` story co-located in `frontend/src/design/`.
- Commit message format: `[story-editor-8hb] <brief description>`.
- A pre-commit hook runs `biome check --write` on staged files. Do not fight it; let it reformat.
- **The three existing regression suites must pass completely unmodified** — no query changes, no assertion changes. If a migration seems to require editing one, the migration is wrong. Fix the code.

### Existing-surface inventory (required by `docs/agent-workflow.md` §2)

Verified by grep/read before this plan was written:

| Thing | Exists? | Where | Decision |
|---|---|---|---|
| `Modal`, `ModalHeader`, `ModalBody`, `ModalFooter` | Yes | `frontend/src/design/primitives.tsx:61-247` | **Reuse.** Do not touch. |
| `Button` (`variant`, `size`, `loading`) | Yes | `primitives.tsx:255-302` | **Reuse.** `loading` already disables and renders a `Spinner` alongside children. |
| `InlineConfirm` + `useInlineConfirm` | Yes | `primitives.tsx:566-684` | **Not a duplicate.** Non-modal, row-level, outside-click dismissal. Coexists. Copy its `${testId}-*` id convention. |
| `useAutofocus` | Yes | `primitives.tsx:553-564` | **Do not wire up.** `Modal` has no focus management; adding it is `story-editor-g4x`, not this task. |
| `cx` classname merge | Yes | `primitives.tsx:51-53` | Reuse if needed. No `clsx` dependency exists. |
| `useId` | Yes | re-exported at `primitives.tsx:785` | Reuse. |
| A shared confirm *modal* | **No** | — | This is what we build. |
| `Primitives/*` story namespace | Yes | `frontend/src/design/*.stories.tsx` | Follow. |
| `frontend/tests/design/` | Yes | contains `ModalCentering.test.tsx` | Put the new unit test here. |

**No new dependency is added.**

---

## File Structure

- **Modify** `frontend/src/design/primitives.tsx` — add `ConfirmDialogProps` + `ConfirmDialog`, placed immediately after `InlineConfirm` (after line 684, before the `revealOnRowHover` block).
- **Create** `frontend/tests/design/ConfirmDialog.test.tsx` — unit tests for the props matrix.
- **Create** `frontend/src/design/ConfirmDialog.stories.tsx` — `Primitives/ConfirmDialog`.
- **Modify** `frontend/src/components/messageRow/ResendConfirmDialog.tsx` — collapse onto the primitive.
- **Modify** `frontend/src/components/StoryPicker.tsx:266-301` — swap the nested confirm.
- **Modify** `frontend/src/components/CharacterSheet.tsx:629-680` — swap the nested confirm.

Task 1 delivers the primitive. Tasks 2-4 each migrate exactly one call site, ordered easiest → riskiest, so the primitive is proven before it touches a nested modal. Each task is independently committable and independently reviewable.

---

## Task 1: The `ConfirmDialog` primitive

**Files:**
- Modify: `frontend/src/design/primitives.tsx` (insert after `InlineConfirm`, ~line 684)
- Test: `frontend/tests/design/ConfirmDialog.test.tsx` (create)
- Create: `frontend/src/design/ConfirmDialog.stories.tsx`

**Interfaces:**
- Consumes: `Modal`, `ModalHeader`, `ModalBody`, `ModalFooter`, `Button`, `useId` — all already in `primitives.tsx`.
- Produces: `ConfirmDialog` and `ConfirmDialogProps`, exported from `@/design/primitives`. Tasks 2-4 import `ConfirmDialog` from there. Derived test ids are exactly `${testId}-confirm`, `${testId}-cancel`, `${testId}-error`.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/design/ConfirmDialog.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '@/design/primitives';

type Props = ComponentProps<typeof ConfirmDialog>;

function renderDialog(overrides: Partial<Props> = {}): {
  onConfirm: ReturnType<typeof vi.fn>;
  onCancel: ReturnType<typeof vi.fn>;
} {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmDialog
      open
      title="Delete this thing?"
      body="This cannot be undone."
      confirmLabel="Delete"
      onConfirm={onConfirm}
      onCancel={onCancel}
      testId="cd"
      {...overrides}
    />,
  );
  return { onConfirm, onCancel };
}

describe('ConfirmDialog', () => {
  it('renders an alertdialog named by its heading', () => {
    renderDialog();
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this thing?' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    renderDialog({ open: false });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('defaults the action button to the danger variant and the cancel label to "Cancel"', () => {
    renderDialog();
    const confirm = screen.getByTestId('cd-confirm');
    expect(confirm).toHaveTextContent('Delete');
    expect(confirm.className).toMatch(/bg-\[var\(--danger\)\]/);
    expect(screen.getByTestId('cd-cancel')).toHaveTextContent('Cancel');
  });

  it('honours confirmVariant="primary" and a custom cancelLabel', () => {
    renderDialog({ confirmVariant: 'primary', confirmLabel: 'Regenerate', cancelLabel: 'Back' });
    const confirm = screen.getByTestId('cd-confirm');
    expect(confirm).toHaveTextContent('Regenerate');
    expect(confirm.className).toMatch(/bg-ink/);
    expect(screen.getByTestId('cd-cancel')).toHaveTextContent('Back');
  });

  it('fires onConfirm and onCancel', async () => {
    const user = userEvent.setup();
    const { onConfirm, onCancel } = renderDialog();
    await user.click(screen.getByTestId('cd-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId('cd-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons while pending', () => {
    renderDialog({ pending: true });
    expect(screen.getByTestId('cd-confirm')).toBeDisabled();
    expect(screen.getByTestId('cd-cancel')).toBeDisabled();
  });

  it('renders an error as role="alert" and keeps the dialog open', () => {
    renderDialog({ error: 'Could not delete.' });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Could not delete.');
    expect(alert).toHaveAttribute('data-testid', 'cd-error');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('omits derived test ids when no testId is given', () => {
    render(
      <ConfirmDialog
        open
        title="T"
        body="B"
        confirmLabel="Go"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // Derived ids must be absent, not the literal string "undefined-confirm".
    expect(screen.getByRole('button', { name: 'Go' })).not.toHaveAttribute('data-testid');
    expect(screen.getByRole('button', { name: 'Cancel' })).not.toHaveAttribute('data-testid');
    expect(screen.getByRole('alertdialog')).not.toHaveAttribute('data-testid');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm --prefix frontend run test -- --run tests/design/ConfirmDialog.test.tsx
```

Expected: FAIL. The import fails — `"ConfirmDialog" is not exported by src/design/primitives.tsx`.

- [ ] **Step 3: Implement `ConfirmDialog`**

In `frontend/src/design/primitives.tsx`, insert **after** the closing brace of `InlineConfirm` and **before** the `revealOnRowHover` comment block:

```tsx
/* ============================================================================
 * <ConfirmDialog/> — modal Cancel/confirm dialog.
 *
 * The modal sibling of <InlineConfirm/>. Presentational: `pending` and
 * `error` are props, so the caller keeps its own mutation, error mapping,
 * and close-vs-stay-open policy.
 *
 * `dismissable` is deliberately NOT exposed. Escape/backdrop close via
 * `onCancel`. When this dialog is nested inside another Modal, the CALLER
 * must gate the outer modal with `dismissable={!open}` — that gate is what
 * makes layered Escape work (it tears down the outer window listener, so
 * only one is ever registered). `stopPropagation` does not do this.
 * ========================================================================== */

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  body: ReactNode;
  /** Action-button label, e.g. "Delete" | "Confirm" | "Regenerate". */
  confirmLabel: string;
  /** Action-button variant. Default "danger". */
  confirmVariant?: 'danger' | 'primary';
  /** Default "Cancel". */
  cancelLabel?: string;
  /** Disables Cancel; puts a spinner on the action button. */
  pending?: boolean;
  /** Rendered role="alert" under the body. The dialog stays open. */
  error?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  /** Root id. Buttons/error derive `${testId}-confirm|-cancel|-error`. */
  testId?: string;
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  confirmVariant = 'danger',
  cancelLabel = 'Cancel',
  pending,
  error,
  onConfirm,
  onCancel,
  testId,
}: ConfirmDialogProps): JSX.Element {
  const titleId = useId();
  return (
    <Modal
      open={open}
      onClose={onCancel}
      labelledBy={titleId}
      size="sm"
      role="alertdialog"
      testId={testId}
    >
      <ModalHeader titleId={titleId} title={title} />
      <ModalBody>
        <p className="font-serif text-[13.5px] leading-[1.55] text-ink-2">{body}</p>
        {error ? (
          <p
            role="alert"
            className="mt-3 font-sans text-[12.5px] text-danger"
            data-testid={testId ? `${testId}-error` : undefined}
          >
            {error}
          </p>
        ) : null}
      </ModalBody>
      <ModalFooter>
        <Button
          variant="ghost"
          onClick={onCancel}
          disabled={pending}
          data-testid={testId ? `${testId}-cancel` : undefined}
        >
          {cancelLabel}
        </Button>
        <Button
          variant={confirmVariant}
          loading={pending}
          onClick={onConfirm}
          data-testid={testId ? `${testId}-confirm` : undefined}
        >
          {confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
```

Note: `ConfirmDialog` returns `JSX.Element`, not `JSX.Element | null`, even though `Modal` renders nothing when `open` is false. A JSX expression is typed `JSX.Element` regardless of the component's own return type. `ResendConfirmDialog.tsx:14` already does exactly this today.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm --prefix frontend run test -- --run tests/design/ConfirmDialog.test.tsx
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Add the Storybook story**

Create `frontend/src/design/ConfirmDialog.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ConfirmDialog } from './primitives';

const meta = {
  title: 'Primitives/ConfirmDialog',
  component: ConfirmDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    open: true,
    title: 'Delete "The Hollow Crown"?',
    body: 'This permanently removes the story and all its chapters, characters, outline, and chats.',
    confirmLabel: 'Delete',
    onConfirm: () => {},
    onCancel: () => {},
    testId: 'confirm-dialog',
  },
} satisfies Meta<typeof ConfirmDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Default: destructive action, danger button. */
export const Default: Story = {};

/** Non-destructive action — the regenerate-from-here confirm. */
export const Primary: Story = {
  args: {
    title: 'Regenerate from here?',
    body: 'This will delete 7 messages below and regenerate the reply.',
    confirmLabel: 'Regenerate',
    confirmVariant: 'primary',
  },
};

/** In flight: Cancel is disabled and the action button shows a spinner. */
export const Pending: Story = {
  args: { confirmLabel: 'Deleting…', pending: true },
};

/** The action failed. The dialog stays open and shows the reason. */
export const WithError: Story = {
  args: { error: 'Could not delete the story. Please try again.' },
};
```

- [ ] **Step 6: Typecheck, design-lint, and run the full frontend suite**

```bash
npm --prefix frontend run typecheck && \
npm --prefix frontend run lint:design && \
npm --prefix frontend run test -- --run
```

Expected: typecheck clean; `✓ No design-token drift.`; all suites pass (the new file adds 8 tests, nothing else changes).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/design/primitives.tsx \
        frontend/src/design/ConfirmDialog.stories.tsx \
        frontend/tests/design/ConfirmDialog.test.tsx
git commit -m "[story-editor-8hb] add ConfirmDialog primitive + story + tests"
```

---

## Task 2: Migrate `ResendConfirmDialog`

The standalone site. Proves the primitive against a real caller before touching a nested modal.

**Files:**
- Modify: `frontend/src/components/messageRow/ResendConfirmDialog.tsx` (whole file)
- Tests (must pass unmodified): `frontend/tests/components/ResendConfirmDialog.test.tsx`,
  `frontend/tests/components/SceneTab.test.tsx`, `frontend/tests/components/ChatTab.test.tsx`

**Three suites, not one.** `SceneTab.test.tsx:723,1168` and `ChatTab.test.tsx:482,535,626`
drive this dialog through `ChatSceneTab` and query it by `data-testid="resend-confirm"`.
They stay green only because `ConfirmDialog` forwards `testId` straight to the `Modal`
card (`primitives.tsx:128`), so the card keeps that id. That passthrough is load-bearing
— if it ever regresses, these two suites are the only thing that catches it.

**Interfaces:**
- Consumes: `ConfirmDialog` from `@/design/primitives` (Task 1).
- Produces: nothing new. `ResendConfirmDialogProps` (`{ count, onConfirm, onCancel }`) is unchanged — `ChatSceneTab.tsx:422-428` renders it and must not need editing.

**Accepted visual delta (from the spec, expected — do not "fix"):** the body becomes `font-serif text-[13.5px]` instead of `text-[13px]`, and the buttons grow from `size="sm"` (28px) to the default `md` (32px). The existing tests query by role and text, so they stay green.

- [ ] **Step 1: Rewrite the component**

Replace the entire contents of `frontend/src/components/messageRow/ResendConfirmDialog.tsx`:

```tsx
import type { JSX } from 'react';
import { ConfirmDialog } from '@/design/primitives';

export interface ResendConfirmDialogProps {
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Thin wrapper over the ConfirmDialog primitive. Kept as a named component
 * because it owns the message-count pluralization and ChatSceneTab imports it.
 */
export function ResendConfirmDialog({
  count,
  onConfirm,
  onCancel,
}: ResendConfirmDialogProps): JSX.Element {
  return (
    <ConfirmDialog
      open
      title="Regenerate from here?"
      body={`This will delete ${String(count)} ${count === 1 ? 'message' : 'messages'} below and regenerate the reply.`}
      confirmLabel="Regenerate"
      confirmVariant="primary"
      onConfirm={onConfirm}
      onCancel={onCancel}
      testId="resend-confirm"
    />
  );
}
```

The local `useId` is gone (the primitive owns the heading id). `Modal`/`ModalBody`/`ModalFooter`/`ModalHeader`/`Button` imports are gone.

- [ ] **Step 2: Run all three regression suites unmodified**

```bash
npm --prefix frontend run test -- --run \
  tests/components/ResendConfirmDialog.test.tsx \
  tests/components/SceneTab.test.tsx \
  tests/components/ChatTab.test.tsx
```

Expected: PASS. `ResendConfirmDialog.test.tsx` has 3 tests (7-messages plural, 1-message singular, cancel callback), all querying by role/text. `SceneTab`/`ChatTab` additionally assert `findByTestId('resend-confirm')`, its body text (`'3 messages'`), and a `Regenerate` button inside it. **If any assertion fails, do not edit the test** — the primitive is wrong.

- [ ] **Step 3: Confirm the card test-id passthrough survived**

```bash
grep -rn "resend-confirm" frontend/src frontend/tests
```

Expected: 6 hits — the `testId="resend-confirm"` line in the component, plus 5 test references (`SceneTab.test.tsx:723,1168`; `ChatTab.test.tsx:482,535,626`). Those tests query the Modal **card**'s id, which `ConfirmDialog` forwards from `testId`. If they fail, the passthrough broke — do not "fix" it by editing the tests.

- [ ] **Step 4: Typecheck + full suite**

```bash
npm --prefix frontend run typecheck && npm --prefix frontend run test -- --run
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/messageRow/ResendConfirmDialog.tsx
git commit -m "[story-editor-8hb] migrate ResendConfirmDialog onto ConfirmDialog"
```

---

## Task 3: Migrate `StoryPicker`'s delete confirm

First nested modal. The soft-delete/undo wiring and the outer `dismissable` gate must survive untouched.

**Files:**
- Modify: `frontend/src/components/StoryPicker.tsx` (lines 266-301; also delete the now-unused `confirmHeadingId`)
- Test (must pass unmodified): `frontend/tests/components/StoryPicker.test.tsx`

**Interfaces:**
- Consumes: `ConfirmDialog` from `@/design/primitives`.
- Produces: nothing.

**Do not touch:**
- `dismissable={confirmingStory === null}` on the **outer** `Modal` (line 133). This is the entire layered-Escape mechanism — it removes the outer `window` keydown listener while the confirm is open. Removing it silently breaks the "Escape cancels the confirm, leaves the picker open" test.
- `handleConfirmDelete` (lines 121-125) and the `scheduleDelete` / undo-toast flow.

- [ ] **Step 1: Replace the nested confirm**

Replace lines 266-301 (the `{confirmingStory ? (<Modal …>…</Modal>) : null}` block) with:

```tsx
      {confirmingStory ? (
        <ConfirmDialog
          open
          title={`Delete "${confirmingStory.title || 'Untitled'}"?`}
          body="This permanently removes the story and all its chapters, characters, outline, and chats."
          confirmLabel="Delete"
          onConfirm={handleConfirmDelete}
          onCancel={() => {
            setConfirmingId(null);
          }}
          testId="story-picker-delete-confirm"
        />
      ) : null}
```

**Keep the `{confirmingStory ? … : null}` wrapper.** `title` dereferences `confirmingStory.title`; rendering the dialog unconditionally with `open={confirmingId !== null}` throws on the closed state.

- [ ] **Step 2: Delete the now-unused heading id**

Remove `const confirmHeadingId = useId();` at `StoryPicker.tsx:95`. **Keep `headingId` (line 94)** — the outer modal still uses it at lines 131 and 138. If `useId` has no other caller in the file, drop it from the React import; `tsc` and biome will tell you.

- [ ] **Step 3: Add the import**

Add `ConfirmDialog` to the existing `@/design/primitives` import. `Modal`, `ModalHeader`, `ModalBody`, `ModalFooter` are still used by the outer picker modal — do not remove them. `Button` may still be used elsewhere in the file; check before removing.

- [ ] **Step 4: Run the regression suite unmodified**

```bash
npm --prefix frontend run test -- --run tests/components/StoryPicker.test.tsx
```

Expected: PASS. The load-bearing cases:
- the confirm is a `role="alertdialog"` named `/delete "dune"/i`
- Cancel closes the confirm and fires no delete
- **Escape cancels the confirm and leaves the picker open**
- confirming hides the row and shows the undo toast
- timer expiry fires exactly one DELETE

**If the Escape test fails, the outer `dismissable` gate was disturbed.** Restore it. Do not edit the test.

- [ ] **Step 5: Typecheck + full suite**

```bash
npm --prefix frontend run typecheck && npm --prefix frontend run test -- --run
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/StoryPicker.tsx
git commit -m "[story-editor-8hb] migrate StoryPicker delete-confirm onto ConfirmDialog"
```

---

## Task 4: Migrate `CharacterSheet`'s delete confirm

The riskiest site: nested modal, stays open on error, swaps its button label while pending.

**Files:**
- Modify: `frontend/src/components/CharacterSheet.tsx` (lines 629-680)
- Test (must pass unmodified): `frontend/tests/components/CharacterSheet.test.tsx`, `frontend/tests/components/CharacterSheet.create.test.tsx`

**Interfaces:**
- Consumes: `ConfirmDialog` from `@/design/primitives`.
- Produces: nothing.

**Do not touch:**
- `dismissable={!confirmOpen}` on the **outer** `Modal` (line 450) — the layered-Escape mechanism.
- `handleConfirmDelete` (lines 427-436), `deleteMutation`, `deleteError`, `mapError`.

**Test-id rule:** keep `testId="character-sheet-confirm"`. Do **not** use `character-sheet-delete` — the delete *trigger* button already owns that id (`CharacterSheet.tsx:604`, queried by `CharacterSheet.test.tsx:484` and `CharacterSheet.create.test.tsx:110`). Reusing it would put the same `data-testid` on the Modal card whenever the confirm is open, and `getByTestId` would throw.

- [ ] **Step 1: Replace the nested confirm**

Replace lines 629-680 (the whole second `<Modal>…</Modal>`) with:

```tsx
      <ConfirmDialog
        open={confirmOpen}
        title="Delete this character?"
        body="Delete this character? This cannot be undone."
        confirmLabel={deletePending ? 'Deleting…' : 'Confirm'}
        pending={deletePending}
        error={deleteError}
        onConfirm={() => {
          void handleConfirmDelete();
        }}
        onCancel={() => {
          setConfirmOpen(false);
          setDeleteError(null);
        }}
        testId="character-sheet-confirm"
      />
```

Notes:
- `open={confirmOpen}` passes straight through — unlike StoryPicker, nothing is dereferenced, so no conditional wrapper is needed.
- `onCancel` keeps **both** statements. It is wired to Escape/backdrop as well as the Cancel button, so dropping `setDeleteError(null)` would leave a stale error on reopen.
- The derived ids become `character-sheet-confirm-confirm` / `-cancel` / `-error`. No test queries any of them (all three query by role) — verified by grep. The doubled `-confirm-confirm` is cosmetic; do not "fix" it by changing the root id.

- [ ] **Step 2: Delete the now-unused confirm heading id usages**

The confirm used `` labelledBy={`${headingId}-confirm`} `` and `` titleId={`${headingId}-confirm`} ``. Both go away with the block. **Keep `headingId` itself** (`useId()`, line 356) — the outer modal uses it at lines 448 and 454. There is no second `useId` to remove here.

- [ ] **Step 3: Add the import**

Add `ConfirmDialog` to the `@/design/primitives` import. The outer modal still uses `Modal`, `ModalHeader`, `ModalBody`, `ModalFooter`, and `Button` — do not remove them.

- [ ] **Step 4: Run the regression suites unmodified**

```bash
npm --prefix frontend run test -- --run \
  tests/components/CharacterSheet.test.tsx \
  tests/components/CharacterSheet.create.test.tsx
```

Expected: PASS. The load-bearing cases:
- Delete opens an in-modal `alertdialog` (absent before the click)
- Confirm fires DELETE and closes the main modal on success
- Cancel dismisses the confirm and keeps the main modal open
- **Escape closes only the confirm when it is open, else closes the main modal**

**There is no delete-failure test.** `error={deleteError}` is wired and correct, but no
suite exercises it — the only `role="alert"` assertion in `CharacterSheet.test.tsx` (line
155) is the *fetch*-error path, not delete. So the stay-open-on-error behavior is
**unguarded**. Do not let that tempt you into weakening the wiring; if you have budget,
adding that missing test is a welcome extra, but it is not required by this task.

**A transient `<Spinner role="status">` now renders on the confirm button while pending** (accepted delta 2). The only `getByRole('status')` in this suite is on the GET-pending path, so it does not collide. If it somehow does, that is a real finding — report it, do not silence the test.

- [ ] **Step 5: Typecheck, design-lint, full suite**

```bash
npm --prefix frontend run typecheck && \
npm --prefix frontend run lint:design && \
npm --prefix frontend run test -- --run
```

- [ ] **Step 6: Verify no bespoke confirm dialog survives**

```bash
grep -rn 'role="alertdialog"' frontend/src/
```

Expected: **exactly one hit** — `role="alertdialog"` inside `ConfirmDialog` in `frontend/src/design/primitives.tsx`. Nothing under `frontend/src/components/**` matches. (`Modal.stories.tsx:75` writes `role: 'alertdialog'` with single quotes and `primitives.tsx:72` mentions it only in prose, so neither is in this pattern's result set.)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/CharacterSheet.tsx
git commit -m "[story-editor-8hb] migrate CharacterSheet delete-confirm onto ConfirmDialog"
```

---

## Verify (the bd `verify:` line)

```bash
npm --prefix frontend run typecheck && npm --prefix frontend run test && npm --prefix frontend run lint:design
```

## Out of scope (do not do these)

- `AccountPrivacyModal`'s delete-account takeover — a password + typed-`DELETE` form, not a Cancel/confirm dialog. Deliberate non-target.
- `Modal` focus management (no initial focus, no trap, no restore) — filed as `story-editor-g4x`. Adding it here would smuggle a behavior change into a refactor.
- `InlineConfirm` and its three callers — the non-modal sibling, not a duplicate.
- `Settings.tsx`'s venice-key "Remove" button, which has no confirmation today. Adding one is a product change.
