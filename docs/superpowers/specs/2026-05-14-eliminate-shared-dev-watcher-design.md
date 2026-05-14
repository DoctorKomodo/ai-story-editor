# Eliminate the shared-package dev watcher — design

**bd issue:** story-editor-at5
**Status:** design approved 2026-05-14; pending spec review
**Branch:** `chore/claude-md-and-settings` (bundled with the story-editor-lki Docker work)

## Problem

`make dev` spawns a host-side `tsc -p shared/tsconfig.build.json --watch` process — backgrounded, its PGID tracked in `.watcher.pid`, killed by `make stop` via a process-group `kill`. It exists for one reason: the backend dev server (`ts-node-dev --respawn --transpile-only`) resolves `story-editor-shared` through the workspace symlink → `shared/package.json`'s `"main": "./dist/index.js"` — the *compiled* output. A shared-schema edit doesn't reach the running backend until `shared/dist` is rebuilt.

The frontend dev server already sidesteps this: `frontend/vite.config.ts` aliases `story-editor-shared` → `../shared/src`, so Vite compiles shared from source and needs no watcher.

Two costs of the watcher:

1. **Fragile lifecycle.** It's a host process in an otherwise fully-containerized dev flow. A process backgrounded in a non-interactive `make` recipe shares the recipe's process group, so `make stop`'s `kill -- -$PGID` can SIGTERM unrelated work — this is the latent bug that made story-editor-lki's close-gate verify line exit 143.
2. **The same `dist` coupling hits the test suites.** Neither `backend/vitest.config.ts` nor `frontend/vitest.config.ts` aliases `story-editor-shared`, so both test runners resolve through `shared/dist`. That's why `make test` runs `shared-build` first, `ci.yml`/`e2e.yml` carry a `Build shared` step, and CLAUDE.md carries a "build shared before tests" gotcha.

## Goal

Make the backend dev server **and** both test suites resolve `story-editor-shared` to `shared/src` directly, so the watcher and every `shared/dist`-for-dev/test coupling can be deleted. Production resolution behaviour is unchanged: the prod backend is a `tsc`-compiled CommonJS process and must `require()` compiled JS, so prod stays on `shared/dist`.

## Approach — Option C (hybrid resolution)

Two mechanisms, each picked for the consumer where it's most robust.

### `shared/package.json` — `exports` map with a `source` condition

```json
"exports": {
  ".": {
    "types":   "./src/index.ts",
    "source":  "./src/index.ts",
    "default": "./dist/index.js"
  }
}
```

`exports` is Node's entry-point map; a resolver walks the conditions top-down and takes the first active one. `types` is active during TypeScript type resolution; `source` is active **only** when a process opts in with `--conditions=source`; `default` always matches.

The condition is named `source`, not `development`, deliberately: `development`/`production` are names Vite already ascribes meaning to, so a `development` condition in shared's manifest could be flipped on by a tool by accident. `source` is the established community convention for "the unbundled-source entry point" — it says what it does and collides with nothing.

`exports` is *sealing*: once present, `main` is ignored by modern resolvers and unlisted deep imports throw. Verified safe — every backend and frontend import is the bare `story-editor-shared` specifier, and `shared/src/index.ts` is a single barrel export. Top-level `main`/`types` are kept as a harmless fallback for any resolver that ignores `exports`.

### Backend dev server — opt into the `source` condition

`backend/package.json`'s `dev` script:

```
NODE_OPTIONS=--conditions=source ts-node-dev --respawn --transpile-only src/index.ts
```

Node resolves `story-editor-shared` → `shared/src/index.ts`; ts-node-dev's `.ts` require-hook transpiles it in-memory (`--transpile-only`); `--respawn` adds it to the watch set, so editing `shared/src/**` respawns the backend. `NODE_OPTIONS` is set in the `dev` script only — `npm start` (prod) never sees it.

### Both test suites — flat `resolve.alias`

`backend/vitest.config.ts` and `frontend/vitest.config.ts` each get:

```ts
resolve: { alias: { 'story-editor-shared': path.resolve(__dirname, '../shared/src') } }
```

An alias rewrites the specifier to a path plainly outside `node_modules`, so Vitest's externalization heuristic never gets to ask the "externalize vs. inline" question — it transforms `shared/src` as first-party source, deterministically. This is why tests use an alias rather than the `source` condition: for an externalized `node_modules` dep, `resolve.conditions` is not reliably consulted, and forcing it back in (`server.deps.inline`) is the fragile path. The alias mirrors the existing `frontend/vite.config.ts` precedent.

**Discovery during spec authoring:** `frontend/vitest.config.ts` has *no* `story-editor-shared` alias today (only `'@'`) — the Vite alias lives in `frontend/vite.config.ts`, which Vitest does not inherit. So frontend tests currently resolve through `shared/dist` too. Delivering the chosen scope — drop `make test`'s `shared-build`, the CLAUDE.md gotcha, and the CI `Build shared` step, all of which also serve frontend tests — *requires* the same one-line alias in `frontend/vitest.config.ts`. It is folded in: one line, mirrors frontend Vite, zero risk.

### Production — unchanged behaviour

`node` runs without `--conditions`, so prod resolves `story-editor-shared` via the `default` condition → `shared/dist/index.js` — byte-identical outcome to today's `main`. `backend/Dockerfile`'s **builder** stage still runs `npm -w story-editor-shared run build`; the **runner** stage still copies and resolves `shared/dist`. The frontend's Vite alias rewrites the specifier before resolution consults `exports`, so the frontend build is unaffected.

## Resolution matrix (after this change)

| Consumer | Mechanism | Resolves to |
|---|---|---|
| Backend dev server (`ts-node-dev`) | `--conditions=source` → `exports.source` | `shared/src/index.ts` |
| Backend tests (`vitest`) | `resolve.alias` | `shared/src` |
| Frontend dev / build (`vite`) | existing `resolve.alias` | `shared/src` |
| Frontend tests (`vitest`) | **new** `resolve.alias` | `shared/src` |
| Frontend typecheck (`tsc -b`, `moduleResolution: "bundler"`) | `exports.types` | `shared/src/index.ts` (types only — same file as today's top-level `types`) |
| Backend typecheck / build (`tsc`, `NodeNext`) | `exports.types` | `shared/src/index.ts` (types only — unchanged from today's `types`) |
| Backend prod runtime (`node`) | `exports.default` | `shared/dist/index.js` (unchanged) |

## What gets deleted

- **Makefile** — the inline watcher spawn in `dev`; the `.watcher.pid` kill in `stop`; the standalone `shared-watch` target; `shared-build` as a prerequisite of `dev` and `test`; the now-orphaned `shared-build` target itself; the `.PHONY` entries for `shared-build`/`shared-watch`.
- **backend/Dockerfile** — `RUN npm -w story-editor-shared run build` in the **dev** stage (dev no longer needs `dist`). The builder stage's copy of that line stays.
- **docker-compose.override.yml** — the `./shared:/app/shared` backend mount **stays** (the container must see `shared/src` edits); only its comment is rewritten — no longer "so the host watcher's rebuilds reach the container," now "so editing `shared/src` hot-reloads the backend, the way `./frontend` does for Vite."
- **.github/workflows/ci.yml** — the `Build shared` step. Nothing in CI consumes `shared/dist` once both vitest configs alias to `src`: typechecks and builds use the `types` condition / Vite alias, and CI never runs the compiled backend.
- **.github/workflows/e2e.yml** — the `Build shared` step. Vestigial, exactly like `ci.yml`'s. The e2e job brings up the dev compose stack (which resolves `shared` internally — dev backend via the `source` condition, dev frontend via the Vite alias) and then runs Playwright as a *black-box browser suite* against the running app (`playwright.config.ts` drives a browser at `baseURL`; it imports no app modules). No file under `tests/` imports `story-editor-shared` — verified by grep — so nothing in the e2e path consumes `shared/dist`.
  While editing this file, also fix its **two stale comment regions** — the header block and the `on:` trigger block both claim T8 hasn't shipped and point at a `tests/smoke.spec.ts` that is now `tests/e2e/smoke.spec.ts`; T8 and T8.1 are both done (`docs/done/done-T.md`). The fix makes the comments *honest about the current state* (the workflow runs `workflow_dispatch`-only) — it does **not** flip the triggers. Whether e2e.yml should now be PR-blocking — `done-T.md` and `playwright.config.ts` both describe T8 as "tier-2 PR-blocking", yet the workflow is still manual-only — is a CI-policy decision outside at5's scope, filed as **story-editor-7ns**.
- **CLAUDE.md** — the "`shared/` must be built before backend/frontend tests resolve `story-editor-shared`" gotcha.
- **.watcher.pid** — the stale working-tree file (gitignored, not tracked — a plain `rm`).

Not touched:

- **README.md** — it has no watcher or `shared-build` references; its `make dev` mentions are generic "start the stack."
- **Historical plan/spec docs** under `docs/superpowers/` — a `grep` for `shared-build` also hits the lki plan (`plans/2026-05-14-dev-container-permissions.md`) and `plans/2026-05-11-character-entity-consolidation.md`. These are immutable historical records, left alone. Called out explicitly because the lki plan is on *this same branch* — an implementer running that grep should not update it.

## Edge cases & risks

1. **ts-node-dev honouring `--conditions` — the one spike.** The implementation plan's first task confirms `NODE_OPTIONS=--conditions=source` reaches ts-node-dev's respawned child and that its `.ts` hook transpiles a `.ts` path returned by Node's `exports` resolution. Fallback if it does not: switch the dev runner from `ts-node-dev` to **`tsx`** (`tsx watch`) — a modern, actively-maintained replacement with Node-compatible conditions resolution. That is a bigger change than a flag (it swaps the dev runner) but carries no footgun. The fallback is deliberately *not* `tsconfig-paths`: that would reintroduce exactly the cross-`rootDir` + `NodeNext` rough edges this design rejected when it ruled out Option B. The vitest aliases are unaffected by the spike outcome either way.
2. **`exports` sealing.** Verified safe (bare specifiers only, single barrel). The plan re-greps both `backend/src` and `frontend/src` for any `story-editor-shared/...` deep import before landing the `exports` map.
3. **Frontend `exports` impact is type-resolution only.** The Vite alias (dev/build) and the new frontend vitest alias both bypass `exports` entirely. The frontend *typecheck*, however, does consult it: `frontend/tsconfig.app.json` sets `moduleResolution: "bundler"`, which reads `exports` — so `tsc -b` resolves `story-editor-shared` via `exports.types`. That lands on `./src/index.ts`, the same file today's top-level `types` field points at, so there is no behaviour change — but the design states *why* it's safe rather than claiming the frontend is untouched. The plan confirms a frontend typecheck + test run + build all still resolve `shared/src`.

## Testing & verification

This is a resolution / build-config change — its "tests" are the existing suites passing under the new resolution, plus a runtime hot-reload check. The bd verify line (at5's notes ask for a hot-reload assertion) takes this shape, with the exact respawn-log marker and wait timeouts pinned in the implementation plan:

0. **`rm -rf shared/dist` first — load-bearing, not optional.** On any dev machine `shared/dist` already exists from earlier builds, so steps 2–3 would pass even if resolution still wrongly pointed at `dist`. Deleting `dist` up front is what makes the verify a real regression test rather than a no-op.
1. `! grep -qE 'watcher\.pid|tsc.* --watch' Makefile` — the watcher is gone.
2. `npm -w story-editor-backend run typecheck && npm -w story-editor-backend run build` — the prod compile path still works with `shared/dist` absent (tsc resolves types from `shared/src` and does not need `dist` to emit).
3. The backend **and** frontend suites pass with `shared/dist` deleted — proves both vitest configs resolve `shared/src`. (`make test` with its `shared-build` prerequisite removed is exactly this, given step 0.)
4. `npm -w story-editor-shared run build && npm -w story-editor-shared run typecheck && npm -w story-editor-shared run test` — confirms the `exports`-map change didn't disturb shared's own tooling, and restores `shared/dist` for normal dev afterward.
5. Runtime hot-reload — `make stop && make dev`, wait for the backend healthy, `touch shared/src/index.ts`, wait, assert the backend dev server respawned (grep its recent logs for the respawn marker), `make stop`.

Step 5's `make stop` / `make dev` / `make stop` cycle is now *safe* — this change removes the watcher self-kill from `make stop`, the latent bug that made story-editor-lki's verify line exit 143. **at5 unblocks lki by construction.**

## Sequencing

at5 lands on `chore/claude-md-and-settings`, on top of the lki commits already there. Once at5 lands, lki's verify line passes (no watcher to self-kill), and lki + at5 close together. The `blocked-by lki` edge on at5 was merge-conflict-avoidance on `backend/Dockerfile`'s dev stage — moot on a single shared branch.

## Forward pointer — Option D (not in scope)

A/B/C all keep prod on `shared/dist` because `tsc` does not rewrite module specifiers — `import 'story-editor-shared'` must hit a resolvable package at runtime. The only escape is to *have no runtime specifier*: bundle `shared/src` into the backend's prod artifact (esbuild / tsup), so shared is inlined at build time — no `shared/dist`, no `exports` map, no `source` condition. `shared` is pure Zod/TS and bundles trivially (none of the Prisma / native-dep hazards that make bundling backends painful — those stay external). Under D, dev/test keep a plain alias; only this design's `exports`-map work is superseded — the vitest aliases survive.

D is **out of at5's scope**: it is a change to the backend *build toolchain* with its own review surface (Prisma codegen, source maps, the `dist/` layout the runner stage copies) — a different system from "restructure to kill the watcher," and the kind of architectural call CLAUDE.md says to surface separately. Filed as its own bd issue: **story-editor-8i9**, carrying a `depends-on story-editor-at5` edge so `bd ready` won't surface it until at5 closes.
