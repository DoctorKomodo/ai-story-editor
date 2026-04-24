#!/usr/bin/env bash
# Runs tsc --noEmit scoped to the edited workspace.
# Silent on success; prints diagnostics to stderr on failure (exit 2 blocks).
set -u

INPUT=$(cat)

if command -v jq >/dev/null 2>&1; then
  FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')
else
  FILE_PATH=$(printf '%s' "$INPUT" | grep -oP '"file_path"\s*:\s*"\K[^"]+' | head -n1)
fi

[ -z "${FILE_PATH:-}" ] && exit 0

case "$FILE_PATH" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac

case "$FILE_PATH" in
  *"/backend/"*) WS="$CLAUDE_PROJECT_DIR/backend" ;;
  *"/frontend/"*) WS="$CLAUDE_PROJECT_DIR/frontend" ;;
  *) exit 0 ;;
esac

OUT=$(cd "$WS" && npx --no-install tsc --noEmit 2>&1)
CODE=$?
if [ $CODE -ne 0 ]; then
  echo "tsc --noEmit failed in $WS:" >&2
  echo "$OUT" >&2
  exit 2
fi
exit 0
