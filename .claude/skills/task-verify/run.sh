#!/usr/bin/env bash
# Run the verify command for a TASKS.md task and report the true exit code.
# Usage: .claude/skills/task-verify/run.sh <TASK_ID>

set -uo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $(basename "$0") <TASK_ID>" >&2
  exit 1
fi

TASK_ID="$1"
ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
EXTRACT="$ROOT_DIR/scripts/extract-verify.sh"

if [ ! -x "$EXTRACT" ]; then
  chmod +x "$EXTRACT" 2>/dev/null || true
fi

CMD="$("$EXTRACT" "$TASK_ID")"
status=$?
if [ $status -ne 0 ] || [ -z "$CMD" ]; then
  exit $status
fi

echo "▶ task-verify [$TASK_ID]"
echo "▶ cwd: $ROOT_DIR"
echo "▶ cmd: $CMD"
echo "──────────────────────────────────────────────"

cd "$ROOT_DIR"
bash -o pipefail -c "$CMD"
rc=$?

echo "──────────────────────────────────────────────"
if [ $rc -eq 0 ]; then
  echo "✔ task-verify [$TASK_ID] passed (exit 0)"
else
  echo "✘ task-verify [$TASK_ID] FAILED (exit $rc)"
fi
exit $rc
