#!/usr/bin/env bash
# Print the `verify:` command for a given TASKS.md task ID.
# Usage: scripts/extract-verify.sh <TASK_ID> [TASKS_FILE]
# Exits 0 on match, 2 if no verify line found, 1 on argument/IO error.

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $(basename "$0") <TASK_ID> [TASKS_FILE]" >&2
  exit 1
fi

TASK_ID="$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TASKS_FILE="${2:-$ROOT_DIR/TASKS.md}"

if [ ! -f "$TASKS_FILE" ]; then
  echo "TASKS file not found: $TASKS_FILE" >&2
  exit 1
fi

# Match the task header line (captures the ID in **[...]**) and then the first
# `- verify: \`...\`` line that follows before any other task bullet.
python3 - "$TASK_ID" "$TASKS_FILE" <<'PY'
import re
import sys

task_id, path = sys.argv[1], sys.argv[2]
task_id = task_id.upper()

header_re = re.compile(r'^\-\s*\[[ x]\]\s*\*\*\[([A-Za-z0-9]+)\]\*\*')
verify_re = re.compile(r'^\s*-\s*verify:\s*`(.*)`\s*$')

in_task = False
found = False
with open(path, encoding='utf-8') as f:
    for line in f:
        m = header_re.match(line)
        if m:
            in_task = (m.group(1).upper() == task_id)
            if found:
                break
            continue
        if in_task:
            v = verify_re.match(line)
            if v:
                print(v.group(1))
                found = True
                break

if not found:
    print(f'No verify: line for task {task_id} in {path}', file=sys.stderr)
    sys.exit(2)
PY
