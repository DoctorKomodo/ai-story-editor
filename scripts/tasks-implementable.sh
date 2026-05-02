#!/usr/bin/env bash
# List open tasks in TASKS.md that are ready to start: have a `plan:` or
# `trivial:` line AND a `verify:` line.
# Output format: one line per task, "<ID> [planned|trivial] <description-first-72-chars>".
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TASKS_FILE="${1:-$ROOT_DIR/TASKS.md}"
awk '
  /^- \[[x ]\] \*\*\[/ {
    if (id) emit()
    open = ($0 ~ /^- \[ \]/)
    id=$0; sub(/^- \[[x ]\] \*\*\[/,"",id); sub(/\].*/,"",id)
    desc=$0; sub(/^- \[[x ]\] \*\*\[[^\]]+\]\*\* /,"",desc)
    has_plan=0; has_trivial=0; has_verify=0
    next
  }
  /^  - plan:/    { has_plan=1 }
  /^  - trivial:/ { has_trivial=1 }
  /^  - verify:/  { has_verify=1 }
  END { if (id) emit() }
  function emit() {
    if (open && has_verify && (has_plan || has_trivial)) {
      kind = has_plan ? "planned" : "trivial"
      printf "%-6s %-8s %s\n", id, kind, substr(desc, 1, 72)
    }
  }
' "$TASKS_FILE"
