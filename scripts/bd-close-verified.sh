#!/usr/bin/env bash
# Gate-then-close a bd issue: runs the issue's verify: line and only
# calls `bd close` if it exits 0. Mirrors /task-verify but for the
# close action.
#
# Usage: bd-close-verified.sh <bd-id> [--reason="..."] [--force]
#
# Verify lookup: first line in the issue's --notes matching
#   ^verify:[ \t]*(.*)$
# is the runnable command. "TBD …", "design decision …", or empty
# means no automated verify; closing requires --force.

set -uo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $(basename "$0") <bd-id> [--reason=...] [--force]" >&2
  exit 1
fi

ID="$1"; shift
FORCE=0
REASON_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=1 ;;
    --reason=*) REASON_ARGS+=("$1") ;;
    --reason) REASON_ARGS+=("--reason=$2"); shift ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
  shift
done

NOTES="$(bd show "$ID" --json 2>/dev/null | jq -r 'if type == "array" and length > 0 then (.[0].notes // "") else "" end' 2>/dev/null)"
if [ -z "$NOTES" ]; then
  echo "✘ no such issue or empty notes: $ID" >&2
  exit 2
fi

CMD="$(printf '%s\n' "$NOTES" | awk '/^verify:/ {sub(/^verify:[ \t]*/, ""); print; exit}')"

case "$CMD" in
  ""|"TBD"*|"design decision"*|"<TBD>"*)
    if [ "$FORCE" -ne 1 ]; then
      echo "✘ no automated verify for $ID (got: ${CMD:-<empty>})" >&2
      echo "  use --force to close anyway." >&2
      exit 2
    fi
    echo "▶ no automated verify for $ID; closing with --force"
    bd close "$ID" "${REASON_ARGS[@]}"
    exit $?
    ;;
esac

echo "▶ bd-close-verified [$ID]"
echo "▶ cmd: $CMD"
echo "──────────────────────────────────────────────"

if bash -o pipefail -c "$CMD"; then
  echo "──────────────────────────────────────────────"
  echo "✔ verify passed; calling bd close"
  bd close "$ID" "${REASON_ARGS[@]}"
  exit $?
else
  rc=$?
  echo "──────────────────────────────────────────────"
  echo "✘ verify FAILED for $ID (exit $rc); refusing to close" >&2
  exit $rc
fi
