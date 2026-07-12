---
name: bd-execute
description: Bridge from bd → superpowers' subagent-driven-development loop. Claims a bd issue, reads its plan link, picks rules digests by touch-set, then runs the implementer + task-reviewer loop with project rules prepended at each dispatch, plus a whole-branch simplify pass and a final whole-branch review. After the loop is clean, hands off to `/bd-close-reviewed`. User-invocable as `/bd-execute <BD_ID>`.
---

# bd-execute

The bridge between bd and the superpowers `subagent-driven-development` loop. Owns project-rule injection at dispatch time per `docs/superpowers-injection-spike.md` (Phase 0).

This skill is the **controller**: when invoked, you (the main session) drive the loop directly using superpowers' prompt templates as content, with project digests prepended. Do **not** invoke `superpowers:subagent-driven-development` separately — that would create two competing loops.

> **Targets superpowers 6.x** (single merged `task-reviewer`, file-based task-brief / review-package handoffs, a per-task progress ledger, and a final whole-branch review). If the installed superpowers major changes again and the templates or scripts named below don't resolve, **stop and surface the drift to the user** (see "Read superpowers' templates → Structure validation"). Do not improvise a substitution.

## Inputs

One required: bd issue ID (e.g. `story-editor-9vm`).

## Preconditions

- The bd issue exists.
- The bd issue's `--notes` contains a line `plan: <path>` pointing to a plan file under `docs/superpowers/plans/`. If missing, see "When the issue has no plan link" below.
- The repository is in a clean enough state to start work (you may use `superpowers:using-git-worktrees` if isolation is needed; per project memory, use a feature branch by default and reach for worktrees only for parallel/risky work).

## The full loop

### 0. Read state

Run `bd show <id> --json` and confirm:
- The issue exists.
- It is not already `closed`.
- It is not claimed by someone else (if claimed by you from a prior session and the tree is clean, that's fine; if dirty, follow the SessionStart recovery prompt).

Extract the `plan: <path>` line from `.notes`. If absent, stop and tell the user — see "When the issue has no plan link".

**Resume check (compaction-safe).** Read the progress ledger if it exists:
`cat "$(git rev-parse --show-toplevel)/.superpowers/sdd/progress.md"`. Any task the ledger marks complete is DONE — do **not** re-dispatch it; resume at the first task not marked complete. The commits the ledger names exist in `git log` even when your context no longer remembers creating them; after a compaction trust the ledger and `git log` over recollection.

### 1. Read the plan

Read the plan file at `<path>`. Identify:

- **Touch-set** — the list of files the plan creates or modifies. Plans authored via `superpowers:writing-plans` have a "File Structure" / "Files to Create / Modify" section. Extract those paths.
- **Tasks** — the plan's numbered task list. You do **not** paste task text into dispatches in 6.x — the `task-brief` script extracts each task to a file (step 6). But you still read the plan once here to learn the task count, the per-task `model:` overrides (a `model: <name>` line at the top of a task body — consumed in "Model selection"), and the **Global Constraints** section (handed to the reviewer verbatim in step 7).

### 2. Pick rules digests and assemble the project-rules file

Read `docs/agent-rules/index.md`. For each path in the touch-set, walk the mapping table top-to-bottom and **union** the matched digest names (a cross-boundary plan gets all matched digests, not the first match). The result is a deduplicated list of digest filenames (e.g. `general.md`, `backend.md`, `repo-boundary.md`, `frontend.md`).

First resolve the active superpowers version and the SDD paths (used here and throughout the loop), then ensure the workspace exists and assemble the unioned digests into one file there:

```bash
SP=~/.claude/plugins/cache/claude-plugins-official/superpowers
VER="$(ls -1 "$SP" | sort -V | tail -1)"   # highest installed semver = the active version
SDD="$SP/$VER/skills/subagent-driven-development"
WS="$("$SDD/scripts/sdd-workspace")"        # <repo-root>/.superpowers/sdd, self-ignoring
cat docs/agent-rules/general.md docs/agent-rules/backend.md … > "$WS/project-rules.md"
```

If `$SP` doesn't exist (a different install method), don't guess — see step 3's "Plugin path fallback". `$WS` is `<repo-root>/.superpowers/sdd` with a self-ignoring `.gitignore` (the `sdd-workspace` script writes it) — so `project-rules.md`, task briefs, reports, review packages, and the ledger all stay out of `git status`. The assembled `project-rules.md` is the **`<RULES_BLOCK>`** handed (as a path) to the implementer and the task-reviewer. Keeping it in a file — not pasted inline — keeps the controller's context lean across dispatches.

If a digest filename listed in `index.md` doesn't resolve to a readable file: print a one-line warning naming the missing digest, omit it from the concatenation, and proceed with the digests that *did* resolve. Surface the warning in your end-of-task summary.

If the touch-set is empty or matches no glob, dispatch with no project-rules file and surface that as a concern — usually it means the plan's file map is missing or the index needs an entry.

### 3. Read superpowers' templates

Read these files fresh (the bridge does not fork them — plugin upgrades roll forward automatically):

- `$SDD/implementer-prompt.md`
- `$SDD/task-reviewer-prompt.md`
- `$SP/$VER/skills/requesting-code-review/code-reviewer.md` (final whole-branch review, step 11)

`$SP`, `$VER`, and `$SDD` were resolved in step 2. `$VER` is the highest installed semver — the version Claude Code loads when more than one is present (cross-check: the path any already-loaded superpowers skill reports in this session is the active version). Ignore older sibling versions.

**Plugin path fallback.** If the `~/.claude/plugins/cache/claude-plugins-official/superpowers/` directory doesn't exist (different install method — user-config plugin, project-vendored, or a future plugin manager that picks a different location), do **not** guess or fork. Stop and ask the user where superpowers is installed; record the answer in this skill so the next dispatch finds it. The bridge depends on these templates being readable; bypassing them by inlining a copy is forbidden (see Forbidden list below).

**Structure validation.** Once the templates are read, confirm the 6.x shape holds:
- `implementer-prompt.md` exists and contains the placeholders `[BRIEF_FILE]`, `[Scene-setting`, `Work from: [directory]`, and `[REPORT_FILE]`.
- `task-reviewer-prompt.md` exists (a **single** merged reviewer returning both spec-compliance and code-quality verdicts) and contains `[BRIEF_FILE]`, `[GLOBAL_CONSTRAINTS]`, `[REPORT_FILE]`, `[BASE_SHA]`, `[HEAD_SHA]`, `[DIFF_FILE]`.
- The helper scripts `scripts/task-brief`, `scripts/review-package`, and `scripts/sdd-workspace` exist and are executable.

If any of these is renamed, missing, or split/merged differently (e.g. a future major reverts to two separate reviewer files, or renames a placeholder), the substitutions below would silently produce malformed prompts — **stop and surface the drift to the user** rather than improvising. This skill is the place to fix the mapping when that happens.

### 4. Claim the issue

```
bd update <id> --claim
```

If `--claim` fails because someone else claimed it, stop and tell the user.

### 5. Track tasks locally + open the ledger

Use TodoWrite to write each task from the plan as a todo item. (This is one of the few cases where TodoWrite is correct in this project — it's the within-session per-task ledger. The bd issue is the cross-session ledger. Do **not** create per-task bd issues.)

TodoWrite does **not** survive compaction. The durable record is the progress ledger at `$WS/progress.md`. When a task's review comes back clean (step 9), append one line:

```
Task N: complete (commits <base7>..<head7>, review clean)
```

`git clean -fdx` destroys the ledger (git-ignored scratch); recover from `git log` if that happens.

### 6. For each task: dispatch implementer

**a. Write the task brief to a file** (so the task text never passes through your context):

```bash
"$SDD/scripts/task-brief" <plan-path> <N>        # prints e.g. .superpowers/sdd/task-N-brief.md
```

(`$SDD` = the version's `subagent-driven-development` dir.) Record the current `HEAD` SHA as this task's **BASE** before dispatching — you need it for the review package, and `HEAD~1` would silently drop all but the last commit of a multi-commit task.

**b. Compose the dispatch** from `implementer-prompt.md`'s prompt body, substituting:
- `[BRIEF_FILE]` → the brief path from (a).
- `[Scene-setting…]` → one paragraph: where this task fits, what earlier tasks it depends on, and the **interfaces/decisions from earlier tasks** the brief can't know.
- `Work from: [directory]` → the repo-root absolute path.
- `[REPORT_FILE]` → `$WS/task-N-report.md`.

Inject the project rules near the top of the prompt (before `## Task Description`):

```
## Project Rules

Read your project rules first: <$WS/project-rules.md>. They are binding
implementation rules for this codebase — follow them as strictly as the
task brief. (Omit this block only if step 2 produced no project-rules file.)
```

Dispatch via the Agent tool, `subagent_type: general-purpose`, with an **explicit `model:`** (default `"sonnet"`, or the per-task override from the plan — see "Model selection"). Hand the subagent files, not pasted bulk: the dispatch prompt carries scene-setting + paths, not the task text or the digests.

#### Implementer status protocol

The implementer's final message declares one of four statuses (per superpowers' `subagent-driven-development` SKILL.md). Handle each:

- **`DONE`** — implementation complete, tests pass. Proceed to step 7 (task reviewer).
- **`DONE_WITH_CONCERNS`** — complete but the implementer flagged doubts. Read them. If they're about correctness or scope: re-dispatch the implementer to address them before review. If they're observations (e.g. "this file is getting large"): note them in the ledger/summary and proceed to step 7. Do not silently drop concerns.
- **`NEEDS_CONTEXT`** — the implementer needs info that wasn't provided. Treat it as your problem: gather the context (read the relevant files, query Context7 MCP for docs, check sibling code) and re-dispatch with the missing context appended. Do **not** ask the user unless the context truly isn't recoverable from the repo.
- **`BLOCKED`** — a hard stop (environmental issue, a contradiction in the plan, a missing dependency). Assess: a context problem → add context + re-dispatch same model; needs more reasoning → re-dispatch a more capable model; task too large → split it; plan itself is wrong → stop the loop and escalate to the user with the full implementer summary. Do **not** `bd close` or advance. The bd issue stays claimed until resolved.

Never force the same model to retry an escalation without changing something.

### 7. For each task: dispatch the task reviewer (spec + quality, one pass)

After the implementer reports DONE (or DONE_WITH_CONCERNS resolved), generate the review package and dispatch **one** reviewer that returns both a spec-compliance verdict and a code-quality verdict.

**a. Generate the review package** from the recorded BASE (not `HEAD~1`):

```bash
"$SDD/scripts/review-package" <BASE> <HEAD>      # prints the unique .diff path it wrote
```

This writes the commit list + stat summary + `-U10` diff to a file. It never enters your context.

**b. Compose the dispatch** from `task-reviewer-prompt.md`, substituting:
- `[BRIEF_FILE]` → the same brief file the implementer used.
- `[GLOBAL_CONSTRAINTS]` → the plan's **Global Constraints** section, copied **verbatim** (exact values, formats, and stated relationships between components). This is the reviewer's attention lens — do not paraphrase, and do not pre-judge findings or tell the reviewer what not to flag.
- `[REPORT_FILE]` → the implementer's report file.
- `[BASE_SHA]` / `[HEAD_SHA]` → the SHAs.
- `[DIFF_FILE]` → the review-package path from (a).

Inject the **same project-rules file pointer** as the implementer (the merged reviewer now owns the code-quality half, so it enforces the same project rules the implementer was held to):

```
## Project Rules

Read the project rules: <$WS/project-rules.md>. Treat a violation of these
rules as a code-quality finding at the severity the rule implies.
```

Dispatch via the Agent tool, `subagent_type: general-purpose`, with an **explicit `model:`** (default `"sonnet"` — see "Model selection").

**c. Act on the verdicts:**
- **Spec ❌ or Critical/Important quality findings** → dispatch **one** fix subagent (same task, same model as the implementer dispatch) with the complete findings list — not one fixer per finding. The fix subagent re-runs the tests covering its change and appends results to the same report file; confirm the report contains the command + output before re-reviewing. Then regenerate the review package (fresh range) and re-dispatch the reviewer. Loop until spec ✅ **and** no open Critical/Important.
- **⚠️ "Cannot verify from diff"** items → you resolve each yourself (you hold the cross-task context the reviewer lacks). A confirmed gap is a failed spec review — send it back and re-review.
- **Minor findings** → record them in the ledger and carry the list into the final whole-branch review (step 11) for triage. Don't silently discard them.
- **Plan-mandated finding** (the reviewer flags something the plan's text explicitly requires) → that's the user's decision, like any plan contradiction. Present the finding beside the plan text and ask which governs. Don't dispatch a fix that contradicts the plan without asking, and don't dismiss the finding because the plan mandates it.

### 8. (folded into step 7)

The 6.x reviewer returns spec compliance **and** code quality in one pass — there is no separate code-quality dispatch. Both verdicts are required; a report missing either is not acceptable.

### 9. Mark task complete, move to next task

Mark the TodoWrite item complete **and** append the `Task N: complete (commits <base7>..<head7>, review clean)` line to `$WS/progress.md` in the same step. Repeat steps 6–9 for each remaining task. Do not pause to check in between tasks — execute the whole plan. The only reasons to stop are an unresolvable BLOCKED, a plan-mandated finding needing the user's call, or all tasks done.

### 10. After all tasks: simplify pass (whole-branch, behavior-preserving)

Per-task reviews judge one task's diff at a time — two tasks of the same plan can each grow a similar helper and no single review sees both. Before the final review, run one behavior-preserving cleanup pass over the whole branch, so the final reviewer (step 11) reviews the cleaned branch, simplify edits included.

**Skip when** the plan is `plan: trivial`, the branch diff is docs/config-only, or the plan was a single small task — the pass is pure cost there. Record `Simplify pass: skipped (<reason>)` in the ledger and go to step 11.

Otherwise:

**a.** Confirm the tree is clean (the loop leaves every task committed) and record `HEAD` — that's the revert point.

**b.** Invoke the **`simplify` skill** (Skill tool), scoped to the branch diff (`git merge-base main HEAD`..`HEAD`). Quality-only: reuse, duplication the branch introduced, altitude, dead weight.

**c. Boundaries — the pass must not:**
- change observable behavior, a wire shape, or the schema;
- expand scope beyond the branch diff. It may consolidate duplication **this branch introduced**; pre-existing duplicates elsewhere in the tree are file-and-block territory (CLAUDE.md, "Duplication: file-and-block") — file the issue, add the blocker edge, don't edit them here.

**d. If it applied fixes:** commit them as **one separate commit** (`[<bd-id>] simplify pass`) so the cleanup diff stays separable from the feature diff, then re-run the issue's `verify:` line and typecheck on the affected workspaces. Green → record `Simplify pass: applied (<sha7>)` in the ledger and proceed. Red → **revert the simplify commit**, record `Simplify pass: reverted (<what failed>)`, and proceed — do not loop on a failing cleanup; the branch was already review-clean without it.

**e. If it found nothing:** record `Simplify pass: clean` and proceed. On a branch that went through a strict plan and per-task reviews, that outcome is normal.

This pass runs **before** the final whole-branch review by design — its edits must be reviewed like any other code. Running it after step 11, or after `/bd-close-reviewed`, is forbidden.

### 11. After the simplify pass: final whole-branch review

The per-task reviews are task-scoped gates; a cross-task / whole-branch review runs once at the end and catches integration issues no single task's diff shows.

```bash
"$SDD/scripts/review-package" "$(git merge-base main HEAD)" HEAD   # whole-branch package
```

Dispatch the final reviewer from `requesting-code-review/code-reviewer.md`, `subagent_type: general-purpose`, on the **most capable available model** (Opus — a whole-branch review is a judgment task, per superpowers' Model Selection). Prepend the same project-rules file pointer, hand it the whole-branch package path, and include the **Minor findings list** accumulated in the ledger so it can triage which must be fixed before close.

If it returns Critical/Important findings: dispatch **one** fix subagent with the complete list, re-run covering tests, then re-review. Loop until clean.

### 12. Hand off to close-reviewed

After the final review is clean, invoke:

```
/bd-close-reviewed <id>
```

That skill runs typecheck, the path-matched **surface**-reviewer fan-out (`security-reviewer`, `repo-boundary-reviewer` — narrower and project-tuned, complementary to the broad final review above), the verify line, and the bd close. **You do not run `bd close` directly from this skill**, and `/bd-close-reviewed` — not superpowers' `finishing-a-development-branch` — is this project's terminal gate.

## When the issue has no plan link

Stop. Tell the user the issue has no plan and suggest the path forward:

- If the work needs design discussion → `superpowers:brainstorming` first, then `superpowers:writing-plans` (which writes a plan to `docs/superpowers/plans/YYYY-MM-DD-*.md`), then `scripts/bd-link-plan.sh <id> <plan-path>`, then re-invoke `/bd-execute <id>`.
- If the bd issue is genuinely trivial and a plan would be theatre → still write a one-paragraph "trivial:" note explaining why, then lift it into the bd notes as `plan: trivial` plus an inline rationale. Per project convention, every bd issue goes through brainstorm → plan → execute, but the plan can be terse.

Do **not** make up a plan inline and proceed — that defeats the brainstorm gate.

## When the issue is a parent of plan-less children (brainstorming-split convention)

Stop. The brainstorming-split convention puts the plan on each child sub-issue, not on the parent. If the parent has children with `blocked-by` edges and no plan of its own, `/bd-execute` should be invoked on each **child** in turn (via `bd ready` to find the unblocked one), not on the parent. The parent closes automatically after every child closes.

## Pre-flight plan review

Before dispatching Task 1, scan the plan once for conflicts: tasks that contradict each other or the Global Constraints, and anything the plan explicitly mandates that the review rubric treats as a defect (a test that asserts nothing, verbatim duplication of a logic block). Present everything you find as **one batched question** — each finding beside the plan text that mandates it, asking which governs — before execution begins, not one interrupt per discovery. If the scan is clean, proceed without comment.

## Diff sanity check (after the loop)

The final whole-branch review (step 11) and `/bd-close-reviewed` are the real gates and already read the whole-branch diff — so no separate controller re-review is needed. The one thing to confirm yourself, because it's cheap and project-critical: that the final reviewer was handed a project-rules file **including `repo-boundary.md`** whenever the touch-set is narrative-adjacent (that digest carries the no-plaintext-leak invariant). If the touch-set produced no project-rules file, or `repo-boundary.md` wasn't in it for a narrative change, skim `git diff <merge-base>...HEAD` once for decrypted narrative content in new logs / response shapes before handing off.

## Model selection

Always specify `model:` explicitly on every dispatch — an omitted model inherits the session's model (often the most expensive), which silently defeats this section.

- **Implementer** — default **Sonnet**. The plan + project rules spell out the work; Sonnet executes structured TDD-shaped tasks well. When a task's plan text contains the complete code to write, the work is transcription + testing — Sonnet is still the floor (don't drop to Haiku; it takes more turns on multi-step work and the turn count outweighs the token saving). Per-task lift to Opus via a plan `model: opus` line (below).
- **Task reviewer** — **Sonnet**, scaled to the diff: a small mechanical diff stays on Sonnet; a subtle concurrency/crypto change can justify Opus. Sonnet is the default.
- **Final whole-branch reviewer (step 11)** — **Opus** (most capable available). A whole-branch review is a judgment task.
- **Simplify pass (step 10)** — not a subagent dispatch; the `simplify` skill runs in the controller session, so no `model:` applies.

Surface reviewers (`security-reviewer`, `repo-boundary-reviewer`) dispatched by `/bd-close-reviewed` pin their own model in agent frontmatter (`.claude/agents/`) — the bridge doesn't override them.

`subagent_type: general-purpose` has **no agent-definition file**, so without an explicit `model:` it inherits the parent session's model. That's the failure mode this section closes.

### When to opt the implementer up to Opus

A task warrants Opus when *what to build* is the hard part rather than *how to express the build*: non-obvious algorithm design, hairy cross-file refactors with many invariants in flight, novel API design, or a task whose framing genuinely needs cross-domain reasoning. Signal it in the **plan**, not the bridge — add a `model: opus` line to the task header before any other body text:

```
### Task 4: redesign chapter export pipeline

model: opus

[task body…]
```

When step 1 reads the plan it records that override and uses it for that task's implementer dispatch (and any fix re-dispatch). Absent the line, Sonnet. Don't speculatively opt up: Opus on a Sonnet-shaped task is wasted budget.

## Forbidden

- Skipping the task review, or accepting a report missing either verdict (spec compliance **and** code quality are both required from the single 6.x reviewer).
- Skipping the final whole-branch review (step 11) before handing off.
- Running the simplify pass (step 10) after the final review or after `/bd-close-reviewed` — its edits must land where the final reviewer and close gates see them. Skipping it silently is also out: a skip gets a ledger line with a reason.
- Letting the simplify pass change behavior, wire shapes, or pre-existing code outside the branch diff — pre-existing duplication is file-and-block, not an inline edit. And never loop on a red simplify commit: revert and move on.
- Forking superpowers' template files (read them fresh each dispatch); inlining a hand-copied template instead of reading the installed one.
- Hardcoding the `<RULES_BLOCK>` into the bridge skill's content (always assemble it from `docs/agent-rules/`).
- Dispatching a task reviewer without a diff file — generate it with `scripts/review-package <BASE> <HEAD>` first, using the recorded per-task BASE (never `HEAD~1`).
- Pasting task text or the digests inline into a dispatch when a file handoff exists — hand briefs, reports, diffs, and the project-rules file as paths.
- Pre-judging a reviewer's findings ("treat as Minor at most", "don't flag X") — let the reviewer raise it and adjudicate in the loop.
- Calling `bd close` directly from this skill (always go through `/bd-close-reviewed`).
- Dispatching multiple implementer subagents in parallel for the same plan (conflicts; superpowers' Red Flags rule).
- Dispatching any subagent without an explicit `model:` parameter.
- Re-dispatching a task the progress ledger already marks complete (check the ledger + `git log` after any compaction or resume).

## Verification

This skill is intentionally not directly verifiable by an automated `verify:` line — its correctness is observed end-to-end across the bd issues that flow through it. For a smoke test, hand-craft a no-op single-task plan, run `/bd-execute`, and confirm: (1) the project-rules file is assembled and its path reaches the implementer dispatch; (2) the task-brief and review-package files are written under `.superpowers/sdd/`; (3) the task reviewer returns both verdicts; (4) the progress ledger gains a `Task 1: complete …` line; (5) the ledger gains a `Simplify pass: …` line (`applied`/`clean`/`skipped`/`reverted` — a single-small-task smoke plan should legitimately hit `skipped`).
