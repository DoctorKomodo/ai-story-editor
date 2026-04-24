# Story Editor

A self-hosted, web-based story and text editor with Venice.ai AI integration. Users can manage multiple stories, break them into chapters, attach characters for consistency, and invoke AI assistance directly from a TipTap rich text editor.

## Monorepo layout

```
/
├── frontend/   React + Vite + TypeScript + TailwindCSS + TipTap
├── backend/    Node.js + Express + TypeScript + Prisma
├── db/         Prisma schema and migrations
├── scripts/    Utility shell scripts (backup, seed, reset)
├── docs/       Architecture and API documentation
└── docker-compose.yml
```

## Quick start

1. Copy `.env.example` to `.env` and fill in values (including your Venice.ai API key).
2. `docker compose up -d`
3. Frontend: http://localhost:3000 — Backend: http://localhost:4000

See [SELF_HOSTING.md](SELF_HOSTING.md) for production deployment instructions.

## Development

Source of truth for development work is [TASKS.md](TASKS.md). Operating rules for contributors (including Claude Code) are in [CLAUDE.md](CLAUDE.md).

## Repository policy

### Branch protection — configure on GitHub before inviting contributors

The CI pipeline (`.github/workflows/ci.yml`) and secret-scan workflow (`.github/workflows/secret-scan.yml`) are only enforcement points if `main` is protected. Without branch protection, a direct push bypasses every gate. Configure the following under **Settings → Branches → Branch protection rules → `main`**:

- **Require a pull request before merging** — yes. Disallow direct pushes to `main`.
- **Require status checks to pass before merging** — yes. Required checks:
  - `CI / lint · typecheck · test`
  - `Secret scan / gitleaks`
- **Require branches to be up to date before merging** — yes. Forces a rebase/merge from `main` before the merge button unblocks, so CI runs against the exact SHA that will land.
- **Require conversation resolution before merging** — yes.
- **Do not allow bypassing the above settings** — yes, including for admins. CI is only valuable if nobody skips it.
- **Allow force pushes** — no.
- **Allow deletions** — no.

### Dependency updates

Dependabot is configured in `.github/dependabot.yml` to open weekly grouped PRs for each of the three npm workspaces (root / backend / frontend) and for GitHub Actions. Minor + patch updates are grouped; majors get their own PR. Review and merge as any other PR — CI gates apply.

### Pre-commit hook

Pre-commit runs [Biome](https://biomejs.dev) via `lint-staged` (see `package.json`). Initial hook install: `npm install` at the repo root triggers `simple-git-hooks` via the `prepare` script. If the hook isn't firing on commit, run `npx simple-git-hooks` from the repo root to re-register it.

To bypass in an emergency: `SKIP_SIMPLE_GIT_HOOKS=1 git commit …`. Don't make it a habit — CI will catch what the hook would have.
