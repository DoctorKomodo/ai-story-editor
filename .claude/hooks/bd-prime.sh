#!/usr/bin/env bash
# bd-prime.sh — wraps `bd prime` to neutralize two statements in its output
# that are false for this repo and contradict CLAUDE.md (the authoritative
# workflow doc):
#   1. The "**Note:** This is an ephemeral branch ... merged to main locally,
#      not pushed" line. bd emits this whenever the branch has no upstream;
#      this repo has an `origin` remote and uses a push + PR workflow.
#   2. The session-close `bd dolt pull` step. Per CLAUDE.md, beads sync rides
#      refs/dolt/data on the git remote and .beads/issues.jsonl is a passive
#      export — there is no manual `bd dolt pull` against a separate Dolt
#      remote here (it errors "no remote").
# The real `bd prime` runs underneath, so dynamic memory injection and
# MCP-mode detection are preserved. Always exits 0 — a hook must not block
# the session.
set -u

out="$(bd prime "$@")" || { printf '%s\n' "$out"; exit 0; }

printf '%s\n' "$out" \
  | grep -v '^\*\*Note:\*\* This is an ephemeral branch' \
  | sed 's|^\[ \] 3\. bd dolt pull .*|[ ] 3. git add .beads/issues.jsonl  (commit the bd passive export with your work)|'

# Regression guards: if bd reworded a line our transform targets, the
# transform silently no-op's and the false text returns. Catch that.
if printf '%s\n' "$out" | grep -q 'SESSION CLOSE PROTOCOL'; then   # CLI mode
  # The `bd dolt pull` step is unconditional in CLI-mode output.
  if ! printf '%s\n' "$out" | grep -qF 'bd dolt pull'; then
    printf '%s\n' "ⓘ bd-prime.sh: 'bd dolt pull' patch target not found — bd output may have changed; re-check .claude/hooks/bd-prime.sh against CLAUDE.md." >&2
  fi
  # The ephemeral-branch note is emitted only when the branch has no
  # upstream — guard it only in that case, else "absent" is correct.
  if ! git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1 \
     && ! printf '%s\n' "$out" | grep -q '^\*\*Note:\*\* This is an ephemeral branch'; then
    printf '%s\n' "ⓘ bd-prime.sh: branch has no upstream but the 'ephemeral branch' note wasn't found — bd may have reworded it; re-check .claude/hooks/bd-prime.sh against CLAUDE.md." >&2
  fi
fi

exit 0
