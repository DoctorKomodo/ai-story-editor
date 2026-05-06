#!/usr/bin/env bash
# Run the verify command for a bd issue and report the true exit code.
# Usage: .claude/skills/task-verify/run.sh <bd-id>
#
# Verify lookup: first line in `bd show <id> --json` notes matching
#   ^verify:[ \t]*(.*)$
# is the runnable command. Runs with `bash -o pipefail -c "$CMD"` so
# pipeline failures aren't masked by the last stage's exit code.

set -uo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $(basename "$0") <bd-id>" >&2
  exit 1
fi

ID="$1"
ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"

NOTES="$(bd show "$ID" --json 2>/dev/null | jq -r 'if type == "array" and length > 0 then (.[0].notes // "") else "" end' 2>/dev/null)"
if [ -z "$NOTES" ]; then
  echo "✘ no such issue or empty notes: $ID" >&2
  exit 2
fi

CMD="$(printf '%s\n' "$NOTES" | awk '/^verify:/ {sub(/^verify:[ \t]*/, ""); print; exit}')"

case "$CMD" in
  ""|"TBD"*|"design decision"*|"<TBD>"*)
    echo "✘ no automated verify for $ID (got: ${CMD:-<empty>})" >&2
    exit 2
    ;;
esac

echo "▶ task-verify [$ID]"
echo "▶ cwd: $ROOT_DIR"
echo "▶ cmd: $CMD"
echo "──────────────────────────────────────────────"

cd "$ROOT_DIR"
bash -o pipefail -c "$CMD"
rc=$?

echo "──────────────────────────────────────────────"
if [ $rc -eq 0 ]; then
  echo "✔ task-verify [$ID] passed (exit 0)"
else
  echo "✘ task-verify [$ID] FAILED (exit $rc)"
fi
exit $rc
