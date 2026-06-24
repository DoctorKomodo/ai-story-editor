#!/usr/bin/env bash
# scripts/release.sh — cut a release: bump versions, commit, tag.
#
# Usage:
#   scripts/release.sh <version>      # e.g. scripts/release.sh 0.2.0
#
# What it does:
#   1. Validates <version> is plain semver (X.Y.Z) and the tag doesn't exist.
#   2. Refuses to run on a dirty working tree.
#   3. Bumps the `version` field in all four package.json files in lockstep
#      (root + backend + frontend + shared) via `npm version`.
#   4. Commits `[REL] release vX.Y.Z` and creates the annotated tag `vX.Y.Z`.
#
# It does NOT push. Review the commit, then:
#   git push origin <branch> --follow-tags
# Pushing the v* tag triggers .github/workflows/release.yml, which builds and
# publishes the GHCR images and creates the GitHub Release.
#
# Exit codes:
#   0  — version bumped, committed, tagged
#   1  — bad usage / validation failure (dirty tree, existing tag, bad version)

set -euo pipefail

cd "$(dirname "$0")/.."

if [ "$#" -ne 1 ]; then
  echo "usage: scripts/release.sh <version>   (e.g. 0.2.0)" >&2
  exit 1
fi

VERSION="$1"
TAG="v${VERSION}"

# Plain semver only — no leading "v", no pre-release/build suffix. The release
# workflow trigger (v*.*.*) and metadata-action's type=semver both expect this.
if ! printf '%s' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "error: version must be plain semver X.Y.Z (got '$VERSION')" >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "error: working tree is dirty — commit or stash first." >&2
  exit 1
fi

if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
  echo "error: tag ${TAG} already exists." >&2
  exit 1
fi

echo "Bumping all workspaces to ${VERSION}…"
# Bumps root + every workspace package.json in one call. --no-git-tag-version
# keeps npm from creating its own commit/tag (we do that below, with our
# message format and an annotated tag).
npm version "$VERSION" \
  --no-git-tag-version \
  --workspaces \
  --include-workspace-root \
  >/dev/null

git add package.json package-lock.json backend/package.json frontend/package.json shared/package.json
git commit -m "[REL] release ${TAG}" >/dev/null
git tag -a "${TAG}" -m "Release ${TAG}"

echo "Committed and tagged ${TAG}."
echo "Next: git push origin \"\$(git rev-parse --abbrev-ref HEAD)\" --follow-tags"
