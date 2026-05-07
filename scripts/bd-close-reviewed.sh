#!/usr/bin/env bash
# bd-close-reviewed.sh — Phase 1B of multi-agent workflow plan.
#
# Mechanical helper for /bd-close-reviewed. Owns the parts that are
# better in shell than in a Claude prompt:
#   --phase=typecheck    Run path-matched typecheck across affected workspaces.
#   --phase=affected     Print which surface reviewers should fire ("auth",
#                        "repo-boundary", or both, or nothing). Read by the
#                        skill to decide which Agent dispatches to make.
#   --phase=close        bd close the issue (after the skill confirms reviewers
#                        and any override are accounted for).
#
# Reviewer dispatch itself happens on the Claude side (Agent tool) — shell
# can't dispatch subagents. The skill orchestrates; this script is the
# mechanical utility.
#
# Override path: --override-block "<reviewer> — <reason>" records the
# override on the bd issue notes and creates an empty git commit with a
# Reviewer-Override trailer so the override appears in `git log` and PR diffs.
#
# Usage:
#   bash scripts/bd-close-reviewed.sh <bd-id> --phase=typecheck
#   bash scripts/bd-close-reviewed.sh <bd-id> --phase=affected
#   bash scripts/bd-close-reviewed.sh <bd-id> --phase=close [--reason="..."]
#   bash scripts/bd-close-reviewed.sh <bd-id> --phase=close --override-block="<reviewer> — <reason>"

set -uo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $(basename "$0") <bd-id> --phase=<typecheck|affected|close> [...]" >&2
  exit 64
fi

ID="$1"; shift
PHASE=""
REASON=""
OVERRIDE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --phase=*)          PHASE="${1#*=}" ;;
    --reason=*)         REASON="${1#*=}" ;;
    --reason)           REASON="$2"; shift ;;
    --override-block=*) OVERRIDE="${1#*=}" ;;
    --override-block)   OVERRIDE="$2"; shift ;;
    *) echo "unknown arg: $1" >&2; exit 64 ;;
  esac
  shift
done

if [ -z "$PHASE" ]; then
  echo "✘ --phase=<typecheck|affected|close> is required" >&2
  exit 64
fi

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$repo_root" ]; then
  echo "✘ not a git repository" >&2
  exit 2
fi
cd "$repo_root"

# Determine merge base. Default to main; allow override via env if needed.
BASE="${BD_CLOSE_BASE:-main}"
if ! git rev-parse --verify "$BASE" >/dev/null 2>&1; then
  echo "✘ base ref not found: $BASE" >&2
  exit 2
fi
merge_base="$(git merge-base HEAD "$BASE")"
diff_files="$(git diff --name-only "$merge_base"...HEAD)"

case "$PHASE" in
  typecheck)
    EXIT=0
    if echo "$diff_files" | grep -q '^backend/'; then
      echo "→ backend typecheck (npm --prefix backend run typecheck)"
      if ! npm --prefix backend run typecheck; then EXIT=2; fi
    else
      echo "→ backend untouched, skipping typecheck"
    fi
    if echo "$diff_files" | grep -q '^frontend/'; then
      echo "→ frontend typecheck (npm --prefix frontend run typecheck)"
      if ! npm --prefix frontend run typecheck; then EXIT=2; fi
    else
      echo "→ frontend untouched, skipping typecheck"
    fi
    exit $EXIT
    ;;

  affected)
    # Path → reviewer mapping. Output one reviewer name per line.
    # Mapping mirrors CLAUDE.md "Security Review" + "Repo-Boundary Review".
    fired=""

    # security-reviewer: auth/crypto/middleware surface
    if echo "$diff_files" | grep -qE '^backend/src/(routes/auth|services/auth|services/crypto|services/content-crypto|middleware/)'; then
      fired="$fired security-reviewer"
    fi
    if echo "$diff_files" | grep -qE '^backend/src/routes/venice-key\.routes\.ts$'; then
      fired="$fired security-reviewer"
    fi
    # backend/src/index.ts hosts the cookie / cors / helmet / rate-limit / encryption-key bootstrap
    # (see CLAUDE.md "Security Review"). Treat any change to it as in-lane.
    if echo "$diff_files" | grep -qE '^backend/src/index\.ts$'; then
      fired="$fired security-reviewer"
    fi

    # repo-boundary-reviewer: narrative repos / routes / content-crypto / prompt-service / narrative migrations
    if echo "$diff_files" | grep -qE '^backend/src/repos/'; then
      fired="$fired repo-boundary-reviewer"
    fi
    if echo "$diff_files" | grep -qE '^backend/src/routes/(stories|chapters|characters|outline|chat)\.routes\.ts$'; then
      fired="$fired repo-boundary-reviewer"
    fi
    if echo "$diff_files" | grep -qE '^backend/src/services/(content-crypto|prompt)\.service\.ts$'; then
      fired="$fired repo-boundary-reviewer"
    fi
    if echo "$diff_files" | grep -qE '^backend/prisma/(migrations/.*|schema\.prisma)$'; then
      # Heuristic: fire repo-boundary-reviewer when a migration touches a narrative model name
      # OR a DEK-wrap / BYOK ciphertext column. Both are in-lane for the boundary reviewer.
      if git diff "$merge_base"...HEAD -- 'backend/prisma/' \
          | grep -qE '\b(Story|Chapter|Character|OutlineItem|Chat|Message|contentDekPassword|contentDekRecovery|veniceApiKeyEnc)\b'; then
        fired="$fired repo-boundary-reviewer"
      fi
    fi

    # Print uniquely, one per line, sorted (stable for callers).
    if [ -n "$fired" ]; then
      printf '%s\n' $fired | sort -u
    fi
    exit 0
    ;;

  close)
    if [ -n "$OVERRIDE" ]; then
      # Read existing notes, append override line, write back.
      EXISTING="$(bd show "$ID" --json 2>/dev/null \
        | jq -r 'if type == "array" and length > 0 then (.[0].notes // "") else "" end' 2>/dev/null)"
      NEW_NOTES="$(printf '%s\noverride: %s\n' "$EXISTING" "$OVERRIDE")"
      bd update "$ID" --notes "$NEW_NOTES" || {
        echo "✘ failed to record override on bd notes" >&2
        exit 2
      }
      echo "▶ recorded override on $ID: $OVERRIDE"

      # Empty commit so the override appears in `git log` / PR diffs.
      git commit --allow-empty -m "chore: reviewer override recorded for $ID

Reviewer-Override: $OVERRIDE
" || {
        echo "✘ failed to create override trailer commit" >&2
        exit 2
      }
      echo "▶ trailer commit created"
    fi

    if [ -n "$REASON" ]; then
      bd close "$ID" --reason "$REASON"
    else
      bd close "$ID"
    fi
    ;;

  *)
    echo "✘ unknown phase: $PHASE (use typecheck|affected|close)" >&2
    exit 64
    ;;
esac
