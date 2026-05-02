# TASKS.md Reorganisation — Design

**Date:** 2026-05-02
**Status:** Proposed
**Branch (planned):** `chore/tasks-md-reorg`
**Type:** Documentation / process — no production code touched

---

## Problem

`TASKS.md` is 609 lines. ~150 of those are completed `[x]` entries in
sections that are functionally closed (AU, B, I, T are 100% done; F is
only open in its Phase-4 subsection). The X-series has accreted into a
24-entry junk drawer mixing dependency bumps, security advisories, AI
features, exports, account-settings work, and design-system follow-ups,
with no internal grouping.

Two consequences:

1. The file no longer scans well. "Where are we?" requires scrolling
   past hundreds of `[x]` lines to find the handful of `[ ]` ones.
2. Adding a task today implies the existing convention — a full
   description plus a `verify:` line — even when the task is
   nothing more than a future-idea placeholder. Tasks that need a
   spec/plan get added inconsistently; some get a `[design-first]`
   tag (per F59–F64) and some don't.

---

## Goals

1. Live `TASKS.md` shrinks to ~180–220 lines: only open tasks plus
   header / focus / workflow blocks.
2. The X-series stops being a junk drawer. Recurring categories
   (maintenance, design-system follow-ups) get their own section
   letters; bounded backlog stays under X with internal grouping.
3. A documented lifecycle: a task can be added with a description
   only, but cannot be implemented until it has either a `plan:`
   link or a `trivial:` justification.
4. Backwards-compatible: every old task ID stays greppable via
   `grep -rE "\[<ID>\]" TASKS.md docs/done/` (the convention already
   in CLAUDE.md). No commit-history rewrite.

## Non-goals

- Not changing how tasks get **executed** (subagent-driven-development
  / executing-plans / `/task-verify` all stay).
- Not introducing a new checkbox state. Standard GFM `[ ]` / `[x]` only.
- Not auto-archiving on a schedule. Archive happens when a subsection
  closes, manually, in the same PR that closes the last task.
- Not building a TUI / dashboard. Two short shell scripts for grep'ing
  by lifecycle state are enough.

---

## Design

### 1. File structure

```
TASKS.md                   ~180–220 lines (open tasks + header + focus + workflow)
docs/done/
  done-S.md                existing, immutable
  done-A.md                existing, immutable
  done-D.md                existing, immutable
  done-E.md                existing, immutable
  done-V.md                existing, immutable
  done-L.md                existing, immutable
  done-AU.md               NEW — AU1–AU17 (all done)
  done-B.md                NEW — B1–B12 + V19–V28 + D17 (all done)
  done-F.md                NEW — F1–F67 (mockup-fidelity / page-integration / core-completion subsections)
                                  — Phase 4 stays live in TASKS.md
  done-I.md                NEW — I1–I9 (all done)
  done-T.md                NEW — T1–T9 + T8.1 (all done)
  done-X.md                NEW — X12, X13, X14, X15, X19, X22, X23, X24 (closed entries from old X bucket)
```

What stays live in `TASKS.md`:

| Section | State | Open task count |
|---|---|---|
| AU — Auth & Security | stub (all archived) | 0 |
| B — Backend (non-AI routes) | stub | 0 |
| F — Frontend | only `### Phase 4 (Storybook)` live | F63, F65, F74, F75 |
| I — DevOps & Infra | stub | 0 |
| T — Testing | stub | 0 |
| X — Extras (feature backlog) | live, themed subsections | the open X-numbered features |
| **M — Maintenance & dependencies** | NEW, live | M1 (was X16), M2 (was X20), M3 (was X21) |
| **DS — Design-system follow-ups** | NEW, live, empty | none yet |

The `## S/A/D/E/V/L` archived stubs already exist; the new
`## AU/B/I/T` stubs follow the same 2-line pattern:

```markdown
## AU — archived

All [AU]-series tasks complete — archived in [`docs/done/done-AU.md`](docs/done/done-AU.md).
```

### 2. Section taxonomy

| Letter | Name | Status |
|---|---|---|
| S | Scaffold | archived |
| A | Architecture docs | archived |
| D | Database | archived |
| AU | Auth & Security | archived |
| E | Encryption at rest | archived |
| V | Venice integration | archived |
| L | Live Venice testing | archived |
| B | Backend (non-AI routes) | archived |
| F | Frontend | live (Phase 4 only) |
| I | DevOps & Infra | archived |
| T | Testing | archived |
| X | Extras (feature backlog) | live, themed subsections |
| **M** | **Maintenance & dependencies** | **live, NEW** |
| **DS** | **Design-system follow-ups** | **live, NEW** |

X subsections inside the live `## X` section:

- `### X — Editor & writing` — X1, X2, X9, X17
- `### X — AI features` — X4, X8, X11
- `### X — Import & export` — X5, X6, X7
- `### X — Account` — X3, X18

ID continuity rule:

- **Closed tasks keep their original ID forever.** X22/X23/X24 stay
  under those IDs in `done-X.md`; the next design-system task is
  `[DS1]`.
- **Open tasks moved to a new section get re-IDed**, with a one-line
  `(was X16)` annotation in the description for grep-bridging.
  - `[M1]` (was X16) — pg deprecation
  - `[M2]` (was X20) — act-warning sweep
  - `[M3]` (was X21) — hono advisory

### 3. New `## Current focus` block

Replaces the existing 5-line "Current focus" block in TASKS.md with:

```markdown
## Current focus

- **In flight:** F74 / F75 (retire HTML mockups + README update — gated on F68–F73 + X24 done; all unblocked).
- **Backlog (next):** F63 chat history, F65 terminal-401 redirect, M1–M3 maintenance.
- **Proposed (no plan yet):** X1, X2, X3, X4, X5, X6, X7, X8, X9, X11, X17, X18, DS-* (none yet).
- **Archived:** S, A, D, AU, E, V, L, B, I, T (full task history in `docs/done/`).
- **Live sections:** F (Phase 4 only), X, M, DS.
```

The "Proposed" line is auto-derivable; `scripts/tasks-proposed.sh`
regenerates it on demand.

### 4. New `## Workflow` block

Inserted directly under `## Current focus`:

```markdown
## Workflow

Tasks lifecycle: `proposed` → `planned` / `trivial` → `done`.

- Add a task with description only — no plan needed at creation.
- Before implementation, every task needs either:
  - `- plan: [...]` link to a spec/plan under `docs/superpowers/plans/`, OR
  - `- trivial: <one-line justification>` (≤30 LoC, no new abstractions, no schema/auth/crypto/repo touch, no new dependency)
- Both gates also require `- verify: <command>`.
- Tick `[x]` only after `/task-verify <ID>` exits 0 (auto-ticked by the pre-edit hook).
```

### 5. Lifecycle states (worked examples)

```markdown
- [ ] **[M4]** Bump TipTap to v3.x. <one-paragraph description>
                                                           ← proposed (no plan:, no trivial:)

- [ ] **[M5]** Bump TipTap to v3.x. <description>
  - plan: [docs/superpowers/plans/M5-tiptap-v3.md](...)
  - verify: `cd frontend && npm test`
                                                           ← planned

- [ ] **[M6]** Pin `@types/node` to `^22`. <description>
  - trivial: single-line package.json bump, no code changes
  - verify: `cd backend && npm run build`
                                                           ← trivial

- [x] **[M7]** Bump pg to v9. <description>
  - plan: [docs/superpowers/plans/M7-pg-v9.md](...)
  - verify: `cd backend && npm test`
                                                           ← done
```

### 6. Triviality bar

A task is `trivial:` only if **all** of:

- ≤ ~30 LoC change
- no new abstractions (no new module, no new shared type beyond local)
- no schema, auth, crypto, or repo-layer touch
- no new dependency
- ideally one file

Borderline → write a plan. The `trivial:` line includes the
justification (one short clause), not just the literal word, so a
reviewer can challenge the call.

### 7. Helper scripts

Two short awk scripts under `scripts/`:

- `scripts/tasks-proposed.sh` — list open tasks with no `plan:` and
  no `trivial:`. Used to regenerate the "Proposed" line in
  `## Current focus`.
- `scripts/tasks-implementable.sh` — list open tasks that are ready
  to start (have either `plan:` or `trivial:`, plus `verify:`).

Each is ≤10 lines of awk. No extra dependencies; runs on the
project's existing bash.

### 8. CLAUDE.md updates

Three small edits, all in the same commit as the TASKS.md rewrite:

1. **Task Completion Protocol** section — insert the lifecycle gate
   as a new bullet:
   > "Before writing implementation code, confirm the task has a
   > `plan:` or `trivial:` line. If neither, stop and write the plan
   > first (or justify the `trivial:` exception inline)."

2. **Archived sections** line — replace:
   > Currently archived: **S, A, D, E, V, L**. Currently live in
   > `TASKS.md`: **AU, B, F, I, T, X**.

   with:
   > Currently archived: **S, A, D, AU, E, V, L, B, I, T**. Currently
   > live in `TASKS.md`: **F (Phase 4 only), X, M, DS**.

3. **Task Order** — append two rows to the section table:
   - `M | maintenance & dependency upgrades`
   - `DS | design-system follow-ups`

### 9. Archive-rotation rule (tightened)

CLAUDE.md currently says: "rotate when fully closed AND not touched
in last 2 PRs." Tighten to:

> Rotate a **subsection** (rather than waiting for the whole section
> letter to close) when its tasks are all `[x]`. The subsection
> entries move verbatim into the matching `done-<X>.md` and the
> subsection heading is removed from the live file. Done in the same
> PR that closes the last task in the subsection.

This avoids the current state where AU/B/F/I/T are all functionally
done but kept live just because one or two open tasks remain in
unrelated subsections.

---

## Migration plan

Single PR, branch `chore/tasks-md-reorg`. No production code touched.

1. **Step 1** — write this spec doc (done by writing it).
2. **Step 2** — create six new archive files in one commit (move
   verbatim, no `[x]`→`[done]` transformation).
3. **Step 3** — rewrite `TASKS.md`: new `## Current focus` and
   `## Workflow` blocks; archived-section stubs; live X (themed
   subsections); new M and DS sections.
4. **Step 4** — update CLAUDE.md (lifecycle gate + archived line +
   M/DS rows in the task-order table) in the same commit as Step 3.
5. **Step 5** — add `scripts/tasks-proposed.sh` and
   `scripts/tasks-implementable.sh` in a separate commit.
6. **Step 6** — verify:
   - `wc -l TASKS.md` → expect ~180–220 lines
   - `grep -c "^- \[x\]" TASKS.md` → expect 0
   - `grep -rE "\[(AU|B|F[1-6]|I|T)[0-9]+\]" TASKS.md docs/done/`
     → every old ID resolvable in exactly one place
   - `bash scripts/tasks-implementable.sh` → lists every open task
     with `plan:` or `trivial:`
   - `bash scripts/tasks-proposed.sh` → lists every open task
     missing both
7. **Step 7** — open the PR.

## Risks / non-issues

- **Commit-message ID drift:** all old IDs stay greppable via the
  documented `grep -rE "\[<ID>\]" TASKS.md docs/done/` lookup. No
  commit-history rewrite needed.
- **Pre-edit auto-tick hook:** `.claude/hooks/pre-tasks-edit.sh` may
  need a quick check during execution to confirm it only watches the
  live `TASKS.md` and doesn't break when an archived section's task
  is referenced.
- **Phase 4 mid-flight:** F73 just shipped and F74/F75 are next; the
  live `### F — Phase 4 (Storybook)` subsection stays intact through
  this migration so that work isn't disturbed.

## Out of scope

- Moving spec / plan files anywhere. They stay in
  `docs/superpowers/{specs,plans}/`.
- Any change to `/task-verify` or the pre-edit hook other than the
  quick check noted above.
- A real-time dashboard / TUI for task state.

## Decision log

- **Section split (Question 2):** chose hybrid (c) — promote M and
  DS to top-level sections (recurring work), keep the rest as X
  subsections (bounded backlog).
- **Archive granularity (Question 1):** chose subsection-level (b) —
  rotate completed subsections, keep open subsections live in the
  same section letter.
- **Lifecycle gate (Question 3):** chose convention-driven (c) — no
  new checkbox state; presence of `plan:` or `trivial:` is the gate.
