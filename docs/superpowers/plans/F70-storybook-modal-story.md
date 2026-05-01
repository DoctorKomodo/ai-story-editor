# [F70] Storybook Modal Story Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author `frontend/src/design/Modal.stories.tsx` with a stateful `ModalDemo` wrapper that exercises the five behavioural axes the `Modal` primitive's API exposes — `size`, `dismissable`, `role`, focus trap, and `labelledBy` wiring.

**Architecture:**
- Modal's `open` prop is parent-controlled. Rendering `<Modal open={true} ... />` from args alone never exercises the open-close transition, the focus trap on first input, or the ESC-to-close handler. A local `ModalDemo` component owns `useState` for `open` and renders a "Reopen modal" `<Button variant="ghost">` outside the modal so each story can re-trigger the open transition without a page refresh.
- The wrapper composes `ModalHeader` + `ModalBody` + `ModalFooter` with a single `<Field>` + `<Input>` inside the body to give the focus trap something to work with. Both `useId()` calls (one for `labelledBy` on Modal, one for `htmlFor` on Field) demonstrate the pattern HANDOFF.md prescribes.
- One story per behavioural axis (5 total): `Default`, `Small`, `Large`, `NotDismissable`, `AlertDialog`.
- No automated focus-trap test in this PR — manual verification via the checklist below. [X24] (Playwright theme-sweep) is the eventual automated layer.

**Decision points pinned in the plan:**
1. **Demo wrapper colocates with the stories**, not extracted to a shared file. Modal is the only primitive needing this pattern; YAGNI on a `_storyHelpers/` directory.
2. **Initial `open: true`** in the wrapper — Storybook lands you on the "modal is visible" state, not "click to see the modal". The reopen button is for re-triggering after dismissal during the same session.
3. **No props are exposed via Storybook controls panel.** The story's args ARE the wrapper's props, but flipping `dismissable` mid-modal-open is meaningless (the prop only matters at mount). Each story is a fixed configuration.
4. **`AlertDialog` story uses `dismissable: false`** — alert dialogs typically lack a close button (the user must explicitly Confirm or Cancel). Mirrors the nested confirm pattern in [CharacterSheet.tsx](../../frontend/src/components/CharacterSheet.tsx).

**Tech Stack:** Storybook 9.x, React 19, TypeScript strict, Tailwind v4, primitives from [frontend/src/design/primitives.tsx](../../frontend/src/design/primitives.tsx).

**Source-of-truth references:**
- [frontend/src/design/primitives.tsx:84-147](../../frontend/src/design/primitives.tsx#L84-L147) — Modal API surface (`open`, `onClose`, `labelledBy`, `size`, `dismissable`, `embedded`, `role`, `testId`, `children`).
- [frontend/src/design/primitives.tsx:155-211](../../frontend/src/design/primitives.tsx#L155-L211) — ModalHeader / ModalFooter / ModalBody.
- [frontend/src/components/CharacterSheet.tsx](../../frontend/src/components/CharacterSheet.tsx) — reference impl for nested `role="alertdialog"` confirm pattern.
- [docs/HANDOFF.md](../HANDOFF.md) § "Modal.stories.tsx — the one primitive that needs a wrapper" — the source snippet.

---

## File Structure

**Create (frontend):**
- `frontend/src/design/Modal.stories.tsx` — wrapper + 5 stories.

**Not touched:**
- `frontend/src/design/primitives.tsx` — no API changes.

---

## Task 1: Modal.stories.tsx

**Files:**
- Create: `frontend/src/design/Modal.stories.tsx`

- [ ] **Step 1: Create the file**

Verbatim from HANDOFF.md § "Modal.stories.tsx — the one primitive that needs a wrapper":

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import {
  Button,
  Field,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  useId,
} from './primitives';

function ModalDemo({
  size = 'md',
  dismissable = true,
  role = 'dialog',
}: {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  dismissable?: boolean;
  role?: 'dialog' | 'alertdialog';
}) {
  const [open, setOpen] = useState(true);
  const titleId = useId();
  const nameId = useId();
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Reopen modal
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        labelledBy={titleId}
        size={size}
        dismissable={dismissable}
        role={role}
      >
        <ModalHeader
          titleId={titleId}
          title="Edit character"
          onClose={dismissable ? () => setOpen(false) : undefined}
        />
        <ModalBody>
          <Field htmlFor={nameId} label="Name" hint="Required">
            <Input id={nameId} defaultValue="Lyra" />
          </Field>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => setOpen(false)}>
            Save
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}

const meta = {
  title: 'Primitives/Modal',
  component: ModalDemo,
} satisfies Meta<typeof ModalDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: {} };
export const Small: Story = { args: { size: 'sm' } };
export const Large: Story = { args: { size: 'lg' } };
export const NotDismissable: Story = { args: { dismissable: false } };
export const AlertDialog: Story = {
  args: { role: 'alertdialog', size: 'sm', dismissable: false },
};
```

(Differs from the HANDOFF.md snippet in one place: `ModalHeader.onClose` is conditional on `dismissable` so the close-X button correctly disappears in `NotDismissable` and `AlertDialog` stories. The snippet always passed it; that's a minor bug in the source doc.)

- [ ] **Step 2: Verify it builds**

Run: `cd frontend && npm run build-storybook -- --quiet`
Expected: PASS, no warnings about Modal stories.

- [ ] **Step 3: Manual focus-trap / dismissal verification (per story)**

Run: `cd frontend && npm run storybook`
Open: `http://localhost:6006`, navigate to `Primitives/Modal`.

For each story, verify the behaviours below. Capture results in the PR description as a tick-list.

| Story | Expected behaviour |
|---|---|
| Default | ESC closes. Click backdrop closes. Click "Reopen modal" outside re-opens. Tab cycles within modal. First focusable (Cancel button) receives focus on open. |
| Small | Card width = 360px. Otherwise identical to Default. |
| Large | Card width = 640px. Otherwise identical to Default. |
| NotDismissable | ESC is a no-op. Click backdrop is a no-op. No close-X in header. Only the Cancel/Save footer buttons close. |
| AlertDialog | Same as NotDismissable + the modal's `role` attribute is `alertdialog` (verify via DevTools inspector). Card width = 360px. |

- [ ] **Step 4: Theme parity**

Still in the Storybook UI, flip the Theme toolbar through paper / sepia / dark for the Default story. Confirm:
- Backdrop tint is visible against the underlying canvas in all three themes (the `--backdrop` token is `rgba(20, 18, 12, 0.4)` — alpha-blended, so it darkens any background).
- Modal card border is distinguishable from the elevated surface in dark theme.
- Modal animation (`t-modal-in` keyframe defined in [frontend/src/index.css:460-472](../../frontend/src/index.css#L460-L472)) plays on each reopen.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/design/Modal.stories.tsx
git commit -m "feat(storybook): Modal.stories.tsx with stateful wrapper + 5 behavioural-axis stories"
```

---

## Self-review notes (run before merge)

1. **Spec coverage:** All 5 behavioural axes (size, dismissable, role, focus trap, labelledBy) are exercised by at least one story. The focus-trap and `labelledBy` axes are checked manually rather than via dedicated stories — they're properties of every story, not separate configurations.
2. **Placeholder scan:** No TBDs. The verification matrix lists explicit DevTools checks rather than "verify a11y compliance".
3. **Type consistency:** `ModalDemo` props match `Modal`'s prop types — same union literals for `size` and `role`. No drift.
4. **Sequencing:** Single task; depends on [F68] (Storybook installed) and [F69] (Field/Input/Button stories establish the import patterns; not strictly required but conventional).
