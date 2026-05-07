#!/usr/bin/env bash
# session-start.sh — Phase 1 + Phase 2 of multi-agent workflow plan.
#
# Emit-only SessionStart hook. The main session is responsible for
# acting on the output (per docs/agent-workflow.md "Main-session
# contract on SessionStart hook output").
#
# Phase 1 (R12d): CLAUDE.md staleness ping — warn when CLAUDE.md mtime
# is older than the oldest of the 5 most-recent closed bd issues.
#
# Phase 2 (recovery checks): emit summaries when the previous session
# may have exited mid-task.
#   - Stale claim: any in_progress bd issue assigned to the local git
#     user whose updated_at is >1 hour old.
#   - Dirty tree: `git status --short` non-empty.
#
# Each check is independent: a no-op or schema mismatch in one must
# not skip the others. Always exits 0; never blocks the session.

set -u

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}" 2>/dev/null || exit 0

# Need bd + jq to do anything meaningful. Either missing → silent skip.
have_bd=0
have_jq=0
command -v bd >/dev/null 2>&1 && have_bd=1
command -v jq >/dev/null 2>&1 && have_jq=1

# ----------------------------------------------------------------------
# Phase 1: CLAUDE.md staleness ping (R12d).
# ----------------------------------------------------------------------
phase1_staleness_ping() {
  [ -f CLAUDE.md ] || return 0
  [ "$have_bd" = 1 ] && [ "$have_jq" = 1 ] || return 0

  local recent_closes
  recent_closes="$(bd list --status=closed --limit=5 --json 2>/dev/null \
    | jq -r '[.[] | (.closed_at // .closedAt // .updated_at // empty)] | sort | .[0]' 2>/dev/null)"

  [ -n "$recent_closes" ] && [ "$recent_closes" != "null" ] || return 0

  local claude_mtime_iso
  claude_mtime_iso="$(date -u -r CLAUDE.md '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null)" || return 0

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
}

# ----------------------------------------------------------------------
# Phase 2a: stale claim summary.
# ----------------------------------------------------------------------
phase2_stale_claims() {
  [ "$have_bd" = 1 ] && [ "$have_jq" = 1 ] || return 0

  local git_user
  git_user="$(git config user.name 2>/dev/null || echo '')"
  [ -n "$git_user" ] || return 0

  local now_epoch cutoff_epoch
  now_epoch="$(date -u +%s 2>/dev/null)" || return 0
  cutoff_epoch=$(( now_epoch - 3600 ))

  # Filter to in_progress issues assigned to the local git user whose
  # last update is older than the cutoff. updated_at is a reasonable
  # proxy for claim age in this project — the claim is the most recent
  # write-event for issues left mid-task.
  local stale_claims
  stale_claims="$(bd list --status=in_progress --json 2>/dev/null \
    | jq -r --arg user "$git_user" --argjson cutoff "$cutoff_epoch" '
        [ .[]
          | select((.assignee // "") == $user)
          | (.updated_at // .updatedAt // "") as $u
          | select($u | length > 0)
          | select(($u | fromdateiso8601) < $cutoff)
          | "  - \(.id) (updated \($u)): \(.title)"
        ] | .[]
      ' 2>/dev/null)"

  [ -n "$stale_claims" ] || return 0

  cat <<EOF >&2
ⓘ Stale claim ping: in_progress bd issue(s) assigned to $git_user, last updated >1 hour ago.
  May be left over from a session that exited mid-task. Decide: resume,
  un-claim (\`bd update <id> --status=open\`), or close.
$stale_claims
EOF
}

# ----------------------------------------------------------------------
# Phase 2b: dirty working tree summary.
# ----------------------------------------------------------------------
phase2_dirty_tree() {
  command -v git >/dev/null 2>&1 || return 0
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0

  local dirty
  dirty="$(git status --short 2>/dev/null)"
  [ -n "$dirty" ] || return 0

  local line_count
  line_count="$(printf '%s\n' "$dirty" | wc -l | tr -d ' ')"

  cat <<EOF >&2
ⓘ Dirty working tree: $line_count uncommitted change(s).
  If left over from an interrupted session, decide whether to commit,
  stash, or discard before starting new work. First entries:
$(printf '%s\n' "$dirty" | head -10 | sed 's/^/  /')
EOF
}

phase1_staleness_ping
phase2_stale_claims
phase2_dirty_tree

exit 0
