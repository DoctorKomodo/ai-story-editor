# Phase 0 + Phase 1 — handoff for Claude Code

This package brings the live Inkwell repo from "half-migrated" to
"primitives are available, dead code is gone." Two phases, one PR each
recommended.

> **Reality checks built in.** Earlier drafts of this handoff assumed Tailwind
> v3 (with a `tailwind.config.ts`) and a separate `design/tokens.css` file —
> both wrong. The live repo uses **Tailwind v4** with the CSS-first `@theme`
> block, and tokens already live in `frontend/src/index.css`. This document
> reflects that reality. If you find a step that contradicts what you see in
> the codebase, trust the codebase and tell us.

---

## Pre-flight

Run these from the repo root and confirm each result before proceeding:

```sh
# 1. Confirm Tailwind v4 + tokens already in place.
rg '@import "tailwindcss"' frontend/src/index.css     # → 1 hit
rg '@theme' frontend/src/index.css                    # → 1 hit
rg '\-\-color-ink:' frontend/src/index.css            # → 1 hit (in @theme)

# 2. Confirm there is NO Tailwind config to edit.
ls frontend/tailwind.config.* 2>/dev/null             # → no such file
ls frontend/src/design/ 2>/dev/null                   # → may not exist yet

# 3. Confirm the four dead files are still importerless.
for f in AIPanel ModelSelector WebSearchToggle StoryCard; do
  echo "=== $f ==="
  rg -l "from .*\\b$f\\b" frontend/src
done
# → each should print no results.
```

If any of these surprise you, **stop and reply with what you saw** — the
plan below assumes the world matches the checks.

---

## Phase 0 — delete dead code

Four components are unmounted and have zero importers. Delete them, their
tests, and any types they export.

```sh
git rm \
  frontend/src/components/AIPanel.tsx \
  frontend/src/components/ModelSelector.tsx \
  frontend/src/components/WebSearchToggle.tsx \
  frontend/src/components/StoryCard.tsx

# Tests (paths are best-guesses — adjust to your suite layout):
git rm -f \
  frontend/src/components/__tests__/AIPanel.test.tsx \
  frontend/src/components/__tests__/ModelSelector.test.tsx \
  frontend/src/components/__tests__/WebSearchToggle.test.tsx \
  frontend/src/components/__tests__/StoryCard.test.tsx 2>/dev/null || true
```

After deletion, re-grep to make sure nothing dangles:

```sh
rg "AIPanel|ModelSelector\\b|WebSearchToggle|StoryCard\\b" frontend/src
# → only matches that remain should be inside files we just deleted (none)
# or unrelated identifiers (e.g. ModelPicker, which is the live replacement).
```

Run typecheck + tests + the app to confirm nothing was secretly using them:

```sh
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run dev    # smoke-test routes manually
```

**Commit:** `chore: remove unmounted components (Phase 0 dead-code audit)`

---

## Phase 1 — add primitives

The whole goal of this phase is one new file: `frontend/src/design/primitives.tsx`.

Tokens are already wired up via `index.css`, so there is **nothing to add to
`main.tsx`, no Tailwind config to create, and no `tokens.css` to copy**. The
primitives file uses utility classes (`bg-bg-elevated`, `text-ink`,
`border-line`, `shadow-pop`, etc.) that the existing `@theme` block already
exposes.

### Steps

```sh
mkdir -p frontend/src/design
cp <handoff-folder>/design/primitives.tsx frontend/src/design/primitives.tsx
```

Verify the import path the rest of the codebase uses:

```sh
rg "from ['\"]@/" frontend/src | head -5
```

- If you see `@/components/...` style imports → use `@/design/primitives`
  in migrated components.
- If imports are relative (`../components/...`) → use
  `../../design/primitives` (depth depends on the file).

### Smoke test

Add a temporary import in any existing page (e.g. `EditorPage.tsx`) just to
confirm resolution + types:

```tsx
import { Button } from '@/design/primitives';   // adjust path as above
// ...somewhere benign in the JSX:
{false && <Button variant="primary">probe</Button>}
```

Run typecheck. If it passes, remove the probe import. If it fails, the most
likely cause is the import alias — fix and retry.

**Commit:** `feat(design): add primitives (Modal, Button, Field, Input, Textarea, Pill, IconButton, Spinner)`

---

## Phase 1.5 — quick spot-check for the 18 🟡 components

Before kicking off the burn-down, demote-or-promote each 🟡 in
`MIGRATION.md`'s component table. The grep below is the entire spot-check
heuristic:

```sh
for f in $(rg -l "(neutral|red|blue|gray|slate)-[0-9]" frontend/src/components frontend/src/pages); do
  echo "🔴 $f"
done
```

- Files that print → demote to 🔴 (port them in the burn-down).
- Files that don't print → promote to ✅ (they're already on tokens).

Update the table in `MIGRATION.md` accordingly and commit:
`docs(migration): finalise component status after spot-check`.

---

## Phase 2 — the burn-down (in progress)

> **Status:** Phase 2 is currently being executed. This section is kept
> for reference and for any 🟡 → 🔴 components that surface late.

Every 🔴 component becomes a self-contained PR following the pattern in
`MIGRATION.md` § "Porting a component (worked example)". Suggested order
(smallest → largest blast radius):

1. `UsageIndicator.tsx` (1 line)
2. `AutosaveIndicator.tsx` (1 line)
3. `BalanceDisplay.tsx` (~5 lines)
4. `ChapterList.tsx` (~30 lines)
5. `Export.tsx` (small dropdown menu — mostly chrome swaps)
6. `StoryModal.tsx` (becomes a `<Modal>` composition — see worked example)
7. `CharacterSheet.tsx` (the worked example itself; biggest win)
8. Then any 🟡 that demoted to 🔴 in Phase 1.5.

Each PR uses the checklist at the bottom of `MIGRATION.md`.

### Per-port checklist (staple onto every Phase 2 PR)

For each component being ported, the PR should:

- [ ] Replace hand-rolled chrome with primitives from `@/design/primitives`.
- [ ] Swap every Camp B class for its Camp A equivalent (see
      `MIGRATION.md` § "Substitution table").
- [ ] Add `data-testid` to interactive elements that lack one.
- [ ] Verify in all three themes (`paper`, `sepia`, `dark`) — the
      `data-theme` attribute on `<html>` is the lever.
- [ ] `npm --prefix frontend run typecheck && npm --prefix frontend test`
      both green.
- [ ] **Defer the Storybook story** to Phase 4. Don't write a
      `*.stories.tsx` yet — Storybook isn't installed and writing stories
      against an absent runtime is busywork.

### Post-port sweep (between Phase 2 and Phase 3)

Once every 🔴 is green, do a single sweep PR before kicking off Phase 3:

- [ ] Run the spot-check grep one more time:
      `rg '(neutral|red|blue|gray|slate)-[0-9]' frontend/src/components frontend/src/pages`
      should be empty.
- [ ] Update `MIGRATION.md`'s component table — every row should be ✅.
- [ ] Confirm `data-theme="dark"` and `data-theme="sepia"` both render
      every previously-🔴 component without obvious regressions
      (manual smoke-test, ~10 minutes).

Commit message convention: `chore(migration): close out phase 2 burn-down`.

---

## Phase 3 — lock it in (do this the day green hits)

Without enforcement, the next contributor will reintroduce `bg-blue-600` on
day one. A regex-level CI check is the cheapest, most durable way to stop
drift. Drop the script below into `frontend/package.json`, wire it into CI,
and you're done.

### `lint:design` — what it catches

Six categories of drift, all token violations:

1. **Tailwind palette colors** — `neutral-500`, `red-600`, etc. (every
   numbered palette has a token equivalent).
2. **Black/white literals** — `bg-white`, `text-black`, etc.
3. **Mid-tier shadows** — `shadow-sm`, `shadow-md`, `shadow-lg`,
   `shadow-xl`, `shadow-2xl`. We only ship `shadow-card` and `shadow-pop`.
4. **Hex/rgb/hsl/oklch literals in arbitrary values** — `bg-[#fff]`,
   `text-[rgb(0,0,0)]`. (`bg-[var(--token)]` is fine and not caught.)
5. **Raw hex codes in source** — anywhere in `.tsx`/`.ts` files.
6. **Focus rings** — `focus:ring-*` (Inkwell uses `focus:border-ink-3`).

### What it does **not** catch (intentional)

- Spacing utilities with numbers (`p-4`, `gap-2`, `mt-8`) — those are fine.
- Token classes that contain color words (`bg-bg`, `text-ink`) — fine.
- Files exempt from the rule:
  - `frontend/src/index.css` (defines the tokens; needs hex codes)
  - `*.test.*` / `*.spec.*` (test fixtures may assert against legacy markup)

  **Note:** `*.stories.tsx` is NOT exempt — stories live under `src/`
  and are subject to the same drift rules as production code. See
  Phase 4 § "Tooling interactions" for the rationale.

### The script

The script ships in this handoff at `scripts/lint-design.mjs`. Drop it
into `frontend/scripts/lint-design.mjs` and wire up `package.json`:

```json
{
  "scripts": {
    "lint:design": "node scripts/lint-design.mjs"
  }
}
```

The script (annotated):

- Pure-Node implementation — walks `frontend/src/` for `.ts`/`.tsx`
  files and scans each line. No external dependencies; runs on any CI
  runner with Node, no ripgrep install needed.
- Six regex patterns covering the categories above.
- Excludes `src/index.css`, `*.test.*`, `*.spec.*`. **`*.stories.tsx`
  is intentionally NOT excluded** — see Phase 4 § "Tooling
  interactions" for the rationale.
- Honors a `// lint:design-allow — <reason>` marker for one-off escapes.
- Exits 0 if clean, 1 if drift, 2 on infrastructure error.

Open the file to read inline comments — patterns and exclusions are all
in one place at the top.

### Wire it to CI

In `.github/workflows/ci.yml` (or wherever your frontend job lives):

```yaml
- name: Design-token drift check
  run: npm --prefix frontend run lint:design
```

Run it once locally first:

```sh
npm --prefix frontend run lint:design
# Should fail today (🔴 components still exist) and pass after burn-down.
```

That expected-failure-then-pass arc is the proof the lint rule is doing
its job.

### Allowlisting genuine exceptions

If a real exception comes up (e.g. an icon SVG that has to ship a literal
`#000000`), add a marker comment to opt that line out:

```tsx
const ICON_BLACK = '#000000';  // lint:design-allow — SVG fill literal
```

The script already honors `lint:design-allow`. Use sparingly — every
allowlist entry is a tiny crack in the wall.

---

## Phase 4 — stand up Storybook

Phases 0–3 have all merged (PR #39, 2026-04-30) — this phase is unblocked
and is the active work.

Storybook is what closes the parallel-universe problem permanently. Once
it's live, the design system stops being a doc you reference and becomes a
workspace you visit. New feature proposals can be TSX stories instead of
HTML mockups, visual regression testing comes for free, and the original
HTML prototype + visual spec are archived (now read-only at
`mockups/archive/v1-2025-11/`).

### Install

```sh
cd frontend
npx storybook@latest init --type react-vite
```

> **Pin the major version before you run.** As of writing, this resolves
> to **Storybook 9.x**, which differs from 8.x in non-trivial ways:
> the `addon-essentials` bundle was unbundled, the renderer entry moved
> to `@storybook/react-vite`, and the `backgrounds` parameter API tightened.
> Run `npm view storybook version` first and check the SB9 migration
> notes (https://storybook.js.org/docs/migration-guide). The snippets in
> this document target SB9 — if you land on 8.x the imports and parameter
> shapes will need adjusting.

The init wizard creates:

- `.storybook/main.ts` — entry point, addon list, story glob.
- `.storybook/preview.tsx` — global decorators, parameters, theme wiring.
- `src/stories/` — sample stories (delete these; we write our own).
- A `storybook` and `build-storybook` script in `package.json`.

### Wire tokens + themes

Replace the auto-generated `.storybook/preview.tsx` with the snippet
below. **Verify the imports against the installed Storybook version**
before committing — `Decorator` and `Preview` types live in
`@storybook/react` in SB9, but if `npm view storybook version` returned
something newer, double-check the entry point. The structure (a
`globalTypes.theme` toolbar with a decorator that toggles
`document.documentElement.dataset.theme`) is stable across versions even
if the import paths shift.

```tsx
import type { Preview, Decorator } from '@storybook/react';
import { useEffect } from 'react';
import '../src/index.css';   // tokens + Tailwind base

const ThemeDecorator: Decorator = (Story, context) => {
  const theme = context.globals.theme ?? 'paper';
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return <Story />;
};

const preview: Preview = {
  parameters: {
    backgrounds: { disable: true },   // we use tokens, not Storybook's BG add-on
    layout: 'centered',
  },
  globalTypes: {
    theme: {
      description: 'Inkwell theme',
      defaultValue: 'paper',
      toolbar: {
        title: 'Theme',
        icon: 'paintbrush',
        items: [
          { value: 'paper', title: 'Paper' },
          { value: 'sepia', title: 'Sepia' },
          { value: 'dark',  title: 'Dark'  },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [ThemeDecorator],
};

export default preview;
```

Add the viewport add-on for responsive checks (Storybook installs it by
default, but confirm it's listed in `.storybook/main.ts` under `addons`).

### First stories — cover the primitives

One `*.stories.tsx` next to each primitive. Pattern is consistent — a
default export naming the component, then one named export per state.
The Button file looks like this:

```tsx
// frontend/src/design/Button.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './primitives';

const meta = {
  title: 'Primitives/Button',
  component: Button,
  args: { children: 'Save changes' },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = { args: { variant: 'primary' } };
export const Ghost:   Story = { args: { variant: 'ghost'   } };
export const Danger:  Story = { args: { variant: 'danger'  } };
export const Link:    Story = { args: { variant: 'link', children: 'Read more' } };
export const Loading: Story = { args: { variant: 'primary', loading: true, children: 'Saving…' } };
export const Disabled: Story = { args: { variant: 'primary', disabled: true } };
export const SmallGhost: Story = { args: { variant: 'ghost', size: 'sm' } };
```

Repeat for `Field`, `Input`, `Textarea`, `Pill`, `IconButton`, `Spinner`.
Each takes ~15 minutes. **`Modal` is its own thing** — see the next
section.

### Modal.stories.tsx — the one primitive that needs a wrapper

`Modal`'s `open` prop is controlled by a parent. You can't render it
stand-alone in args because Storybook's controls don't exercise the
open-close transition, the focus trap, or the ESC handler. Wrap it in a
local `Demo` component instead:

```tsx
// frontend/src/design/Modal.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { useId, useState } from 'react';
import { Modal, ModalHeader, ModalBody, ModalFooter, Button, Field, Input } from './primitives';

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
      <Button variant="ghost" onClick={() => setOpen(true)}>Reopen modal</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        labelledBy={titleId}
        size={size}
        dismissable={dismissable}
        role={role}
      >
        <ModalHeader titleId={titleId} title="Edit character" onClose={() => setOpen(false)} />
        <ModalBody>
          <Field htmlFor={nameId} label="Name" hint="Required">
            <Input id={nameId} defaultValue="Lyra" />
          </Field>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={() => setOpen(false)}>Save</Button>
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

export const Default:    Story = { args: {} };
export const Small:      Story = { args: { size: 'sm' } };
export const Large:      Story = { args: { size: 'lg' } };
export const NotDismissable: Story = { args: { dismissable: false } };
export const AlertDialog:    Story = { args: { role: 'alertdialog', size: 'sm', dismissable: false } };
```

This covers the five behavioural axes that matter: size, dismissable,
role, focus trap (verify manually — ESC closes, click-outside on the
backdrop closes, Tab cycles within the modal), and `labelledBy` wiring
(`useId()` upstream, passed to both `Modal` and `ModalHeader`). The
"reopen" button outside the modal lets you re-trigger the open
transition without refreshing the story.

### A token swatch story (replaces the archived visual spec § Tokens)

This story has to cover **every surface the HTML doc covered** — not just
colours. That means colour swatches, type tokens (`--sans`, `--serif`,
`--mono`), and any spacing/radius/shadow tokens. Audit `index.css`
before listing names: `rg '^\s+--' frontend/src/index.css | sort -u` is
the definitive source.

The hex readout is **not** an exercise — ship the effect. Every story
render with empty hex divs will confuse anyone using the doc.

```tsx
// frontend/src/design/Tokens.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { useLayoutEffect, useRef } from 'react';

const COLOR_TOKENS: { group: string; names: string[] }[] = [
  { group: 'Surface', names: ['--bg', '--bg-elevated', '--bg-sunken', '--surface-hover'] },
  { group: 'Ink',     names: ['--ink', '--ink-2', '--ink-3', '--ink-4', '--ink-5'] },
  { group: 'Lines',   names: ['--line', '--line-2'] },
  { group: 'Accent',  names: ['--accent', '--accent-soft', '--mark', '--ai', '--ai-soft', '--danger'] },
];

const TYPE_TOKENS = ['--sans', '--serif', '--mono'] as const;

// Audit `rg '^\s+--' frontend/src/index.css | sort -u` and add any missing
// groups here — spacing, radii, shadow, etc. — if the @theme block exposes
// them. The story is the source of truth; if a token isn't here it isn't
// part of the public surface.

function Swatches() {
  const root = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!root.current) return;
    const cs = getComputedStyle(document.documentElement);
    root.current.querySelectorAll<HTMLElement>('[data-hex]').forEach(el => {
      el.textContent = cs.getPropertyValue(el.dataset.hex!).trim();
    });
    root.current.querySelectorAll<HTMLElement>('[data-font]').forEach(el => {
      el.textContent = cs.getPropertyValue(el.dataset.font!).trim().split(',')[0];
    });
  });

  return (
    <div ref={root} style={{ display: 'grid', gap: 32, fontFamily: 'var(--mono)' }}>
      {COLOR_TOKENS.map(({ group, names }) => (
        <section key={group}>
          <h3 style={{ font: '600 12px var(--sans)', color: 'var(--ink-2)', marginBottom: 8 }}>{group}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {names.map(n => (
              <div key={n} style={{ border: '1px solid var(--line)', borderRadius: 3 }}>
                <div style={{ background: `var(${n})`, height: 60, borderRadius: '3px 3px 0 0' }} />
                <div style={{ padding: '6px 8px', fontSize: 11 }}>
                  <div style={{ color: 'var(--ink)' }}>{n}</div>
                  <div data-hex={n} style={{ color: 'var(--ink-3)' }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
      <section>
        <h3 style={{ font: '600 12px var(--sans)', color: 'var(--ink-2)', marginBottom: 8 }}>Type</h3>
        <div style={{ display: 'grid', gap: 8 }}>
          {TYPE_TOKENS.map(n => (
            <div key={n} style={{ border: '1px solid var(--line)', borderRadius: 3, padding: 12 }}>
              <div style={{ font: '600 11px var(--mono)', color: 'var(--ink-3)' }}>
                {n} — <span data-font={n} />
              </div>
              <div style={{ fontFamily: `var(${n})`, fontSize: 18, color: 'var(--ink)', marginTop: 6 }}>
                The quick brown fox jumps over the lazy dog
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const meta = { title: 'Tokens/Swatches', component: Swatches } satisfies Meta<typeof Swatches>;
export default meta;
export const All: StoryObj<typeof meta> = {};
```

If `index.css` exposes spacing/radius/shadow as `@theme` tokens, add
those sections too — same shape, different swatch (a sized `<div>` with
the radius/shadow/padding applied).

### Add Storybook to CI

In `.github/workflows/ci.yml`:

```yaml
- name: Build Storybook
  run: npm --prefix frontend run build-storybook -- --quiet
```

This catches "story breaks because primitive prop renamed" before review.

### Visual regression — Option B (Playwright theme-sweep)

> **Decision (2026-04-30):** Inkwell already has Playwright wired
> (`@playwright/test ^1.49.1` at the root, `playwright.config.ts`,
> `tests/e2e/{full-flow,smoke}.spec.ts`), so we extend that rather than
> stand up `@storybook/test-runner`. Implementation slot is **[X24]** in
> [TASKS.md](../TASKS.md) (originally written before Phase 4 existed; now
> retitled and cross-linked here). **Do not implement Option A on this
> repo** — the section below is kept for context only.

#### Option A — `@storybook/test-runner` (NOT chosen for Inkwell)

Wraps Playwright; snapshots each story at its rendered state. Trades
zero extra story authoring for non-trivial CI choreography (Storybook
running in the background plus a `concurrently` / `wait-on` /
`http-server` dance) and baseline-pinning fragility. Rejected because
Inkwell already has Playwright wired — running both would mean two
baseline directories. Full recipe at
https://storybook.js.org/docs/writing-tests/test-runner if the call is
ever revisited.

#### Option B — Raw Playwright sweep across themes (CHOSEN)

Extend the existing `tests/e2e/` suite with theme-sweep specs that load
the live app at known routes, toggle `data-theme` between
paper/sepia/dark on `<html>`, and `expect(page).toHaveScreenshot()` each
surface. Pros: reuses the runner, fixtures, and CI wiring already in
place; exercises the real app rather than isolated stories; covers theme
switching natively. Cons: requires seeded test data and a stable login
fixture (both already exist for `full-flow.spec.ts`).

Implementation lives under **[X24]** in [TASKS.md](../TASKS.md). When
that task lands, the goal is the same: a 1px shift in a primitive (or in
any composed component) fails CI before the PR merges.

### Tooling interactions

Two existing CI tools touch `*.stories.tsx` and need a quick decision before
the first story PR.

**Biome.** Storybook's auto-generated example stories often trip Biome
(`as any` casts, unused imports in template files). The hand-written
stories in this guide are clean, but expect to either:

- Add `**/*.stories.tsx` to `biome.json`'s `files.ignore` if Biome blocks
  the first PR, OR
- Configure per-story overrides for the rules that fire (usually
  `noExplicitAny` and `noUnusedImports`).

Don't pre-emptively add the ignore — wait for the first PR to surface
real complaints, then decide narrowly. A blanket ignore on stories means
real bugs (typos, dead imports) stop being caught.

**`lint:design` (Phase 3 script).** Stories live under `frontend/src/`,
so the Phase 3 script will scan them. This is **deliberate — keep it**.
A story authored with `bg-blue-600` is the same drift as production code
authored with `bg-blue-600`, and Storybook is the place where bad
habits are most contagious.

The one exception: if you ever write a "before/after migration" story
that demonstrates legacy patterns on purpose, use the
`// lint:design-allow — legacy demo` marker per line. Don't add
`*.stories.tsx` to the script's exclude list.

### Backfill stories for already-migrated components

Because Phase 2 ran before Storybook was installed, the migrated
components don't have stories yet. Backfill them as a single sweep once
the primitive stories are in place:

1. For each component ported in Phase 2, write a sibling
   `<Component>.stories.tsx` next to the source file.
2. Cover the obvious states: empty / populated / error / loading where
   applicable. Don't over-spec — two or three stories per component is
   enough to give the visual-regression tests something to anchor on.
3. Verify each story renders cleanly in all three themes via the toolbar
   switcher.

Commit message convention: `chore(storybook): backfill stories for
migrated components`. Land it as one PR, not seven — backfill is
low-risk and easier to review in aggregate.

From this point forward, **every new component PR includes its story
in the same diff** — no more backfill rounds.

### Retire the parallel HTML universe — completed 2026-05-02 ([F74])

The original HTML prototype directory and the visual spec page are
archived at `mockups/archive/v1-2025-11/` (read-only). `CLAUDE.md`'s
"UI source of truth" rule now points at Storybook; the README's
"Design system" section points at the same surface plus the
`lint:design` guard. See [the F74 plan](superpowers/plans/F74-retire-html-mockups.md)
for the recipe and the prerequisites that gated the move.

Hard-delete of the archive is not scheduled — it costs nothing to keep,
and "where did the old mockups go?" is a real question new contributors
will eventually ask. If the archive is ever pruned, do it as a separate
PR with its own justification.

---

## Files this migration touches

Quick map of where the moving parts live now that Phases 0–3 have
shipped (all repo-relative paths):

| File | Role |
|---|---|
| `docs/MIGRATION.md` | The plan. Component burn-down table, worked example, substitution cheatsheet, PR checklist. |
| `docs/HANDOFF.md` | This file. |
| `frontend/src/design/primitives.tsx` | Token-aware primitives. Imported from every migrated component. |
| `frontend/src/index.css` | Live design tokens (`--ink-*`, `--bg-*`, theme blocks). Source of truth. |
| `frontend/scripts/lint-design.mjs` | Phase 3 CI guard. Wired in `frontend/package.json` as `lint:design` and in `.github/workflows/ci.yml`. |
| `mockups/archive/v1-2025-11/` | Read-only archive of the original HTML prototype (incl. `design/Inkwell.html`) and the visual spec (`Design System Handoff.html`). Retired in Phase 4 ([F74]) — Storybook is the live design surface. |
