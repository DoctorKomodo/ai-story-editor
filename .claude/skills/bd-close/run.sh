#!/usr/bin/env bash
# Slash-skill thin wrapper around scripts/bd-close-verified.sh.
ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
exec "$ROOT_DIR/scripts/bd-close-verified.sh" "$@"
