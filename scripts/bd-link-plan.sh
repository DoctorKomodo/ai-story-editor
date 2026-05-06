#!/usr/bin/env bash
# bd-link-plan.sh — Record `plan: <path>` at the top of a bd issue's
# notes, preserving any existing notes lines (in particular, the
# `verify:` line). Idempotent: replaces an existing `plan:` line if
# already present.
#
# Usage: bd-link-plan.sh <bd-id> <plan-path>

set -uo pipefail

if [ $# -lt 2 ]; then
  echo "Usage: $(basename "$0") <bd-id> <plan-path>" >&2
  exit 1
fi

ID="$1"
PLAN="$2"

if [ ! -f "$PLAN" ]; then
  echo "✘ plan file not found: $PLAN" >&2
  exit 2
fi

NOTES="$(bd show "$ID" --json 2>/dev/null \
  | jq -r 'if type == "array" and length > 0 then (.[0].notes // "") else "" end' 2>/dev/null)"
if ! bd show "$ID" --json >/dev/null 2>&1; then
  echo "✘ no such issue: $ID" >&2
  exit 2
fi

# Drop any existing plan: line; new plan: line goes on top.
WITHOUT_PLAN="$(printf '%s\n' "$NOTES" | grep -v '^plan:' || true)"
NEW_NOTES="$(printf 'plan: %s\n%s' "$PLAN" "$WITHOUT_PLAN")"

bd update "$ID" --notes "$NEW_NOTES"
echo "✔ $ID → plan: $PLAN"
