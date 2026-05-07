---
name: bd-close
description: Gate-then-close a bd issue — runs the issue's `verify:` line via pipefail, only calls `bd close` if it exits 0. Use after `/task-verify` to commit a task as done. User-invocable as `/bd-close <BD_ID>`.
---

# bd-close

Wraps `scripts/bd-close-verified.sh`. Runs the verify line for the given bd issue, and if it exits 0, marks the issue closed via `bd close`.

For "no automated verify" cases (`TBD …`, `design decision …`, empty), refuses to close unless `--force` is passed.

This is the bookkeeping replacement for the retired `pre-tasks-edit.sh` hook — instead of gating an edit to TASKS.md, it gates the `bd close` call.

## Inputs

One required: bd issue ID (e.g. `story-editor-9vm`).

Optional:
- `--reason="..."` — recorded on `bd close`.
- `--force` — close even if no automated verify is defined.

## Steps

1. Read the bd ID from `$1`.
2. Run `scripts/bd-close-verified.sh "$@"`.
3. Report the wrapped exit code.

## Usage

```bash
# User slash form
/bd-close story-editor-9vm
/bd-close story-editor-h1i --force --reason="design decision recorded in docs/venice-integration.md"

# Direct shell form
bash scripts/bd-close-verified.sh story-editor-9vm
```

## Notes for Claude

- Use `/task-verify <id>` first to confirm the verify passes; only invoke `/bd-close` when ready to commit the close.
- A failing verify exits non-zero and the issue stays open — fix the code, don't bypass.
- `--force` is for design-only or research-only tasks that legitimately have no automated verify. Do not use it to bypass a failing verify.
- When close succeeds, paste the trailing summary line(s) so the user sees the evidence.
