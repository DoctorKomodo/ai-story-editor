---
name: task-verify
description: Run the `verify:` command for a TASKS.md task by its ID (e.g. AU1, D7) and report the true exit code — without letting `grep -iv error` or other pipeline tricks mask a failure. Use before marking any task `[x]`. User-invocable as `/task-verify <TASK_ID>`.
---

# task-verify

Looks up the `verify:` command belonging to a task ID in `TASKS.md`, runs it with `bash -o pipefail`, and reports the actual exit code.

This exists because `TASKS.md` verify commands often pipe through `grep -iv error` or similar filters that can silently hide a failing step (ask me how I know — see D7). `pipefail` makes the pipeline fail if *any* stage fails, not just the last one.

## Inputs

One argument: the task ID (case-insensitive), e.g. `AU1`, `d7`, `S10`.

## Steps

1. Read the task ID from `$1` (or the slash-command argument).
2. Resolve `TASKS_FILE` — defaults to `TASKS.md` at the repo root.
3. Use the helper script `scripts/extract-verify.sh` to print the `verify:` command for that task ID. If no match, exit 2 with a clear message.
4. Print the command that will run, then execute it with `bash -o pipefail -c "<cmd>"`.
5. Report the exit code. Exit 0 only if the command exited 0.

## Usage

```bash
# User slash form
/task-verify AU1

# Direct shell form (what the slash command runs under the hood)
bash .claude/skills/task-verify/run.sh AU1
```

## Notes for Claude

- If the user asks you to mark a task `[x]`, run `task-verify <ID>` first and only edit `TASKS.md` if it exits 0.
- If the verify command needs interactive input or a TTY (e.g. `prisma migrate dev`), `task-verify` will surface that as a real failure — don't paper over it; find a non-interactive equivalent (like we did for D7 with `prisma migrate diff`).
- When a verify passes, paste the trailing summary line(s) from the run into your reply so the user sees the evidence.
