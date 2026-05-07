#!/usr/bin/env bash
# session-start.sh — Phase 1 of multi-agent workflow plan.
#
# Emit-only SessionStart hook. The main session is responsible for
# acting on the output (per docs/agent-workflow.md "Main-session
# contract on SessionStart hook output").
#
# Phase 1 ships:
#   - CLAUDE.md staleness ping (R12d) — warn when CLAUDE.md mtime is
#     older than the oldest of the 5 most-recent closed bd issues.
#     Signal: "≥5 issues have closed since CLAUDE.md was last
#     touched, consider a refresh before the next implementer
#     dispatch since the digests + CLAUDE.md gate the prompts".
#
# Phase 2 will add:
#   - bd list --claimed-by-me stale-claim summary.
#   - git status --short dirty-tree summary.
#
# Always exits 0; never blocks the session.

set -u

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}" 2>/dev/null || exit 0

# CLAUDE.md must exist; if it doesn't, the project hasn't adopted this
# workflow yet — silently skip.
[ -f CLAUDE.md ] || exit 0

# Need bd + jq to do anything meaningful. Either missing → silent skip.
command -v bd >/dev/null 2>&1 || exit 0
command -v jq >/dev/null 2>&1 || exit 0

# Get the close dates of the 5 most-recent closed bd issues. bd's JSON
# output is normally an array of issue objects with a `closed_at` (or
# similar) field; we filter for status=closed and take the 5 most
# recent. The exact query syntax varies by bd version; try the most
# common form, fall through silently if it doesn't work.
recent_closes="$(bd list --status=closed --limit=5 --json 2>/dev/null \
  | jq -r '[.[] | (.closed_at // .closedAt // .updated_at // empty)] | sort | .[0]' 2>/dev/null)"

# If we couldn't extract anything, exit silently — bd schema may have
# changed; better to be quiet than to spam every session.
[ -n "$recent_closes" ] && [ "$recent_closes" != "null" ] || exit 0

# Compare CLAUDE.md mtime against the oldest of the recent closes.
claude_mtime_iso="$(date -u -r CLAUDE.md '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null)" || exit 0

# String-compare ISO-8601 timestamps (lexicographic order matches
# chronological order for this format).
if [ "$claude_mtime_iso" \< "$recent_closes" ]; then
  cat <<EOF >&2
ⓘ CLAUDE.md staleness ping: CLAUDE.md was last modified $claude_mtime_iso,
  which is older than each of the 5 most-recent closed bd issues
  (oldest of the 5 closed at $recent_closes).
  The implementer + reviewer dispatches read CLAUDE.md and
  docs/agent-rules/ at dispatch time. Consider whether either has
  drifted from the project's current shape before kicking off
  /bd-execute work.
EOF
fi

exit 0
