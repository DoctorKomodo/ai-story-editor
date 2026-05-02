#!/usr/bin/env bash
# List open tasks in TASKS.md that have neither a `plan:` nor a `trivial:` line.
# Output format: one line per task, "<ID>  <description-first-80-chars>".
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TASKS_FILE="${1:-$ROOT_DIR/TASKS.md}"
awk '
  /^- \[[x ]\] \*\*\[/ {
    if (id) emit()
    open = ($0 ~ /^- \[ \]/)
    id=$0; sub(/^- \[[x ]\] \*\*\[/,"",id); sub(/\].*/,"",id)
    desc=$0; sub(/^- \[[x ]\] \*\*\[[^\]]+\]\*\* /,"",desc)
    has_plan=0; has_trivial=0
    next
  }
  /^  - plan:/    { has_plan=1 }
  /^  - trivial:/ { has_trivial=1 }
  END { if (id) emit() }
  function emit() {
    if (open && !has_plan && !has_trivial) printf "%-6s %s\n", id, substr(desc, 1, 80)
  }
' "$TASKS_FILE"
