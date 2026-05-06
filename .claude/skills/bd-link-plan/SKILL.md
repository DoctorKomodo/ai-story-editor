---
name: bd-link-plan
description: Record a `plan: <path>` link at the top of a bd issue's notes, preserving existing notes (especially the `verify:` line). Use after `superpowers:writing-plans` lands a plan file, before `/bd-execute`. User-invocable as `/bd-link-plan <BD_ID> <PLAN_PATH>`.
---

# bd-link-plan

Wraps `scripts/bd-link-plan.sh`. Sets the `plan: <path>` line at the top of a bd issue's notes so `/bd-execute` can find it.

Idempotent: replaces any existing `plan:` line. Other lines in `--notes` (notably `verify:`) are preserved.

## Inputs

Two required:

1. bd issue ID (e.g. `story-editor-9vm`)
2. Plan path, relative to repo root (e.g. `docs/superpowers/plans/2026-05-06-feature-x.md`)

## Steps

1. Validate the plan file exists at the given path.
2. Read the issue's current `--notes` via `bd show <id> --json`.
3. Strip any existing `plan:` line.
4. Prepend the new `plan: <path>` line.
5. Write back via `bd update <id> --notes "<new content>"`.

## Usage

```bash
# User slash form
/bd-link-plan story-editor-9vm docs/superpowers/plans/2026-05-06-stories-pagination.md

# Direct shell form
bash scripts/bd-link-plan.sh story-editor-9vm docs/superpowers/plans/2026-05-06-stories-pagination.md
```

## Notes for Claude

- Run this after `superpowers:writing-plans` writes the plan file. The
  `superpowers:brainstorming` skill should produce a spec; `writing-plans`
  produces the plan; this skill links the plan to the bd issue.
- Used in the brainstorming-split convention too: when brainstorming
  splits a parent bd issue into sub-features, each sub-issue gets its
  own plan via this skill; the parent stays plan-less and acts as a
  coordinator.
- `/bd-execute` errors on a bd issue without a `plan:` line — this skill
  is the way to get one there.
