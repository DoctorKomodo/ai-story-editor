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

Working task tracker is [**bd** (beads)](https://gastownhall.github.io/beads/) — run `bd ready` to find available work, `bd show <id>` for details. The default implementation flow is `/bd-execute <id>` (multi-agent loop with reviewer gates; see [docs/agent-workflow.md](docs/agent-workflow.md)). Historical task journal lives in [TASKS.md](TASKS.md) for closed-task ID lookups. Operating rules for contributors (including Claude Code) are in [CLAUDE.md](CLAUDE.md). Production deployment notes are in [SELF_HOSTING.md](SELF_HOSTING.md).

## Quick start

```bash
cp .env.example .env        # then edit values
make dev                    # postgres + backend + frontend
                            # frontend :3000  ·  backend :4000
make seed                   # creates the demo user and sample content
```

Sign in at <http://localhost:3000/login> with the demo credentials below.

## Demo / dev test user

`make seed` creates a fixed-credential demo user with a couple of stories, chapters, and characters. The seed refuses to run against `NODE_ENV=production` (override only via `ALLOW_PROD_SEED=1`, which you almost certainly should not).

| | |
|---|---|
| Username | `demo` |
| Password | `demopass123` |
| Recovery code | printed by the seed run — copy it from the terminal if you want to exercise the recovery / reset flows |
| Stories | *The Lantern Keeper* (fantasy), *A Quiet Year on Halsey Street* (literary mystery) |
| Per story | 2 chapters + 2 characters |

Re-running `make seed` is idempotent: it deletes the demo user (cascade wipes their stories / chapters / characters / chats / messages) and recreates everything fresh.

## Day-to-day commands

| | |
|---|---|
| `make dev` | start the stack |
| `make stop` | stop the stack |
| `make logs` | tail all services |
| `make migrate` | apply pending migrations (`prisma migrate deploy`) |
| `make seed` | seed the demo user + content (dev only) |
| `make reset-db` | **destructive** — wipes the `pgdata` volume and re-migrates |
| `make rebuild-frontend` | rebuild + restart after a frontend `package.json` change |
| `make rebuild-backend` | rebuild + restart after a backend `package.json` change |
| `make rebuild` | rebuild + restart both images |

Need a clean dev environment from scratch? `make reset-db && make dev && make seed` will give you a fresh DB with a freshly-registered demo user.

After adding or upgrading an npm dependency, run `make rebuild-frontend` (or `make rebuild-backend`). The dev compose bind-mounts source but keeps every `node_modules` tree in anonymous volumes, so a host-side `npm install` doesn't reach the running stack — `make rebuild*` rebuilds the image *and* recreates those volumes (`--renew-anon-volumes`) so the fresh install propagates.

## Tests and lint

All commands are run from the repo root unless otherwise noted.

### Test suites

| Command | Scope |
|---|---|
| `make test` | shared (vitest) + backend (vitest) + frontend (vitest) |
| `make verify` | local CI-equivalent: lint + typecheck + design-lint + builds + all three test suites (backend tests require `make dev` up) |
| `npm -w story-editor-shared run test` | shared schemas (Zod contract) |
| `cd backend && npm test` | backend unit + integration |
| `npm -w story-editor-backend run db:test:reset` | reset the test DB before a full backend run |
| `cd backend && npm run test:live` | opt-in live Venice tests (requires `backend/.env.live` — never in CI) |
| `cd frontend && npm test` | frontend unit + integration (jsdom) |
| `make test-e2e` | Playwright E2E (requires the stack to be up) |
| `npm run test:e2e:visual` | Playwright visual-regression sweep (developer-run, not CI-gated) |

Single-task verify is part of the close gate: `/bd-close-reviewed <BD_ID>` (project-local slash command, see `.claude/skills/bd-close-reviewed/`) runs the issue's `verify:` line, typechecks affected workspaces, and fans path-matched surface reviewers before calling `bd close`.

### Lint, typecheck, verify

| Command | Scope |
|---|---|
| `make lint` | Biome check across the whole repo (also `npm run lint`) |
| `make typecheck` | shared + backend + frontend typecheck |
| `make verify` | local CI-equivalent gate (`npm run verify` calls the same target) |
| `npm run lint:fix` | Biome with `--write` |
| `npm run format` | Biome format with `--write` |
| `npm run format:check` | Biome format dry-run |
| `cd frontend && npm run lint:design` | design-token guard (forbids raw Tailwind colour utilities) |
| `npm --prefix shared run typecheck` | shared typecheck (`tsc --noEmit` — source-only workspace, no build) |
| `npm --prefix backend run typecheck` | backend typecheck (`tsc --noEmit`) |
| `npm --prefix frontend run typecheck` | frontend typecheck (`tsc -b`, project references) |

The `shared` workspace is source-only — it has no `build` script. The backend `tsup` build inlines it via `noExternal: ['story-editor-shared']`, so there's no `shared/dist` artifact at runtime; `typecheck` is the equivalent compile-time gate.

A `lint-staged` + Biome pre-commit hook runs automatically on `git commit` (see `Pre-commit hook` below).

### Design system

Storybook is the live design surface — primitives (`Button`, `Field`, `Modal`, …), tokens (colour / type / radii / shadows), and component stories for every major UI surface. Browse it before authoring new UI; new components ship as `*.stories.tsx` files alongside their source.

```bash
cd frontend
npm run storybook              # http://localhost:6006
npm run build-storybook        # static build to frontend/storybook-static
```

The `lint:design` guard (`cd frontend && npm run lint:design`) enforces token-only usage in `frontend/src/` — raw Tailwind colour utilities, hardcoded hex values, and ad-hoc shadows are CI-blocked. Token sources live in `frontend/src/index.css`.

Historical reference (the original HTML prototype + `Design System Handoff.html`) is preserved read-only at `mockups/archive/v1-2025-11/`; treat it as an archive, not a guide.

## Pre-commit hook

Pre-commit runs [Biome](https://biomejs.dev) via `lint-staged` (see `package.json`). Initial hook install: `npm install` at the repo root triggers `simple-git-hooks` via the `prepare` script. If the hook isn't firing on commit, run `npx simple-git-hooks` from the repo root to re-register it.

To bypass in an emergency: `SKIP_SIMPLE_GIT_HOOKS=1 git commit …`. Don't make it a habit — CI will catch what the hook would have.

## Repository policy

### Branch protection

The CI pipeline (`.github/workflows/ci.yml`) and secret-scan workflow (`.github/workflows/secret-scan.yml`) are only enforcement points if `main` is protected. Configure under **Settings → Branches → Branch protection rules → `main`**:

- **Require a pull request before merging** — yes. Disallow direct pushes to `main`.
- **Require status checks to pass before merging** — yes. Required checks:
  - `CI / lint · typecheck · test`
  - `Secret scan / gitleaks`
- **Require branches to be up to date before merging** — yes.
- **Require conversation resolution before merging** — yes.
- **Do not allow bypassing the above settings** — yes, including for admins.
- **Allow force pushes** — no.
- **Allow deletions** — no.

### Dependency updates

Dependabot is configured in `.github/dependabot.yml` to open weekly grouped PRs for each of the three npm workspaces (root / backend / frontend) and for GitHub Actions. Minor + patch updates are grouped; majors get their own PR. CI gates apply.
