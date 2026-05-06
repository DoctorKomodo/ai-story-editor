---
name: bd-execute
description: Bridge from bd → superpowers' subagent-driven-development loop. Claims a bd issue, reads its plan link, picks rules digests by touch-set, then runs the implementer + spec-reviewer + code-quality-reviewer loop with project rules prepended at each dispatch. After the loop reports CLEAN, hands off to `/bd-close-reviewed`. User-invocable as `/bd-execute <BD_ID>`.
---

# bd-execute

The bridge between bd and the superpowers `subagent-driven-development` loop. Owns project-rule injection at dispatch time per `docs/superpowers-injection-spike.md` (Phase 0).

This skill is the **controller**: when invoked, you (the main session) drive the loop directly using superpowers' prompt templates as content, with project digests prepended. Do **not** invoke `superpowers:subagent-driven-development` separately — that would create two competing loops.

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

### 1. Read the plan

Read the plan file at `<path>`. Identify:

- **Touch-set** — the list of files the plan creates or modifies. Plans authored via `superpowers:writing-plans` typically have a "Files to Create / Modify" or "File Map" section. Extract those paths.
- **Tasks** — the plan's task list (numbered or otherwise). Capture the full text of each task verbatim — implementers must not have to read the plan file.

### 2. Pick rules digests

Read `docs/agent-rules/index.md`. For each path in the touch-set, walk the mapping table top-to-bottom and union the matched digest names. The result is a deduplicated list of digest filenames (e.g. `backend.md`, `repo-boundary.md`).

Read each matched digest file under `docs/agent-rules/` into memory. They are the **`<RULES_BLOCK>`** that gets injected into every dispatch.

If a digest filename listed in `index.md` doesn't resolve to a readable file (typo in the index, file moved without index update, etc.): print a one-line warning that names the missing digest and proceed with the digests that *did* resolve. Do not stall the loop — fail visible, not silent. Surface the warning in your end-of-task summary so the user can fix the index.

If the touch-set is empty or doesn't match any glob, dispatch with no `<RULES_BLOCK>` and surface that as a concern in your end-of-task summary — usually it means the plan's file map is missing or the index needs an entry.

### 3. Read superpowers' templates

Read these files fresh (the bridge does not fork them — plugin upgrades roll forward automatically):

- `~/.claude/plugins/cache/claude-plugins-official/superpowers/<version>/skills/subagent-driven-development/implementer-prompt.md`
- `~/.claude/plugins/cache/claude-plugins-official/superpowers/<version>/skills/subagent-driven-development/spec-reviewer-prompt.md`
- `~/.claude/plugins/cache/claude-plugins-official/superpowers/<version>/skills/subagent-driven-development/code-quality-reviewer-prompt.md`

Discover `<version>` via `ls ~/.claude/plugins/cache/claude-plugins-official/superpowers/` (usually one entry, e.g. `5.1.0`).

**Plugin path fallback.** If the `~/.claude/plugins/cache/claude-plugins-official/superpowers/` directory doesn't exist (different install method — user-config plugin, project-vendored, or a future plugin manager that picks a different location), do **not** guess or fork. Stop and ask the user where superpowers is installed; record the answer in this skill so the next dispatch finds it. The bridge depends on these templates being readable; bypassing them by inlining a copy is forbidden (see Forbidden list below).

**Placeholder-name validation.** Once the templates are read, confirm that the placeholder strings you intend to substitute (e.g. `[FULL TEXT of task from plan - paste it here]`, `[Scene-setting...]`, `Work from: [directory]`) actually appear in the templates verbatim. If a plugin upgrade has renamed them, the substitution would silently produce malformed prompts — stop and surface the rename to the user instead.

### 4. Claim the issue

```
bd update <id> --claim
```

If `--claim` fails because someone else claimed it, stop and tell the user.

### 5. Track tasks locally

Use TodoWrite to write down each task from the plan as a todo item. (This is one of the few cases where TodoWrite is correct in this project — it's superpowers' per-task ledger during execution. The bd issue is the cross-session ledger; the TodoWrite list is the within-session per-task ledger. Do **not** create per-task bd issues.)

### 6. For each task: dispatch implementer

Construct the implementer prompt by composing:

```
## Project Rules (from <list of digest filenames>)

<contents of all matched digest files, separated by `---`>

---

<the rest of implementer-prompt.md template, with substitutions:>
- [FULL TEXT of task from plan] → the verbatim task text
- [Scene-setting...] → a one-paragraph "where this fits, what it depends on" framing pulled from the plan's introduction
- Work from: [directory] → the repo root absolute path
```

Dispatch via the Agent tool, `subagent_type: general-purpose`, with the composed prompt. (Do not pass the plan file path to the subagent — give them the extracted text directly. Subagents do not read the plan file. Reading the plan file would re-cost the entire plan tokens per dispatch and pull in tasks the subagent shouldn't be touching.)

#### Implementer status protocol

The implementer's final summary will declare one of four statuses (per superpowers' `subagent-driven-development` SKILL.md). Handle each:

- **`DONE`** — implementation complete, all assertions / TDD steps passed. Proceed to step 7 (spec reviewer).
- **`DONE_WITH_CONCERNS`** — implementation complete but the implementer flagged something for human review (e.g. a public API ambiguity, a follow-up they noticed but didn't fix). Read the concerns. If they are tractable adjustments to *this* task: re-dispatch the implementer with the fix asked for. If they are out-of-scope follow-ups: capture them as TODOs in your end-of-loop summary and proceed to step 7. Do not silently drop concerns.
- **`NEEDS_CONTEXT`** — implementer couldn't proceed without additional information (e.g. an undocumented API shape, a missing fixture). Treat this as your problem, not the implementer's: gather the context (read the relevant files, query Context7 MCP for docs, check sibling code) and re-dispatch with the additional context appended to the original prompt. Do **not** ask the user unless the context truly isn't recoverable from the repo.
- **`BLOCKED`** — implementer hit a hard stop (e.g. an environmental issue, a contradiction in the plan, a missing dependency). Stop the loop, surface the blocker to the user with the full implementer summary, and do **not** call `bd close` or proceed to the next task. The bd issue stays claimed until you (or the user) resolve the blocker and resume.

If you're unsure which status the implementer reported, re-read superpowers' `subagent-driven-development/SKILL.md` once for the canonical definitions — the bridge defers to it.

### 7. For each task: dispatch spec reviewer

After the implementer reports DONE (or DONE_WITH_CONCERNS resolved):

Compose the spec-reviewer prompt by reading the spec-reviewer template, substituting:
- The task text
- Git SHAs of the implementer's commits for this task

Dispatch via Agent tool, `subagent_type: general-purpose`. **No project rules digest is prepended to the spec reviewer** — its job is to verify the implementation matches the *spec*, not the project's general rules.

If the spec reviewer finds gaps: re-dispatch the implementer (same subagent type) with the gaps as fix instructions. Loop until spec-clean.

### 8. For each task: dispatch code-quality reviewer

After spec-clean, compose the code-quality-reviewer prompt with the **same** `<RULES_BLOCK>` prepended as the implementer (so the reviewer enforces the same project rules the implementer was held to):

```
## Project Rules (from <list of digest filenames>)

<contents of matched digests>

---

<rest of code-quality-reviewer template>
```

Dispatch via Agent tool, `subagent_type: general-purpose`.

If the code-quality reviewer finds issues: re-dispatch the implementer with fix instructions. Loop until quality-clean.

### 9. Mark task complete in TodoWrite, move to next task

Repeat steps 6–9 for each remaining task. Do not pause between tasks unless an implementer reports BLOCKED you cannot resolve, or all tasks are done.

### 10. After all tasks: hand off to close-reviewed

After the last task reports CLEAN from both reviewers, invoke:

```
/bd-close-reviewed <id>
```

That skill runs typecheck, the path-matched surface reviewer fan-out (`security-reviewer`, `repo-boundary-reviewer`), and the bd close. **You do not run `bd close` directly from this skill.**

## When the issue has no plan link

Stop. Tell the user the issue has no plan and suggest the path forward:

- If the work needs design discussion → `superpowers:brainstorming` first, then `superpowers:writing-plans` (which writes a plan to `docs/superpowers/plans/YYYY-MM-DD-*.md`), then `/bd-link-plan <id> <plan-path>`, then re-invoke `/bd-execute <id>`.
- If the bd issue is genuinely trivial and a plan would be theatre → still write a one-paragraph "trivial:" note explaining why, then either lift the trivial path into the bd notes as `plan: trivial` plus an inline rationale, or pick a different workflow. Per project convention, every bd issue goes through brainstorm → plan → execute via superpowers, but the plan can be terse.

Do **not** make up a plan inline and proceed — that defeats the brainstorm gate.

## When the issue is a parent of plan-less children (brainstorming-split convention)

Stop. The brainstorming-split convention puts the plan on each child sub-issue, not on the parent. If the parent has children with `blocked-by` edges and no plan of its own, `/bd-execute` should be invoked on each **child** in turn (via `bd ready` to find the unblocked one), not on the parent. The parent closes automatically after every child closes.

## Diff review (after the loop)

Once `/bd-close-reviewed` succeeds:

1. Read `git diff <merge-base>...HEAD`.
2. Compare to the implementer's status summary. Look for:
   - Claimed-but-missing changes.
   - Unintended churn outside the touch-set.
   - Debug logging left behind.
   - Plaintext leaks (decrypted narrative content in new logs / response shapes — see `docs/agent-rules/repo-boundary.md`).
3. This is a sanity check, not a re-review. If something stands out, decide whether to fix in this PR or file a follow-up bd issue.

## Forbidden

- Skipping the spec reviewer or code-quality reviewer for any task.
- Forking superpowers' template files (read them fresh each dispatch).
- Hardcoding the `<RULES_BLOCK>` into the bridge skill's content (always read from `docs/agent-rules/`).
- Calling `bd close` directly from this skill (always go through `/bd-close-reviewed`).
- Dispatching multiple implementer subagents in parallel for the same plan (conflicts; superpowers' Red Flags rule).
- Letting the implementer self-review replace the two-stage review (both stages run, in order, every task).

## Verification

This skill is intentionally not directly verifiable by an automated `verify:` line — its correctness is observed end-to-end during the first ~10 real bd issues that flow through it (per Phase 1 → Phase 2 gate in `docs/multi-agent-workflow-plan.md`). For a Phase-1 smoke test, see Phase 1 verification step 1 in that plan: hand-craft a no-op task plan, run `/bd-execute`, and confirm the digest reaches the implementer's effective prompt.
