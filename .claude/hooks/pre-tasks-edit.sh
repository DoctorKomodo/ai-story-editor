#!/usr/bin/env bash
# PreToolUse hook: refuses Edit/Write/MultiEdit on TASKS.md when the proposed
# change introduces `[x]` on a task whose `verify:` command does not pass.
#
# Hook protocol (Claude Code):
#   stdin:  JSON payload (tool_name, tool_input, …)
#   exit 0: allow the tool call
#   exit 2: block the tool call (stderr is surfaced to Claude as feedback)
#   other:  non-blocking error (shown to user, tool still proceeds)

set -uo pipefail

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$HOOK_DIR/../.." && pwd)"
LOG="$ROOT_DIR/.claude/logs/pre-tasks-edit.log"
mkdir -p "$(dirname "$LOG")"
log() { printf '[%s] %s\n' "$(date -Iseconds)" "$*" >> "$LOG"; }

PAYLOAD="$(cat)"
TOOL="$(printf '%s' "$PAYLOAD" | jq -r '.tool_name // empty')"
FILE="$(printf '%s' "$PAYLOAD" | jq -r '.tool_input.file_path // empty')"

case "$TOOL" in
  Edit|Write|MultiEdit) ;;
  *) exit 0 ;;
esac

case "$FILE" in
  "$ROOT_DIR"/TASKS.md|"$ROOT_DIR"/*/TASKS.md) ;;
  *) exit 0 ;;
esac

log "triggered: tool=$TOOL file=$FILE"

# Figure out which task IDs the proposed change is *newly* marking [x].
NEW_IDS="$(printf '%s' "$PAYLOAD" | python3 "$HOOK_DIR/extract-new-ids.py" "$FILE")"

if [ -z "${NEW_IDS//[[:space:]]/}" ]; then
  log "no newly-completed task IDs in diff; allowing"
  exit 0
fi

log "newly-completed IDs: $(echo "$NEW_IDS" | tr '\n' ' ')"

failures=()
while IFS= read -r tid; do
  [ -z "$tid" ] && continue
  if ! CMD="$("$ROOT_DIR/scripts/extract-verify.sh" "$tid" "$FILE" 2>&1)"; then
    log "no verify command for $tid: $CMD"
    failures+=("$tid: no verify command found ($CMD)")
    continue
  fi
  if [ -z "$CMD" ]; then
    failures+=("$tid: empty verify command")
    continue
  fi
  log "running verify for $tid: $CMD"
  out="$(cd "$ROOT_DIR" && bash -o pipefail -c "$CMD" 2>&1)"
  rc=$?
  if [ $rc -ne 0 ]; then
    log "verify FAILED for $tid (rc=$rc)"
    tail_out="$(printf '%s\n' "$out" | tail -n 15)"
    failures+=("$tid (exit $rc):
$tail_out")
  else
    log "verify OK for $tid"
  fi
done <<< "$NEW_IDS"

if [ ${#failures[@]} -eq 0 ]; then
  log "all verify commands passed; allowing edit"
  exit 0
fi

{
  echo "Refusing to mark task(s) [x] — verify command(s) failed."
  echo "Run the verify commands locally, fix the code until they pass, then retry the edit."
  echo
  for f in "${failures[@]}"; do
    printf -- '---\n%s\n' "$f"
  done
  echo "---"
  echo "(Hook log: .claude/logs/pre-tasks-edit.log)"
} >&2

exit 2
