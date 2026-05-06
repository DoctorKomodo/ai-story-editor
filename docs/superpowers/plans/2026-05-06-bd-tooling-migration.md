# bd Tooling Migration — Plan

**Bd issue:** `story-editor-xwn` (P3, open).

**Goal.** End state: all working task tracking happens in **bd**. TASKS.md is a historical pointer file (or removed). The verify-as-contract gate is preserved — moved from TASKS.md `verify:` lines into bd `--notes` — and `/task-verify` continues to work, reading from bd. The pre-edit hook is replaced by an analogous gate on `bd close`. The four TASKS.md helper scripts are retired or replaced by bd queries.

The two pieces of value the current tooling provides over CI alone are preserved:
1. **Verify-as-contract** — a maintained link between a task and the specific test that proves it. Survives the migration.
2. **Per-task locality** — running just *that task's* test in seconds, not the full suite. Survives.

The third value (`pipefail` correctness for piped verifies) survives via the same `bash -o pipefail -c "$CMD"` runner. The bookkeeping protection (hook blocks `[x]` without passing verify) is replaced by a `bd close` wrapper.

---

## Pre-migration audit (current state, 2026-05-06)

21 open bd issues. Verify-line completeness:

| State | Count | IDs |
|---|---|---|
| Has `verify:` line in notes (machine-runnable) | 16 | F63, F65, X1, X2, X3, X4, X5, X6, X7, X8, X9, X17, X18, M1, M2, M3 |
| Has `verify:` line but it's prose/TBD/design-only | 3 | X30 (TBD), X11 (design decision), X28 (no verify yet) |
| No `verify:` line at all | 2 | X34 (recently filed, no verify defined), `story-editor-xwn` (meta) |

Format convention (already in use): the **first** line in `--notes` matching `^verify:[ \t]*(.*)$` is the runnable command. Non-runnable verifies (TBD, design-only) are accepted but the runner reports them as "no automated verify" and exits 2 (not blocking, but distinct from a pass).

---

## End state (concrete)

```
.claude/skills/task-verify/run.sh        rewritten — reads bd notes
.claude/hooks/pre-tasks-edit.sh          deleted
.claude/hooks/extract-new-ids.py         deleted
.claude/settings.json                    PreToolUse hook removed
scripts/extract-verify.sh                deleted (or rewritten as bd-aware helper)
scripts/tasks-proposed.sh                deleted
scripts/tasks-implementable.sh           deleted
scripts/bd-close-verified.sh             new — gate on close
TASKS.md                                 collapsed to pointer file
CLAUDE.md                                Task Completion Protocol rewritten
```

Daily flow becomes:
```bash
bd ready                          # pick work
bd update <id> --claim            # claim
… write code …
/task-verify <id>                 # gate (reads bd notes)
scripts/bd-close-verified.sh <id> # closes only if verify exits 0
```

---

## Phase 1 — Build bd-aware tooling (parallel run)

Both old and new live side-by-side. No removal. Goal: prove the bd-aware path works against real issues before retiring anything.

**1.1 — Standardise verify-line format in bd `--notes`.**
Convention: first matching `^verify:[ \t]*(.*)$` line in `--notes` is the runnable command. Multi-line commands forbidden — use `&&` / `;` on one line. Document the convention in CLAUDE.md.

**1.2 — Backfill missing/non-runnable verifies.**
- `story-editor-myi` (X34): add a verify (likely a grep of dev console for the new log line, or just `cd backend && npx tsc --noEmit` if it's pure prod-gated logging).
- `story-editor-tdc` (X28): no verify yet because no plan yet — leave `verify: TBD (plan first)` and move on; not a blocker for the migration.
- `story-editor-8od` (X30): leave TBD — runner will report "no automated verify" cleanly.
- `story-editor-h1i` (X11): `verify: design decision — no automated verify` is fine; runner short-circuits to exit 2 with a clear message.
- `story-editor-xwn` (this issue): add a verify on completion — see Phase 4 below.

**1.3 — Rewrite `.claude/skills/task-verify/run.sh`.**
Behaviour matrix:

| Input arg | Behaviour |
|---|---|
| `story-editor-XXX` (bd ID) | Read `bd show <id> --json`, extract first `verify:` line from `.notes`, run with `bash -o pipefail -c "$CMD"`. |
| `[A-Z]+\d+` (TASKS.md ID, transitional) | Fall back to old behaviour: `scripts/extract-verify.sh <id>` → run. Print a deprecation hint pointing at the bd ID if one can be found by ref-grep. |
| Verify is `TBD …`, `design decision …`, or empty | Exit 2 with a clear "no automated verify" message — distinct from a real failure (exit 1+). |

Update `SKILL.md` to document both modes. Skill name and slash trigger unchanged.

**1.4 — Add `scripts/bd-close-verified.sh`.**
```bash
bd-close-verified <id> [--reason="..."]
```
1. Extracts verify from `bd show <id> --json` notes.
2. Runs it with `bash -o pipefail -c "$CMD"`.
3. On exit 0: calls `bd close <id> [--reason=…]`, prints success.
4. On non-zero: refuses to close, prints failing tail, exits with the verify's exit code.
5. Special-cases "no automated verify" cases by requiring `--force` to close (so design-decision tasks don't get accidentally locked).

This is the bookkeeping replacement for `pre-tasks-edit.sh`. ~40 lines of bash. No `.beads/hooks/*` integration — beads has no `pre-close` hook today.

**1.5 — Smoke-test on a real issue.**
Pick `story-editor-9vm` (F63) or `story-editor-6ug` (F65) when its work is in flight: run `/task-verify <id>` *before* implementation (expect failure), implement, run again (expect pass), then `bd-close-verified <id>` to close. This is the live proof that the new tooling works before retiring the old.

**Verify Phase 1:** new skill works against ≥3 bd issues (one passing, one failing, one "no automated verify" branch); old skill still works against TASKS.md IDs unchanged; `bd-close-verified` exercised against one passing and one failing case.

---

## Phase 2 — Cut over

Atomic single PR after Phase 1 has at least one real-use proof point.

**2.1 — Migrate TASKS.md "live" sections to pointer rows.**
For each open `[ ]` row in TASKS.md live sections (F Phase 4, X, M, DS):
```markdown
- [ ] **[F63]** → bd:story-editor-9vm
- [ ] **[X28]** → bd:story-editor-tdc
…
```
Drop the body (description, plan, verify, trivial lines) — bd is now the source of truth for those fields. Keep the `[ ]` checkbox as a visual cue but the auto-tick hook is gone, so the box is purely informational.

Rationale for keeping the rows visible (vs deletion): preserves the historical `[A-Z]\d+` ID → bd ID mapping for grep-archaeology of plan docs and commit messages, which all reference TASKS.md IDs. Same purpose as the existing `docs/done/done-*.md` archives.

**2.2 — Rewrite TASKS.md preamble.**
- "Source of truth" line: bd is canonical, TASKS.md is a historical index + ID-mapping table.
- "Workflow" section: deleted (now lives in CLAUDE.md against bd).
- "Helpers" lines (`tasks-proposed.sh`, `tasks-implementable.sh`): deleted.
- "Current focus" section: deleted (use `bd ready` / `bd list --priority=2`).
- Section letters intro: keep as a glossary for cross-refs in plans/commits.

**2.3 — Rewrite CLAUDE.md "Task Completion Protocol".**
Remove the dual-tick coordination paragraph from the May-6 edit. Replace step-list with the bd-only flow:
1. Read bd issue (`bd show <id>`); read its `verify:` from notes.
2. Confirm `plan:` link or `trivial:` justification in notes (if neither, write the plan first).
3. `bd update <id> --claim`.
4. Write code + test.
5. `/task-verify <id>` — gate.
6. `scripts/bd-close-verified.sh <id>` — closes only on verify pass.
7. Move on.

Drop the "Archived sections" subsection's `TASKS.md` references (archives stay; the section becomes "Historical archives"). Drop the `pre-tasks-edit.sh` and `extract-verify.sh` mentions in "Local tooling".

**2.4 — Retire the auto-tick hook.**
- Remove the `PreToolUse` block targeting `pre-tasks-edit.sh` from `.claude/settings.json`.
- `git rm .claude/hooks/pre-tasks-edit.sh .claude/hooks/extract-new-ids.py`.

**2.5 — Retire the helper scripts.**
- `git rm scripts/extract-verify.sh scripts/tasks-proposed.sh scripts/tasks-implementable.sh`.
- Add bd-query equivalents (one-liners) to a small README at `.beads/README.md` or fold into CLAUDE.md "Quick Start":
  - "Implementable tasks": `bd list --status=open --json | jq -r '.[] | select(.notes | test("^plan:|^trivial:"; "m")) | .id'` — or simpler, just trust `bd ready`.
  - "Proposed but not yet implementable": inverse of above.

**2.6 — Update agent prompts.**
- `.claude/agents/security-reviewer.md` and `.claude/agents/repo-boundary-reviewer.md`: replace any "before marking task `[x]`" phrasing with "before `bd close`-ing"; keep the historical AU/E/V task-ID references in their scope tables (those are real archive anchors).

**Verify Phase 2:**
```bash
[ ! -f .claude/hooks/pre-tasks-edit.sh ]
[ ! -f .claude/hooks/extract-new-ids.py ]
[ ! -f scripts/extract-verify.sh ]
[ ! -f scripts/tasks-proposed.sh ]
[ ! -f scripts/tasks-implementable.sh ]
[ -x scripts/bd-close-verified.sh ]
! grep -q 'pre-tasks-edit' .claude/settings.json
! grep -q 'extract-verify\|tasks-proposed\|tasks-implementable' .
grep -q 'bd-close-verified\|/task-verify' CLAUDE.md
```

---

## Phase 3 — Soak + close

After Phase 2 lands and at least one real task is closed via the new flow:

**3.1 —** Run `/task-verify` against ≥5 distinct bd IDs over a week of normal work. Confirm the no-automated-verify branch behaves correctly for X11/X30 when those are touched.

**3.2 —** Confirm no remaining grep hits for retired tooling: `grep -rE 'pre-tasks-edit|extract-verify|tasks-proposed|tasks-implementable' . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=docs/done` returns zero.

**3.3 —** `bd close story-editor-xwn --reason="bd-tooling migration complete"`.

---

## Open decisions (capture in PR)

1. **Pointer-row format in TASKS.md** — `→ bd:story-editor-9vm` (proposed) or `→ #54` (gh issue style) or fully delete the rows? Recommendation: pointer rows (preserves grep archaeology).
2. **`bd-close-verified.sh` location** — `scripts/` (project-wide) vs `.beads/scripts/` (bd-namespaced) vs `.claude/skills/bd-close/` (slash-command). Recommendation: `scripts/` so it's invocable outside Claude Code too.
3. **Slash command for close?** — Add `/bd-close <id>` skill as a thin wrapper over `bd-close-verified.sh`, mirroring `/task-verify`? Recommendation: yes, symmetry with `/task-verify`.
4. **TASKS.md filename** — keep `TASKS.md` at repo root (preserves historical references) or rename to `docs/TASKS-archive.md`? Recommendation: keep, demote.
5. **`extract-verify.sh` fate** — delete vs rewrite as bd-aware (e.g. `scripts/bd-extract-verify.sh`)? Recommendation: delete; the logic is 6 lines of `jq | awk` and lives inside the new `task-verify` skill directly.

---

## Out of scope

- Migrating closed `docs/done/done-*.md` archives into bd. They're immutable historical artefacts; leaving them as-is is correct.
- Rewriting plan docs under `docs/superpowers/plans/` to reference bd IDs instead of TASKS.md IDs. Most are for closed tasks; not worth the churn.
- Adding bd labels/tags taxonomy. Out of scope; can be added later if `bd ready` proves insufficient.
- Migrating the verify-line format to a structured file (`verify.toml`) keyed by bd ID. Considered and rejected — single source of truth (bd notes) is simpler and the contract value is preserved either way.

---

## Trigger / when to start

Phase 1 can start any time — additive only. Phase 2 should land *after* Phase 1 has ≥1 real-use proof point, and ideally during a quiet period (no in-flight work that would be disrupted by the cut-over PR). Phase 3 closes naturally after a week of soak.

No hard prerequisite from other open tasks. Independent of all 20 seeded bd issues.
