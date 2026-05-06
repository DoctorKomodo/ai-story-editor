---
name: bd-close-reviewed
description: Close a bd issue through the project's review gate — typecheck affected workspaces, fan path-matched surface reviewers (security-reviewer, repo-boundary-reviewer), refuse close on BLOCK / FIX_BEFORE_MERGE unless `--override-block "<reason>"` with user ack. Called by `/bd-execute` at end-of-loop, or directly when work didn't go through `/bd-execute`. User-invocable as `/bd-close-reviewed <BD_ID>`.
---

# bd-close-reviewed

The close gate for bd issues. Wraps `scripts/bd-close-reviewed.sh` with the agent-driven pieces (surface reviewer fan-out, override user-ack) that shell can't do.

This skill is what `/bd-execute` calls at the end of the superpowers loop. It can also be invoked directly when an implementation didn't go through `/bd-execute` (e.g. a one-off bug fix the user did by hand).

## Inputs

One required: bd issue ID (e.g. `story-editor-9vm`).

Optional flags forwarded to the script:
- `--reason="..."` — recorded on `bd close`.
- `--override-block="<reviewer> — <reason>"` — accept a surface reviewer's BLOCK / FIX_BEFORE_MERGE (after user ack). Records on bd notes **and** creates an empty commit with a `Reviewer-Override:` trailer.

## Steps

### 1. Typecheck affected workspaces

Run:

```bash
bash scripts/bd-close-reviewed.sh <id> --phase=typecheck
```

The script runs `npm --prefix backend run typecheck` and / or `npm --prefix frontend run typecheck` based on which workspace(s) appear in the branch diff. If exit code is non-zero, **stop and refuse close** — the issue stays open and the typecheck failure is the user's next action.

### 2. Compute path-matched reviewers

Run:

```bash
bash scripts/bd-close-reviewed.sh <id> --phase=affected
```

The script prints zero or more reviewer names, one per line:

- `security-reviewer` — when the diff touches auth / crypto / middleware / Venice-key routes.
- `repo-boundary-reviewer` — when the diff touches the narrative-entity boundary (repos, narrative routes, content-crypto, prompt-service, or migrations on narrative tables).

If the output is empty, both reviewers are SKIPPED-OUT-OF-LANE for this diff. Proceed straight to step 5.

### 3. Dispatch matching reviewers in parallel

For each printed reviewer name, dispatch via the Agent tool **in a single message with multiple tool calls** (parallel). Use the matching `subagent_type`:

- `security-reviewer` → `subagent_type: "security-reviewer"`
- `repo-boundary-reviewer` → `subagent_type: "repo-boundary-reviewer"`

The prompt should describe the bd issue and scope the reviewer to the diff on this branch. A good shape:

```
Review the changes on branch `<current-branch>` against `main`.
Scope: <brief one-liner about the bd issue's intent>.
This is the close-gate run for bd issue <id>; the implementer + spec
+ code-quality review have already passed (or this work didn't go
through /bd-execute). Look for the `<reviewer-specific>` invariants
the project's CLAUDE.md and `docs/agent-rules/` are concerned with.

Report findings with `BLOCK | FIX_BEFORE_MERGE | NIT | OK` priorities
and `file:line` evidence. CLEAN means no `BLOCK` and no
`FIX_BEFORE_MERGE`.
```

(Both reviewer agent definitions already enforce their own scope; the prompt above just sets the boundary.)

### 4. Decide on override (if any reviewer returns BLOCK / FIX_BEFORE_MERGE)

If any reviewer returns BLOCK or FIX_BEFORE_MERGE: **refuse close** by default.

The user can request override with `--override-block "<reviewer> — <reason>"`. If they do:

1. Confirm with the user: "OK to override `<reviewer>` BLOCK with reason: '`<reason>`'? [yes / no]". Wait for confirmation. Frequent overrides indicate reviewer prompt drift, not normal flow — say so if it's the second override in the same week.
2. On `yes`: proceed to step 5 with the override flag.
3. On `no` or anything else: stop, leave the bd issue open.

Do not silently override. Do not assume `--override-block` was authorised in advance — the flag arms the override; user ack pulls the trigger.

### 5. Run the close

```bash
bash scripts/bd-close-reviewed.sh <id> --phase=close \
  [--reason="..."] \
  [--override-block="<reviewer> — <reason>"]
```

The script:
- If `--override-block`: appends an `override:` line to the bd notes, then creates an empty commit with a `Reviewer-Override:` trailer (visible in `git log` and PR diffs).
- Calls `bd close <id>` (with `--reason` if supplied).

On success: paste the trailing summary lines from the script output so the user sees the close took.

## Spec / code-quality review is **not** this skill's job

Those are owned by superpowers `subagent-driven-development` (and run as part of `/bd-execute`). This skill runs only the **additional** path-matched surface reviews (`security-reviewer`, `repo-boundary-reviewer`) plus the typecheck and the close.

If the bd issue did **not** flow through `/bd-execute` (manual implementation), the spec / code-quality review is the user's call — this skill won't insist on them, but it'll still gate on the surface reviewers and typecheck.

## Forbidden

- Calling `bd close` directly without going through `--phase=close` (skips the bd-notes override recording on the override path).
- Treating a BLOCK / FIX_BEFORE_MERGE as a NIT to dodge user ack.
- Auto-arming `--override-block` because a reviewer "is being annoying" — that is the failure mode the user-ack guards against.
- Running the surface reviewers when the script's `--phase=affected` returned empty (waste of tokens; they self-report SKIPPED-OUT-OF-LANE anyway, but the skill should respect the diff path mapping).

## Phase-2 extension (deferred)

When the warnings baseline lands (Phase 2), step 1 grows to also run `npm run warnings:check` and refuse close on new-warning regressions. This skill's body does not need to change yet; the script will gain a `--phase=warnings` step and step 1 in this skill will document running it before close.
