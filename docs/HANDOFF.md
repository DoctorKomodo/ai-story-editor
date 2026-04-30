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
pnpm -C frontend typecheck
pnpm -C frontend test
pnpm -C frontend dev    # smoke-test routes manually
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

## Phase 2 onwards — the burn-down

After Phase 1 lands, every 🔴 component is a self-contained PR following
the pattern in `MIGRATION.md` § "Porting a component (worked example)".
Order suggestion (smallest → largest blast radius):

1. `UsageIndicator.tsx` (1 line)
2. `AutosaveIndicator.tsx` (1 line)
3. `BalanceDisplay.tsx` (~5 lines)
4. `ChapterList.tsx` (~30 lines)
5. `Export.tsx` (small dropdown menu — mostly chrome swaps)
6. `StoryModal.tsx` (becomes a `<Modal>` composition — see worked example)
7. `CharacterSheet.tsx` (the worked example itself; biggest win)
8. Then any 🟡 that demoted to 🔴 in Phase 1.5.

Each PR uses the checklist at the bottom of `MIGRATION.md`.

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
  - `*.stories.tsx` (Storybook may demonstrate "before" states)
  - `*.test.*` (test fixtures may assert against legacy markup)

### The script

A ready-to-drop copy lives at `scripts/lint-design.mjs` in this handoff
package. Steps to install:

```sh
mkdir -p frontend/scripts
cp <handoff-folder>/scripts/lint-design.mjs frontend/scripts/lint-design.mjs
```

Then add to `frontend/package.json`:

```json
{
  "scripts": {
    "lint:design": "node scripts/lint-design.mjs"
  }
}
```

The script (annotated):

- Six regex patterns covering the categories above.
- Excludes `src/index.css`, `*.stories.{ts,tsx}`, `*.test.*`, `*.spec.*`.
- Honors a `// lint:design-allow — <reason>` marker for one-off escapes.
- Exits 0 if clean, 1 if drift, 2 on infrastructure error (e.g. `rg`
  missing).

Open the file to read inline comments — patterns and exclusions are all
in one place at the top.

### Wire it to CI

In `.github/workflows/ci.yml` (or wherever your frontend job lives):

```yaml
- name: Design-token drift check
  run: pnpm -C frontend lint:design
```

Run it once locally first:

```sh
pnpm -C frontend lint:design
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

## What this package contains

| File | What for |
|---|---|
| `MIGRATION.md` | The plan. Component table, worked example, substitution cheatsheet, PR checklist. |
| `design/primitives.tsx` | The only file Phase 1 actually copies into the repo. |
| `scripts/lint-design.mjs` | Phase 3 CI guard. Drop into `frontend/scripts/` once burn-down is green. |
| `design/tokens.css` | **Reference only** — DO NOT copy into the repo. Live tokens already live in `frontend/src/index.css`. Kept here for the prototype HTML and the design-system handoff doc. |
| `Design System Handoff.html` | Visual spec — open in a browser to see swatches, type, primitives, modal-on-modal demo, sticker-sheet. |
| `Inkwell – Story Editor.html` | The original prototype, useful for cross-referencing prose/chrome details. |
| `HANDOFF.md` | This file. |

---

## Open questions / known mismatches

- **Import alias.** Best guess is `@/design/primitives`. Confirm in Phase 1
  before opening the PR.
- **Test framework for primitives.** No test scaffolding ships with this
  package. If the repo uses Vitest + Testing Library, primitives are
  straightforward to cover; ask before authoring tests.
- **Storybook.** Not stood up. The "what comes next" section of `MIGRATION.md`
  describes the target end-state; happy to scaffold separately.
