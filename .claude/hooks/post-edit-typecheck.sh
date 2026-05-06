#!/usr/bin/env bash
# Runs tsc --noEmit per affected workspace, triggered by:
#   - SubagentStop  — fires after any subagent stops; checks working tree for
#                      changed .ts(x) files and typechecks the matching workspace.
#   - PreToolUse Bash with command = `git commit` — same check, before the
#                      commit lands.
#
# Silent on success; prints diagnostics to stderr on failure (exit 2 blocks).
#
# (Phase 1B of docs/multi-agent-workflow-plan.md: trigger config moved off
# PostToolUse Edit|Write|MultiEdit, which fired per-file during multi-file
# changes. SubagentStop + PreToolUse(git commit) gives one fire per natural
# checkpoint instead.)
set -u

INPUT=$(cat)

if command -v jq >/dev/null 2>&1; then
  EVENT=$(printf '%s' "$INPUT" | jq -r '.hook_event_name // empty')
  TOOL=$(printf '%s' "$INPUT"  | jq -r '.tool_name // empty')
  CMD=$(printf '%s' "$INPUT"   | jq -r '.tool_input.command // empty')
else
  EVENT=$(printf '%s' "$INPUT" | grep -oP '"hook_event_name"\s*:\s*"\K[^"]+' | head -n1)
  TOOL=$(printf '%s' "$INPUT"  | grep -oP '"tool_name"\s*:\s*"\K[^"]+' | head -n1)
  CMD=$(printf '%s' "$INPUT"   | grep -oP '"command"\s*:\s*"\K[^"]+'   | head -n1)
fi

case "${EVENT:-}" in
  SubagentStop)
    ;;
  PreToolUse)
    [ "${TOOL:-}" = "Bash" ] || exit 0
    case "${CMD:-}" in
      "git commit"|"git commit "*) ;;
      *) exit 0 ;;
    esac
    ;;
  *)
    exit 0
    ;;
esac

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}" || exit 0

DIRTY=$(git status --porcelain 2>/dev/null | awk '{print $NF}')
[ -z "$DIRTY" ] && exit 0

run_ws() {
  local ws="$1"
  local out code
  out=$(cd "$ws" && npx --no-install tsc -b --noEmit 2>&1)
  code=$?
  if [ "$code" -ne 0 ]; then
    echo "tsc --noEmit failed in $ws:" >&2
    echo "$out" >&2
    return 2
  fi
  return 0
}

EXIT=0
if echo "$DIRTY" | grep -qE '^backend/.*\.tsx?$'; then
  run_ws "backend" || EXIT=2
fi
if echo "$DIRTY" | grep -qE '^frontend/.*\.tsx?$'; then
  run_ws "frontend" || EXIT=2
fi
exit "$EXIT"
