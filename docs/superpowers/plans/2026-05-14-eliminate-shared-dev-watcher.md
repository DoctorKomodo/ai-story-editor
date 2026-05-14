# Eliminate the Shared-Package Dev Watcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the backend dev server and both test suites resolve `story-editor-shared` to `shared/src` directly, so the host-side `tsc --watch` dev watcher and every `shared/dist`-for-dev/test coupling can be deleted.

**Architecture:** Option C (hybrid resolution) from the design doc. `shared/package.json` gains an `exports` map with a custom `source` condition; the backend `dev` script opts in via `NODE_OPTIONS=--conditions=source`; both vitest configs get a flat `resolve.alias`. Production resolution behaviour is unchanged — `node` runs without `--conditions`, so prod resolves the `default` condition → `shared/dist`.

**Tech Stack:** npm workspaces, Node 24, ts-node-dev, Vitest, Docker Compose, GNU Make, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-05-14-eliminate-shared-dev-watcher-design.md` — read it first; it carries the *why* (Option C vs A/B, the `source`-not-`development` naming, the resolution matrix, Option D as a forward pointer).

**Pre-planning de-risking already done (do not re-run, just be aware):**
- `process.allowedNodeEnvironmentFlags` on this machine (Node v24.14.0) **includes `--conditions`** — `NODE_OPTIONS=--conditions=source` will be accepted. The spike in Task 1 therefore only needs to confirm the *residual* risk: that ts-node transpiles the `.ts` file the resolver returns.
- ts-node-dev's restart log marker is `notify('Restarting', '<file> has been modified')` (`node_modules/ts-node-dev/lib/index.js:224`) — the verify line greps for `Restarting`.

---

## File Map

| File | Change | Task |
|---|---|---|
| `shared/package.json` | Add `exports` map (`types` / `source` / `default`); keep `main`/`types` as fallback | 1 |
| `backend/package.json` | Prefix the `dev` script with `NODE_OPTIONS=--conditions=source` | 1 |
| `backend/tests/shared-resolution.test.ts` | **Create** — regression guard: backend vitest resolves `shared/src` | 2 |
| `frontend/tests/shared-resolution.test.ts` | **Create** — regression guard: frontend vitest resolves `shared/src` | 2 |
| `backend/vitest.config.ts` | Add `story-editor-shared` → `../shared/src` to `resolve.alias` | 2 |
| `frontend/vitest.config.ts` | Add `story-editor-shared` → `../shared/src` to `resolve.alias` | 2 |
| `Makefile` | Delete the watcher spawn, `.watcher.pid` handling, `shared-watch` + `shared-build` targets, the `shared-build` prerequisites; update `.PHONY` | 3 |
| `.watcher.pid` | **Delete** the stale working-tree file (gitignored, untracked) | 3 |
| `backend/Dockerfile` | Remove `RUN npm -w story-editor-shared run build` from the **dev** stage (builder stage keeps it) | 4 |
| `docker-compose.override.yml` | Rewrite the backend `./shared` mount comment (the mount itself stays) | 4 |
| `.github/workflows/ci.yml` | Remove the `Build shared` step | 5 |
| `.github/workflows/e2e.yml` | Remove the `Build shared` step; rewrite the two stale `[T8]` comment regions | 5 |
| `CLAUDE.md` | Remove the "`shared/` must be built before tests" Known-Gotchas bullet | 6 |
| bd issue `story-editor-at5` notes | Update the `verify:` line to the integration-test one-liner | 6 |

**Ordering invariant:** every task leaves the repo in a working (if transitional) state. Task 1 makes the dev server resolve `src` but the watcher still runs harmlessly until Task 3. Tasks 2→3→4→5 each remove one now-dead coupling. Task 6 finalises docs + the verify line and runs the full integration check. Do the tasks in order.

---

### Task 1: Spike + land the resolution mechanism for the dev server

**Files:**
- Modify: `shared/package.json`
- Modify: `backend/package.json`

This task adds the `exports` map and the `NODE_OPTIONS` opt-in, then *spikes* that ts-node-dev actually resolves+transpiles `shared/src` under the `source` condition. If the spike fails, **stop** — the fallback (switching the dev runner to `tsx`) is a re-plan, not an in-task pivot.

- [ ] **Step 1: Confirm there are no deep imports of the shared package**

`exports` is *sealing* — once present, unlisted subpath imports (`story-editor-shared/foo`) throw. Confirm every import is the bare specifier.

Run:
```bash
grep -rn "story-editor-shared/" backend/src frontend/src shared/src 2>/dev/null || echo "NO DEEP IMPORTS — safe to add exports"
```
Expected: `NO DEEP IMPORTS — safe to add exports`

If any deep import is found: **stop and report** — the `exports` map needs a matching subpath entry, which is out of this plan's scope.

- [ ] **Step 2: Delete `shared/dist` so the spike is unambiguous**

With `dist` absent, a successful resolution can *only* be `shared/src` — there is no `default`-condition file to silently fall back to.

Run:
```bash
rm -rf shared/dist
```
Expected: no output.

- [ ] **Step 3: Add the `exports` map to `shared/package.json`**

Find this region of `shared/package.json`:
```json
  "private": true,
  "main": "./dist/index.js",
  "types": "./src/index.ts",
  "scripts": {
```
Replace it with (top-level `main`/`types` are kept as a harmless fallback for any resolver that ignores `exports`):
```json
  "private": true,
  "main": "./dist/index.js",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "source": "./src/index.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
```

- [ ] **Step 4: Add the `source` condition opt-in to the backend `dev` script**

In `backend/package.json`, find:
```json
    "dev": "ts-node-dev --respawn --transpile-only src/index.ts",
```
Replace with:
```json
    "dev": "NODE_OPTIONS=--conditions=source ts-node-dev --respawn --transpile-only src/index.ts",
```

- [ ] **Step 5: Spike — confirm ts-node resolves and transpiles `shared/src` under the `source` condition**

Run (from the repo root):
```bash
cd backend && NODE_OPTIONS=--conditions=source npx ts-node --transpile-only -e "const s = require('story-editor-shared'); console.log('RESOLVED:', require.resolve('story-editor-shared')); console.log('HAS_SCHEMA:', typeof s.storySchema);" ; cd ..
```
Expected:
```
RESOLVED: /home/asg/projects/story-editor/shared/src/index.ts
HAS_SCHEMA: object
```
(`ts-node` is the same compiler `ts-node-dev` wraps; if `ts-node` resolves+transpiles it, `ts-node-dev` will too. The respawn behaviour is verified in Task 6.)

**Failure modes — if the output is not the two expected lines, stop and report `BLOCKED` with the exact error:**
- `Error: Cannot find module 'story-editor-shared'` — the `source` condition was not honoured (and `dist` is gone, so there is no fallback). Re-run `cd backend && node --conditions=source -p "require.resolve('story-editor-shared')"` to isolate: if *that* fails too, the `exports` map is malformed; if it succeeds, ts-node is dropping the condition. Either way → `tsx` fallback is a re-plan.
- A `SyntaxError` pointing inside `shared/src/*.ts` — ts-node resolved the `.ts` file but did not transpile it (its default `ignore` pattern skipped it). Narrower fix: a ts-node config that does not ignore the `shared/src` path. Report `BLOCKED` with this diagnosis so the user can decide between the narrow fix and the `tsx` re-plan.

- [ ] **Step 6: Confirm the backend typecheck + build still work with `dist` absent**

`exports.types` resolves to `shared/src/index.ts` (same file the old top-level `types` pointed at); `tsc` reads types from source and does not need `shared/dist` to emit.

Run:
```bash
npm -w story-editor-backend run typecheck && npm -w story-editor-backend run build
```
Expected: both exit 0, no errors.

- [ ] **Step 7: Confirm shared's own tooling is undisturbed, and restore `shared/dist`**

The `exports` map must not affect shared's own `build`/`typecheck`/`test` scripts. This step also rebuilds `shared/dist` so the working tree is back to normal.

Run:
```bash
npm -w story-editor-shared run build && npm -w story-editor-shared run typecheck && npm -w story-editor-shared run test
```
Expected: all three exit 0; `shared/dist/index.js` exists again afterward.

- [ ] **Step 8: Commit**

```bash
git add shared/package.json backend/package.json
git commit -m "$(cat <<'EOF'
[at5] resolve story-editor-shared from src in the backend dev server

Add an `exports` map to shared/package.json with a custom `source`
condition pointing at ./src/index.ts; opt the backend `dev` script in via
NODE_OPTIONS=--conditions=source. Prod resolution is unchanged — `node`
runs without --conditions, so the `default` condition still resolves
./dist/index.js. Spiked: ts-node resolves + transpiles shared/src under
the condition.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Vitest aliases — backend + frontend test suites onto `shared/src`

**Files:**
- Create: `backend/tests/shared-resolution.test.ts`
- Create: `frontend/tests/shared-resolution.test.ts`
- Modify: `backend/vitest.config.ts`
- Modify: `frontend/vitest.config.ts`

The vitest runners do not get the `source` condition — for an externalised `node_modules` dep, `resolve.conditions` is not reliably consulted. A flat `resolve.alias` rewrites the specifier to a path outside `node_modules`, so vitest transforms `shared/src` as first-party source, deterministically. The two new test files are permanent regression guards: run with `shared/dist` deleted, they fail fast if an alias is ever removed.

- [ ] **Step 1: Create the backend resolution test**

Create `backend/tests/shared-resolution.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { STORY_TITLE_MAX } from 'story-editor-shared';

// Regression guard for story-editor-at5. Proves the backend vitest config
// resolves `story-editor-shared` to shared/src — not the compiled
// shared/dist. The bd verify line runs this with `shared/dist` deleted, so
// it fails fast ("Cannot find module") if the resolve.alias is ever removed.
describe('story-editor-shared resolution (backend)', () => {
  it('imports a runtime value from the shared package', () => {
    expect(typeof STORY_TITLE_MAX).toBe('number');
  });
});
```
(`backend/vitest.config.ts` has `globals: false`, so `describe`/`it`/`expect` must be imported explicitly. `STORY_TITLE_MAX` is a runtime `const` exported from `shared/src/index.ts` — a value import, not a type import, so it is not erased at transpile time.)

- [ ] **Step 2: Create the frontend resolution test**

Create `frontend/tests/shared-resolution.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { STORY_TITLE_MAX } from 'story-editor-shared';

// Regression guard for story-editor-at5. Proves the frontend vitest config
// resolves `story-editor-shared` to shared/src — not the compiled
// shared/dist. The bd verify line runs this with `shared/dist` deleted, so
// it fails fast ("Cannot find module") if the resolve.alias is ever removed.
describe('story-editor-shared resolution (frontend)', () => {
  it('imports a runtime value from the shared package', () => {
    expect(typeof STORY_TITLE_MAX).toBe('number');
  });
});
```

- [ ] **Step 3: Delete `shared/dist` and run both tests to verify they FAIL**

With `dist` gone and no alias yet, vitest resolves `story-editor-shared` via `exports.default` → `./dist/index.js`, which no longer exists.

Run:
```bash
rm -rf shared/dist
npm -w story-editor-backend run test -- tests/shared-resolution.test.ts
```
Expected: **FAIL** — vitest reports it cannot resolve / find `story-editor-shared`.

Then:
```bash
npm -w story-editor-frontend run test -- tests/shared-resolution.test.ts
```
Expected: **FAIL** — same, cannot resolve `story-editor-shared`.

- [ ] **Step 4: Add the alias to `backend/vitest.config.ts`**

Find:
```ts
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
```
Replace with:
```ts
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'story-editor-shared': path.resolve(__dirname, '../shared/src'),
    },
  },
```

- [ ] **Step 5: Add the alias to `frontend/vitest.config.ts`**

Find:
```ts
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
```
Replace with:
```ts
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'story-editor-shared': path.resolve(__dirname, '../shared/src'),
    },
  },
```

- [ ] **Step 6: Run both tests to verify they now PASS (with `dist` still deleted)**

Run:
```bash
npm -w story-editor-backend run test -- tests/shared-resolution.test.ts
npm -w story-editor-frontend run test -- tests/shared-resolution.test.ts
```
Expected: **both PASS** — 1 test each. Because `shared/dist` is still absent, passing proves the alias resolved `shared/src`.

- [ ] **Step 7: Restore `shared/dist` and run the full frontend suite as a no-regression check**

Run:
```bash
npm -w story-editor-shared run build
npm -w story-editor-frontend run test
```
Expected: `shared/dist` rebuilt; the full frontend suite passes (jsdom, no DB needed — confirms the alias did not perturb any other frontend test). The full *backend* suite needs a test database and is exercised by CI and the `/bd-execute` per-task review; it is intentionally not run here.

- [ ] **Step 8: Commit**

```bash
git add backend/tests/shared-resolution.test.ts frontend/tests/shared-resolution.test.ts backend/vitest.config.ts frontend/vitest.config.ts
git commit -m "$(cat <<'EOF'
[at5] resolve story-editor-shared from src in both vitest suites

Add a flat resolve.alias (story-editor-shared -> ../shared/src) to the
backend and frontend vitest configs, plus a dedicated resolution test in
each suite that fails fast when run with shared/dist deleted. The test
suites no longer depend on a pre-built shared/dist.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Delete the watcher — `Makefile` + `.watcher.pid`

**Files:**
- Modify: `Makefile`
- Delete: `.watcher.pid`

The host-side `tsc --watch` watcher exists only to keep `shared/dist` fresh for the dev server — now obsolete. Removing it also deletes the `make stop` process-group `kill` that self-terminates whatever invoked it (the latent bug that exited story-editor-lki's verify line 143).

- [ ] **Step 1: Update the `.PHONY` line**

Find (line 1):
```makefile
.PHONY: dev stop rebuild rebuild-frontend rebuild-backend migrate seed reset-db test test-e2e logs shared-build shared-watch
```
Replace with:
```makefile
.PHONY: dev stop rebuild rebuild-frontend rebuild-backend migrate seed reset-db test test-e2e logs
```

- [ ] **Step 2: Delete the `shared-build` target and its comment**

Find and delete this block entirely:
```makefile
# Build the shared workspace (shared/dist/) so backend + tests can resolve
# story-editor-shared at runtime. This is a host-side build; the Docker image
# also builds shared internally (see backend/Dockerfile builder/dev stages).
shared-build:
	npm -w story-editor-shared run build

```

- [ ] **Step 3: Delete the `shared-watch` target and its comment**

Find and delete this block entirely:
```makefile
# Watcher sidecar — keeps shared/dist/ up to date on the host while you edit
# shared/src/**. The override compose bind-mounts ./shared into the backend
# container (/app/shared), so ts-node-dev will pick up changes via the
# workspace symlink (node_modules/story-editor-shared → ../shared).
shared-watch:
	npx -w story-editor-shared tsc -p tsconfig.build.json --watch

```

- [ ] **Step 4: Strip the watcher from the `dev` target**

Find:
```makefile
dev: shared-build
	@( npx -w story-editor-shared tsc -p tsconfig.build.json --watch & BGPID=$$!; ps -o pgid= -p $$BGPID > .watcher.pid ) ; \
	 echo "shared watcher running in background; backend container will pick up shared/dist changes via bind-mount"
	docker compose up -d $(COMPOSE_UP_FLAGS)
	@echo "Frontend: http://localhost:3000"
	@echo "Backend:  http://localhost:4000"
```
Replace with:
```makefile
dev:
	docker compose up -d $(COMPOSE_UP_FLAGS)
	@echo "Frontend: http://localhost:3000"
	@echo "Backend:  http://localhost:4000"
```

- [ ] **Step 5: Strip the `.watcher.pid` kill from the `stop` target**

Find:
```makefile
stop:
	@docker compose down
	@if [ -f .watcher.pid ]; then PGID=$$(cat .watcher.pid | tr -d ' '); kill -- -$$PGID 2>/dev/null || true; rm -f .watcher.pid; fi
```
Replace with:
```makefile
stop:
	@docker compose down
```

- [ ] **Step 6: Drop the `shared-build` prerequisite from the `test` target**

Find:
```makefile
test: shared-build
	npm -w story-editor-backend run test
	npm -w story-editor-frontend run test
```
Replace with:
```makefile
test:
	npm -w story-editor-backend run test
	npm -w story-editor-frontend run test
```

- [ ] **Step 7: Delete the stale `.watcher.pid` working-tree file**

Run:
```bash
rm -f .watcher.pid
```
Expected: no output. (The file is gitignored and untracked — this is a plain working-tree cleanup, nothing to stage.)

- [ ] **Step 8: Verify the Makefile is watcher-free and the recipes are clean**

Run:
```bash
! grep -qE 'watcher\.pid|tsc.* --watch' Makefile && echo "OK: no watcher in Makefile"
grep -nE 'shared-build|shared-watch' Makefile || echo "OK: no shared-build/shared-watch targets"
make -n dev stop test
```
Expected: `OK: no watcher in Makefile`; `OK: no shared-build/shared-watch targets`; and `make -n` (dry-run) prints recipes for `dev` (`docker compose up -d ...` only), `stop` (`docker compose down` only), and `test` (the two `npm ... run test` lines only) — no `tsc --watch`, no `.watcher.pid`, no `shared-build`.

- [ ] **Step 9: Commit**

```bash
git add Makefile
git commit -m "$(cat <<'EOF'
[at5] delete the shared-package dev watcher from the Makefile

Remove the host-side tsc --watch spawn from `make dev`, the .watcher.pid
process-group kill from `make stop`, the shared-watch + shared-build
targets, and the shared-build prerequisites. The dev server and test
suites now resolve shared/src directly, so nothing needs shared/dist kept
fresh on the host. This also removes the `make stop` self-kill that exited
story-editor-lki's verify line 143.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Drop the dev-stage shared build — `backend/Dockerfile` + compose comment

**Files:**
- Modify: `backend/Dockerfile`
- Modify: `docker-compose.override.yml`

The dev image baked `shared/dist` at build time; the dev server no longer needs it. The builder (prod) stage keeps its build. The `./shared` bind-mount stays — the container must see `shared/src` edits — only its comment is now wrong.

- [ ] **Step 1: Remove the shared build from the Dockerfile's `dev` stage**

Find this block in `backend/Dockerfile`:
```dockerfile
# ---- dev (used by docker-compose.override.yml) ---------------------------
FROM deps AS dev
ARG PRISMA_GENERATE_DATABASE_URL
ENV NODE_ENV=development
COPY --chown=node:node . .
RUN npm -w story-editor-shared run build
RUN DATABASE_URL=${PRISMA_GENERATE_DATABASE_URL} npx -w story-editor-backend prisma generate
```
Replace with:
```dockerfile
# ---- dev (used by docker-compose.override.yml) ---------------------------
FROM deps AS dev
ARG PRISMA_GENERATE_DATABASE_URL
ENV NODE_ENV=development
COPY --chown=node:node . .
# NOTE: unlike the `builder` stage, `dev` does NOT run
# `npm -w story-editor-shared run build`. The dev server resolves
# story-editor-shared straight from shared/src via the `source` export
# condition (NODE_OPTIONS=--conditions=source in backend/package.json's
# `dev` script) — there is no shared/dist for dev to build.
RUN DATABASE_URL=${PRISMA_GENERATE_DATABASE_URL} npx -w story-editor-backend prisma generate
```

- [ ] **Step 2: Rewrite the backend `./shared` mount comment in `docker-compose.override.yml`**

Find:
```yaml
    volumes:
      # Bind-mount both source trees for hot reload: ./backend, and ./shared
      # so the host-side shared watcher's shared/dist/ rebuilds reach the
      # container.
      - ./backend:/app/backend
      - ./shared:/app/shared
```
Replace with:
```yaml
    volumes:
      # Bind-mount both source trees for hot reload: ./backend, and ./shared
      # so editing a shared Zod schema hot-reloads the backend — ts-node-dev
      # resolves story-editor-shared straight from shared/src via the `source`
      # export condition, the same way ./frontend's Vite alias works.
      - ./backend:/app/backend
      - ./shared:/app/shared
```

- [ ] **Step 3: Verify the dev image still builds and only the builder stage builds shared**

Run:
```bash
docker compose build backend
grep -n "story-editor-shared run build" backend/Dockerfile
grep -nE "watcher" docker-compose.override.yml || echo "OK: no watcher reference in override"
```
Expected: `docker compose build backend` succeeds; `grep` on the Dockerfile shows **exactly one** hit — the `builder` stage's `RUN npm -w story-editor-shared run build` (around line 40) — and **not** one in the `dev` stage; `OK: no watcher reference in override`.

- [ ] **Step 4: Commit**

```bash
git add backend/Dockerfile docker-compose.override.yml
git commit -m "$(cat <<'EOF'
[at5] stop building shared/dist in the backend dev image

The dev stage no longer runs `npm -w story-editor-shared run build` — the
dev server resolves shared/src via the `source` export condition. The
builder (prod) stage is unchanged. The ./shared bind-mount stays; its
comment is corrected (it is for hot-reloading shared/src edits, not for a
host watcher's dist rebuilds).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Drop the CI `Build shared` steps + fix `e2e.yml`'s stale comments

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/e2e.yml`

Nothing in either workflow consumes `shared/dist` once both vitest configs alias to `src`: `ci.yml`'s typechecks/builds use the `types` condition and its tests use the alias (CI never runs the compiled backend); `e2e.yml` brings up the dev compose stack (which resolves `shared` internally) and runs Playwright as a black-box browser suite that imports no app modules. While in `e2e.yml`, also correct its two stale `[T8]` comment regions.

- [ ] **Step 1: Remove the `Build shared` step from `ci.yml`**

Find:
```yaml
      - name: Install deps
        run: npm ci

      - name: Build shared
        run: npm -w story-editor-shared run build

      # ── Lint ───────────────────────────────────────────────────────────────
```
Replace with:
```yaml
      - name: Install deps
        run: npm ci

      # ── Lint ───────────────────────────────────────────────────────────────
```

- [ ] **Step 2: Remove the `Build shared` step from `e2e.yml`**

Find:
```yaml
      - name: Install root deps
        run: npm ci

      - name: Build shared
        run: npm -w story-editor-shared run build

      - name: Install Playwright browsers
```
Replace with:
```yaml
      - name: Install root deps
        run: npm ci

      - name: Install Playwright browsers
```

- [ ] **Step 3: Rewrite `e2e.yml`'s stale header comment**

Find:
```yaml
name: E2E (Playwright)

# E2E scaffold for [T8]. Brings up the full docker-compose stack (postgres
# + backend + frontend), waits for healthchecks, and runs Playwright against
# the running frontend. Intentionally on manual trigger only until T8 ships
# real tests — right now `tests/smoke.spec.ts` asserts the nginx placeholder,
# which passes but doesn't prove anything useful.
#
# To enable on every push/PR once T8 lands: uncomment the `push` and
# `pull_request` triggers below. Current gate is `workflow_dispatch` (manual
# run from the Actions tab) so the workflow is discoverable and already
# green before it starts blocking merges.
```
Replace with:
```yaml
name: E2E (Playwright)

# Brings up the full docker-compose stack (postgres + backend + frontend),
# waits for healthchecks, and runs the Playwright suite under tests/e2e/
# against the running app. T8 / T8.1 shipped real coverage (full-flow +
# smoke specs) — see docs/done/done-T.md.
#
# This workflow currently runs on manual trigger (workflow_dispatch) only.
# Whether it should also gate PRs (done-T.md and playwright.config.ts both
# describe T8 as "tier-2 PR-blocking") is an open CI-policy decision tracked
# in story-editor-7ns — do not flip the triggers without resolving that.
```

- [ ] **Step 4: Rewrite `e2e.yml`'s stale `on:` block comment**

Find:
```yaml
on:
  workflow_dispatch:
  # Once [T8] ships real E2E coverage, flip these on:
  # push:
  #   branches: [main]
  # pull_request:
```
Replace with:
```yaml
on:
  workflow_dispatch:
  # PR/push triggers intentionally left off pending story-editor-7ns:
  # push:
  #   branches: [main]
  # pull_request:
```

- [ ] **Step 5: Verify both workflows are clean and still parse**

Run:
```bash
grep -rn "Build shared" .github/workflows/ || echo "OK: no Build shared step"
grep -rn "shared run build" .github/workflows/ || echo "OK: no shared build run"
grep -niE "until T8|tests/smoke\.spec\.ts|E2E scaffold" .github/workflows/e2e.yml || echo "OK: e2e.yml stale comments gone"
git diff --check
```
Expected: `OK: no Build shared step`; `OK: no shared build run`; `OK: e2e.yml stale comments gone`; `git diff --check` prints nothing (no whitespace errors). Then read both workflow files top to bottom to confirm YAML indentation is intact around the removed steps.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/e2e.yml
git commit -m "$(cat <<'EOF'
[at5] drop the CI `Build shared` steps; fix e2e.yml stale comments

ci.yml and e2e.yml no longer build shared/dist — once both vitest configs
alias to shared/src, nothing in CI consumes the compiled output (typechecks
use the types condition, the e2e stack resolves shared internally, and the
Playwright suite is black-box). Also corrects e2e.yml's two stale [T8]
comment regions: T8/T8.1 shipped; the PR-blocking-trigger question is
tracked in story-editor-7ns.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Remove the CLAUDE.md gotcha, update the bd verify line, run the full integration check

**Files:**
- Modify: `CLAUDE.md`
- Modify: bd issue `story-editor-at5` notes (`bd update`)

Final task: delete the now-false Known-Gotchas bullet, set the real `verify:` line, and run it end-to-end. The integration run is the capstone — it proves hot-reload works *and* that `make stop`/`make dev`/`make stop` no longer self-kills.

- [ ] **Step 1: Remove the stale Known-Gotchas bullet from `CLAUDE.md`**

In `CLAUDE.md`'s "Known Gotchas" section, find and delete this entire bullet:
```markdown
- **`shared/` must be built before backend/frontend tests resolve `story-editor-shared`.** `make test` runs `shared-build` first; a bare `npm -w story-editor-backend test` (or a stale Docker image) resolves `story-editor-shared` to a stale `shared/dist/`. After changing `shared/`, run `npm -w story-editor-shared run build` (or `make shared-build`) before testing consumers.
```
(It is false after this work — the test suites resolve `shared/src` via the vitest alias — and it references the deleted `make shared-build` target.)

- [ ] **Step 2: Update the bd verify line**

The `--notes` field already carries a `plan:` line (added by `scripts/bd-link-plan.sh` before execution). Preserve it and set the new `verify:` line. Run:
```bash
bd update story-editor-at5 --notes "plan: docs/superpowers/plans/2026-05-14-eliminate-shared-dev-watcher.md
verify: rm -rf shared/dist && ! grep -qE 'watcher\.pid|tsc.* --watch' Makefile && npm -w story-editor-backend run typecheck && npm -w story-editor-backend run build && npm -w story-editor-backend run test -- tests/shared-resolution.test.ts && npm -w story-editor-frontend run test -- tests/shared-resolution.test.ts && npm -w story-editor-shared run build && npm -w story-editor-shared run typecheck && npm -w story-editor-shared run test && make stop && make dev && timeout 180 bash -c 'until docker compose exec -T backend wget -qO- http://localhost:4000/api/health 2>/dev/null | grep -q status; do sleep 3; done' && touch shared/src/index.ts && sleep 8 && docker compose logs --since=30s backend | grep -qi restarting && make stop"
```
Then confirm: `bd show story-editor-at5` shows both the `plan:` and the new `verify:` line.

- [ ] **Step 3: Run the full verify line end-to-end**

Run exactly the command on the `verify:` line above (copy it from `bd show story-editor-at5`). Run it from the repo root.

Expected: exit 0. Specifically:
- the watcher grep passes (Makefile is clean);
- backend typecheck + build pass with `shared/dist` deleted;
- both `shared-resolution.test.ts` files pass with `shared/dist` deleted (vitest aliases resolve `src`);
- shared's own build/typecheck/test pass (and `shared/dist` is restored);
- `make stop && make dev` brings the stack up with **no watcher** and **no self-kill** — the chain reaches the end;
- after `touch shared/src/index.ts`, `docker compose logs --since=30s backend` contains `Restarting` — ts-node-dev hot-reloaded on the shared-source edit;
- the final `make stop` tears the stack down.

If the `Restarting` grep fails: confirm ts-node-dev's actual restart log line with `docker compose logs backend` after a manual `touch shared/src/index.ts`, and adjust the grep marker in the `verify:` line to the exact substring observed (then re-run `bd update` and re-run the verify).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
[at5] remove the stale "build shared before tests" CLAUDE.md gotcha

The test suites resolve shared/src via the vitest alias now; the gotcha is
false and referenced the deleted `make shared-build` target. The bd verify
line is updated to the integration-test one-liner (watcher-gone grep +
typecheck/build/tests with shared/dist deleted + a make dev/stop hot-reload
cycle).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**1. Spec coverage** — every spec section maps to a task:
- `exports` map + `source` condition + backend `dev` `NODE_OPTIONS` → Task 1.
- Both vitest `resolve.alias`es → Task 2. (Spec note: the discovery that `frontend/vitest.config.ts` has no shared alias is handled — Task 2 creates it.)
- Resolution matrix / "prod resolution unchanged" → Task 1 keeps `default` → `dist`; verified in Task 1 Step 6–7 and Task 4 Step 3 (builder stage untouched).
- Deletion list — Makefile watcher/`.watcher.pid`/`shared-watch`/`shared-build` → Task 3; dev-stage Dockerfile build → Task 4; `docker-compose.override.yml` comment → Task 4; `ci.yml` + `e2e.yml` `Build shared` → Task 5; `e2e.yml` two stale comment regions → Task 5; `CLAUDE.md` gotcha → Task 6; `.watcher.pid` file → Task 3.
- The ts-node-dev `--conditions` spike → Task 1 Step 5, with the documented `tsx`-is-a-re-plan fallback.
- Verify-line shape (incl. the load-bearing `rm -rf shared/dist` step 0, shared's-own-tooling step, and the hot-reload assertion) → Task 6 Step 2–3.
- "at5 unblocks lki by construction" → Task 3 removes the `make stop` self-kill; Task 6's integration run exercises the `make stop`/`make dev`/`make stop` cycle that previously exited 143.
- Option D forward pointer → already filed as `story-editor-8i9` (no task needed).

**2. Placeholder scan** — no `TBD`/`TODO`/"handle edge cases"/"similar to Task N". Every code step shows the exact before/after. The one conditional is Task 1 Step 5's spike failure modes — these are concrete diagnoses with concrete next actions (`BLOCKED` + named fallback), not placeholders. Task 6 Step 3's "adjust the grep marker if it fails" is a concrete contingency with a concrete method, and the de-risking note at the top already pins the expected marker (`Restarting`).

**3. Type / name consistency** — `STORY_TITLE_MAX` is the same runtime export used in both resolution tests. The alias target (`../shared/src`) and `path.resolve(__dirname, ...)` form match the existing `'@'` alias in both vitest configs. The `source` condition name is consistent across `shared/package.json`, the `backend/package.json` `dev` script, the Dockerfile comment, and the compose comment. The verify-line `verify:` text in Task 6 Step 2 matches the File Map's description and the spec's verify shape.

No gaps found.
