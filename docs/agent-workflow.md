# Agent Workflow — How We Build on This Project

> **Audience:** future maintainers (human or agent). This file is the
> operating doc for the brainstorm → plan → bd → execute → close
> loop. CLAUDE.md is the rules manual; this file is the workflow
> manual.
>
> **Companion docs:** `docs/multi-agent-workflow-plan.md` (the plan
> that produced this workflow), `docs/superpowers-injection-spike.md`
> (Phase 0 mechanism proof), `docs/agent-rules/` (lane digests
> consumed by the bridge).

---

## TL;DR — the loop

```
brainstorm  →  plan  →  bd issue  →  /bd-execute  →  /bd-close-reviewed
(superpowers   (superpowers   (filed in    (bridge to       (path-matched
brainstorming)  writing-plans)  bd, with    superpowers'     surface
                                plan link   subagent loop,   reviewers,
                                via         with rules       typecheck,
                                /bd-link-   digest           bd close)
                                plan)       prepended)
```

Every bd issue goes through this loop, including trivial ones. There
is no fast path for "small" tasks — the uniform workflow is the
cheaper protocol once you stop counting lines and start counting
"how often did I forget to invoke security-reviewer / mock the
Venice client / not log decrypted content."

---

## The five steps in detail

### 1. Brainstorm (HARD-GATE design)

**When:** you have a feature request or bug report and either no
spec, no design, or open questions about either.

**Tool:** `superpowers:brainstorming` skill. Hard-gate, user-approved
spec written to `docs/superpowers/specs/`.

**What it does:** explores user intent, requirements, constraints,
and design tradeoffs. Surfaces splits ("this is actually two
features" / "this is a backend change with no frontend follow-on" /
"this needs a migration first"). Produces a contract-explicit spec
the planner can build a plan from.

**Brainstorming-split convention.** When brainstorming concludes the
work is actually multiple features, *don't* try to keep them in one
bd issue:

- Split into bd sub-issues (`bd create` per sub-feature).
- Add `blocked-by` edges (`bd dep add <parent> <sub-id>` for each
  child the parent waits on; or `bd dep add <child> <other-child>`
  if children depend on each other).
- Each sub-issue gets its own plan via `bash scripts/bd-link-plan.sh`.
- The parent bd issue stays plan-less and acts as a **coordinator**.
  `/bd-execute` errors on a parent issue with plan-less children —
  invoke `/bd-execute` on each child in turn (find the unblocked
  one with `bd ready`).
- The parent closes automatically once every child closes (per bd
  blocked-by semantics).

This preserves the **one bd issue per plan** invariant the bridge
relies on.

### 2. Plan (TDD-shaped, written down)

**When:** you have a brainstorm-approved spec, or the work is
genuinely trivial enough that the spec is "make this one-line
change" written inline.

**Tool:** `superpowers:writing-plans` skill. Plan written to
`docs/superpowers/plans/YYYY-MM-DD-<slug>.md`.

**What the plan must contain** (so `/bd-execute` can run it
without prompting):

- A **task list** — each task self-contained, with enough text that
  an implementer subagent doesn't need to read upstream files.
- A **file map** — the touch-set, named in the path conventions the
  rules-digest index can resolve (`backend/src/repos/...`,
  `frontend/src/lib/api.ts`, etc.). The bridge reads this map to
  decide which lane digests apply.
- An explicit **TDD signal** per task if TDD is required (most
  tasks should have it; superpowers' implementer follows TDD when
  the task says so).

If the plan's file map is missing, `/bd-execute` will dispatch with
no rules digest and surface that as a concern. Add the map and
re-invoke; don't fight the bridge.

### 3. File a bd issue and link the plan

**When:** the plan is written.

**Steps:**

```bash
bd create \
  --title="<short summary>" \
  --description="<why this exists, what done looks like>" \
  --type=feature|bug|task \
  --priority=<0-4>
# → returns story-editor-XXX

bash scripts/bd-link-plan.sh story-editor-XXX docs/superpowers/plans/YYYY-MM-DD-<slug>.md
```

`scripts/bd-link-plan.sh` is idempotent and preserves any existing
`verify:` line in `--notes`. If the plan moves, re-run it.

For sub-issue splits, file each child the same way and add the
`blocked-by` edges:

```bash
bd dep add <parent-id> <child-id>     # parent waits on child
bd dep add <child-2-id> <child-1-id>  # child 2 waits on child 1
```

### 4. Execute via `/bd-execute`

**When:** the bd issue exists and has a `plan: <path>` line in
notes.

**Tool:** `/bd-execute <bd-id>` skill (`.claude/skills/bd-execute/`).

**What it does:** (the skill reads first, claims only after it has
everything it needs to proceed — so a misconfigured plan or missing
template surfaces *before* the issue is taken out of the ready
queue.)

1. Reads the bd issue state and extracts the `plan: <path>` line
   from notes. Stops if the issue is already closed, claimed by
   someone else, or has no plan link.
2. Reads the plan file linked from bd notes; extracts the touch-set
   and the per-task text.
3. Reads `docs/agent-rules/index.md`; matches the plan's file map
   against the path-glob table; unions the matched digest names and
   reads each digest into memory.
4. Reads superpowers' prompt templates fresh from the installed
   plugin (`~/.claude/plugins/cache/claude-plugins-official/
   superpowers/<version>/skills/subagent-driven-development/
   {implementer,spec-reviewer,code-quality-reviewer}-prompt.md`).
5. **Now** claims: `bd update <id> --claim`.
6. Tracks per-task state in TodoWrite (within-session ledger).
7. For each task: dispatches **implementer** → **spec reviewer** →
   **code-quality reviewer** in that order. Project rules digests
   are prepended to the implementer and code-quality-reviewer
   prompts as a `## Project Rules` section before the
   `## Task Description` block. The spec reviewer is dispatched
   *without* the digest — its job is spec compliance, not project
   rule enforcement.
8. After the last task reports CLEAN from both reviewers, hands off
   to `/bd-close-reviewed`.

**Continuous execution:** the bridge does not pause between tasks.
The user is interrupted only when an implementer reports BLOCKED
the bridge cannot resolve, ambiguity prevents progress, or all
tasks are done.

**What the bridge does NOT do:** call `bd close` directly. That's
`/bd-close-reviewed`'s job, after the surface reviewers run.

### 5. Close via `/bd-close-reviewed`

**When:** `/bd-execute`'s loop reports CLEAN, or you implemented
something by hand and want to close.

**Tool:** `/bd-close-reviewed <bd-id>` skill.

**What it does:**

1. **Typecheck** affected workspaces (`backend/` and / or
   `frontend/` based on diff). Refuses close on failure.
2. **Compute path-matched reviewers** by inspecting
   `git diff <merge-base>...HEAD`:
   - `security-reviewer` — auth / crypto / middleware / Venice-key
     routes.
   - `repo-boundary-reviewer` — repos, narrative routes,
     content-crypto, prompt-service, narrative migrations.
3. **Dispatches matching reviewers in parallel** via the Agent tool
   (single message, multiple tool calls). Refuses close on any
   `BLOCK` / `FIX_BEFORE_MERGE`.
4. **Override path** (`--override-block "<reviewer> — <reason>"`)
   requires explicit user ack:
   - Records on bd notes.
   - Creates an empty git commit carrying a `Reviewer-Override:`
     trailer so the override appears in `git log` and PR diffs.
5. On clean: `bd close <id>`.

**The override is a judgment call,** not a routine flag. Frequent
overrides indicate reviewer prompt drift — that's a reviewer fix,
not a workflow shortcut.

**Phase 2 will add:** a `warnings:check` step against
`.warnings-baseline.json`. Same skill body; new script phase.

---

## The rules-digest mechanism

### Why digests exist

Project rules — repo-layer-only for narrative entities, Zod-validate
every body, tokens-only from `index.css`, request-scoped DEK only,
ciphertext never returned, etc. — are too many to restate per task,
too project-specific to live in superpowers' generic prompts, and
too important to skip. They live in `docs/agent-rules/` as plain
prose and get **prepended at dispatch time** to the implementer +
code-quality-reviewer prompts.

### How the prepend works

The bridge skill is the controller. It reads superpowers'
`implementer-prompt.md` template, the matching digest(s) from
`docs/agent-rules/`, and constructs the dispatched Task prompt with
this shape:

```
You are implementing Task N: [task name]

## Project Rules (from docs/agent-rules/<name>.md)

<digest content, verbatim, with literal section headers>

---

## Task Description

[FULL TEXT of task from plan]

## Context

[Scene-setting...]

[...rest of implementer-prompt.md template, with substitutions...]
```

The same `## Project Rules` block is prepended to the
code-quality-reviewer's prompt so it enforces the same rules the
implementer was held to. The spec-reviewer's prompt is
*not* augmented — its scope is spec compliance, not project rules.

### How `index.md` resolves digests

`docs/agent-rules/index.md` maps path globs to digest names. When
the plan's file map lists a path, the bridge walks the table
top-to-bottom and **unions** the matched digests. A path that
matches multiple rows accumulates all their digests, deduplicated.

A plan that touches both backend and frontend (typical for new
features) usually accumulates `backend.md` + `frontend.md` +
`repo-boundary.md`. That's the expected steady state for
cross-boundary features.

### Why this isn't a fork

The bridge **reads** superpowers' prompt templates fresh on each
dispatch — it does not copy them into project source. Plugin
upgrades roll forward automatically. The bridge owns only the
**addition** of the `## Project Rules` section; the body of each
template is whatever the plugin currently ships.

If superpowers ships a major rewrite of the placeholder names in a
future plugin version, the bridge skill's prompt-construction
instructions need a corresponding update — but the surface area is
small (the bridge is not re-implementing the loop, just composing
around the templates).

### Editing a digest changes future runs

Rules edits to `docs/agent-rules/*.md` apply to **the next**
`/bd-execute` dispatch. There is no cache, no compile step. If a
rule is wrong, fix the digest, and the next implementer dispatch
picks it up.

---

## Model selection

`/bd-execute` defaults its dispatched subagents to **Sonnet** — both
reviewers always, the implementer unless the task opts up. The two
surface reviewers invoked by `/bd-close-reviewed`
(`security-reviewer`, `repo-boundary-reviewer`) pin `model: sonnet`
in their agent frontmatter, so the close gate is consistent.

**Why Sonnet by default.** The bridge's subagents do structured
work: implementers execute TDD tasks against a plan + rules digest;
reviewers compare a diff against a spec or a digest. None of that
is synthesis. Sonnet handles structured execution well; running
Opus by default (which is what happens with no explicit
`model:` parameter, since `subagent_type: general-purpose` has no
agent-definition file to consult) is wasted budget.

### Opting the implementer up to Opus

Some tasks genuinely need Opus — non-obvious algorithm design,
hairy cross-file refactors, novel API shape decisions. Signal it in
the **plan**, not in the bridge invocation: add a `model: opus`
line to the task header before any other body text:

```
### Task 4: redesign chapter export pipeline

model: opus

[task body…]
```

The bridge picks the line up when it extracts task text in step 1
of its loop and uses it as the `model:` parameter for that task's
implementer dispatch (and any re-dispatch on review failure). The
spec + code-quality reviewers stay on Sonnet regardless — their
work shape doesn't change with task difficulty.

If no `model:` line is present, Sonnet is the default. Don't
speculatively opt up.

The full convention (Haiku considerations, cost rationale, the
forbidden "no explicit model" pattern) lives in
`.claude/skills/bd-execute/SKILL.md` "Model selection" section.

---

## Layer-2 implicit-dependency ruleset

CLAUDE.md's historical "Task Order" section encoded **hard gates**
between bring-up letters (S → A → D → AU → E → V → L → B → F → I →
T → X) and a small set of cross-letter constraints. Most of those
letters are now archived; the section letters are not the active
ordering anymore. **bd's `blocked-by` graph is authoritative for
ordering.**

What survives from the old hard-gate list — and lives here as the
"Layer-2 implicit-dependency ruleset" — is a small set of *implicit*
project rules that do not slot into the bd graph cleanly because
they apply at the rule-shape level, not the task level:

1. **Any narrative-entity CRUD touches the encryption boundary.**
   Adding or modifying a Story / Chapter / Character / OutlineItem /
   Chat / Message route, repo, or schema column requires the repo
   layer + ciphertext-triple template. (Captured in
   `docs/agent-rules/repo-boundary.md`; enforced by
   `repo-boundary-reviewer` at close time.)
2. **Any AI-call code path is per-user, never singleton.** No
   server-wide Venice key, no shared client, no module-scoped
   client cache. Every Venice call is constructed via
   `getVeniceClient(userId)`. (`backend.md`, AI integration; the
   `[V17]` invariant.)
3. **Auth / session / crypto changes get a security review.**
   Touching `backend/src/services/auth.service.ts`,
   `backend/src/services/crypto.service.ts`,
   `backend/src/services/content-crypto.service.ts`,
   `backend/src/middleware/`, or any cookie / cors / helmet / rate-
   limit bootstrap fires `security-reviewer` automatically via
   `/bd-close-reviewed`. The implementer should treat the rules
   digest as the design contract; the reviewer is the safety net.
4. **Tests against narrative entities go through the repo layer.**
   Mocking the database is forbidden in integration tests; the test
   DB is real Prisma against real ciphertext. (CLAUDE.md "Testing
   Rules" + `backend.md`.)
5. **`docs-MCP-before-muscle-memory` for fast-moving libraries.**
   TipTap, Vite, Tailwind, TanStack Query, Zustand, Express, Prisma,
   Zod — all have shipped breaking changes in the last ~12 months.
   Prefer Context7 MCP `query-docs` over recalled API shapes when
   muscle memory is the only reason for a particular call.

These rules are not arrows in the bd graph; they are constraints that
apply *to* the code, regardless of which bd issue contains it. The
rules digest mechanism + path-matched surface reviewers turn them
into automatically enforced gates rather than honour-system reminders.

## Preserved Task-Order rationale (why the old hard-gates existed)

Captured here so the *why* survives even though the section-letter
ordering retires:

- **B requires AU** — backend non-auth routes assume the auth +
  ownership middleware exists. Without AU, every B route would have
  to re-derive ownership inline. The middleware is the seam.
- **Narrative-entity CRUD requires E3 + E9** — writing plaintext
  rows you'd have to re-encrypt later is wasted work and a leak
  risk during the window between write and re-encrypt. E3 (the
  per-request DEK unwrap) and E9 (the repo-layer boundary) ship
  the encryption invariant; doing CRUD before they exist means
  every CRUD diff has to be re-reviewed when E9 lands.
- **V beyond `[A4]` requires AU11 + AU12** — BYOK is the only key
  path. There is no server-wide Venice key. AU11 (the AES-256-GCM
  helper) and AU12 (the BYOK endpoints) ship the storage layer; V
  can't make calls without it.
- **L (live tests) requires V17** — the probe CLI and live tests
  reuse the per-user client construction. A separate client in
  `scripts/` or `tests/live/` is duplication waiting to drift.
- **F AI features require V5+** — the streaming endpoints are what
  the selection-bubble / inline-result / chat-panel UIs consume.
  Building UI before the endpoint exists creates work that has to
  be re-done when the endpoint shape lands.
- **E2E tests require Docker Compose** — Playwright drives a real
  stack; mocking out the backend is what jsdom is for.

Most of these gates are now satisfied (the project is well past
initial bring-up). The implicit constraints they encoded — "don't
write plaintext you'd re-encrypt", "don't build UI for endpoints
that don't exist" — survive in the rules digests and the surface
reviewers.

---

## Reviewer-override semantics

The override path is **a deliberate exit valve, not a routine
flag.**

### When to use it

- A surface reviewer returns `BLOCK` / `FIX_BEFORE_MERGE` on a
  finding that is genuinely a false positive (e.g. it flagged a
  pattern that the project actually allows in a context the
  reviewer's prompt didn't anticipate).
- The fix would block a time-sensitive change unrelated to the
  flagged finding (rare).
- An external constraint forces ship — and the override
  documents the trade explicitly so it's not invisible later.

### When NOT to use it

- The reviewer is "being annoying" but technically correct.
- You don't understand the finding and want to move on. (Re-read
  the finding; if still unclear, escalate to the user.)
- You've used override more than once in the same week. That's a
  **reviewer prompt drift signal**, not a normal-flow trigger —
  fix the reviewer's prompt instead of overriding past it.

### How the override is recorded

`/bd-close-reviewed` with `--override-block "<reviewer> — <reason>"`:

1. Prompts the user for explicit ack (`yes` / `no`). No silent
   overrides.
2. On `yes`, appends an `override:` line to the bd issue's notes.
3. Creates an **empty git commit** with a `Reviewer-Override:`
   trailer:

   ```
   chore: reviewer override recorded for story-editor-XXX

   Reviewer-Override: <reviewer> — <reason>
   ```

   The empty commit appears in `git log`, so PR diffs and review
   tools surface the override at the same level as code changes.
4. Calls `bd close <id>`.

The bd note is the long-term record; the commit trailer is the
short-term visibility (it stops the override from being invisible
in the merge process).

---

## Main-session contract on SessionStart hook output

Phase 1 ships a SessionStart hook that prints:

- **CLAUDE.md staleness ping** (R12d) — one-line warning when
  `CLAUDE.md` `mtime` is older than the close dates of the 5 most
  recent closed bd issues.

Phase 2 will extend the hook with:

- **Stale-claim summary** — `bd list --claimed-by-me` filtered to
  claims older than 1 hour.
- **Dirty-tree summary** — `git status --short` if non-empty.

The hook is **emit-only**; it never blocks. The main session is
responsible for *acting* on what the hook prints:

- **Staleness ping** → consider refreshing CLAUDE.md / `agent-rules/`
  before the next implementer dispatch (the implementer's effective
  prompt is only as up-to-date as those files).
- **Stale claim** (Phase 2) → before doing anything else, prompt the
  user with three options:
  1. **Resume** — finish the in-flight work in the claimed bd
     issue.
  2. **Abandon** — `bd update <id> --unclaim` and clean up the
     working tree.
  3. **Inspect** — show the diff and the issue notes; user
     decides.
- **Dirty tree** (Phase 2) → similar: surface, don't auto-decide.
  An unexpected dirty tree may be the user's in-progress work.

The contract: **the hook only emits, the session acts.** Don't
auto-resume, don't auto-abandon, don't auto-clean. The dirty-tree
output is informational; the user is the one with context on what
that uncommitted work means.

---

## Worktrees vs. feature branches

Per project memory: **feature branches by default; worktrees only
for parallel or risky work.** When you reach for a worktree, place
it under `.worktrees/` inside the repo (so it's discoverable next
to the source tree, not floating elsewhere).

Common cases for a worktree:

- You're going to take a destructive action (force-pushing a
  rewrite, hard reset) and want a backup branch on disk.
- You're running multiple `/bd-execute` invocations in parallel
  for *independent* bd issues — superpowers' loop is not
  parallel-safe within a single session, but two separate
  worktrees with two separate sessions are.

Common cases for a plain feature branch:

- Single `/bd-execute` invocation, single bd issue.
- Code review feedback fixes on an existing PR.
- Anything where the only "isolation" you need is "don't
  contaminate `main`".

---

## What this workflow doesn't solve

These are explicit non-goals for the current phase. Don't try to
shoehorn them in:

- **Multimodal UI verification.** No screenshot-diff loop; visual
  regressions are caught by Storybook + Playwright.
- **Long-running PR coordination.** Use a separate
  `subscribe_pr_activity` flow for that, not `/bd-execute`.
- **Cross-task refactors that span backend + frontend
  simultaneously.** Brainstorming produces a contract-explicit
  spec; the implementer-loop still works one plan at a time. The
  cross-boundary spec lets you sequence the plans cleanly.
- **Auto-summarising past sessions.** Phase 2 ships a hand-written
  `docs/session-log.md` digest. Auto-summaries decay too fast to
  be worth the noise.

---

## Quick reference

```
bash scripts/bd-link-plan.sh <bd-id> <plan-path>   # link a written plan to a bd issue
/bd-execute <bd-id>                                 # claim, dispatch loop, hand off to close
/bd-close-reviewed <bd-id>                          # typecheck + surface reviewers + bd close
```

```
docs/agent-rules/        ← lane digests; edit to change implementer behaviour
docs/superpowers/specs/  ← brainstormed specs (input to writing-plans)
docs/superpowers/plans/  ← written plans (input to /bd-execute)
docs/session-log.md      ← (Phase 2) cross-session digest
```

---

## See also

- `CLAUDE.md` — orchestration rules, gate documentation, naming /
  git / Docker / testing policy, Known Gotchas, "When to Stop and
  Ask".
- `docs/agent-rules/index.md` — path-glob → digest mapping (read
  by `/bd-execute`).
- `docs/multi-agent-workflow-plan.md` — the plan that produced this
  workflow.
- `docs/superpowers-injection-spike.md` — Phase 0 mechanism proof.
- Superpowers plugin (`~/.claude/plugins/cache/.../superpowers/`)
  — `brainstorming`, `writing-plans`,
  `subagent-driven-development`, `using-git-worktrees`.
