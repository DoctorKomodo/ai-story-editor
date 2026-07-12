# ConfirmDialog primitive — design

**bd issue:** `story-editor-8hb` — Extract ConfirmDialog primitive; migrate the bespoke Modal confirm dialogs
**Blocks:** `story-editor-6ze` (draft delete/fork data-safety) — its delete-warning modal must consume this primitive rather than hand-roll another bespoke dialog.
**Date:** 2026-07-10

---

## Problem

The codebase has three bespoke modal confirmation dialogs, each hand-composed from
`Modal` + `ModalHeader` + `ModalBody` + `ModalFooter` + `Button`, all with the same
shape: heading, one-line body, `[Cancel][action]` footer, `role="alertdialog"`,
`size="sm"`. There is no shared component. `story-editor-6ze` would add a fourth.

Per the "Duplication: file-and-block" rule in `CLAUDE.md`, the extraction goes on
the critical path rather than into a graveyard issue: 6ze is blocked on this.

### Correction to the bd issue text

The issue says "the 4 bespoke Modal confirm dialogs". **There are three.** Verified by
enumerating every `role="alertdialog"` and every `ModalFooter` consumer under
`frontend/src/`:

| # | Site | Nested in another Modal? | Confirm action |
|---|---|---|---|
| 1 | `components/messageRow/ResendConfirmDialog.tsx` (whole file) | No — standalone | `onConfirm` prop (regenerate-from-here) |
| 2 | `components/StoryPicker.tsx:266-301` | **Yes** | `scheduleDelete()` — 5s soft-delete + undo toast |
| 3 | `components/CharacterSheet.tsx:629-680` | **Yes** | `deleteMutation` — stays open + shows inline error on failure |

**`AccountPrivacyModal`'s delete-account flow is a deliberate non-target.** It is a
same-modal *takeover* (`takeover: {kind:'delete-account'}`), not a nested dialog: it
renders a full `DeleteAccountConfirmForm` requiring a password *and* the typed literal
`DELETE`, and its actions are raw `<button className={BTN_DANGER}>` inside the body,
not a `ModalFooter`. Forcing it through a Cancel/confirm primitive would mean adding a
password slot and a typed-confirmation slot that no other caller uses. It is not a
duplicate of this shape and is out of scope. Recorded here so a future reader does not
"discover" it as a missed migration.

### Relationship to `InlineConfirm`

`InlineConfirm` (in `design/primitives.tsx`) already exists and is **not** a candidate
for replacement. It is the *non-modal* confirm: an inline `<fieldset>` Delete/Cancel
pair that replaces content in-row, dismissed by outside-click via `useInlineConfirm`.
Used by `ChapterList`, `DraftList`, `CastTab` for row-level deletes. `ConfirmDialog` is
its modal sibling for higher-stakes, whole-object deletes. The two coexist; the new
component copies `InlineConfirm`'s test-id convention (`${testId}-confirm`,
`${testId}-cancel`).

---

## Design

### Placement

`frontend/src/design/primitives.tsx`, immediately after `InlineConfirm`. Story at
`frontend/src/design/ConfirmDialog.stories.tsx`, `title: 'Primitives/ConfirmDialog'`
— matching the established `Primitives/*` namespace used by every other design story.

### API

```ts
export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  body: ReactNode;
  /** Action-button label. "Delete" | "Confirm" | "Regenerate". */
  confirmLabel: string;
  /** Action-button variant. Default "danger". */
  confirmVariant?: 'danger' | 'primary';
  /** Default "Cancel". */
  cancelLabel?: string;
  /** Disables Cancel, puts a spinner on the action button. */
  pending?: boolean;
  /** Rendered role="alert" below the body. Dialog stays open. */
  error?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  testId?: string;
}
```

### Implementation sketch

```tsx
export function ConfirmDialog({
  open, title, body, confirmLabel, confirmVariant = 'danger',
  cancelLabel = 'Cancel', pending, error, onConfirm, onCancel, testId,
}: ConfirmDialogProps): JSX.Element {
  const titleId = useId();
  return (
    <Modal open={open} onClose={onCancel} labelledBy={titleId}
           size="sm" role="alertdialog" testId={testId}>
      <ModalHeader titleId={titleId} title={title} />
      <ModalBody>
        <p className="font-serif text-[13.5px] leading-[1.55] text-ink-2">{body}</p>
        {error ? (
          <p role="alert" className="mt-3 font-sans text-[12.5px] text-danger"
             data-testid={testId ? `${testId}-error` : undefined}>{error}</p>
        ) : null}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onCancel} disabled={pending}
                data-testid={testId ? `${testId}-cancel` : undefined}>
          {cancelLabel}
        </Button>
        <Button variant={confirmVariant} loading={pending} onClick={onConfirm}
                data-testid={testId ? `${testId}-confirm` : undefined}>
          {confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
```

### Decisions and their reasons

**Presentational, not stateful.** `pending` and `error` are props; the primitive never
awaits `onConfirm` and never maps errors. This mirrors `Modal`, which is itself
presentational (it takes `labelledBy` from the caller and owns no mutation state). It
preserves the three sites' divergent behavior exactly: CharacterSheet stays open and
renders its `mapError`-formatted message; StoryPicker fires into a soft-delete and
closes; ResendConfirmDialog just calls back.

**`dismissable` is left at `Modal`'s default of `true`, and is not exposed.** All three
inner modals are dismissable today. Two test suites pin the layered-Escape behavior
("Escape closes the confirm, leaves the parent modal open"). Tying `dismissable` to
`pending` would change that silently.

The mechanism deserves precision, because it is easy to get wrong and the wrong
version is load-bearing. Layering does **not** work via `e.stopPropagation()`.
`Modal` registers its Escape handler on `window` (`primitives.tsx:109`), and
`stopPropagation` does not prevent other listeners on the *same* target from firing —
that would need `stopImmediatePropagation`. Layering works because **only one window
listener is ever registered at a time**: when the confirm opens, the caller flips its
outer modal to `dismissable={false}` (`StoryPicker.tsx:133`, `CharacterSheet.tsx:450`),
whose effect (deps include `dismissable`) tears down and re-runs, hitting the
`if (!open || !dismissable || embedded) return;` early-out and registering nothing.
The inner modal's listener is the only one alive.

Two consequences. First, **the outer `dismissable` gate is the entire safety
mechanism** — a future "cleanup" that removes it on the belief that `stopPropagation`
covers the layering would silently break Escape. Second, effect *registration order*
is irrelevant, so extracting the dialog into its own component (which changes when its
effect runs relative to the parent's) cannot regress this.

**The primitive owns the heading id** via `useId`, unlike `Modal`. Nothing outside each
confirm dialog references its heading id, so all three can be deleted. Note the sites
differ: `StoryPicker` allocates a dedicated `confirmHeadingId` (`useId()`, line 95) and
`ResendConfirmDialog` a standalone `titleId`, but **`CharacterSheet` has no second
`useId`** — it derives `${headingId}-confirm` from the outer modal's base `headingId`.
Deleting the `-confirm` usages leaves that base id intact for the outer modal. Do not
go looking for a `useId()` in `CharacterSheet`'s confirm; there isn't one.

**Test-id suffixes are `-confirm` / `-cancel` / `-error`**, matching `InlineConfirm`'s
`${testId}-delete` / `${testId}-cancel` convention in spirit (a generic action button
should not be called "delete" when one caller labels it "Regenerate").

**All three root test ids stay exactly as they are today** (`resend-confirm`,
`story-picker-delete-confirm`, `character-sheet-confirm`). This is not cosmetic. The
tempting move — giving CharacterSheet's dialog `testId="character-sheet-delete"` so its
error id keeps today's spelling — **collides with the delete *trigger* button**, which
already carries `data-testid="character-sheet-delete"` (`CharacterSheet.tsx:604`) and is
queried by two tests. The Modal card would take the same id, and any
`getByTestId('character-sheet-delete')` would throw whenever the confirm is open. The
collision is invisible today only because those tests run with the confirm closed (the
Modal returns `null`). Keeping the roots unchanged avoids it entirely.

*Naming note:* because `character-sheet-confirm` already ends in "confirm", its derived
action button becomes `character-sheet-confirm-confirm`. Ugly, and referenced by no
test. New call sites (including 6ze) should pick a root that does not end in "confirm" —
e.g. `draft-delete-dialog` → `draft-delete-dialog-confirm`.

**No autofocus.** `Modal` wires no initial focus today despite its header comment
claiming it "handles … initial focus", and none of the three dialogs autofocus.
Adding it here would be an unrequested behavior change. This is a real a11y gap —
a destructive `alertdialog` should move focus into itself — but it belongs to `Modal`,
affects all seven modal consumers, and is filed separately rather than smuggled in.
(`useAutofocus` already exists in `primitives.tsx` if we take it up.)

---

## Accepted deltas

Consolidation is not free. Three intentional changes, each small:

1. **`ResendConfirmDialog` restyles.** Its body is `text-[13px]` sans and its buttons
   are `size="sm"`; the other two use `font-serif text-[13.5px] leading-[1.55]` and
   default `md` buttons. The primitive standardizes on the two-site majority. Net:
   the regenerate dialog's body becomes serif, its buttons grow 28px → 32px. Visual
   only. `ResendConfirmDialog.test.tsx` queries by role and text and stays green.
   *Rejected alternative:* a `size` / `bodyClassName` escape hatch to keep it
   pixel-identical — that re-admits the per-site divergence the primitive exists to
   remove, for one caller.

2. **A spinner appears on the confirm button while pending.** `Button loading` renders
   a `Spinner` and disables the button. CharacterSheet currently only swaps its label
   to "Deleting…"; it keeps that by passing
   `confirmLabel={deletePending ? 'Deleting…' : 'Confirm'}`, and now also shows the
   spinner. Consistent with `InlineConfirm`, which already passes `loading={pending}`.

3. **Derived test ids change; no test query does.** The buttons' and error's ids become
   `${testId}-confirm` / `-cancel` / `-error`, replacing the hand-written
   `character-sheet-confirm-cancel`, `character-sheet-confirm-delete`, and
   `character-sheet-delete-error`. A repo-wide grep confirms **no test references any of
   them** — all three suites query the confirm/cancel buttons and the alertdialog by
   role. So this delta costs zero test churn. It is listed only because a reader
   scanning the diff will see the ids change.

   (An earlier draft of this spec claimed three query strings had to change, and chose
   a dialog `testId` that would have collided with the delete trigger button. Both were
   wrong; see the test-id decision above.)

---

## Migration plan

Ordered easiest → riskiest, so the primitive is proven before it touches a nested modal.

### 1. `ResendConfirmDialog` (standalone)
The whole file collapses to a `ConfirmDialog` call with
`confirmVariant="primary"`, `confirmLabel="Regenerate"`, `testId="resend-confirm"`.
Keep the component as a thin named wrapper — `ChatSceneTab` imports it and it owns the
message-count pluralization. Its `useId` goes away.

### 2. `StoryPicker` (nested, soft-delete)
Swap lines 266-301 for a `ConfirmDialog` with `confirmLabel="Delete"`,
`testId="story-picker-delete-confirm"`, `onConfirm={handleConfirmDelete}`,
`onCancel={() => setConfirmingId(null)}`. `confirmHeadingId` (`useId`) is deleted.
The outer `dismissable={confirmingStory === null}` gate is untouched. The
`scheduleDelete` / undo-toast wiring is untouched.

**Keep the `{confirmingStory ? (…) : null}` wrapper.** `title` and `body` dereference
`confirmingStory.title`, so the dialog cannot be rendered unconditionally with
`open={confirmingId !== null}` — that throws on the closed state. The conditional
wrapper stays and `open` is passed as a bare `open`, exactly as today.

### 3. `CharacterSheet` (nested, stays open on error)
Swap lines 629-680. Keep `testId="character-sheet-confirm"` (see the test-id decision —
do **not** use `character-sheet-delete`, which the trigger button owns). `onCancel` keeps
its two-statement body (`setConfirmOpen(false); setDeleteError(null)`).
`error={deleteError}`, `pending={deletePending}`,
`confirmLabel={deletePending ? 'Deleting…' : 'Confirm'}`. `open={confirmOpen}` passes
straight through — unlike StoryPicker, nothing here is dereferenced, so no guard is
needed. The `${headingId}-confirm` id is deleted; the outer's base `headingId` stays.

---

## Testing

**New:** `frontend/tests/design/ConfirmDialog.test.tsx` covering the props matrix —
default `danger` variant vs `primary`; `cancelLabel` default and override;
`pending` disables Cancel and puts the button in `loading`; `error` renders a
`role="alert"` node and the dialog stays open; `onConfirm` / `onCancel` fire;
`role="alertdialog"` and the heading are wired via `aria-labelledby`.

**New:** `frontend/src/design/ConfirmDialog.stories.tsx` — `Default` (danger),
`Primary`, `Pending`, `WithError`.

**Regression net (must pass completely unmodified — no query and no assertion changes):**

| Suite | Pins |
|---|---|
| `tests/components/ResendConfirmDialog.test.tsx` | count pluralization, confirm/cancel callbacks |
| `tests/components/SceneTab.test.tsx`, `tests/components/ChatTab.test.tsx` | the resend dialog by `data-testid="resend-confirm"` — i.e. the **card test-id passthrough** from `ConfirmDialog.testId` |
| `tests/components/StoryPicker.test.tsx` | alertdialog accessible name, Cancel closes confirm only, **Escape cancels confirm and leaves picker open**, confirm → row hides + undo toast, timer expiry fires one DELETE |
| `tests/components/CharacterSheet.test.tsx` | confirm opens/closes, DELETE on confirm, Cancel keeps main modal open, **layered Escape** |

These suites are the whole safety argument for the nested migrations. If a migration
requires editing an assertion in them, that is a signal the migration is wrong — fix the
code, not the test.

**Known gap:** nothing tests CharacterSheet's stay-open-on-delete-error path. Its only
`role="alert"` assertion (line 155) covers the *fetch* error, not the delete error. So
`error={deleteError}` is preserved by inspection, not by a test. Adding that test is
optional in 8hb and worth doing.

**Verify line (unchanged from the bd issue):**
```
npm --prefix frontend run typecheck && npm --prefix frontend run test && npm --prefix frontend run lint:design
```

---

## Out of scope

- `AccountPrivacyModal` delete-account takeover (different shape — see above).
- `Modal` focus management / autofocus (pre-existing gap, all consumers, separate issue).
- `InlineConfirm` and its three callers (non-modal sibling, not a duplicate).
- `Settings.tsx`'s venice-key "Remove" button, which today has **no** confirmation at
  all. Adding one is a product change, not a migration.
