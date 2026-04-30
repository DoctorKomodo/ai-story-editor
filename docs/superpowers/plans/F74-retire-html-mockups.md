# [F74] Retire the Parallel HTML Universe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decommission the `mockups/frontend-prototype/` HTML prototype + `docs/Design System Handoff.html` as the project's "UI source of truth", replacing both with Storybook (built up across [F68]–[F73]). Multi-PR procedural cleanup gated on hard prerequisites.

**Architecture:**
- This is **destructive doc-and-asset work**, not code work. The implementation is two PRs (or three if F75 lands separately):
  1. **PR-A** — Rewrite the [CLAUDE.md](../../CLAUDE.md) "UI source of truth" rule and audit-update every other reference. Lands without touching the actual mockups directory.
  2. **PR-B** — `git mv` the directory to `mockups/archive/v1-2025-11/`. Atomic.
  3. **PR-C ([F75])** — README "Design system" section update; can land same PR as PR-B or follow up.
- **Archive, don't delete.** History stays accessible at `mockups/archive/v1-2025-11/` indefinitely. Six months on, if nobody has needed the archive, a separate hard-delete PR can take it; don't pre-emptively schedule that.
- Hard prerequisites are listed below as a tick-box gate. The CLAUDE.md rewrite cannot land before all gate items are true; otherwise the new rule points at a Storybook surface that doesn't exist or isn't trusted yet.

**Hard prerequisites (gate — all must be true before Task 1 starts):**
- [ ] [F68] (Install Storybook) merged on `main`.
- [ ] [F69] (Primitive stories) merged on `main`.
- [ ] [F70] (Modal story) merged on `main`.
- [ ] [F71] (Tokens story) merged on `main`.
- [ ] [F72] (CI build-storybook) merged on `main`.
- [ ] [F73] (Component backfill) merged on `main`.
- [ ] [X24] (Playwright theme-sweep) has at least one green run on `main`. Without that safety net, deleting the HTML reference removes an axis of visual fact-checking with nothing to replace it.
- [ ] At least one new feature has shipped via the new workflow — TSX story instead of HTML mockup. Proves the workflow works in practice, not just in theory.

If any prerequisite is missing, this task does not start. There is no half-measure: the parallel universe stays parallel until the new universe is genuinely populated.

**Decision points pinned in the plan:**
1. **CLAUDE.md rewrite is its own PR** (PR-A), not bundled with the archive move. Reason: a docs-only PR is reviewable in five minutes; combined with a `git mv` of a multi-thousand-line directory it would be near-unreviewable.
2. **`git mv`, not `git rm`.** Preserves history. Anyone tracing an old PR description that links to `mockups/frontend-prototype/Inkwell.html` can follow the rename to `mockups/archive/v1-2025-11/Inkwell.html`.
3. **Archive directory is dated** (`v1-2025-11`) so a future v2 archive doesn't collide. The date matches when the prototype was first imported (2025-11) — not today's date — to preserve provenance.
4. **`docs/Design System Handoff.html` moves into the same archive** as one parameter dump. It's a sibling visual reference, not a separate concept.
5. **No hard-delete in this task.** A follow-up task (not opened speculatively) handles that if ever justified.
6. **`biome.json` exclusion `!docs/**/*.html` stays for now** — it becomes obsolete once the file moves but it's harmless and removing it is a separate trivial cleanup.

**Tech Stack:** None (pure docs + git operations).

**Source-of-truth references:**
- [docs/HANDOFF.md](../HANDOFF.md) § "Retire the parallel HTML universe" — the procedural source. Steps 1–4 in that doc map to Tasks 1–4 below.
- [CLAUDE.md](../../CLAUDE.md) lines 11–16 — the existing "UI source of truth" rule that needs rewriting (under "Project Overview").
- [docs/MIGRATION.md](../MIGRATION.md) — the burn-down doc; will need a "✅ retired" note on completion.

---

## File Structure

**Modify (PR-A — CLAUDE.md rewrite):**
- `CLAUDE.md` — rewrite the "UI source of truth" paragraph in the Project Overview section.
- `README.md` — if a `## Design system` or `## Contributing` section references `mockups/frontend-prototype/`, update it. (May also be touched by [F75]; coordinate to avoid conflict.)
- `docs/MIGRATION.md` — add a "Phase 4 retired the parallel HTML universe — see [F74]" note at the top.
- `.github/PULL_REQUEST_TEMPLATE.md` — if it exists and mentions `frontend-prototype`, update.
- Other docs surfaced by the `rg` audit in Task 2.

**Move (PR-B — archive):**
- `mockups/frontend-prototype/` → `mockups/archive/v1-2025-11/`
- `docs/Design System Handoff.html` → `mockups/archive/v1-2025-11/Design System Handoff.html`

**Not touched:**
- `frontend/scripts/lint-design.mjs` — already updated for Phase 4 (stories scanned).
- `biome.json` — leave the `!docs/**/*.html` exclusion as-is (harmless after the move).

---

## Task 1: Verify the prerequisites gate

**Files:** none (pre-flight check only).

- [ ] **Step 1: Confirm every prerequisite**

Run each in order; all must succeed:

```bash
# F68-F72 + F73 merged
git log main --oneline | grep -E '\[F(68|69|70|71|72|73)\]' | sort -u

# X24 has a green run
gh run list --workflow=CI --branch=main --limit=20 --json conclusion,event,headSha,headBranch | jq '.[] | select(.event == "push") | .conclusion' | head -5
# (Manually confirm one of the runs corresponds to a commit that includes the Playwright theme-sweep spec.)

# At least one feature shipped via the new workflow
# (Manually confirm — there is no automated check for "this PR used a TSX story instead of an HTML mockup". Look at recent merged PRs touching frontend/src/ for a story-driven feature description.)
```

If any check fails, stop. This task does not begin until the gate is open.

- [ ] **Step 2: (No commit — gate verification only.)**

---

## Task 2: PR-A — CLAUDE.md rewrite + reference sweep

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md` (if a relevant section exists)
- Modify: `docs/MIGRATION.md` (add retirement note)
- Modify: any other file surfaced by Step 2

- [ ] **Step 1: Branch from main**

```bash
git checkout main
git pull --ff-only origin main
git checkout -b chore/retire-mockups-claude-md
```

- [ ] **Step 2: Repo-wide reference audit**

```bash
rg -i 'frontend-prototype|design system handoff' --type md
rg -i 'frontend-prototype|design system handoff' .github/
rg -i 'frontend-prototype|design system handoff' docs/
rg -i 'frontend-prototype|design system handoff' README.md 2>/dev/null
```

Capture the hit list. Every hit needs an update or deliberate decision to leave (e.g. archive paths inside `mockups/archive/` if the move has happened — but in this PR it hasn't yet, so all hits are stale references).

- [ ] **Step 3: Rewrite the CLAUDE.md "UI source of truth" rule**

Find the existing paragraph in `CLAUDE.md` (under "Project Overview", currently lines ~11–16):

```
**UI source of truth:** `mockups/frontend-prototype/` — high-fidelity design prototype. `design/styles.css` defines the full token set (colors, typography, spacing, radii, shadows) for three themes (`paper` default, `sepia`, `dark`). `screenshots/` are the visual reference. `design/*.jsx` are component references, not production code — recreate faithfully in the real React app.
```

Replace with (adjust to project tone — the version below preserves the "X is the source for Y" voice):

```
**UI source of truth:** Storybook. Run `npm --prefix frontend run storybook` and browse `Primitives/`, `Tokens/`, and component-namespaced stories before authoring new UI. New components and new feature mockups are written as `*.stories.tsx` files alongside the component source — there is no parallel HTML mockup universe. The design tokens (`--ink-*`, `--bg-*`, theme blocks, radii, shadows) live in `frontend/src/index.css`'s `@theme` block; the `lint:design` CI guard (see `frontend/scripts/lint-design.mjs`) enforces token-only usage in `frontend/src/`. Historical mockups live read-only at `mockups/archive/v1-2025-11/`.
```

- [ ] **Step 4: Update each other hit from Step 2**

- For `docs/MIGRATION.md`: prepend a one-line "**Phase 4 (retired):** the parallel HTML universe is gone — see [F74](../docs/superpowers/plans/F74-retire-html-mockups.md). UI source of truth is now Storybook." note above the existing burn-down content.
- For `README.md`: defer the actual rewrite to [F75]; in this PR, only update if a hit references `mockups/frontend-prototype/` and would be confusing without an immediate fix.
- For `.github/PULL_REQUEST_TEMPLATE.md`: if it exists and references the old workflow, update.
- Other hits: case-by-case.

- [ ] **Step 5: Verify**

```bash
# CLAUDE.md no longer references the old folder as the source
! grep -qE 'mockups/frontend-prototype.*UI source of truth' CLAUDE.md

# Audit returns no unresolved hits (or only intentional ones)
rg -i 'frontend-prototype|design system handoff' --type md .github/ docs/ README.md
# Manually inspect remaining hits; each should be either an archive reference or in this PR's diff itself.
```

- [ ] **Step 6: Commit + PR**

```bash
git add CLAUDE.md docs/MIGRATION.md README.md .github/PULL_REQUEST_TEMPLATE.md 2>/dev/null
git commit -m "docs: point UI source-of-truth at Storybook (pre-deletion)"
git push -u origin chore/retire-mockups-claude-md
gh pr create --title "docs: point UI source-of-truth at Storybook (pre-deletion)" --body "$(cat <<'EOF'
## Summary
- Rewrites `CLAUDE.md`'s "UI source of truth" rule to point at Storybook + the `lint:design` guard.
- Updates other repo references to the old `mockups/frontend-prototype/` workflow.
- **Does NOT move the actual directory** — that's the follow-up PR ([F74] Step 3).
- Lands first so the rule is on `main` before the directory it references gets renamed.

## Why now
All [F74] prerequisites are green:
- [F68]-[F72] + [F73] merged.
- [X24] Playwright theme-sweep has at least one green CI run on main.
- ≥1 feature shipped via the new TSX-story workflow.

## Follow-ups
- PR-B: `git mv mockups/frontend-prototype mockups/archive/v1-2025-11/` ([F74] Step 3).
- PR-C: README "Design system" section refresh ([F75]).
EOF
)"
```

Wait for PR-A to merge before starting Task 3.

---

## Task 3: PR-B — archive the directory

**Files:**
- Move: `mockups/frontend-prototype/` → `mockups/archive/v1-2025-11/`
- Move: `docs/Design System Handoff.html` → `mockups/archive/v1-2025-11/Design System Handoff.html`

- [ ] **Step 1: Branch from main**

```bash
git checkout main
git pull --ff-only origin main
git checkout -b chore/archive-mockups-v1
```

- [ ] **Step 2: Confirm files exist**

```bash
ls mockups/frontend-prototype/ | head -5    # should list design/ screenshots/ etc.
ls "docs/Design System Handoff.html"        # should print the filename
```

If either is missing, stop — the prerequisites or PR-A may have already moved them, and re-running this task would be incorrect.

- [ ] **Step 3: Move**

```bash
mkdir -p mockups/archive
git mv mockups/frontend-prototype mockups/archive/v1-2025-11
git mv "docs/Design System Handoff.html" mockups/archive/v1-2025-11/
# (The original Inkwell.html prototype lives inside mockups/frontend-prototype/
# and is moved by the line above — no separate mv needed. Verify:)
ls mockups/archive/v1-2025-11/design/Inkwell.html
```

- [ ] **Step 4: Verify**

```bash
# Old paths gone
! [ -d mockups/frontend-prototype ]
! [ -e "docs/Design System Handoff.html" ]

# New paths present
[ -d mockups/archive/v1-2025-11 ]
[ -f mockups/archive/v1-2025-11/design/Inkwell.html ]
[ -f "mockups/archive/v1-2025-11/Design System Handoff.html" ]

# Repo-wide grep is clean (only archive references should remain)
rg 'mockups/frontend-prototype' --type md
# Expected output: empty (or only this PR's diff itself).
```

- [ ] **Step 5: Run the full CI suite locally**

```bash
cd frontend && npm run build && npm run lint:design && npx biome ci .
```

Expected: all checks pass. The `biome.json` exclusion for `docs/**/*.html` is now obsolete-but-harmless; leave for a separate cleanup.

- [ ] **Step 6: Commit + PR**

```bash
git add -A mockups/ docs/
git commit -m "chore(mockups): archive v1 prototype after Storybook adoption"
git push -u origin chore/archive-mockups-v1
gh pr create --title "chore(mockups): archive v1 prototype after Storybook adoption" --body "$(cat <<'EOF'
## Summary
- Moves `mockups/frontend-prototype/` → `mockups/archive/v1-2025-11/` (preserving git history).
- Moves `docs/Design System Handoff.html` into the same archive.
- Storybook ([F68]-[F73]) is now the live design surface; this PR retires the parallel HTML universe.

## Why archive vs delete
- History stays accessible — old PR descriptions linking to `mockups/frontend-prototype/Inkwell.html` can be navigated to via the archive path.
- Zero ongoing cost (the archive is static).
- Hard delete is a separate decision for a later PR if ever justified (HANDOFF.md guidance: leave indefinitely).

## Verify
- `cd frontend && npm run build` ✓
- `cd frontend && npm run lint:design` ✓
- `cd frontend && npx biome ci .` ✓
- `rg 'mockups/frontend-prototype' --type md` returns only archive paths ✓

## Follow-ups
- README "Design system" section refresh ([F75]).
- Optional cleanup: drop the now-obsolete `!docs/**/*.html` exclusion from `biome.json`.
EOF
)"
```

---

## Task 4: PR-C — README "Design system" section ([F75])

This is the [F75] task. Owner can choose:

- **(a) Land in the same PR as Task 3 (PR-B)** — atomic from the user's perspective. Add the README change to the PR-B branch before pushing; update the PR title to `chore(mockups): archive v1 prototype + point README at Storybook`.
- **(b) Land as a separate PR-C** — slightly cleaner review separation; allows the archive PR to merge instantly.

Either is fine. See [F75] in TASKS.md for the verify command.

---

## Self-review notes (run before merge)

1. **Spec coverage:** All four steps from HANDOFF.md § "Retire the parallel HTML universe" are mapped to Tasks 1–4. The hard-prerequisites gate from HANDOFF.md is in Task 1.
2. **Placeholder scan:** No "TODO", no "audit other references later". The `rg` commands run in Task 2 / Task 3 do the audits explicitly.
3. **Type consistency:** N/A (no code).
4. **Sequencing:** Task 1 gate → Task 2 (PR-A) merges → Task 3 (PR-B) merges → Task 4 (PR-C, optional). Don't open PR-B before PR-A merges; the CLAUDE.md rule must be the new shape on main before the directory it references moves.
