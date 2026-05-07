#!/usr/bin/env bash
# bd-close-reviewed-idempotent.test.sh
#
# Verifies scripts/bd-close-reviewed.sh --phase=close is idempotent
# when the bd issue is already closed.
#
# Method: stub `bd` and `git commit` on PATH so we can record calls
# without touching real bd state or the repo. Drives the script
# through three scenarios:
#   1. close + already-closed bd → exit 0, "already closed" stdout,
#      no `bd close` invocation.
#   2. close + open bd → exit 0, exactly one `bd close` invocation.
#   3. override-block + already-closed bd → exit 0, no `bd update`
#      and no `git commit` invocation (override path short-circuits
#      identically).
#
# Each scenario runs in its own temp dir; the stubs write call logs
# we grep against expectations.

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
script="$repo_root/scripts/bd-close-reviewed.sh"

if [ ! -x "$script" ]; then
  echo "✘ $script not executable or missing" >&2
  exit 2
fi

fail() {
  echo "✘ FAIL: $1" >&2
  exit 1
}

# ----------------------------------------------------------------------
# Build a sandbox: tmpdir with stub bd + git on PATH; stubs log calls.
# ----------------------------------------------------------------------
setup_sandbox() {
  local sandbox status="$1"
  sandbox="$(mktemp -d)"
  mkdir -p "$sandbox/bin"

  # Stub `bd`: log argv, respond to `show --json` with a JSON array
  # encoding the desired status. All other subcommands log + succeed.
  cat >"$sandbox/bin/bd" <<EOF
#!/usr/bin/env bash
echo "bd \$*" >> "$sandbox/bd.log"
if [ "\$1" = "show" ]; then
  echo '[{"id":"story-editor-test","status":"$status","notes":"existing"}]'
  exit 0
fi
exit 0
EOF
  chmod +x "$sandbox/bin/bd"

  # Stub `git`: log argv, succeed for `commit` so the override path
  # doesn't fail; pass-through everything else to real git via the
  # original PATH so `git rev-parse --show-toplevel` etc. still work.
  cat >"$sandbox/bin/git" <<EOF
#!/usr/bin/env bash
if [ "\$1" = "commit" ]; then
  echo "git \$*" >> "$sandbox/git.log"
  exit 0
fi
exec $(command -v git) "\$@"
EOF
  chmod +x "$sandbox/bin/git"

  echo "$sandbox"
}

# ----------------------------------------------------------------------
# Scenario 1: close + already-closed → idempotent exit, no bd close call.
# ----------------------------------------------------------------------
run_scenario_already_closed() {
  local sandbox out exit_code
  sandbox="$(setup_sandbox closed)"
  set +e
  out="$(PATH="$sandbox/bin:$PATH" bash "$script" story-editor-test --phase=close 2>&1)"
  exit_code=$?
  set -e

  [ "$exit_code" -eq 0 ] || fail "scenario-1: expected exit 0, got $exit_code (out: $out)"
  echo "$out" | grep -q "already closed" || fail "scenario-1: missing 'already closed' note in stdout (out: $out)"
  if grep -q '^bd close ' "$sandbox/bd.log" 2>/dev/null; then
    fail "scenario-1: expected no 'bd close' call, but got: $(grep '^bd close' "$sandbox/bd.log")"
  fi
  echo "✓ scenario-1: close + already-closed is idempotent"
  rm -rf "$sandbox"
}

# ----------------------------------------------------------------------
# Scenario 2: close + open → bd close called exactly once.
# ----------------------------------------------------------------------
run_scenario_open() {
  local sandbox out exit_code
  sandbox="$(setup_sandbox open)"
  set +e
  out="$(PATH="$sandbox/bin:$PATH" bash "$script" story-editor-test --phase=close 2>&1)"
  exit_code=$?
  set -e

  [ "$exit_code" -eq 0 ] || fail "scenario-2: expected exit 0, got $exit_code (out: $out)"
  local close_calls
  close_calls="$(grep -c '^bd close ' "$sandbox/bd.log" 2>/dev/null || echo 0)"
  [ "$close_calls" -eq 1 ] || fail "scenario-2: expected 1 'bd close' call, got $close_calls (log: $(cat "$sandbox/bd.log"))"
  echo "✓ scenario-2: close + open dispatches one 'bd close' call"
  rm -rf "$sandbox"
}

# ----------------------------------------------------------------------
# Scenario 3: override-block + already-closed → no notes update, no commit.
# ----------------------------------------------------------------------
run_scenario_override_already_closed() {
  local sandbox out exit_code
  sandbox="$(setup_sandbox closed)"
  set +e
  out="$(PATH="$sandbox/bin:$PATH" bash "$script" story-editor-test \
    --phase=close --override-block="security-reviewer — false positive on cookie sameSite" 2>&1)"
  exit_code=$?
  set -e

  [ "$exit_code" -eq 0 ] || fail "scenario-3: expected exit 0, got $exit_code (out: $out)"
  echo "$out" | grep -q "already closed" || fail "scenario-3: missing 'already closed' note in stdout"
  if grep -q '^bd update ' "$sandbox/bd.log" 2>/dev/null; then
    fail "scenario-3: expected no 'bd update' (override line append), but got: $(grep '^bd update' "$sandbox/bd.log")"
  fi
  if [ -f "$sandbox/git.log" ] && grep -q '^git commit ' "$sandbox/git.log"; then
    fail "scenario-3: expected no override trailer commit, but got: $(grep '^git commit' "$sandbox/git.log")"
  fi
  echo "✓ scenario-3: override-block + already-closed short-circuits (no notes append, no trailer commit)"
  rm -rf "$sandbox"
}

run_scenario_already_closed
run_scenario_open
run_scenario_override_already_closed

echo "all idempotency scenarios passed."
