---
name: task-verify
description: Run the `verify:` command for a bd issue by its ID (e.g. story-editor-9vm) and report the true exit code — without letting `grep -iv error` or other pipeline tricks mask a failure. Use before `/bd-close <id>` to confirm work is done. User-invocable as `/task-verify <BD_ID>`.
---

# task-verify

Looks up the `verify:` command in a bd issue's `--notes` (first line matching `^verify:[ \t]*(.*)$`), runs it with `bash -o pipefail`, and reports the actual exit code.

This exists because verify commands often pipe through `grep -iv error` or similar filters that can silently hide a failing step. `pipefail` makes the pipeline fail if *any* stage fails, not just the last one.

## Inputs

One argument: the bd issue ID, e.g. `story-editor-9vm`.

## Steps

1. Read the bd ID from `$1` (or the slash-command argument).
2. Run `bd show <id> --json` and extract the first `verify:` line from `.notes`.
3. If the verify is `TBD …`, `design decision …`, or empty → exit 2 with a clear "no automated verify" message (distinct from a real failure).
4. Otherwise, print the command that will run, then execute it with `bash -o pipefail -c "<cmd>"`.
5. Report the exit code. Exit 0 only if the command exited 0.

## Usage

```bash
# User slash form
/task-verify story-editor-9vm

# Direct shell form (what the slash command runs under the hood)
bash .claude/skills/task-verify/run.sh story-editor-9vm
```

## Notes for Claude

- If the user asks you to close a task, run `/task-verify <id>` first, then `/bd-close <id>` only if the verify exits 0. `/bd-close` runs the same gate internally — you can skip the standalone verify if you're going straight to close.
- If the verify command needs interactive input or a TTY (e.g. `prisma migrate dev`), `task-verify` will surface that as a real failure — don't paper over it; find a non-interactive equivalent.
- When a verify passes, paste the trailing summary line(s) from the run into your reply so the user sees the evidence.
- Verify-line convention in bd `--notes`: a single line starting with `verify:`, the runnable command on the rest of that line. Multi-line commands go on one line via `&&` / `;`. The first matching line wins.
