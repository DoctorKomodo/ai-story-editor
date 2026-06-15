# Multi-Agent Workflow for Inkwell

## Context

You already have:
- Two project-tuned read-only reviewers (`security-reviewer`,
  `repo-boundary-reviewer`) for auth/crypto and narrative-entity
  boundary surfaces.
- The superpowers Claude Code plugin
  (https://claude.com/plugins/superpowers), which provides
  `brainstorming` (HARD-GATE design review), `writing-plans` (TDD plan
  authoring to `docs/superpowers/plans/`), and
  `subagent-driven-development` (the implementer → spec-reviewer →
  code-quality-reviewer execution loop).
- bd (post-PR70) as the task tracker, with `/bd-close` and
  `/task-verify` skills.
- 20 plan files already authored in `docs/superpowers/plans/` —
  the design + planning loop is in active use.

What you don't have:
1. **No bridge between bd and superpowers' execution loop.** A bd issue
   may link to a plan file in its notes, but nothing reads that link,
   dispatches the superpowers loop against the plan, and closes the bd
   issue when the loop finishes. Today this happens by hand.
2. **No project-rule customisation of the superpowers implementer /
   code-quality-reviewer prompts.** The skill dispatches a generic
   implementer; it doesn't know repo-layer-only, tokens-from-index.css,
   Zod-validate-every-body, BYOK, encryption-boundary respect. Each
   plan re-states project rules in task text, which is brittle.
3. **No path-matched fan-out to the existing surface reviewers.**
   `security-reviewer` and `repo-boundary-reviewer` are documented
   gates — a human has to remember to invoke them. Nothing inspects
   the diff and routes them automatically. **This is the same C1
   problem as before**, unchanged by the superpowers reframe.
4. **The post-Edit/Write typecheck hook fires too eagerly** during
   multi-file changes (C2, confirmed pain point).
5. **CLAUDE.md "Task Order" is legacy** (S→A→D→AU→…). With sections
   archived and bd as the live task store, the section-letter ordering
   no longer fits — bd's `blocked-by` graph should be authoritative,
   but the migration hasn't happened yet.
6. **Interrupted-run recovery is improvised** — if an implementer
   exits mid-task with a claimed bd issue + dirty tree, the next
   session has no documented protocol.

This plan addresses those six gaps and nothing else. Earlier drafts
proposed a roster of six-to-eight new agents (`task-planner`,
`plan-critic`, `slice-architect`, `code-reviewer`, `spec-reviewer`,
`design-token-reviewer`, `backend-engineer`, `frontend-engineer`,
`test-author`); each has been retired against the superpowers skills
that already do the work. The remaining pieces are **rules digests
(data, not agents)**, **two thin bridge skills**, and **two hooks**.

---

## Design Principles

1. **Build on superpowers; don't reinvent it.** `brainstorming`,
   `writing-plans`, and `subagent-driven-development` cover design
   review, plan authoring, and the implementer + two-stage post-
   implementation review loop. Re-implementing them produces a less
   mature copy and breaks composition.
2. **Customise via prompt-time rule injection, not by forking
   agents.** Superpowers' `subagent-driven-development` dispatches by
   composing prompt-template files (`implementer-prompt.md`,
   `spec-reviewer-prompt.md`, `code-quality-reviewer-prompt.md`) into
   a generic Agent call — verified by reading the skill. The right
   unit of project customisation is **rules-digest files** that the
   bridge skill prepends to those templates at dispatch time. No
   agent definitions to maintain, no fork to drift.
3. **bd issue per plan, not per task.** Verified: superpowers manages
   per-task state in session-level TodoWrite, not in any external
   store. bd cannot pass-through that. Resolution: one bd issue tracks
   "this whole feature is in flight"; superpowers owns per-task
   bookkeeping during execution; bd close fires once at the end via
   `/bd-close-reviewed`.
4. **Path-matched surface reviewers run *after* superpowers' loop,
   not in place of it.** Superpowers' two-stage review (spec
   compliance + general code quality) fires unconditionally on every
   task. The project's surface reviewers (`security-reviewer`,
   `repo-boundary-reviewer`) only fire when the diff touches their
   lane. They run as an *additional* path-matched gate at bd-close
   time, not as a replacement.
5. **Single uniform workflow.** Every bd issue (including trivial
   ones) goes brainstorm → plan → execute via superpowers. No
   second mental model for "small" tasks. Verified user preference.
6. **Hooks stay minimal.** Two: `SubagentStop` typecheck (C2) and
   `SessionStart` staleness + recovery checks (C12/R12d + interrupted-
   run protocol). Don't auto-fire writers from hooks.
7. **Trust but verify on diffs.** Before reporting CLEAN to the user,
   the main session reads `git diff` and compares to what the
   implementer summary claimed. Agent summaries describe intent, not
   outcome (per harness rule). This is a sanity check, not a re-run
   of the reviewers.

---

## The four building blocks

Just four artefacts. Everything else is wiring.

### 1. Project-rules digests (data, prompt-injectable)

Files under `docs/agent-rules/`:
- `backend.md` — repo-layer-only for narrative entities, Zod-validate
  every body, no `try/catch` per-route, no ciphertext egress, no
  plaintext logging in prod, auth+ownership middleware, never expose
  `passwordHash` / decrypted Venice key, request-scoped DEK only,
  test DB only / mock Venice HTTP / no `.skip`/`.only`,
  docs-MCP-before-muscle-memory for fast-moving libraries.
- `frontend.md` — API only via `src/lib/api.ts`, Zustand for client
  / TanStack Query for server / no other stores, tokens-only from
  `frontend/src/index.css` (lint:design enforces), JWT in memory,
  Storybook-first, selection-bubble `preventDefault`, keyboard
  shortcut contract, peer `*.stories.tsx` for new components,
  TanStack Query keys `[entity, id]`, hooks `use<Entity>(id)`,
  jsdom for unit / Playwright for E2E, mock at `lib/api.ts`,
  **docs-MCP-before-muscle-memory for fast-moving libraries**
  (TipTap, Vite, Tailwind, TanStack Query, Zustand all move
  fast — R6a applies just as much here as on the backend).
- `repo-boundary.md` — encrypt-on-write / decrypt-on-read template,
  ciphertext columns triple, never return ciphertext fields,
  `wordCount` from plaintext before encryption.
- `index.md` — meta-file mapping path globs to digests:
  `backend/src/**` → `backend.md` + `repo-boundary.md` (when
  narrative entities); `frontend/src/**` → `frontend.md`; etc.

These are **plain prose**, deliberately. They get prepended into
superpowers' `implementer-prompt.md` and `code-quality-reviewer-
prompt.md` at dispatch time. Editing a digest changes implementer
and reviewer behaviour for that lane on the next dispatch — no agent
definitions to update, no fork to maintain. Source of truth for
project rules; CLAUDE.md retains only orchestration / workflow rules.

**Cross-lane rules** (R6a docs-MCP-before-muscle-memory; "no `.skip`
/ `.only` in tests"; TS strict / no `any`; "no plaintext user content
in prod logs") are duplicated across `backend.md` and `frontend.md`
during initial authoring. If during authoring more than ~3 rules
turn out to be cross-lane, extract a `general.md` digest that both
lanes inherit instead of duplicating; otherwise duplication is
cheaper than the indirection. Decide once digests are drafted, not
in advance.

### 2. `/bd-execute <id>` bridge skill (NEW)

The skill that connects bd to superpowers. Located at
`.claude/skills/bd-execute/`. **Depends on Phase 0 spike** — its
shape changes substantially based on whether superpowers exposes a
prompt-injection hook.

What it does:
1. `bd update <id> --claim`.
2. Reads the bd issue's notes; finds the `plan:` link to a
   `docs/superpowers/plans/YYYY-MM-DD-*.md` file.
3. Errors if no plan link (bd issues without plans don't go through
   this skill — they go through `brainstorming` → `writing-plans`
   first to *produce* a plan, then through `/bd-execute`).
4. Reads the plan file. Parses its file map to determine the
   touch-set; consults `docs/agent-rules/index.md` to pick the
   matching digests.
5. Invokes superpowers' `subagent-driven-development` with the
   digests injected into the implementer + code-quality-reviewer
   prompts via the mechanism chosen in Phase 0 (one of: skill-
   config file, skill argument, or bridge-driven dispatch loop
   using superpowers' prompt content as data).
6. After superpowers' loop reports CLEAN on the last task, calls
   `/bd-close-reviewed <id>` to run the surface reviewer fan-out
   and close the bd issue.

Output: standard "tasks done / bd issue closed" or "blocked at
task N / bd issue still claimed".

#### Brainstorm → plan → bd issue stitching

The bridge assumes "one bd issue per plan, one plan per bd issue".
Two flows can break that invariant; both have a defined response.

**Flow A — brainstorming kept the bd issue intact.** Spec writes
out, plan writes out under `docs/superpowers/plans/`, plan link
gets recorded as a bd note: `bd update <id> --notes "plan: <path>"`.
This is the convention; either brainstorming's final step does it,
or the main session does it before invoking `/bd-execute`.
Either way it's one mechanical line and worth a tiny `/bd-link-plan
<bd-id> <plan-path>` skill (Phase 1, low-cost) so it doesn't get
forgotten.

**Flow B — brainstorming split the bd issue into sub-features.**
Convention: split into bd sub-issues (`bd add` per sub-feature,
`bd update <parent> --blocked-by <sub-id>` for each), give each
sub-issue its own plan link, leave the parent bd issue as a
coordinator with no plan of its own. `/bd-execute` errors on a
parent issue that has plan-less children; the parent closes only
after every child closes. This preserves the "one bd issue per
plan" invariant and gives proper `blocked-by` edges between sub-
features. The brainstorming skill itself surfaces the split
decision; this convention just defines what bd does after.

### 3. `/bd-close-reviewed <id>` close gate (REVISED, narrower)

Located at `.claude/skills/bd-close-reviewed/` plus
`scripts/bd-close-reviewed.sh`. Called by `/bd-execute` after
superpowers' loop, or directly by the user / main session when an
implementation didn't go through `/bd-execute`.

What it does:
1. Run typecheck across affected workspaces (`npm --prefix backend
   run typecheck` and / or `npm --prefix frontend run typecheck`,
   based on diff paths).
2. Inspect `git diff <merge-base>...HEAD`; pick path-matched surface
   reviewers:
   - `backend/src/{routes/auth,services/auth,services/crypto,
     services/content-crypto,middleware/}**` → `security-reviewer`
   - `backend/src/repos/**`, narrative-entity routes,
     `backend/src/services/content-crypto.service.ts`, narrative
     migrations → `repo-boundary-reviewer`
   Fan them in parallel (single Agent batch).
3. Refuse close on any BLOCK / FIX_BEFORE_MERGE.
4. (Phase 2) Run `npm run warnings:check` against
   `.warnings-baseline.json`; refuse close if new warnings.
5. **Override path:** `--override-block "<reason>"` requires user
   acknowledgment (main session asks; user types ok / no) and is
   recorded in two places: (a) `bd update <id> --notes "override:
   <reviewer> BLOCK overridden — <reason>"`; (b) a commit-message
   trailer on the next commit, format `Reviewer-Override:
   <reviewer> — <reason>`, so the override is visible in `git log`
   and PR diffs, not only in the task tracker. Frequent overrides
   indicate reviewer prompt drift, not normal flow.
6. On clean: `bd close <id>`.

(The override path is a judgment call to pre-build versus design-on-
first-hit. Pre-built here because deadlock on a reviewer false-
positive without an exit is annoying enough to be worth the small
cost. Reconsider in Phase 2 if it's never used.)

What it does NOT do: spec review and code-quality review are owned by
superpowers' `subagent-driven-development`, not by this script. This
script only runs the *additional* surface-specific reviews that
superpowers doesn't know about.

### 4. Two hooks

`.claude/hooks/post-edit-typecheck.sh` — same content as today, but
trigger config moves from `PostToolUse` Edit/Write to **`SubagentStop`
+ `PreToolUse` `git commit`** (C2 — fires once at agent end and once
before commit, not mid-Edit). Body unchanged.

`.claude/hooks/session-start.sh` — new `SessionStart` hook. Phase 1
ships only the staleness ping; the recovery checks defer to Phase 2.

Phase 1:
- Compare CLAUDE.md `mtime` against close dates of the 5 most recent
  closed bd issues; print one-line warning if CLAUDE.md is older
  (R12d staleness ping). Cheap, useful from day one.

Phase 2 (only if observed need):
- Run `bd list --claimed-by-me`; if any stale claim (>1 hour),
  print summary.
- Run `git status --short`; if dirty tree, print summary.
The recovery checks address an unproven failure mode (implementer
exits mid-task with claimed bd issue + dirty tree). Defer until
Phase 1 has run on real work and the failure mode actually appears.
The hook doesn't block in either phase.

---

## The Existing Surface Reviewers (Unchanged)

`security-reviewer` and `repo-boundary-reviewer` keep their current
prompts (PR70 already updated them for bd). They get invoked by
`/bd-close-reviewed` based on diff paths, not by the user
remembering. No content changes; only invocation changes.

---

## Orchestration Model

```
SessionStart hook fires:
  - CLAUDE.md staleness ping (R12d)
  - bd list --claimed-by-me → recovery prompt if any
  - git status --short → recovery prompt if dirty tree
  ↓
User: "what's next?" or "let's do <feature>"
  ↓
Main session decides: is there a plan?
  - If no plan or no spec: invoke superpowers `brainstorming`
    (HARD-GATE — user-approved spec to docs/superpowers/specs/),
    then `writing-plans` (TDD plan to docs/superpowers/plans/).
  - If a plan exists but no bd issue tracks it: create one,
    `bd update <id> --notes "plan: <path>"`.
  ↓
Main session invokes /bd-execute <id>:
  1. bd update --claim
  2. read plan, pick rules digest by touch-set
  3. invoke superpowers subagent-driven-development with
     digest prepended to implementer + code-quality-reviewer prompts
  4. for each task in plan:
     - implementer (with project rules baked in via digest)
     - SubagentStop hook runs typecheck (C2)
     - spec-reviewer (superpowers, unmodified)
     - code-quality-reviewer (superpowers, with digest prepended)
     - if BLOCK / FIX_BEFORE_MERGE → fix loop
  5. on last task CLEAN: call /bd-close-reviewed <id>
  ↓
/bd-close-reviewed:
  1. typecheck (across affected workspaces)
  2. (Phase 2) warnings:check
  3. fan path-matched surface reviewers in parallel:
     - auth/crypto/middleware → security-reviewer
     - repos/narrative routes → repo-boundary-reviewer
  4. refuse close on BLOCK / FIX_BEFORE_MERGE
     (override: --override-block "<reason>" + user ack)
  5. bd close on CLEAN
  ↓
Main session DIFF REVIEW: reads `git diff`, compares to
implementer/superpowers summary, looks for claimed-but-missing
changes, unintended churn, debug logging, plaintext leaks. Sanity
check, not re-review.
  ↓
Main session reports BLOCK / CLEAN to user; commits if clean.
End of session: append 5–10 line digest to docs/session-log.md
(Phase 2; R12a).
```

**Reviewer re-opening rule:** if a surface reviewer returns BLOCK
after the gate already succeeded (e.g. later manual review on closed
work), re-open the bd issue and dispatch the fix back through
`/bd-execute` with the findings as context.

**Don't auto-fire writers from hooks.** Hooks: `SubagentStop`
typecheck + `SessionStart` recovery / staleness. No writer-spawning
hooks (would deadlock or recursively loop).

---

## Files to Create / Modify

### Phase 0 — Spike (prerequisite)

Two-hour read-and-prove pass. Output: a one-page memo
`docs/superpowers-injection-spike.md` recording the chosen
mechanism, with a no-op proof-of-concept showing a sentinel string
from a digest file reaching the implementer's effective prompt.

| Path | Action | Notes |
|---|---|---|
| (read-only) | INVESTIGATE | Read superpowers' `subagent-driven-development` skill source. Determine: (a) skill-config injection point (e.g. `.superpowers-config.json` declaring "prepend file X to implementer-prompt.md"), (b) skill argument / parameter passed through, or (c) neither — bridge skill must drive its own dispatch loop using superpowers' prompt-template files as content. |
| `docs/superpowers-injection-spike.md` | CREATE | Memo recording: chosen mechanism, no-op POC results, fallback decision if (c) is the only path. The fallback decision matters — if (c) is forced, choose between "fork-by-copy of superpowers prompts (drifts on plugin updates)" vs. "rules-as-data injected into plan files (brittle, the thing digests are meant to avoid)" vs. "abandon the digest mechanism entirely". |

**Phase 0 gate:** Phase 1 does not start until the memo exists and
either (a) or (b) is viable, OR a written rationale accepts the (c)
fallback's tradeoffs. If (c) is forced and no fallback is acceptable,
the plan needs revisiting before any code lands.

**Phase 0 ownership:** the spike is the first session's first task
on the multi-agent branch. Output is the memo file plus the no-op
POC; nothing else lands until the memo records (a), (b), or an
accepted (c) tradeoff.

### Phase 1 — Keystone

| Path | Action | Notes |
|---|---|---|
| `docs/agent-rules/backend.md` | CREATE | Backend rules digest, extracted from CLAUDE.md (see CLAUDE.md migration scope below) |
| `docs/agent-rules/frontend.md` | CREATE | Frontend rules digest |
| `docs/agent-rules/repo-boundary.md` | CREATE | Encryption-boundary digest (overlaps with security-reviewer's lane but as data, for implementer / code-quality-reviewer) |
| `docs/agent-rules/index.md` | CREATE | Path-glob → digest mapping |
| `.claude/skills/bd-execute/SKILL.md` | CREATE | bd → superpowers bridge; shape determined by Phase 0 spike |
| `.claude/skills/bd-link-plan/SKILL.md` | CREATE | One-line skill: `bd update <bd-id> --notes "plan: <plan-path>"`; called by brainstorming's final step or by hand. Removes a forgettable manual step in the brainstorm → plan → bd → execute chain. |
| `scripts/bd-close-reviewed.sh` | CREATE | Typecheck + path-matched surface reviewer fan-out + bd close, with `--override-block` flag and commit-trailer recording |
| `.claude/skills/bd-close-reviewed/SKILL.md` | CREATE | Skill alias for the script |
| `.claude/hooks/post-edit-typecheck.sh` | MODIFY | Same content; trigger moves to `SubagentStop` + `PreToolUse` `git commit` (C2) |
| `.claude/hooks/session-start.sh` | CREATE | **Phase 1: staleness ping only** (R12d). Recovery checks defer to Phase 2. |
| `.claude/settings.json` | MODIFY | Update hook registrations |
| `lint:design` | HARDEN | Catch raw hex / `rgb()` / `hsl()` for colour values (regex-trivial). **Out of scope for this row:** AST-aware `style={{...}}` detection scoped to colour/spacing/typography — that's its own engineering task with its own plan. Path until then: code-quality-reviewer + frontend rules digest catches inline-style misuse at review time. |
| `CLAUDE.md` | MODIFY | See "CLAUDE.md migration scope" below — non-trivial restructuring, not a few one-line edits. |
| `docs/agent-workflow.md` | CREATE | Operating doc: brainstorm → plan → bd → /bd-execute → /bd-close-reviewed flow; rules-digest mechanism; brainstorming-split-into-sub-issues convention; Layer-2 implicit-dependency ruleset (C4); **preserved Task-Order rationale** (so the *why* of hard-gates survives); reviewer-override semantics + commit-trailer convention; **main-session contract on SessionStart hook output** — when the hook prints a stale-claim summary or dirty-tree warning, the main session must prompt the user with resume / abandon / inspect before doing anything else; the hook only emits, the session acts. (Phase-2-deferred) recovery checks land in the hook itself. |
| `(bd)` | MIGRATE | Walk surviving CLAUDE.md hard-gates; preserve rationale in `docs/agent-workflow.md`; encode dependencies as bd `blocked-by` relations; delete CLAUDE.md prose. |

#### CLAUDE.md migration scope

Restructuring, not one-line edits. Explicit decision per section:

**Move out to `docs/agent-rules/*.md`:**
- "Architecture Rules — Backend" → `agent-rules/backend.md`
- "Architecture Rules — Frontend" → `agent-rules/frontend.md`
- "Architecture Rules — Database" (repo-layer-only, schema-change protocol) → `agent-rules/backend.md` + `agent-rules/repo-boundary.md`
- "Architecture Rules — AI Integration" → `agent-rules/backend.md` (the per-user client + prompt-service rules belong there)
- "Architecture Rules — Encryption at Rest" → `agent-rules/repo-boundary.md` + `agent-rules/backend.md` (envelope model, request-scoped DEK, leak test)

**Keep in CLAUDE.md (orchestration, cross-lane, gate documentation):**
- Project Overview, Quick Start, Naming Conventions, Git Rules
- Task Completion Protocol (workflow), When to Stop and Ask (workflow)
- Testing Rules (test-suite *policy* is workflow, not lane-specific —
  e.g. "test DB only", "no `.skip`/`.only`", "mock Venice HTTP".
  Lane-specific test details — vitest config, jsdom vs. Playwright
  split, repo-layer-only integration tests — go in `backend.md` /
  `frontend.md` digests. Test rules end up in two places by design;
  this is split-by-purpose, not drift.)
- Docker & Infrastructure Rules (touched by every lane)
- Security Review (gate documentation pointing to surface reviewer)
- Repo-Boundary Review (gate documentation pointing to surface reviewer)
- Known Gotchas (cross-lane warnings)
- Architecture Rules — General (cross-lane: error responses, no server-wide Venice key, APP_ENCRYPTION_KEY policy, dependency-version policy)

**Cross-reference (replace deleted prose with one-liner):**
Each removed Architecture Rules subsection becomes a one-line pointer:
> *Backend rules live in `docs/agent-rules/backend.md` (read by
> implementer + code-quality-reviewer at dispatch time).*

Result: CLAUDE.md stays as the orchestration manual; `docs/agent-rules/`
becomes the single source of truth for lane-specific implementation
rules. Project-rule edits go into one place; agents pick them up
automatically on next dispatch.

### Phase 2 — Warnings + cross-session memory + recovery checks

| Path | Action | Notes |
|---|---|---|
| `.warnings-baseline.json` | CREATE | Single file; site hash per warning, not line-bound |
| `package.json` (root) | MODIFY | Add `warnings:baseline`, `warnings:baseline:add`, `warnings:check` |
| `scripts/bd-close-reviewed.sh` | EXTEND | Add `warnings:check` step |
| `docs/session-log.md` | CREATE | Append-only session digest (R12a) |
| `.claude/hooks/session-start.sh` | EXTEND | Add `bd list --claimed-by-me` stale-claim check + `git status --short` dirty-tree check (deferred from Phase 1; lands when an actual interrupted-run incident shows the failure mode is real, or proactively if Phase 1 surfaces it) |

### Unchanged across all phases

- `.claude/agents/security-reviewer.md`
- `.claude/agents/repo-boundary-reviewer.md`
- All superpowers plugin skills (used as-is)

---

## Phasing

### Phase 0 — Spike (gate)

Two-hour read-and-prove pass on superpowers' injection mechanism.
The whole project-customisation story rests on this. If neither a
config-file nor a skill-argument injection point is viable, the
fallback choices are unattractive (fork-by-copy of superpowers'
prompts, or rules-as-data injected into per-feature plan files),
and the digest mechanism may need redesign. **Phase 1 does not
start until Phase 0's memo is written.**

### Phase 1 — Keystone (the value)

The bridge from bd → superpowers + the path-matched surface reviewer
fan-out + the project-rule digest mechanism + hook fixes + C4
migration. After Phase 1, every bd issue with a plan link runs
through one uniform workflow that picks up project rules
automatically and gates on the right reviewers.

**Gate to Phase 2 (qualitative, not numeric):**
- Phase 1 has run on ~10 real bd issues end-to-end.
- No main-session rule-restating observed (the digest mechanism is
  carrying its weight).
- No per-task workflow improvisation (the loop holds).
- Informal token check: per-task cost is *not absurd* relative to
  the historical manual workflow. (Earlier draft proposed "≤2×
  baseline" — discarded as unmeasurable; the comparison includes
  the cost of the workflow change itself, and a precise threshold
  would invent precision the data can't support.)

### Phase 2 — Warnings + memory

Lands once Phase 1 has run. New warnings can't hide behind legacy
ones; cross-session orientation gets a 5–10-line digest.

### Phase 3 — Deferred indefinitely

Earlier drafts had a Phase 3 for cross-boundary skills (`/slice-plan`,
`/slice-verify`). Superpowers' `brainstorming` already produces
contract-explicit specs for cross-boundary work, and its
subagent-driven-development handles the per-task split. There is no
gap left for a slice-specific tool to fill. **Drop Phase 3 entirely
unless real work shows superpowers can't handle a particular cross-
boundary failure mode.**

---

## Verification

**Prerequisites:**
- PR70 is merged (`bd ready` returns issues; `[ -f
  .claude/skills/bd-close/SKILL.md ]`; no `pre-tasks-edit.sh`).
- Superpowers plugin is installed (it is — confirmed by user).
- **Phase 0 memo exists** at `docs/superpowers-injection-spike.md`,
  recording the chosen injection mechanism + no-op POC.

### Phase 0 verification

0. **Injection mechanism proven.** A digest file containing a
   sentinel string (e.g. `RULES-DIGEST-SENTINEL-XYZZY`) is reaching
   the implementer's effective prompt during a no-op task
   dispatch. Verifiable by adding a temporary `echo` step in a
   sacrificial implementer prompt that prints whether the sentinel
   is present, removed before any real task runs. Memo file
   exists and records both the mechanism chosen and any tradeoffs
   accepted.

### Phase 1 verification

1. **Rules digests load correctly.** Hand-craft a no-op task plan
   under `docs/superpowers/plans/test-`. Run `/bd-execute` against a
   matching test bd issue. Confirm: implementer's effective prompt
   includes the matching digest from `docs/agent-rules/`. (Inspect
   via debug logging or by adding a "echo $RULES_DIGEST | head -3"
   step in the bridge skill, removed before Phase 2.)

2. **`/bd-close-reviewed` smoke tests.**
   - Known-passing bd issue: typecheck pass, both surface reviewers
     SKIPPED-OUT-OF-LANE (because diff touches neither auth nor
     repos), bd issue closes.
   - Known-failing typecheck bd issue: refuse close, exit non-zero,
     bd state unchanged.
   - Known-passing-but-touches-auth diff: confirm `security-reviewer`
     fires, returns CLEAN, bd issue closes.
   - Known-passing-but-touches-repo diff: confirm
     `repo-boundary-reviewer` fires, returns CLEAN, bd issue closes.
   - Override path: introduce a known-false-positive BLOCK, run with
     `--override-block "<reason>"`, confirm user ack prompt fires,
     confirm override is recorded in bd notes.

3. **Hook smoke tests.**
   - **SubagentStop typecheck (C2):** invoke the superpowers
     implementer dispatch with a no-op task. Confirm typecheck
     fires once on agent stop, not per-Edit. Confirm a `git commit`
     from the main session also triggers via the `PreToolUse`
     matcher.
   - **SessionStart staleness (R12d):** start a session with
     `CLAUDE.md` `mtime` artificially older than the 5 most recent
     closed bd issues. Confirm the staleness warning prints. (The
     SessionStart recovery checks defer to Phase 2 — they verify
     there.)

4. **`lint:design` hardening:** confirm raw hex / `style={{...}}` for
   colour/spacing/typography fail `lint:design` (the syntactic
   checks that an earlier draft would have given to a separate
   reviewer agent).

5. **C4 migration:** CLAUDE.md "Task Order" prose is gone;
   `docs/agent-workflow.md` contains the preserved rationale + the
   Layer-2 ruleset; surviving hard-gates are encoded as bd
   `blocked-by` relations.

6. **End-to-end real task:** pick a real bd issue with a plan link,
   run `/bd-execute <id>`, watch the full loop. Confirm:
   - bd claim, plan loaded, digest picked correctly.
   - Superpowers' implementer + spec-reviewer + code-quality-
     reviewer fire as expected with project rules visible in their
     effective prompts.
   - SubagentStop typecheck fires at expected boundaries.
   - On loop CLEAN, `/bd-close-reviewed` runs, surface reviewers
     fan correctly by diff path, bd closes.
   - Main session diff review surfaces no surprises.

7. **Cost sanity:** spot-check token spend on a couple of Phase 1
   runs against historical manual-workflow runs of similar-shaped
   tasks. The check is qualitative — "this is in the same order
   of magnitude, accounting for explicit reviewer fan-out". Phase 2
   only proceeds if the qualitative gate (no rule-restating, no
   workflow improvisation, ~10 real tasks) is hit and the cost is
   not absurd. No fixed numeric threshold (the earlier draft's "≤2×"
   was unmeasurable; the comparison includes the cost of the
   workflow change itself).

8. **Override commit-trailer:** force a known-false-positive BLOCK
   on a sacrificial bd issue, run with `--override-block "<reason>"`,
   confirm both the bd note AND the next commit's trailer
   (`Reviewer-Override: <reviewer> — <reason>`) are recorded.

### Phase 2 verification

9. **Warnings baseline (C11):**
   - `npm run warnings:baseline` generates `.warnings-baseline.json`.
   - `npm run warnings:check` exits 0 against fresh baseline.
   - Introduce a fresh warning; re-run `warnings:check`; expect
     non-zero exit with the new site reported. Revert; expect 0.

10. **Session log:** `docs/session-log.md` exists with the Phase 2
    landing entry; subsequent sessions read the top 3 entries on
    startup (verifiable by inspecting main-session prompt).

11. **SessionStart recovery (deferred from Phase 1):** claim a bd
    issue, exit, start a new session. Confirm the recovery summary
    prints (claimed bd ID + dirty tree if any) and the main-session
    prompts the user before resuming a stale claim.

---

## What This Gets You

- **The C1 win is preserved.** `/bd-close-reviewed` automates the
  path-matched surface reviewer fan-out — `security-reviewer` and
  `repo-boundary-reviewer` stop being honour-system gates.
- **Project rules live in one place** (`docs/agent-rules/*.md`) and
  apply to both implementer and code-quality-reviewer dispatches via
  superpowers, with no agent files to maintain.
- **The plan→execute→review loop is the canonical superpowers loop.**
  No reinvention; no parallel workflow.
- **bd integration is one bridge skill**, not a roster of agents
  duplicating superpowers' work.
- **Recovery from interrupted runs is documented**, not improvised.
- **Main-session diff review is explicit.** Switchboard-with-no-eyes
  failure mode avoided by design.
- (Phase 2) New warnings can't hide; cross-session orientation has a
  short, hand-written digest.

---

## What This Does NOT Solve

- **Multimodal UI verification** (no screenshot-diff loop).
- **Long-running PR coordination** (use `subscribe_pr_activity`).
- **Cross-task refactors that span backend+frontend simultaneously**
  — superpowers' `brainstorming` produces the contract-explicit spec,
  but the implementer-loop still works one plan at a time.
- **Auto-summarising past sessions** (digests are hand-written; signal
  on auto-summaries is poor).

---

## Confirmed Decisions

- **Phase 0 spike is mandatory.** The digest injection mechanism
  is the load-bearing assumption; verifying it is a 2-hour read
  + no-op POC, not a "we'll figure it out" note.
- **One bd issue per plan, not per task.** Superpowers owns per-
  task state via TodoWrite during execution; bd tracks "feature
  in flight" between sessions. Verified non-issue at the
  granularity level: existing bd issues are feature-grained
  (migrated from TASKS.md feature descriptions), so one-plan-per-
  issue matches existing usage. Earlier "granularity conflict"
  concern was based on imagining bd issues as micro-tasks —
  they're not. `/bd-execute` claims at start; `/bd-close-reviewed`
  closes at end.
- **Brainstorming-split convention:** if brainstorming splits a bd
  issue into sub-features, create bd sub-issues with `blocked-by`
  edges, give each sub-issue its own plan link, parent bd issue
  closes after every child closes. Preserves the one-issue-per-
  plan invariant.
- **Brainstorm → plan → bd stitching:** `/bd-link-plan <bd-id>
  <plan-path>` skill (one mechanical line, called by brainstorming's
  final step or by hand) ensures the bd-issue → plan link doesn't
  get forgotten.
- **Reviewer override leaves a commit-trailer trace** in addition to
  the bd note, so `git log` and PR diffs show overrides.
- **CLAUDE.md migration is a real restructure**, not a few one-line
  edits. Architecture Rules — Backend / Frontend / Database / AI
  Integration / Encryption-at-Rest move out to
  `docs/agent-rules/*.md`; orchestration / cross-lane / gate
  documentation stays in CLAUDE.md.
- **Roster: zero new agent files.** Existing two reviewers
  (`security-reviewer`, `repo-boundary-reviewer`) keep their PR70
  prompts. All implementer / spec-reviewer / code-quality-reviewer
  work is owned by superpowers; project customisation lives in
  `docs/agent-rules/*.md` digests.
- **Earlier-draft agents dropped:** `task-planner`, `plan-critic`,
  `slice-architect`, `code-reviewer`, `spec-reviewer`,
  `design-token-reviewer`, `backend-engineer`, `frontend-engineer`,
  `test-author`. Each is covered by an existing superpowers skill, by
  rules digests, by `lint:design`, by surface reviewers, or by the
  user choosing the uniform workflow.
- **Project rules injected at dispatch time**, not by forking
  superpowers' prompts. Verified by reading
  `subagent-driven-development` — dispatch is prompt-template
  composition, not fixed subagent definitions.
- **Always via superpowers, no fast path for trivial tasks.** Uniform
  workflow. Confirmed user preference.
- **Hooks: two.** `SubagentStop` typecheck (C2) — fires after every
  agent stop, including spec-reviewer and code-quality-reviewer
  (which don't write code, so the typecheck is wasted there). This
  over-fire is an accepted cost: incremental typecheck is cheap, and
  filtering by agent type adds complexity not worth its weight at
  this stage. `SessionStart` Phase 1 ships staleness only (R12d);
  Phase 2 extends with recovery checks.
- **`/bd-close-reviewed` is the close gate**, not raw `bd close`.
  Path-matched reviewer fan-out; `--override-block` with user ack
  for the false-positive case.
- **Section letters retire as ordering** (C4); bd `blocked-by` graph
  authoritative; **rationale preserved** in `docs/agent-workflow.md`.
- **Phasing:** Phase 0 (injection-spike gate) → Phase 1 (the
  keystone, staleness ping only) → Phase 2 (warnings + memory +
  recovery checks) → no Phase 3 (cross-boundary skills not needed;
  superpowers brainstorming covers it).
- **SessionStart recovery deferred to Phase 2.** Defends against an
  unproven failure mode; staleness ping (R12d) is cheap and ships
  in Phase 1.
- **`lint:design` Phase 1 hardening is regex-only** (raw hex/rgb/hsl).
  AST-aware `style={{}}` detection is a separate engineering task,
  not folded into this plan; until then, code-quality-reviewer +
  frontend rules digest catches inline-style misuse at review time.
- **Cost gate is qualitative**, not numeric. Earlier draft's "≤2×"
  was unmeasurable.

---

## Sequencing Note

This plan **must land after PR70 is merged**. Reasons: (1)
`/bd-execute` and `/bd-close-reviewed` rely on bd being the live
task store; (2) the surface reviewers' bd-aware prompts ship in
PR70 and re-editing them here would conflict; (3) PR70 retires the
`pre-tasks-edit.sh` auto-tick hook this plan does not re-introduce.
If you want to start in parallel, branch from PR70's head
(`chore/beads-migration`) rather than `main`.

---

## Decision record (compressed history)

This plan went through three drafts. The earlier drafts proposed
larger rosters; each was reduced as new information came in. Recorded
here so the *why* of the cuts survives:

**Draft 1 (eight agents).** Original proposal: `backend-engineer`,
`frontend-engineer`, `code-reviewer`, `design-token-reviewer`,
`task-planner`, `slice-architect`, plus the existing two reviewers,
plus a `test-author`. Cross-cutting tooling: `/bd-close-reviewed`,
warnings baseline, four cross-session memory conventions, two hooks.

**Draft 2 cuts (external review):**
- `test-author` dropped (C5a — implementers write their own tests
  per the user's TDD reading).
- `design-token-reviewer` dropped (three of four checks belong in
  `lint:design`; fourth folds into code-reviewer's R9b conformance).
- `slice-architect` demoted to skills (`/slice-plan`,
  `/slice-verify`); cross-boundary volume unproven.
- R7a (two-pass plan critique) dropped — same-window critique is
  theatre.
- R12b lessons prompt and R12c pin:area labels dropped — optional
  rituals decay.
- Per-tool warnings baseline variants dropped — single file until
  a tool's hashing demands otherwise.
- Phasing introduced — front-loading 8 agents before any had been
  validated against real work was a meta-mistake.

**Draft 3 cuts (superpowers reframe):**
- `task-planner`, `plan-critic`, `code-reviewer`, `spec-reviewer`
  all dropped — covered by superpowers `writing-plans`,
  `brainstorming`, `subagent-driven-development`.
- `backend-engineer` and `frontend-engineer` agent files dropped —
  rules digests injected at dispatch time cover the customisation
  need without forking superpowers' implementer prompt.
- `slice-architect` skills dropped entirely — `brainstorming`
  produces contract-explicit specs for cross-boundary work; the
  Phase 3 tooling has no remaining gap to fill.
- Phase 0 (install superpowers) retired — superpowers is installed
  as a Claude Code plugin, not a project dependency.
- bd ↔ superpowers integration reduced to "one bd issue per plan"
  + `/bd-execute` bridge skill — verified necessary because
  superpowers manages per-task state in TodoWrite, not externally.

**Draft 4 refinements (this review pass):**
- Phase 0 spike added — the digest injection mechanism is unverified
  and load-bearing; a 2-hour read + POC is required before Phase 1.
- bd-issue-per-plan granularity question dropped after user
  clarification: bd issues are feature-grained from the
  TASKS.md migration, so the "one issue per plan" invariant
  matches existing usage.
- `/bd-link-plan` skill added to close the brainstorm → plan → bd
  stitching gap (a small mechanical line that would otherwise be
  forgotten).
- Brainstorming-split-into-sub-issues convention added: split into
  bd sub-issues with `blocked-by` edges, each with its own plan;
  parent closes when children close.
- Override gets a commit-trailer in addition to the bd note, so
  `git log` and PR diffs show the trace.
- CLAUDE.md migration scope spelled out section-by-section
  (move-out / keep / cross-reference); not a few one-line edits.
- Cost gate qualitative, not numeric (`≤2×` discarded as
  unmeasurable).
- `lint:design` Phase 1 hardening narrowed to regex-trivial checks;
  AST-aware `style={{}}` detection deferred as a separate task.
- SessionStart recovery checks deferred from Phase 1 to Phase 2;
  staleness ping (R12d) ships in Phase 1.

**Surviving from all four drafts:**
- C1 (path-matched surface reviewer fan-out) — keystone.
- C2 (SubagentStop hook trigger) — pure mechanics fix.
- C4 (CLAUDE.md Task Order → bd graph + rationale preservation).
- R6a (docs-MCP-before-muscle-memory) — now lives in rules digests.
- R9a/b (sibling-conformance) — now lives in rules digests + read
  by code-quality-reviewer at dispatch time.
- C11 (warnings baseline) — Phase 2.
- R12a + R12d (session log + staleness ping) — Phase 2 + Phase 1
  hook respectively.
- Recovery protocol for interrupted runs.
- Reviewer-override semantics with user ack.
- Main-session diff-review explicit step.
- Cost baseline measurement before Phase 2.
