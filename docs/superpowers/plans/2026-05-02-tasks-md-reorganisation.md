# TASKS.md Reorganisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shrink `TASKS.md` from 609 lines to ~180–220 by archiving completed subsections, regroup the X-series into themed subsections, promote `M` (Maintenance) and `DS` (Design-system) to top-level sections, and document a `proposed → planned/trivial → done` task lifecycle.

**Architecture:** Pure docs / process change. No production code touched. One branch (`chore/tasks-md-reorg`), three logical commits (archive files; rewrite TASKS.md + CLAUDE.md; helper scripts), then a single PR.

**Tech Stack:** bash, awk, grep, git. The verify steps use `wc -l`, `grep -c`, and the helper-script outputs.

**Source-of-truth references:**
- Spec: [docs/superpowers/specs/2026-05-02-tasks-md-reorganisation-design.md](../specs/2026-05-02-tasks-md-reorganisation-design.md)
- Existing archive convention: [docs/done/done-S.md](../../done/done-S.md) (2-line header, then verbatim entries, immutable)
- Pre-edit hook: [.claude/hooks/pre-tasks-edit.sh](../../../.claude/hooks/pre-tasks-edit.sh) — already path-scoped to `TASKS.md`, so archived task IDs do not interfere.
- Verify-extractor: [scripts/extract-verify.sh](../../../scripts/extract-verify.sh) — same path scoping; safe.

---

## File Structure

**Create (docs):**
- `docs/done/done-AU.md` — AU1–AU17 (all done)
- `docs/done/done-B.md` — B1–B12 + V19–V28 + D17 (all done)
- `docs/done/done-F.md` — F1–F67 (mockup-fidelity / page-integration / core-completion subsections; Phase 4 stays live)
- `docs/done/done-I.md` — I1–I9 (all done)
- `docs/done/done-T.md` — T1–T9 + T8.1 (all done)
- `docs/done/done-X.md` — X12, X13, X14, X15, X19, X22, X23, X24 (closed entries)

**Create (scripts):**
- `scripts/tasks-proposed.sh` — list open tasks missing both `plan:` and `trivial:`
- `scripts/tasks-implementable.sh` — list open tasks with `plan:` or `trivial:` plus `verify:`

**Rewrite (in place):**
- `TASKS.md` — keep header / tech-stack / focus / workflow blocks; collapse archived sections to 2-line stubs; live X regrouped into themed subsections; new M and DS sections.

**Modify:**
- `CLAUDE.md` — three small edits (lifecycle gate bullet; archived-line update; M/DS rows in task-order table).

**Not touched:**
- Any production code (frontend/, backend/, db/).
- `docs/superpowers/{specs,plans}/` (existing files left alone).
- `docs/HANDOFF.md`, other docs.
- The pre-edit hook or `extract-verify.sh` (already path-scoped to live TASKS.md; archive files don't interfere).

---

## Task 1: Branch + working directory

**Files:** none (git operation)

- [ ] **Step 1: Create the branch from current main**

```bash
git checkout main
git pull --ff-only
git checkout -b chore/tasks-md-reorg
```

Expected: `Switched to a new branch 'chore/tasks-md-reorg'`.

- [ ] **Step 2: Sanity-check working tree is clean**

```bash
git status --porcelain
```

Expected: empty output.

---

## Task 2: Extract AU section into done-AU.md

**Files:**
- Create: `docs/done/done-AU.md`
- Source: `TASKS.md` lines 47–112 (the `## 🔐 AU` section through the AU17 verify line)

- [ ] **Step 1: Verify the AU section bounds**

```bash
awk '/^## 🔐 AU/{n=NR} /^---$/ && n && NR>n {print n"-"NR-1; exit}' TASKS.md
```

Expected: a single line like `47-112`. If the bounds differ, use the actual numbers in the next step. (The numbers may have shifted if `main` moved between this plan being written and execution — read the live file rather than trusting these line numbers blindly.)

- [ ] **Step 2: Confirm every AU task is `[x]`**

```bash
awk '/^## 🔐 AU/,/^---$/' TASKS.md | grep -c '^- \[ \]'
```

Expected: `0`. If non-zero, stop — there are open AU tasks and the section is not eligible for archiving. (Spec assumes all done.)

- [ ] **Step 3: Write `docs/done/done-AU.md`**

Create the file with this exact two-line header (matching `done-S.md` convention), then the verbatim AU section body (everything from `## 🔐 AU — Auth & Security` through `tests/auth/rotate-recovery-code.test.ts`):

```markdown
> Source of truth: `TASKS.md`. Closed [AU]-series tasks archived here on 2026-05-02 to keep `TASKS.md` lean.
> These entries are immutable; any reopen lands as a new task in `TASKS.md`.

---

## 🔐 AU — Auth & Security

<verbatim copy of lines 47–112 from current TASKS.md, starting at the `## 🔐 AU` heading and ending at the AU17 verify line>
```

To produce the body without re-typing, run:

```bash
awk '/^## 🔐 AU/,/^---$/' TASKS.md | sed '$d'
```

Pipe the output of that into the file after the two header lines + `---`.

- [ ] **Step 4: Verify the archive file**

```bash
grep -c '^- \[x\]' docs/done/done-AU.md
grep -c '^- \[ \]' docs/done/done-AU.md
```

Expected: first line ≥ 17 (AU1–AU17 plus any related subtasks), second line `0`.

- [ ] **Step 5: Stage** (commit happens at end of Task 7 with all archives together)

```bash
git add docs/done/done-AU.md
```

---

## Task 3: Extract B section into done-B.md

**Files:**
- Create: `docs/done/done-B.md`
- Source: `TASKS.md` `## 🖥️ B` section (B1–B12 + the V19–V28 / D17 follow-ups inside `### B — Post-B-series follow-ups`)

- [ ] **Step 1: Verify the B section bounds**

```bash
awk '/^## 🖥️ B/{n=NR} /^## ☁️ I/ && n {print n"-"NR-3; exit}' TASKS.md
```

Expected: a single line like `133-209`. (NR-3 backs off the trailing blank line + `---` separator + the I-section heading.)

- [ ] **Step 2: Confirm every B-section task is `[x]`**

```bash
awk '/^## 🖥️ B/,/^## ☁️ I/' TASKS.md | grep -c '^- \[ \]'
```

Expected: `0`.

- [ ] **Step 3: Write `docs/done/done-B.md`**

Header (same convention):

```markdown
> Source of truth: `TASKS.md`. Closed [B]-series tasks (including V19–V28 follow-ups and the [D17] schema fix that landed in the B-series branch) archived here on 2026-05-02 to keep `TASKS.md` lean.
> These entries are immutable; any reopen lands as a new task in `TASKS.md`.

---
```

Then verbatim body produced by:

```bash
awk '/^## 🖥️ B/,/^## ☁️ I/' TASKS.md | sed '/^---$/{N;/\n## ☁️/d;}' | sed '${/^$/d;}'
```

(That trims the trailing `---` separator and following blank line so the I-section heading does not bleed into the archive.)

- [ ] **Step 4: Verify the archive file**

```bash
grep -c '^- \[x\]' docs/done/done-B.md
grep -c '^- \[ \]' docs/done/done-B.md
```

Expected: first line ≥ 21 (B1–B12 + V19–V28 + D17), second line `0`.

- [ ] **Step 5: Stage**

```bash
git add docs/done/done-B.md
```

---

## Task 4: Extract F section's closed subsections into done-F.md

**Files:**
- Create: `docs/done/done-F.md`
- Source: `TASKS.md` `## 🎨 F` section, **excluding** `### F — Phase 4 (Storybook)` which stays live.

- [ ] **Step 1: Verify the F-section subsection ranges**

```bash
grep -nE '^(## 🎨 F|### F —|## ☁️ I)' TASKS.md
```

Expected output (line numbers may have shifted):

```
212:## 🎨 F — Frontend
277:### F — Mockup-fidelity implementation (Inkwell design)
368:### F — Page integration (mount mockup-fidelity components)
396:### F — Core completion (gaps blocking a usable app)
431:### F — Phase 4 (Storybook)
466:## ☁️ I — DevOps & Infra
```

The closed-subsection range to archive is **start of `## 🎨 F`** through **the line immediately before `### F — Phase 4 (Storybook)`**. The Phase 4 subsection stays in live TASKS.md.

- [ ] **Step 2: Confirm every closed-F task is `[x]`**

```bash
awk '/^## 🎨 F/,/^### F — Phase 4/' TASKS.md | grep -c '^- \[ \]'
```

Expected: `0`. If any open F task exists outside Phase 4, stop and ask — the spec assumed F1–F67 were all done.

- [ ] **Step 3: Write `docs/done/done-F.md`**

Header:

```markdown
> Source of truth: `TASKS.md`. Closed [F]-series tasks (F1–F67 — original frontend, mockup-fidelity implementation, page-integration, and core-completion subsections) archived here on 2026-05-02 to keep `TASKS.md` lean. The Phase 4 (Storybook) subsection is still live in `TASKS.md`.
> These entries are immutable; any reopen lands as a new task in `TASKS.md`.

---
```

Then verbatim body:

```bash
awk '/^## 🎨 F/,/^### F — Phase 4/' TASKS.md | sed '$d'
```

(Drops the `### F — Phase 4` heading line itself; that section stays live.)

- [ ] **Step 4: Verify**

```bash
grep -c '^- \[x\]' docs/done/done-F.md
grep -c '^- \[ \]' docs/done/done-F.md
grep -c 'Phase 4' docs/done/done-F.md
```

Expected: first line ≥ 67, second line `0`, third line `1` (only the header reference to Phase 4 staying live).

- [ ] **Step 5: Stage**

```bash
git add docs/done/done-F.md
```

---

## Task 5: Extract I and T sections

**Files:**
- Create: `docs/done/done-I.md`
- Create: `docs/done/done-T.md`

- [ ] **Step 1: Confirm I and T are 100% done**

```bash
awk '/^## ☁️ I/,/^## 🧪 T/' TASKS.md | grep -c '^- \[ \]'
awk '/^## 🧪 T/,/^## 💡 X/' TASKS.md | grep -c '^- \[ \]'
```

Expected: `0` for both.

- [ ] **Step 2: Write `docs/done/done-I.md`**

```markdown
> Source of truth: `TASKS.md`. Closed [I]-series tasks archived here on 2026-05-02 to keep `TASKS.md` lean.
> These entries are immutable; any reopen lands as a new task in `TASKS.md`.

---

<verbatim body via:>
```

```bash
awk '/^## ☁️ I/,/^## 🧪 T/' TASKS.md | sed '/^---$/{N;/\n## 🧪/d;}' | sed '${/^$/d;}'
```

- [ ] **Step 3: Write `docs/done/done-T.md`**

```markdown
> Source of truth: `TASKS.md`. Closed [T]-series tasks (T1–T9 + T8.1) archived here on 2026-05-02 to keep `TASKS.md` lean.
> These entries are immutable; any reopen lands as a new task in `TASKS.md`.

---

<verbatim body via:>
```

```bash
awk '/^## 🧪 T/,/^## 💡 X/' TASKS.md | sed '/^---$/{N;/\n## 💡/d;}' | sed '${/^$/d;}'
```

- [ ] **Step 4: Verify both**

```bash
grep -c '^- \[x\]' docs/done/done-I.md
grep -c '^- \[ \]' docs/done/done-I.md
grep -c '^- \[x\]' docs/done/done-T.md
grep -c '^- \[ \]' docs/done/done-T.md
```

Expected: I file ≥ 9 done, 0 open. T file ≥ 10 done, 0 open.

- [ ] **Step 5: Stage**

```bash
git add docs/done/done-I.md docs/done/done-T.md
```

---

## Task 6: Extract closed X entries into done-X.md

**Files:**
- Create: `docs/done/done-X.md`
- Source: `TASKS.md` `## 💡 X` section, but only the `[x]` entries: X12, X13, X14, X15, X19, X22, X23, X24.

- [ ] **Step 1: List the closed X entries**

```bash
awk '/^## 💡 X/,0' TASKS.md | grep -E '^- \[x\] \*\*\[X[0-9]+\]\*\*'
```

Expected output: 8 lines for X12, X13, X14, X15, X19, X22, X23, X24. (Note: X10 was deleted long ago and lives as an HTML comment block — not a task; do not include.)

- [ ] **Step 2: Write `docs/done/done-X.md`**

```markdown
> Source of truth: `TASKS.md`. Closed [X]-series entries archived here on 2026-05-02 — feature/maintenance tasks completed before the X→{X, M, DS} reorganisation. New maintenance tasks now land under [M]; new design-system follow-ups under [DS]. Open X-numbered tasks remain in live `TASKS.md` under themed subsections.
> These entries are immutable; any reopen lands as a new task in `TASKS.md` (under whichever section now owns the topic).

---

## 💡 X — Extras (closed entries)
```

Then for each of X12, X13, X14, X15, X19, X22, X23, X24, copy the full task block (the `- [x] **[Xn]** …` line plus its `- verify:` line, plus a trailing blank line) verbatim from `TASKS.md`. Use:

```bash
for id in X12 X13 X14 X15 X19 X22 X23 X24; do
  awk -v id="$id" '
    $0 ~ "^- \\[x\\] \\*\\*\\["id"\\]" { p=1 }
    p { print }
    p && /^  - verify:/ { print ""; p=0 }
  ' TASKS.md
done >> docs/done/done-X.md
```

- [ ] **Step 3: Verify**

```bash
grep -c '^- \[x\] \*\*\[X' docs/done/done-X.md
grep -c '^- \[ \]' docs/done/done-X.md
```

Expected: first line `8`, second line `0`.

- [ ] **Step 4: Stage**

```bash
git add docs/done/done-X.md
```

---

## Task 7: Commit the six archive files

- [ ] **Step 1: Verify all six files staged**

```bash
git diff --cached --name-only
```

Expected: exactly these six lines (in any order):
```
docs/done/done-AU.md
docs/done/done-B.md
docs/done/done-F.md
docs/done/done-I.md
docs/done/done-T.md
docs/done/done-X.md
```

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore(tasks): archive AU/B/F-closed/I/T/X-closed into docs/done/

Mechanical extraction of completed sections from TASKS.md into
per-section archive files following the existing done-S.md / done-A.md
convention. No content changes — entries copied verbatim. The full
TASKS.md rewrite lands in the next commit.

- done-AU.md: AU1–AU17 (all done)
- done-B.md:  B1–B12 + V19–V28 follow-ups + D17 (all done)
- done-F.md:  F1–F67 (Phase 4 stays live)
- done-I.md:  I1–I9 (all done)
- done-T.md:  T1–T9 + T8.1 (all done)
- done-X.md:  X12, X13, X14, X15, X19, X22, X23, X24 (closed)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Rewrite TASKS.md

**Files:**
- Rewrite: `TASKS.md`

This is one large `Write` (full overwrite), not an Edit. The new file body, in order:

1. Existing `# Story Editor — Development Tasks` heading + intro blurb (lines 1–4 of current).
2. `---` separator.
3. Existing `## Tech Stack` block (lines 7–17 of current) — keep as-is.
4. `---` separator.
5. **New `## Current focus`** block (replaces existing).
6. **New `## Workflow`** block.
7. `---` separator.
8. Eight archived-section stubs (S, A, D, AU, E, V, L — each 2 lines per existing convention; B, I, T new in same style).
9. `## 🎨 F — Frontend` heading + a one-line "All non-Phase-4 F-series archived in `done-F.md`" preface, then the existing `### F — Phase 4 (Storybook)` subsection verbatim from current TASKS.md.
10. `## 💡 X — Extras (feature backlog)` with four themed subsections containing only open X tasks (X1, X2, X9, X17 / X4, X8, X11 / X5, X6, X7 / X3, X18) verbatim from current.
11. `## 🔧 M — Maintenance & dependencies` with M1, M2, M3 (the three open ex-X tasks: pg deprecation [was X16], act-warning sweep [was X20], hono advisory [was X21]).
12. `## 🎨 DS — Design-system follow-ups` with a one-line preface ("No open tasks. Land DS-related follow-ups here as the design system evolves.").

- [ ] **Step 1: Confirm what stays live**

```bash
grep -nE '^(## |### )' TASKS.md
```

Read the full output to confirm the section boundaries match what this task assumes (in particular, that `### F — Phase 4 (Storybook)` is at line ~431 and contains F63, F65, F74, F75 as the open items).

- [ ] **Step 2: Read the four blocks that need to be preserved verbatim**

The new TASKS.md needs the verbatim text of:
- The Phase 4 subsection (heading + preface paragraph + F68–F75 entries).
- The four open X tasks in Editor & writing (X1, X2, X9, X17).
- The three open X tasks in AI features (X4, X8, X11).
- The three open X tasks in Import & export (X5, X6, X7).
- The two open X tasks in Account (X3, X18).
- The three M tasks (renamed from X16, X20, X21 — body verbatim with the addition of `(was X16)` etc. in the description).

Read each block via:

```bash
awk '/^### F — Phase 4/,/^---$/' TASKS.md
awk '/^- \[ \] \*\*\[X1\]\*\*/,/^  - verify:/' TASKS.md
awk '/^- \[ \] \*\*\[X2\]\*\*/,/^  - verify:/' TASKS.md
awk '/^- \[ \] \*\*\[X4\]\*\*/,/^  - verify:/' TASKS.md
awk '/^- \[ \] \*\*\[X5\]\*\*/,/^  - verify:/' TASKS.md
awk '/^- \[ \] \*\*\[X6\]\*\*/,/^  - verify:/' TASKS.md
awk '/^- \[ \] \*\*\[X7\]\*\*/,/^  - verify:/' TASKS.md
awk '/^- \[ \] \*\*\[X8\]\*\*/,/^  - verify:/' TASKS.md
awk '/^- \[ \] \*\*\[X9\]\*\*/,/^  - verify:/' TASKS.md
awk '/^- \[ \] \*\*\[X11\]\*\*/,/^  - verify:/' TASKS.md
awk '/^- \[ \] \*\*\[X16\]\*\*/,/^  - verify:/' TASKS.md
awk '/^- \[ \] \*\*\[X17\]\*\*/,/^  - verify:/' TASKS.md
awk '/^- \[ \] \*\*\[X18\]\*\*/,/^  - verify:/' TASKS.md
awk '/^- \[ \] \*\*\[X20\]\*\*/,/^  - verify:/' TASKS.md
awk '/^- \[ \] \*\*\[X21\]\*\*/,/^  - verify:/' TASKS.md
```

Capture each block. The rewrite in the next step inlines them.

- [ ] **Step 3: Write the new TASKS.md**

Use the `Write` tool to overwrite `TASKS.md` with this skeleton (substitute `<… verbatim body of XN …>` with the actual blocks captured in Step 2 — the agent must paste them, not refer to them):

```markdown
# Story Editor — Development Tasks

> A self-hosted, web-based story and text editor with Venice.ai AI integration. Users can manage multiple stories, break them into chapters, attach characters for consistency, and invoke AI assistance directly from the editor.

---

## Tech Stack

- **Frontend:** React + Vite + TypeScript + TailwindCSS + TipTap
- **Backend:** Node.js + Express + TypeScript + Prisma
- **Database:** PostgreSQL
- **Auth:** JWT (access token) + refresh token (httpOnly cookie)
- **AI:** Venice.ai API — OpenAI-compatible, proxied through backend
- **Venice SDK:** `openai` npm package pointed at Venice base URL (`https://api.venice.ai/api/v1`)
- **Containerisation:** Docker + Docker Compose
- **Testing:** Vitest + Supertest (backend), Vitest + React Testing Library (frontend), Playwright (E2E)

---

## Current focus

- **In flight:** F74 / F75 (retire HTML mockups + README update — gated on F68–F73 + X24 done; all unblocked).
- **Backlog (next):** F63 chat history, F65 terminal-401 redirect, M1–M3 maintenance.
- **Proposed (no plan yet):** X1, X2, X3, X4, X5, X6, X7, X8, X9, X11, X17, X18, DS-* (none yet).
- **Archived:** S, A, D, AU, E, V, L, B, I, T (full task history in `docs/done/`).
- **Live sections:** F (Phase 4 only), X, M, DS.

---

## Workflow

Tasks lifecycle: `proposed` → `planned` / `trivial` → `done`.

- Add a task with description only — no plan needed at creation.
- Before implementation, every task needs either:
  - `- plan: [...]` link to a spec/plan under `docs/superpowers/plans/`, OR
  - `- trivial: <one-line justification>` (≤30 LoC, no new abstractions, no schema/auth/crypto/repo touch, no new dependency)
- Both gates also require `- verify: <command>`.
- Tick `[x]` only after `/task-verify <ID>` exits 0 (auto-ticked by the pre-edit hook).

Helpers:
- `bash scripts/tasks-proposed.sh` — list open tasks missing both `plan:` and `trivial:`.
- `bash scripts/tasks-implementable.sh` — list open tasks ready to start.

---

## S — archived

All [S]-series tasks complete — archived in [`docs/done/done-S.md`](docs/done/done-S.md).

---

## A — archived

All [A]-series tasks complete — archived in [`docs/done/done-A.md`](docs/done/done-A.md).

---

## D — archived

All [D]-series tasks complete — archived in [`docs/done/done-D.md`](docs/done/done-D.md).

---

## AU — archived

All [AU]-series tasks complete — archived in [`docs/done/done-AU.md`](docs/done/done-AU.md).

---

## E — archived

All [E]-series tasks complete — archived in [`docs/done/done-E.md`](docs/done/done-E.md).

---

## V — archived

All [V]-series tasks complete — archived in [`docs/done/done-V.md`](docs/done/done-V.md).

---

## L — archived

All [L]-series tasks complete — archived in [`docs/done/done-L.md`](docs/done/done-L.md).

---

## B — archived

All [B]-series tasks complete (B1–B12, plus V19–V28 follow-ups and [D17]) — archived in [`docs/done/done-B.md`](docs/done/done-B.md).

---

## I — archived

All [I]-series tasks complete — archived in [`docs/done/done-I.md`](docs/done/done-I.md).

---

## 🧪 T — archived

All [T]-series tasks complete — archived in [`docs/done/done-T.md`](docs/done/done-T.md).

---

## 🎨 F — Frontend

> All non-Phase-4 [F]-series tasks (F1–F67) complete — archived in [`docs/done/done-F.md`](docs/done/done-F.md). Only the Phase 4 (Storybook) subsection remains live below.

<… verbatim body of `### F — Phase 4 (Storybook)` from current TASKS.md, including its preface paragraph, F68 through F75 (with their `[x]`/`[ ]` state preserved), and per-task `- plan:` / `- verify:` lines …>

---

## 💡 X — Extras (feature backlog)

> Open feature ideas, grouped by theme. Maintenance tasks are now under [M]; design-system follow-ups under [DS]. Closed X-numbered entries are archived in [`docs/done/done-X.md`](docs/done/done-X.md).

### X — Editor & writing

<… verbatim X1, X2, X9, X17 blocks …>

### X — AI features

<… verbatim X4, X8, X11 blocks …>

### X — Import & export

<… verbatim X5, X6, X7 blocks …>

### X — Account

<… verbatim X3, X18 blocks …>

---

## 🔧 M — Maintenance & dependencies

> Recurring dependency upgrades, security advisories, and tooling hygiene. Each task that touches more than ~30 LoC, adds an abstraction, touches schema/auth/crypto/repo, or adds a dependency requires a plan before implementation (per the Workflow section above).

- [ ] **[M1]** (was X16) <verbatim description body of X16, unchanged from current>
  - verify: <verbatim verify line of X16>

- [ ] **[M2]** (was X20) <verbatim description body of X20, unchanged from current>
  - verify: <verbatim verify line of X20>

- [ ] **[M3]** (was X21) <verbatim description body of X21, unchanged from current>
  - verify: <verbatim verify line of X21>

---

## 🎨 DS — Design-system follow-ups

> No open tasks. Land DS-related follow-ups here as the design system evolves (new primitives, token additions, lint:design rule changes, Storybook story patterns). Closed entries from the original X-bucket (X22–X24) are archived in [`docs/done/done-X.md`](docs/done/done-X.md).
```

- [ ] **Step 4: Verify line count + state**

```bash
wc -l TASKS.md
grep -c '^- \[x\]' TASKS.md
grep -c '^- \[ \]' TASKS.md
grep -nE '^(## |### )' TASKS.md
```

Expected:
- Line count: 180–250 (target was 180–220; 250 cap allows for the longer X descriptions and the M-section preface).
- `[x]` count: `0` (or 4 — the closed Phase 4 tasks F68–F73 stay `[x]` in the live file because they're in a still-live subsection; that is fine and expected).
- `[ ]` count: number of currently-open tasks (F63, F65, F74, F75 in F + 12 X tasks + 3 M tasks = ~19).
- Section headings: matches the new layout (no `## 🔐 AU — Auth & Security`, `## 🖥️ B`, `## ☁️ I`, `## 🧪 T` with their bodies; just the archived-stub form).

- [ ] **Step 5: Verify every old ID resolves to exactly one place**

```bash
for id in AU1 AU17 B1 B12 F1 F50 F67 I1 I9 T1 T9 V19 V28 D17 X12 X22; do
  hits=$(grep -rE "^- \[[x ]\] \*\*\[$id\]\*\*" TASKS.md docs/done/ | wc -l)
  echo "$id: $hits"
done
```

Expected: every ID prints `: 1`. Anything else means a duplicated extraction or a missing one.

---

## Task 9: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` — three small edits.

- [ ] **Step 1: Add the lifecycle gate to the Task Completion Protocol**

Find the section that begins:

```
## Task Completion Protocol

**NEVER mark a task `[x]` until its verify command passes with exit code 0.**

For every task:
1. Read the task and its `verify:` command before writing any code
```

Insert a new step **between the existing "Read the task…" step and the existing "Write the implementation" step**:

```markdown
2. Confirm the task has a `plan:` link or a `trivial:` justification line. If neither, stop and write the plan first (or justify the `trivial:` exception inline). Tasks with only a description are *proposed*, not implementable.
```

Renumber the subsequent steps (2 → 3, 3 → 4, etc.) accordingly.

- [ ] **Step 2: Update the "Currently archived" / "Currently live" line**

Find:

```
Currently archived: **S, A, D, E, V, L**. Currently live in `TASKS.md`: **AU, B, F, I, T, X**.
```

Replace with:

```
Currently archived: **S, A, D, AU, E, V, L, B, I, T**. Currently live in `TASKS.md`: **F (Phase 4 only), X, M, DS**.
```

- [ ] **Step 3: Tighten the archive-rotation rule**

Find the paragraph in CLAUDE.md that begins:

```
### Archived sections

`TASKS.md` only lists **live** sections (open tasks or hot code surfaces). Sections that are fully closed AND have not been touched in the last 2 PRs are rotated into `docs/done/done-<section>.md` — one file per section letter.
```

Replace the second sentence with:

```
A **subsection** is rotated into `docs/done/done-<section>.md` as soon as all its tasks are `[x]`, in the same PR that closes the last task — not the whole section letter. (Earlier S/A/D/E/V/L archives waited for the entire letter to close; that left mostly-done letters live and noisy. AU/B/I/T were rotated under the new subsection rule on 2026-05-02.)
```

- [ ] **Step 4: Add M and DS rows to the Task Order table**

Find the table:

```
| Section | Scope |
|---|---|
| S | scaffold |
…
| X | extras |
```

Append two rows after `| X | extras |`:

```
| M | maintenance & dependency upgrades — recurring work (Node major bumps, security advisories, lint cleanup) |
| DS | design-system follow-ups — new primitives, token additions, lint:design rule changes, Storybook story patterns |
```

- [ ] **Step 5: Verify CLAUDE.md updates**

```bash
grep -q "plan:.* trivial:" CLAUDE.md && echo "lifecycle gate: OK" || echo "lifecycle gate: MISSING"
grep -q "Currently archived: \*\*S, A, D, AU" CLAUDE.md && echo "archived line: OK" || echo "archived line: MISSING"
grep -q "subsection.* rotated into" CLAUDE.md && echo "subsection rule: OK" || echo "subsection rule: MISSING"
grep -qE '^\| M \| maintenance' CLAUDE.md && echo "M row: OK" || echo "M row: MISSING"
grep -qE '^\| DS \| design-system' CLAUDE.md && echo "DS row: OK" || echo "DS row: MISSING"
```

Expected: all five lines print "OK".

- [ ] **Step 6: Commit TASKS.md + CLAUDE.md together**

```bash
git add TASKS.md CLAUDE.md
git commit -m "$(cat <<'EOF'
chore(tasks): rewrite TASKS.md + add lifecycle gate

Live TASKS.md shrinks from 609 → ~200 lines. Archived sections
collapse to 2-line stubs pointing at docs/done/done-<X>.md. The X
junk drawer regroups into themed subsections (Editor & writing, AI
features, Import & export, Account); recurring categories M
(Maintenance & dependencies) and DS (Design-system follow-ups) get
promoted to top-level sections. Open ex-X tasks X16/X20/X21 become
M1/M2/M3 with (was Xn) annotations for grep-bridging.

CLAUDE.md gains a Task-Completion-Protocol bullet enforcing the
proposed → planned/trivial → done lifecycle, updates the archived /
live section listing, and adds M and DS rows to the Task Order
table.

Spec: docs/superpowers/specs/2026-05-02-tasks-md-reorganisation-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Add helper scripts

**Files:**
- Create: `scripts/tasks-proposed.sh`
- Create: `scripts/tasks-implementable.sh`

- [ ] **Step 1: Write `scripts/tasks-proposed.sh`**

```bash
#!/usr/bin/env bash
# List open tasks in TASKS.md that have neither a `plan:` nor a `trivial:` line.
# Output format: one line per task, "<ID>  <description-first-80-chars>".
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TASKS_FILE="${1:-$ROOT_DIR/TASKS.md}"
awk '
  /^- \[ \] \*\*\[/ {
    if (id) emit()
    id=$0; sub(/^- \[ \] \*\*\[/,"",id); sub(/\].*/,"",id)
    desc=$0; sub(/^- \[ \] \*\*\[[^\]]+\]\*\* /,"",desc)
    has_plan=0; has_trivial=0
    next
  }
  /^  - plan:/    { has_plan=1 }
  /^  - trivial:/ { has_trivial=1 }
  END { if (id) emit() }
  function emit() {
    if (!has_plan && !has_trivial) printf "%-6s %s\n", id, substr(desc, 1, 80)
  }
' "$TASKS_FILE"
```

- [ ] **Step 2: Write `scripts/tasks-implementable.sh`**

```bash
#!/usr/bin/env bash
# List open tasks in TASKS.md that are ready to start: have a `plan:` or
# `trivial:` line AND a `verify:` line.
# Output format: one line per task, "<ID> [planned|trivial] <description-first-72-chars>".
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TASKS_FILE="${1:-$ROOT_DIR/TASKS.md}"
awk '
  /^- \[ \] \*\*\[/ {
    if (id) emit()
    id=$0; sub(/^- \[ \] \*\*\[/,"",id); sub(/\].*/,"",id)
    desc=$0; sub(/^- \[ \] \*\*\[[^\]]+\]\*\* /,"",desc)
    has_plan=0; has_trivial=0; has_verify=0
    next
  }
  /^  - plan:/    { has_plan=1 }
  /^  - trivial:/ { has_trivial=1 }
  /^  - verify:/  { has_verify=1 }
  END { if (id) emit() }
  function emit() {
    if (has_verify && (has_plan || has_trivial)) {
      kind = has_plan ? "planned" : "trivial"
      printf "%-6s %-8s %s\n", id, kind, substr(desc, 1, 72)
    }
  }
' "$TASKS_FILE"
```

- [ ] **Step 3: Make both executable**

```bash
chmod +x scripts/tasks-proposed.sh scripts/tasks-implementable.sh
```

- [ ] **Step 4: Verify both run cleanly**

```bash
bash scripts/tasks-proposed.sh
bash scripts/tasks-implementable.sh
```

Expected: both exit 0. `tasks-proposed.sh` lists the X-series open features (X1, X2, etc.) and any other proposed task. `tasks-implementable.sh` lists F63/F65/F74/F75 (which all have `plan:` lines) and M1–M3 (verify present, but no plan or trivial yet — these will *not* appear in the implementable list until a plan is added; that's the correct behaviour and demonstrates the lifecycle gate working).

- [ ] **Step 5: Commit**

```bash
git add scripts/tasks-proposed.sh scripts/tasks-implementable.sh
git commit -m "$(cat <<'EOF'
chore(scripts): add tasks-proposed.sh + tasks-implementable.sh

Two short awk helpers for the TASKS.md lifecycle gate:
- tasks-proposed.sh: open tasks with no plan: or trivial: line
- tasks-implementable.sh: open tasks ready to start (plan: or
  trivial: + verify:)

Used by the Workflow section in TASKS.md to keep the "Proposed"
focus line in sync.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Final verification

- [ ] **Step 1: Run all the spec's verify gates**

```bash
echo "--- TASKS.md line count ---"
wc -l TASKS.md
echo
echo "--- open tasks in TASKS.md ---"
grep -c '^- \[ \]' TASKS.md
echo
echo "--- ID resolution sample ---"
for id in AU9 B12 F22 F67 F73 F74 I7 T8 V26 D17 X12 X16 X22; do
  hits=$(grep -rE "^- \[[x ]\] \*\*\[$id\]\*\*" TASKS.md docs/done/ | wc -l)
  printf "%-6s: %s\n" "$id" "$hits"
done
echo
echo "--- proposed tasks ---"
bash scripts/tasks-proposed.sh
echo
echo "--- implementable tasks ---"
bash scripts/tasks-implementable.sh
echo
echo "--- diff vs main ---"
git diff main --stat
```

Expected:
- Line count: 180–250.
- Open tasks: ~19 (4 Phase 4 + 12 X open + 3 M).
- Every sampled ID resolves to exactly `1`.
- Proposed list shows the open X features + M1/M2/M3.
- Implementable list shows F74/F75 (and any planned-already entries) — M1/M2/M3 will appear here only once they get a plan or trivial line.
- `git diff main --stat` shows: 6 new files in `docs/done/`, 2 new files in `scripts/`, modifications to `TASKS.md` and `CLAUDE.md`, plus the spec + plan files — no production-code changes.

- [ ] **Step 2: Confirm pre-edit hook still works against the new TASKS.md**

```bash
echo '{"tool_name":"Edit","tool_input":{"file_path":"'"$(pwd)"'/TASKS.md"}}' | bash .claude/hooks/pre-tasks-edit.sh
echo "exit: $?"
```

Expected: exit 0 (no `[x]` transitions in the payload, so the hook allows). This confirms the hook is still valid against the rewritten file.

- [ ] **Step 3: Push branch + open PR**

```bash
git push -u origin chore/tasks-md-reorg
gh pr create --title "chore(tasks): reorganise TASKS.md — archive done sections, split X, add lifecycle gate" --body "$(cat <<'EOF'
## Summary

- Archive all completed sections (AU, B, I, T) and the closed F subsections (F1–F67) into `docs/done/done-<X>.md` files. F's Phase 4 subsection stays live.
- Split the X junk drawer into themed subsections (Editor & writing / AI features / Import & export / Account); promote recurring categories M (Maintenance) and DS (Design-system) to top-level sections. Closed ex-X entries (X12, X13, X14, X15, X19, X22, X23, X24) move to `docs/done/done-X.md`; open ex-X entries X16/X20/X21 become M1/M2/M3 with `(was Xn)` grep annotations.
- Document a `proposed → planned/trivial → done` lifecycle in a new `## Workflow` block. CLAUDE.md gains a matching Task-Completion-Protocol bullet.
- Add `scripts/tasks-proposed.sh` and `scripts/tasks-implementable.sh` (short awk helpers).

`TASKS.md` shrinks from 609 → ~200 lines. No production code touched.

Spec: `docs/superpowers/specs/2026-05-02-tasks-md-reorganisation-design.md`
Plan: `docs/superpowers/plans/2026-05-02-tasks-md-reorganisation.md`

## Test plan

- [ ] `wc -l TASKS.md` reports under 250.
- [ ] Every old task ID resolves to exactly one location across `TASKS.md` + `docs/done/`.
- [ ] `bash scripts/tasks-proposed.sh` and `bash scripts/tasks-implementable.sh` both run cleanly and produce the expected lists.
- [ ] Pre-edit hook (`.claude/hooks/pre-tasks-edit.sh`) still no-ops on a non-`[x]` payload against the new TASKS.md.
- [ ] No diff in any production-code path (`frontend/src/`, `backend/src/`, `db/`).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Return the PR URL.

---

## Self-review notes (run before merge)

1. **Spec coverage:** §1 (file structure) → Tasks 2–6 + 8. §2 (taxonomy + ID rule) → Task 8 (M1/M2/M3 with `(was Xn)`). §3 (Current focus block) → Task 8 Step 3. §4 (Workflow block) → Task 8 Step 3. §5–6 (lifecycle states + triviality bar) → Task 8 (Workflow block) + Task 9 (CLAUDE.md gate). §7 (helper scripts) → Task 10. §8 (CLAUDE.md updates) → Task 9. §9 (tightened archive-rotation rule) is documented in the Workflow block but the CLAUDE.md "Archived sections" subsection's "fully closed AND not touched in last 2 PRs" wording is left as-is; this plan does not rewrite that paragraph because the spec only specified the archived-line update, not the rule paragraph. **Gap:** if the user wants the tightened rule landed in CLAUDE.md, add a sub-step to Task 9. Flagging here for review.
2. **Placeholder scan:** No TBDs / TODOs / "implement later". Every command is concrete; every body block is either verbatim from existing TASKS.md (Tasks 2–6, 8 Step 2) or fully written out (Task 8 Step 3 skeleton, Task 10 scripts).
3. **Type consistency:** Section letters (`AU/B/F/I/T/X/M/DS`) used identically across tasks. Archive file names (`done-<X>.md`) consistent. Helper script names consistent. Grep patterns (`^- \[x\] \*\*\[Xn\]\*\*`) consistent.
4. **Sequencing:** Task 1 (branch) → 2–6 (extract archives) → 7 (commit archives) → 8 (rewrite live file, depends on archive commit being clean) → 9 (CLAUDE.md, committed with TASKS.md) → 10 (helper scripts, separate commit) → 11 (verify + PR). Each task is independent enough to roll back individually.
