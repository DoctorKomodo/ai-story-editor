# Bundle `story-editor-shared` into the backend prod artifact — design

**bd issue:** story-editor-8i9
**Status:** design approved 2026-05-14 (revised after external spec review); pending spec review
**Branch:** `feature/bundle-shared-prod`

## Problem

After story-editor-at5, the backend dev server and both test suites resolve
`story-editor-shared` from `shared/src`, but **prod still resolves
`shared/dist`**: the prod backend is a `tsc`-compiled CommonJS process, so
`backend/dist/index.js` contains a literal `require('story-editor-shared')`
that must hit a resolvable package at runtime (`tsc` does not rewrite module
specifiers).

That single fact is the root that forces everything above it:

1. `shared/dist` must exist for prod to resolve — so the `shared` build step
   lives on in `backend/Dockerfile`'s builder stage, and `shared/dist` is
   copied into the runner stage.
2. So the `exports` map + custom `source` condition must exist, so dev/test
   can opt *out* of `dist` toward `src`.
3. So `--conditions=source` must be threaded into every Node subprocess that
   transitively imports shared — the backend `dev` script, `make seed`, and
   the `[E12]` leak test's seed `spawnSync` env. story-editor-9mk was exactly
   this leaking: a subprocess that forgot the flag resolved `shared/dist`,
   which isn't built for dev/test/CI after at5.

## Goal

Remove the root cause. **Bundle `story-editor-shared` into the backend's prod
artifact at build time**, so `backend/dist/index.js` is self-contained — it
has no `require('story-editor-shared')` specifier to resolve at runtime at
all. With no runtime specifier, `shared/dist`, the `exports` map, the `source`
condition, all `--conditions=source` threading, and the `shared` build step
all become unnecessary and are deleted. The prod runtime stays the boring,
well-understood `node dist/index.js`.

Separately — and orthogonally — the backend's TypeScript runner moves off the
semi-stale `ts-node-dev` (and the transitive `ts-node` it drags in) onto
`tsx`, for the dev server, the seed script, the Venice probe, and the
one-off admin script. `tsx` is a **build/dev tool only** — it never enters the
prod runtime image.

## Approach — bundle for prod, tsx for dev/scripts

### The prod artifact — `tsup`

The backend's `build` script moves from bare `tsc` to **`tsup`** (a thin,
config-light wrapper over esbuild). `tsup` externalises everything in
`dependencies` by default — Prisma, `argon2`, `pg`, `express`, `zod`, etc. all
stay external and are installed normally by `npm ci` in the runner stage. The
only thing inlined is `story-editor-shared`, via an explicit
`noExternal: ['story-editor-shared']`. `shared` is pure Zod/TS — it bundles
trivially, with none of the native-dep or dynamic-`require` hazards that make
bundling a whole backend painful.

`backend/tsup.config.ts` (new file — the plan pins exact contents):

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],          // backend is "type": "commonjs"; prod stays node dist/index.js
  platform: 'node',
  target: 'node24',         // matches node:24-alpine
  sourcemap: true,          // prod stack traces map back to source
  clean: true,
  minify: false,            // keep require() calls greppable — the CI inline assertion depends on it
  // story-editor-shared is pure Zod/TS — inline it so the prod artifact has
  // no `story-editor-shared` runtime specifier. Everything else in
  // node_modules (Prisma, argon2, pg, express, …) stays external by default.
  noExternal: ['story-editor-shared'],
});
```

Output is `backend/dist/index.js` (+ `.map`) — same path the runner stage
already copies. Prod entry stays **`exec node --enable-source-maps
dist/index.js`** — `node` is the directly-`exec`'d process, so `docker stop`'s
SIGTERM reaches the app with no wrapper or loader process in the signal path.
(`--enable-source-maps` is a small deliberate add: with a bundle, source maps
are what keep stack traces readable.)

### The dev / script runner — `tsx`

`tsx` (esbuild under the hood) replaces `ts-node-dev` **and** the transitive
`ts-node` for everything that runs TypeScript source directly:

| Entry point | Before | After |
|---|---|---|
| Backend dev server | `NODE_OPTIONS=--conditions=source ts-node-dev --respawn --transpile-only src/index.ts` | `tsx watch src/index.ts` |
| Seed | `... -e NODE_OPTIONS=--conditions=source ... npx ts-node --transpile-only prisma/seed.ts` | `npx tsx prisma/seed.ts` |
| Venice probe | `ts-node scripts/venice-probe.ts` | `tsx scripts/venice-probe.ts` |
| Recovery-rotation admin script (usage string only) | `ts-node prisma/scripts/force-recovery-rotation.ts …` | `tsx prisma/scripts/force-recovery-rotation.ts …` |

`tsx` resolves `story-editor-shared` straight from `shared/src` via the
package's plain `main` (see below) — no condition, no alias. `tsx watch` adds
`shared/src` to its watch set, so editing a shared schema respawns the dev
backend, exactly as `ts-node-dev --respawn` did.

### `shared/package.json` — final shape

```json
{
  "name": "story-editor-shared",
  "version": "0.1.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": { "zod": "^4.4.3" },
  "devDependencies": { "typescript": "^6.0.3", "vitest": "^4.1.5" }
}
```

- `main` → `./src/index.ts` (was `./dist/index.js`).
- `exports` map **removed entirely** — the at5 work, fully superseded.
- `build` script **removed**; `shared/tsconfig.build.json` **deleted**;
  `shared/dist/` **deleted** (gitignored, untracked — a plain `rm -rf`).

`main` pointing at a `.ts` file is safe because **no plain-`node` process ever
resolves `story-editor-shared`**: `tsup` resolves it at build time and inlines
it; `tsx` (dev/seed/probe/admin) transpiles on the fly; `vitest` uses
`resolve.alias`; `vite`/`tsc` use `resolve.alias` / `types`. The prod runtime
resolves nothing — `shared` is already inside the bundle.

## Dependency classification

The prod runtime image contains **no TypeScript toolchain**. `tsx`, `tsup`,
`typescript`, `esbuild` (pulled in by `tsup`), and `story-editor-shared` are
all **`devDependencies`** of the backend; the runner stage's `npm ci
--omit=dev` drops every one of them. Specifically:

- `story-editor-shared` moves `dependencies` → **`devDependencies`** — it is
  inlined into the bundle at build time and not needed at runtime.
- `tsx` is **added** to `devDependencies` (dev server + seed + probe + admin
  script).
- `tsup` is **added** to `devDependencies` (the build tool).
- `ts-node-dev` is **removed** from `devDependencies`.
- `typescript` stays a `devDependency` (`tsc` is the typecheck gate; `tsup`
  uses esbuild and does not need it).
- `zod` stays a backend `dependency` — `tsup` keeps it external, and the
  bundle `require()`s it at runtime, so `npm ci --omit=dev` must install it.

Use the current stable for new deps (`npm view tsx version` /
`npm view tsup version` at plan time — 4.22.0 / 8.5.1 as of writing).

## Resolution matrix (after this change)

| Consumer | Mechanism | Resolves to |
|---|---|---|
| Backend prod runtime (`node dist/index.js`) | nothing — `shared` is inlined into the bundle | — |
| Backend prod build (`tsup`) | package `main` + `noExternal` | `shared/src/index.ts` (inlined) |
| Backend dev / seed / probe / admin (`tsx`) | package `main` | `shared/src/index.ts` |
| Backend tests (`vitest`) | `resolve.alias` | `shared/src` |
| Backend typecheck (`tsc`, `NodeNext`) | package `types` | `shared/src/index.ts` (types only) |
| Frontend dev / build / tests (`vite` / `vitest`) | `resolve.alias` | `shared/src` |
| Frontend typecheck (`tsc -b`, `moduleResolution: bundler`) | package `types` | `shared/src/index.ts` (types only) |

No `dist`, no conditions, no subprocess flag-threading anywhere. (at5's matrix
had three mechanisms — condition, alias, types — plus a `shared/dist` prod
row.)

## What changes

### `backend/Dockerfile`

- **`builder` stage stays, simplified.** `RUN npm -w story-editor-shared run
  build` is **deleted** (`tsup` inlines `shared/src`; there is no
  `shared/dist`). The stage becomes `COPY . .` → `prisma generate` → `npm -w
  story-editor-backend run build` (now `tsup`).
- **`dev` stage stays**, essentially unchanged — it already does not build
  shared (at5 removed that). Its `--conditions=source` NOTE comment is
  rewritten to describe the `tsx` model; it runs `tsx watch` via the `dev`
  script.
- **`runner` stage, simplified.** `COPY --from=builder /app/shared/dist
  ./shared/dist` is **deleted** (no `shared/dist` exists). `-w
  story-editor-shared` is **removed** from the runner's `npm ci` line —
  `shared` is no longer a runtime dependency. The `npm ci --omit=dev
  --ignore-scripts` flags are otherwise **unchanged and unaffected**: `tsup`
  and `esbuild` are `devDependencies` and never reach this stage, so
  `--ignore-scripts` has nothing new to break here.
- Stays `deps → builder → dev → runner` — multi-stage, satisfying CLAUDE.md's
  "multi-stage only" rule.

### `backend/docker-entrypoint.sh`

`exec node dist/index.js` → `exec node --enable-source-maps dist/index.js`.
The `npx prisma migrate deploy` line is unchanged.

### `backend/package.json`

- `build` → `tsup` (was `tsc`).
- `dev` → `tsx watch src/index.ts`.
- `start` → `node --enable-source-maps dist/index.js`.
- `venice:probe` → `tsx scripts/venice-probe.ts`.
- `typecheck` stays `tsc --noEmit` — `tsc` remains the pure type gate.
- `ts-node-dev` removed; `tsx` + `tsup` added to `devDependencies`;
  `story-editor-shared` moved to `devDependencies` (see *Dependency
  classification*).
- `main` stays `dist/index.js` — still correct (the build still produces it).

### `backend/tsconfig.json`

The now-dead `"ts-node": { "transpileOnly": true }` block is removed (neither
`tsx` nor `tsup` reads it). `tsc`'s emit-related options (`outDir`,
`sourceMap`, `incremental`) are harmless under `--noEmit` and left alone to
keep the diff focused.

### `backend/tsup.config.ts`

New file — contents as shown under *The prod artifact* above; the plan pins
the exact final config.

### `Makefile`

The `seed` target loses `-e NODE_OPTIONS=--conditions=source` and switches
`npx ts-node --transpile-only` → `npx tsx`; the two-line `--conditions=source`
comment (added by 9mk) is removed.

### `backend/tests/security/encryption-leak.test.ts`

The 9mk fix is reverted at the root: the `spawnSync` env's
`NODE_OPTIONS: [..., '--conditions=source']` injection is **deleted**, the
seed `spawnSync` switches `ts-node` → `tsx`, and the stale `npx ts-node
prisma/seed.ts` comment above it is updated to `tsx`.

### `backend/prisma/scripts/force-recovery-rotation.ts`

The `Usage:` help string referencing `ts-node` → `tsx` (string only — no
behaviour change).

### `docker-compose.override.yml`

The backend `./shared` mount **stays** — `tsx watch` must see `shared/src`
edits. Only its comment, which references `ts-node-dev`, is rewritten to
describe the `tsx` model.

### `.github/workflows/ci.yml`

- The **"Backend build"** step stays — `npm -w story-editor-backend run build`
  now runs `tsup`. (A real build still catches a class of errors `tsc
  --noEmit` does not.)
- **Add a bundle-inlining assertion** right after the build: assert
  `backend/dist/index.js` contains **no** bare `story-editor-shared` specifier
  (proves it was inlined) and **does** still reference an externalised dep
  such as `@prisma/client` (proves externals were not over-bundled). Near-free,
  no DB needed.
- **Add a "Backend boot smoke"** after the existing "Prisma migrate (test DB)"
  step (it needs a migrated DB): boot the **built artifact** — `node
  dist/index.js` — against the CI Postgres with the app's boot-time env, poll
  `/api/health` until `{"status":"ok"}`, then kill. The plan pins the exact
  YAML and enumerates the boot-time env (notably `APP_ENCRYPTION_KEY`, which CI
  currently leaves `backend/tests/setup.ts` to synthesise — the app boot path
  does not run that file).

Together these give CI a real, cheap, Docker-free guard on the prod resolution
path — the build proves the bundle compiles, the grep proves `shared` is
inlined, the smoke proves the artifact boots. What CI still does **not** cover
is Dockerfile-packaging regressions (a missed `COPY`, a wrong `--omit`); that
is covered by the bd verify line's full Docker build + boot (step 6 below).
This split is deliberate and stated rather than left implicit.

### `CLAUDE.md`

The Known Gotcha "Docker hot reload for the backend requires `ts-node-dev` or
`nodemon`… the production Dockerfile does not include these" is now false —
hot reload is `tsx watch`. It is rewritten. The plan also greps `CLAUDE.md`
for any other `ts-node` / backend-build references and corrects them.

### Not touched

- All three `resolve.alias` entries (`backend/vitest.config.ts`,
  `frontend/vitest.config.ts`, `frontend/vite.config.ts`) — at5 got these
  right; `vitest` needs an explicit alias regardless of how prod resolves.
- at5's `backend/tests/shared-resolution.test.ts` and
  `frontend/tests/shared-resolution.test.ts` regression guards.
- The entire frontend build path and `frontend/Dockerfile` — the frontend
  already resolves `shared` via the Vite alias.
- `backend/prisma.config.ts` — it does not import `story-editor-shared`; it is
  loaded by the `prisma` CLI (see risk 1).
- `docker-compose.yml` — the backend prod service targets the `runner` stage,
  which still exists; no change expected. The plan confirms it does not name
  the `builder` stage.
- `.github/workflows/e2e.yml` — at5 already removed its `Build shared` step
  (verified: a grep for `build`/`builder`/`shared`/`dist` in that file returns
  nothing). The plan confirms before relying on it.

## Edge cases & risks

1. **Prisma config loading without `ts-node` — the one spike, concretely
   de-risked.** `backend/prisma.config.ts` is TypeScript, loaded by the
   `prisma` CLI (`prisma generate`, `prisma migrate deploy`). Removing
   `ts-node-dev` removes the transitive `ts-node`. **`@prisma/config@7.8.0` is
   confirmed installed as a direct dependency of `prisma@7.8.0`** — Prisma 7
   has its own config-loader package and does not lean on transitive
   `ts-node`. The plan's first task still runs the spike (verify `npx prisma
   generate` + `npx prisma migrate deploy` succeed with `ts-node` /
   `ts-node-dev` uninstalled) — but it is a confirmation, not a gamble.
   Fallback if it somehow fails: `NODE_OPTIONS=--import tsx` on the prisma
   invocations. This risk applies regardless of bundle-vs-tsx-runtime.
2. **`tsup` externals correctness.** `tsup` externalises `dependencies` by
   default, so Prisma / `argon2` / `pg` / `express` / `zod` stay external with
   no per-dep config. The load-bearing premise — checked, not assumed — is that
   the Prisma schema uses the default `prisma-client-js` generator output and
   every `@prisma/client` import is a bare specifier (`from '@prisma/client'`),
   so the client resolves from `node_modules` and `tsup` externalises it
   cleanly; a custom generator `output` path or a relative client import would
   change this. `noExternal: ['story-editor-shared']` is the single explicit
   inlining directive. The bundle-inlining CI assertion (above) plus the boot
   smoke catch a mistake immediately, and the plan confirms the built bundle
   still `require()`s the native/heavy deps and inlines only `shared`.
3. **`exports` removal is safe by construction.** Removing a seal can only
   *widen* what resolves, never break a bare-specifier import. The plan
   re-greps `backend/src` + `frontend/src` for any `story-editor-shared/...`
   deep import (none today) before landing the change.
4. **`.dockerignore`.** The runner stage's new/changed `COPY`s are all
   `COPY --from=builder …` (stage-to-stage, which `.dockerignore` does not
   filter) — there are no new *context* `COPY`s — so `.dockerignore` excluding
   `dist/` is fine and intentional. The plan confirms `.dockerignore` still
   permits the builder stage's `COPY . .` to bring in `shared/src` (it does:
   `.dockerignore` excludes `dist`/`tests`/`node_modules`, not `src` or
   `*.ts`).
5. **`ts-node` re-grep breadth.** The plan greps for `ts-node` and
   `conditions=source` across `backend/`, `Makefile`,
   `docker-compose.override.yml`, and `.github/workflows/` — wider than at5's
   `backend/ + Makefile` — to enumerate every site (the known set:
   `backend/package.json`, `backend/tsconfig.json`,
   `backend/tests/security/encryption-leak.test.ts`,
   `backend/prisma/scripts/force-recovery-rotation.ts`, `Makefile`,
   `docker-compose.override.yml`). `docs/` is excluded — historical records,
   like at5 handled them.
6. **Bundler-characteristic hazards — checked, none present.** The classic
   ways bundling a Node app goes wrong — `__dirname` / `__filename` /
   `import.meta` references, dynamic `require()` with a computed specifier, and
   reads of asset files relative to the source location — were all greped for
   across `backend/src` and are absent. `story-editor-shared` itself is pure
   Zod/TS with none of them either. This is why `shared` is the easy case for
   bundling; the plan re-confirms the grep before landing `tsup`.

## Why bundle, not run `tsx` in prod

An alternative reaching the same end state runs `tsx` in prod too (`node
--import tsx src/index.ts`), deleting the build step entirely. It was the
working proposal until external spec review. The bundle was chosen because the
trade favours it for a production runtime: `node dist/index.js` keeps the prod
signal path wrapper-free, the image carries no TS toolchain (`tsx` + `esbuild`
~10 MB stay out of it), there is no per-boot transpile cost, and — decisively —
CI can verify the **actual built artifact** cheaply and Docker-free (build +
inline-grep + boot smoke), whereas the test suites never exercise a `tsx`-based
resolution path at all. `tsx`-in-prod wins only on diff size — a one-time cost,
traded here against permanent runtime characteristics. Recorded so the trade
is visible, not lost.

## Relationship to the 8i9 issue text

This design implements the 8i9 issue's stated intent directly — "bundle
`shared/src` into the backend's prod artifact … so there is NO
`story-editor-shared` runtime specifier in prod at all — no `shared/dist`, no
`exports` map, no `source` condition." The issue suggested "esbuild/tsup"; this
spec picks **`tsup`** (esbuild with a config-light wrapper). On close, the 8i9
issue description gets a one-line update pointing at this spec.

## Testing & verification

A resolution / build-config change — its "tests" are the existing suites
passing under the new resolution, plus prod-artifact checks. The bd verify
line takes the shape below; the implementation plan pins exact commands,
markers, and timeouts.

0. **`rm -rf shared/dist backend/dist` first — load-bearing, not optional.**
   These dirs already exist on any dev machine from earlier builds, so later
   steps would pass even if resolution still wrongly pointed at `dist`.
   Deleting them up front makes the verify a real regression test (same
   reasoning as at5's verify step 0).
1. **Machinery is gone:** no `conditions=source` or `ts-node` reference in
   `backend/`, `Makefile`, `docker-compose.override.yml`, or
   `.github/workflows/`; no `shared/tsconfig.build.json`; `shared/package.json`
   has no `exports` map and no `build` script.
2. **All three typechecks pass** (`shared`, `backend`, `frontend`) with no
   `dist` present — proves type resolution works off `shared/src`.
3. **All three test suites + shared tests pass** with no `dist` present —
   proves the vitest aliases resolve `shared/src` and nothing regressed,
   including the `[E12]` leak test whose seed subprocess now spawns `tsx`.
   (The plan sequences `make dev` + a healthcheck wait *before* this step:
   backend vitest's `globalSetup` unconditionally runs `db-test-reset.sh`
   against the compose Postgres, so a clean-state `/bd-close-reviewed` run
   fails without the stack up — a footgun already recorded in bd memory.)
4. **Build + inline assertion:** `npm -w story-editor-backend run build`
   produces `backend/dist/index.js`; assert it contains **no**
   `require("story-editor-shared")` call (the specifier was inlined — the grep
   matches the `require()` call form, not the bare substring, which can survive
   in a comment or string) and **does** still `require("@prisma/client")`
   (externals intact). `minify: false` in `tsup.config.ts` keeps these calls
   greppable by design.
5. **Artifact boot smoke:** `node dist/index.js` against a Postgres, `curl
   /api/health` → `{"status":"ok"}` — verifies the built bundle boots, no
   Docker needed.
6. **Full Docker image build + boot:** `docker compose -f docker-compose.yml
   build backend`, boot it against a Postgres, `curl /api/health`. Catches
   Dockerfile-packaging regressions (missed `COPY`, wrong `--omit`) that
   step 5 cannot. The plan pins how the throwaway DB + env are provided.
7. **Dev hot-reload under `tsx`:** `make stop && make dev`, wait for the
   backend healthy, `touch shared/src/index.ts`, wait, assert the backend dev
   server respawned (grep its recent logs for the `tsx` respawn marker),
   `make stop`.
8. **Shared's own tooling:** `npm -w story-editor-shared run typecheck && npm
   -w story-editor-shared run test` — confirms removing `exports` + the
   `build` script did not disturb shared's own typecheck/test.

## Sequencing

8i9 lands on its own branch, `feature/bundle-shared-prod`, cut from `main`
after PR #106 (at5 + lki) merged. It has no dependency on other open work and
nothing currently open depends on it.

## Forward pointer — Node native type stripping (not in scope)

The truly minimal steady state is `node src/index.ts` with no bundler and no
`tsx` — Node 24's native type stripping. It was evaluated and rejected for
8i9: it requires the backend to become ESM (strip-only mode does not transpile
`import`→`require`, so a `"type": "commonjs"` `.ts` file with `import` syntax
fails), a repo-wide sweep adding explicit extensions to all ~115 extensionless
relative imports, rewriting two `constructor(public readonly …)` parameter
properties, and resolving an open question about whether Node will type-strip
a workspace `.ts` dep reached through the `node_modules` symlink — plus it is
still experimental in Node's stability index. That is an ESM-migration-sized
project, not an 8i9-sized change. It is worth its own bd issue, gated behind a
separate backend-ESM-migration issue; this design deliberately keeps the
backend on CommonJS and unblocks that future path without requiring it.
