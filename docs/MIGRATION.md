# Inkwell Design System Migration

**Goal:** every component in `frontend/src/components/` and `frontend/src/pages/` renders with design tokens (`var(--ink)`, `border-line`, `bg-bg-elevated`, `font-serif`/`font-mono`) and primitives (`<Modal>`, `<Button>`, `<Field>`) — no raw Tailwind color literals (`neutral-*`, `red-*`, `blue-*`, `gray-*`), no hardcoded hex codes, no ad-hoc `shadow-md`/`shadow-lg`.

When this table is all green, the live UI matches the prototype and Claude Code can hand off new features without porting glue.

---

## Phase 0 — dead-code audit (do this first)

**Don't migrate anything until you've deleted the orphans.** A 🔴 component that nothing imports is wasted work. Confirmed dead at audit time:

| Component | Why it's dead |
|---|---|
| `AIPanel.tsx` | Unmounted at F55 — `EditorPage` no longer imports it. Composer is `ChatComposer` + `ChatMessages`. |
| `ModelSelector.tsx` | Replaced by `ModelPicker` (used inside `ChatComposer`). Zero imports. |
| `WebSearchToggle.tsx` | Logic inlined into `ChatComposer` (`showWebSearchToggle`). Zero imports. |
| `StoryCard.tsx` | Earlier dashboard concept; superseded by `StoryPicker` (incl. its `embedded` mode). Zero imports. |

**Action:** delete these four files + their tests + any types they export. Re-grep after deletion to confirm nothing dangles.

**Audit method** (run before each phase):
```sh
# For each candidate component, check for any importers:
rg -l "import.*\\b<ComponentName>\\b|<<ComponentName>" frontend/src
# Zero hits → orphan → delete, don't migrate.
```

Re-run this against every 🟡 in the table before you spot-check it. If nobody imports it, it's not partial — it's dead.

---

## Where things live

```
frontend/src/
├── index.css             ← tokens + @theme block (already in repo)
├── design/
│   ├── primitives.tsx    ← Modal, Button, Field, Input, Textarea, Pill, IconButton (NEW)
│   └── README.md         ← when to use what
├── components/           ← migration target
└── pages/                ← migration target
```

**Tokens already exist.** `frontend/src/index.css` defines every CSS variable (paper / sepia / dark) and contains the Tailwind v4 `@theme` block that exposes them as utilities. **Do not add a separate `design/tokens.css` file** — there is no need to, and a duplicate definition will silently drift.

**There is no `tailwind.config.ts`.** The project is on Tailwind v4, which uses the CSS-first `@import "tailwindcss"` + `@theme { … }` model. The `@theme` block in `index.css` IS the config. To expose a new token as a utility, add a `--color-foo: var(--foo);` line inside that block — don't create a JS config file.

---

## Utilities the @theme block exposes

These are the classes you can actually use today (everything in `index.css` § F23). The substitution table later in this doc only maps to names from this list.

**Background colors:** `bg-bg`, `bg-bg-elevated`, `bg-bg-sunken`, `bg-surface-hover`, `bg-accent`, `bg-accent-soft`, `bg-mark`, `bg-selection`, `bg-ai`, `bg-ai-soft`

**Text colors:** `text-ink`, `text-ink-2`, `text-ink-3`, `text-ink-4`, `text-ink-5`, `text-accent`, `text-danger`, `text-ai`

**Border colors:** `border-line`, `border-line-2`, plus any color above (`border-ink`, `border-accent`, etc.)

**Shape:** `rounded` (3px), `rounded-lg` (6px), `shadow-card`, `shadow-pop`

**Type:** `font-serif`, `font-sans`, `font-mono`

Anything not in this list — `shadow-popover`, `shadow-md`, `bg-neutral-100`, `text-red-600` — is either non-existent in our system or a Camp B leftover and must be ported.

---

## Component status

Three states: ✅ done · 🔴 unmigrated · 💀 dead (deleted in Phase 0).

The 💀 row is kept here for historical context only — the files are gone. The 🟡 spot-check tier from earlier passes was resolved in Phase 1.5 by `rg "(neutral|red|blue|gray|slate)-[0-9]" frontend/src/components frontend/src/pages`: any file that printed → 🔴, any file that didn't → ✅. Two surprises during the spot-check: `Editor.tsx` and `pages/EditorPage.tsx` were previously marked ✅ but contain raw Tailwind colors (toolbar buttons + focus ring in `Editor.tsx`, loading/error fallbacks in `EditorPage.tsx`). Both demoted to 🔴.

| Component | Status | Notes |
|---|---|---|
| `AIPanel.tsx` | 💀 | Deleted in Phase 0. Replaced by `ChatPanel` (`ChatComposer` + `ChatMessages`). |
| `AIResult.tsx` | ✅ | Bundle 2 — primitives + token swap (border-line / bg-bg-sunken / text-ink-2 / text-danger / Button variant=ghost). |
| `AccountPrivacyModal.tsx` | ✅ | Spot-check clean. Uses `Modal` chrome + token classes. |
| `AppShell.tsx` | ✅ | Uses tokens. |
| `AuthForm.tsx` | ✅ | Reference impl for forms. Reads as primitives target. |
| `AutosaveIndicator.tsx` | ✅ | Bundle 1 — text-ink-3 / font-sans. |
| `BalanceDisplay.tsx` | ✅ | Bundle 1 — text-ink-3 / text-ink-2 / font-mono. |
| `CastTab.tsx` | ✅ | Spot-check clean. |
| `ChapterList.tsx` | ✅ | Bundle 2 — primitives Button + token swap (border-line / border-ink active / bg-bg-elevated / text-ink / text-danger error). |
| `CharRefMenu.tsx` | ✅ | Uses `var(--bg-elevated)`, `var(--line-2)`. |
| `CharacterList.tsx` | ✅ | Bundle 2 — primitives Button + token swap (border-line / bg-bg-elevated / text-ink / text-danger error). |
| `CharacterPopover.tsx` | ✅ | Spot-check clean. |
| `CharacterPopoverHost.tsx` | ✅ | Spot-check clean. Glue layer; minimal styling. |
| `CharacterSheet.tsx` | ✅ | Bundle 3 — **the worked example.** Ported to Modal + ModalHeader/Body/Footer + Field + Input + Textarea + Button (primary/ghost/danger), with a nested `role="alertdialog"` confirm dialog. |
| `ChatComposer.tsx` | ✅ | Reference impl for composer surfaces. |
| `ChatMessages.tsx` | ✅ | Spot-check clean. |
| `ChatPanel.tsx` | ✅ | Spot-check clean. |
| `ContinueWriting.tsx` | ✅ | Spot-check clean. |
| `DarkModeToggle.tsx` | ✅ | Bundle 2 — primitives Button (variant=ghost, role=switch). `dark:` variants dropped (theme switching is data-theme based). |
| `Editor.tsx` | ✅ | Bundle 2 — token swap on toolbar (border-line / bg-bg-elevated / accent-soft active), editor surface (border-line / bg-bg-elevated / focus:border-ink-3, no ring), and word-count footer (text-ink-3 / font-mono). |
| `EditorEmptyHints.tsx` | ✅ | Spot-check clean. |
| `Export.tsx` | ✅ | Bundle 2 — primitives Button trigger + token swap on dropdown (border-line / bg-bg-elevated / shadow-pop / hover:bg-surface-hover). |
| `FormatBar.tsx` | ✅ | Reference impl for toolbar surfaces. |
| `InlineAIResult.tsx` | ✅ | Spot-check clean. |
| `MessageCitations.tsx` | ✅ | Spot-check clean. |
| `ModelCard.tsx` | ✅ | Spot-check clean. |
| `ModelPicker.tsx` | ✅ | Reference impl for pickers. |
| `ModelSelector.tsx` | 💀 | Deleted in Phase 0. Replaced by `ModelPicker`. |
| `OutlineTab.tsx` | ✅ | Spot-check clean. |
| `Paper.tsx` | ✅ | Reference impl for the editor surface. |
| `RecoveryCodeHandoff.tsx` | ✅ | Spot-check clean. |
| `ResetPasswordForm.tsx` | ✅ | Spot-check clean. Composes `AuthForm` style. |
| `SelectionBubble.tsx` | ✅ | Uses `var(--radius)`, ink/bg tokens. |
| `Settings.tsx` | ✅ | Spot-check clean. Wrapper. |
| `SettingsAppearanceTab.tsx` | ✅ | Spot-check clean. |
| `SettingsModelsTab.tsx` | ✅ | Spot-check clean. |
| `SettingsWritingTab.tsx` | ✅ | Uses `text-ink-2`, `text-ink-4`, `border-line`, `var(--accent)`. |
| `Sidebar.tsx` | ✅ | Composes `.sidebar-*` classes from `styles.css`. |
| `StoryCard.tsx` | 💀 | Deleted in Phase 0. Superseded by `StoryPicker` (embedded mode). |
| `StoryModal.tsx` | ✅ | Bundle 3 — same primitive composition as `CharacterSheet`, single dialog (no nested confirm). |
| `StoryPicker.tsx` | ✅ | **Reference impl** — every other modal should match this. |
| `StoryPickerEmpty.tsx` | ✅ | Spot-check clean. |
| `TopBar.tsx` | ✅ | Uses `.topbar` classes from `styles.css`. |
| `Transition.tsx` | ✅ | Pure motion utility. |
| `UsageIndicator.tsx` | ✅ | Bundle 1 — text-ink-3 / font-mono. |
| `UserMenu.tsx` | ✅ | Spot-check clean. |
| `WebSearchToggle.tsx` | 💀 | Deleted in Phase 0. Logic inlined into `ChatComposer`. |
| **Pages** | | |
| `DashboardPage.tsx` | ✅ | Hosts `StoryPicker` (embedded) + `StoryModal`. |
| `EditorPage.tsx` | ✅ | Bundle 1 — loading/error fallbacks → text-ink-3 / font-sans. |
| `LoginPage.tsx` | ✅ | Composes `AuthForm`. |
| `RegisterPage.tsx` | ✅ | Composes `AuthForm`. |
| `ResetPasswordPage.tsx` | ✅ | Spot-check clean. |

**Burn-down counts (post-Bundle 3):** 🔴 0 · ✅ 43 · 💀 4 (deleted).

The burn-down is complete — every component renders with design tokens and primitives.

**Phase 3 (lint:design) is live.** `frontend/scripts/lint-design.mjs` is wired up as `npm run lint:design` and runs in `.github/workflows/ci.yml` between the frontend typecheck and the production build. Pure-Node implementation — no `rg` install required on the runner. The script catches six categories of token drift (raw palette colors, black/white literals, mid-tier shadows, hex/rgb/hsl/oklch arbitrary values, raw hex codes, focus rings) and honors a `lint:design-allow` marker for one-off escapes. The Bundle-3 sweep also added a `--color-backdrop` token to `index.css` (`bg-backdrop` utility) so all 5 modals share one literal-free backdrop class.

Optional next: the deferred Playwright snapshot pass over the three themes for the modal ports (`CharacterSheet`, `StoryModal`, `AccountPrivacyModal`).

---

## Phase 1 — drop in primitives (5 minutes)

Tokens are already wired up. The only setup left is adding the primitives so the burn-down PRs have something to import.

```sh
mkdir -p frontend/src/design
cp design/primitives.tsx frontend/src/design/primitives.tsx
# (No CSS to copy — tokens already live in index.css.)
# (No tailwind.config.ts to edit — Tailwind v4 reads @theme from index.css.)
```

Verify the import path resolves (`@/design/primitives` if the project uses `@/*` aliases, otherwise `../design/primitives`). Then proceed to the burn-down.

---

## Porting a component (worked example)

Here is `CharacterSheet.tsx` before and after. It's the highest-leverage port in the table because:

- It's actually rendered (`EditorPage` imports it).
- It exercises **every** primitive: `Modal`, `ModalHeader/Body/Footer`, `Field`, `Input`, `Textarea`, `Button` (primary, ghost, danger), and a nested confirm dialog.
- Once it's done, `StoryModal` and `AccountPrivacyModal` follow the exact same shape.

**Quick API cheatsheet** (read primitives.tsx for the full surface; these are the props the example below uses):

| Primitive | Prop | Notes |
|---|---|---|
| `<Modal>` | `open`, `onClose`, `labelledBy`, `size`, `dismissable`, `embedded`, `role` | `dismissable={false}` disables ESC + backdrop. **No `dismissOnBackdrop`.** |
| `<ModalHeader>` | `titleId`, `title`, `subtitle?`, `onClose?` | **`titleId`, not `id`.** Renders `<h2 id={titleId}>` so `<Modal labelledBy={titleId}>` matches. |
| `<Button>` | `variant`, `size`, `loading` | Variants: `primary` \| `ghost` \| `danger` \| `link`. **No `secondary` — use `ghost`.** |
| `<Field>` | `label`, `htmlFor?`, `hint?`, `error?` | **`htmlFor`, not `id`.** No `required` prop — pass `hint="Required"` and `required` on the inner `<Input>`. |

The full file is ~470 lines; the slice below is a representative cross-section. The full PR diff lives in the proposal folder once you start the port.

### Before — Camp B (hand-rolled chrome + raw Tailwind)

```tsx
return (
  <div
    role="presentation"
    onMouseDown={handleBackdropClick}
    className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4"
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      className="bg-white rounded-md shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto"
    >
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 p-6">
        <h2 id={headingId} className="text-xl font-semibold">Edit character</h2>

        <label htmlFor={nameId} className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Name<span aria-hidden="true"> *</span></span>
          <input
            id={nameId}
            ref={nameInputRef}
            value={fields.name}
            onChange={handleFieldChange('name')}
            className="border border-neutral-300 rounded px-3 py-2
                       focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>

        {/* …six more <label>+<input/textarea> blocks, identical chrome… */}

        {formError ? (
          <p role="alert" className="text-sm text-red-600">{formError}</p>
        ) : null}

        <div className="flex items-center justify-between gap-2 pt-2">
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="bg-red-600 text-white rounded px-3 py-2 font-medium
                       hover:bg-red-700 disabled:opacity-50"
          >
            Delete
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="bg-neutral-100 text-neutral-800 rounded px-3 py-2 font-medium
                         hover:bg-neutral-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saveDisabled}
              className="bg-blue-600 text-white rounded px-3 py-2 font-medium
                         hover:bg-blue-700 disabled:opacity-50"
            >
              {savePending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </div>

    {confirmOpen ? (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] px-4">
        <div
          role="alertdialog"
          className="bg-white rounded-md shadow-lg w-full max-w-sm"
        >
          {/* …hand-rolled confirm body + two more buttons with the same Tailwind… */}
        </div>
      </div>
    ) : null}
  </div>
);
```

**Smell:** every modal in the codebase reinvents this chrome. Backdrop, z-index stacking, `aria-modal`, focus trap, escape handling, button color recipes — all duplicated across `CharacterSheet`, `StoryModal`, `AccountPrivacyModal`. Each instance drifts a little.

### After — Camp A (primitives do the chrome, fields do the layout)

```tsx
import {
  Modal, ModalHeader, ModalBody, ModalFooter,
  Field, Input, Textarea, Button,
} from '@/design/primitives';

return (
  <Modal
    open={open}
    onClose={onClose}
    labelledBy={headingId}
    size="lg"
  >
    <form onSubmit={handleSubmit} noValidate>
      <ModalHeader titleId={headingId} title="Edit character" onClose={onClose} />

      <ModalBody>
        <Field htmlFor={nameId} label="Name" hint="Required">
          <Input
            id={nameId}
            ref={nameInputRef}
            value={fields.name}
            onChange={handleFieldChange('name')}
            maxLength={NAME_MAX}
            required
          />
        </Field>

        <Field htmlFor={roleId} label="Role">
          <Input id={roleId} value={fields.role} onChange={handleFieldChange('role')} maxLength={ROLE_MAX} />
        </Field>

        <Field htmlFor={appearanceId} label="Appearance">
          <Textarea
            id={appearanceId}
            value={fields.appearance}
            onChange={handleFieldChange('appearance')}
            rows={3}
            maxLength={LONG_MAX}
          />
        </Field>

        {/* …voice, arc, personality follow the same Field+Textarea pattern… */}

        {formError ? (
          <p role="alert" className="font-sans text-[12.5px] text-danger">
            {formError}
          </p>
        ) : null}
      </ModalBody>

      <ModalFooter>
        <Button
          type="button"
          variant="danger"
          onClick={() => setConfirmOpen(true)}
          disabled={query.isLoading || savePending || deletePending}
        >
          Delete
        </Button>
        <div className="flex gap-2 ml-auto">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saveDisabled}>
            {savePending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </ModalFooter>
    </form>

    <Modal
      open={confirmOpen}
      onClose={() => setConfirmOpen(false)}
      labelledBy={`${headingId}-confirm`}
      role="alertdialog"
      size="sm"
      dismissable={false}
    >
      <ModalHeader titleId={`${headingId}-confirm`} title="Delete this character?" />
      <ModalBody>
        <p className="font-serif text-[13.5px] leading-[1.55] text-ink-2">
          This cannot be undone.
        </p>
        {deleteError ? (
          <p role="alert" className="font-sans text-[12.5px] text-danger">
            {deleteError}
          </p>
        ) : null}
      </ModalBody>
      <ModalFooter>
        <Button
          type="button"
          variant="ghost"
          onClick={() => setConfirmOpen(false)}
          disabled={deletePending}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="danger"
          onClick={() => void handleConfirmDelete()}
          disabled={deletePending}
        >
          {deletePending ? 'Deleting…' : 'Confirm'}
        </Button>
      </ModalFooter>
    </Modal>
  </Modal>
);
```

### What got deleted

- 4 `bg-black/40 fixed inset-0 …` backdrop blocks (now inside `<Modal>`).
- 7 hand-rolled `<label> + <input className="border border-neutral-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">` recipes (now `<Field>` + `<Input>`/`<Textarea>`).
- 6 button color recipes (`bg-red-600 hover:bg-red-700`, `bg-blue-600 hover:bg-blue-700`, `bg-neutral-100 hover:bg-neutral-200`) — now `variant="danger" | "primary" | "ghost"`.
- The `z-50`/`z-[60]` stacking dance — `<Modal>` manages it.
- Manual `aria-modal`/`role` wiring — `<Modal>` does this; pass `role="alertdialog"` for confirms.

Net: roughly **150 lines down to 70**, plus everything that needs to be checked across modals (focus trap, ESC, backdrop click) is now centralised.

### Substitution table

Use this lookup as a codemod cheatsheet — it covers ~90% of the Camp B → Camp A swaps you'll hit:

| Camp B (Tailwind raw) | Camp A (token) |
|---|---|
| `bg-white` | `bg-bg-elevated` |
| `bg-neutral-50` | `bg-bg-sunken` |
| `bg-neutral-100` (hover) | `hover:bg-[var(--surface-hover)]` |
| `border-neutral-200` | `border-line` |
| `border-neutral-300` | `border-line-2` |
| `border-neutral-400/800` (active) | `border-ink` |
| `text-neutral-900` | `text-ink` |
| `text-neutral-700/800` | `text-ink-2` |
| `text-neutral-500/600` | `text-ink-3` |
| `text-neutral-400` | `text-ink-4` |
| `bg-neutral-100` (hover) | `hover:bg-surface-hover` |
| `text-red-600` | `text-danger` |
| `bg-red-600` | `bg-danger` (or use `<Button variant="danger">` for buttons) |
| `bg-blue-600 text-white` (primary) | use `<Button variant="primary">` (resolves to `bg-ink text-bg`) |
| `bg-blue-600` (toggle on) | `bg-ink` or `bg-accent-soft` for soft state |
| `focus:ring-blue-400/500` | `focus:border-ink-3` (no ring; use border weight) |
| `rounded-md` | `rounded` (3px) |
| `rounded-lg` | `rounded-lg` (6px — already maps via `@theme`) |
| `shadow-sm` | `shadow-card` |
| `shadow-md` | `shadow-card` (we don't have a mid-tier; use `shadow-pop` if elevation matters) |
| `shadow-lg` | `shadow-pop` |
| `font-semibold text-lg` (heading) | `font-serif font-medium text-[18px] tracking-[-0.005em]` |
| `text-sm` (body) | `font-serif text-[13.5px] leading-[1.55]` (prose) **or** `font-sans text-[12.5px]` (chrome) |
| `text-xs` (metadata) | `font-mono text-[11px]` |
| `text-xs uppercase` (label) | `font-mono text-[10.5px] uppercase tracking-[.08em] text-ink-4` |

---

## PR checklist

When porting a component, the PR must include:

- [ ] No `neutral-*`, `red-*`, `blue-*`, `gray-*`, `slate-*` Tailwind color classes remain (run `rg "(neutral|red|blue|gray|slate)-\d" frontend/src/components/<File>.tsx`)
- [ ] No raw hex color literals (`rg "#[0-9a-f]{3,6}" frontend/src/components/<File>.tsx`)
- [ ] No `shadow-(sm|md|lg)` — use `shadow-card` or `shadow-pop` (those are the only two we ship)
- [ ] All buttons use `<Button>` with explicit `variant`
- [ ] All form fields use `<Field>` + `<Input>` / `<Textarea>`
- [ ] All dialogs use `<Modal>` + `<ModalHeader>` / `<ModalBody>` / `<ModalFooter>`
- [ ] Every interactive element has `data-testid="..."` for Playwright
- [ ] The `MIGRATION.md` table row flips to ✅ in this PR
- [ ] A Playwright snapshot test renders the component in all three themes (`paper`, `sepia`, `dark`)

---

## What comes next

When the table is all green:

1. **Delete `mockups/frontend-prototype/`** — the live components ARE the design system. The prototype HTML is no longer the source of truth.
2. **Stand up Storybook** at `frontend/.storybook/` — colocate `*.stories.tsx` next to each component. Visual regression via `@storybook/test-runner` + Playwright.
3. **New features mock in TSX, not HTML** — `mockups/proposals/<name>/mockup.tsx` imports from `@/design/primitives`. Claude Code's job becomes a copy-paste, not a port.

That's the whole arc: stop maintaining a parallel HTML universe, make the codebase BE the design system.
