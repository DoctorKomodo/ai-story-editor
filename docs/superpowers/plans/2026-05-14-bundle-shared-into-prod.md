# Bundle `story-editor-shared` into the Backend Prod Artifact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bundle `story-editor-shared` into the backend's prod artifact with `tsup` so `backend/dist/index.js` is self-contained — no `story-editor-shared` runtime specifier — which lets `shared/dist`, the `exports` map, the `source` condition, and all `--conditions=source` threading be deleted; and swap the backend's TS runner from `ts-node-dev`/`ts-node` to `tsx` for the dev server and all TS scripts.

**Architecture:** Option D from the design doc. The backend `build` script moves from bare `tsc` to `tsup` (esbuild wrapper), which externalises every `node_modules` dependency by default and inlines only `story-editor-shared` via `noExternal`. Prod runtime stays plain `node dist/index.js`. `tsx` replaces `ts-node-dev` + the transitive `ts-node` as a **devDependency** — it never enters the prod image. `shared/package.json` drops to a plain `main: ./src/index.ts`.

**Tech Stack:** npm workspaces, Node 24, tsup (esbuild), tsx, Prisma 7, Vitest, Docker Compose (multi-stage), GitHub Actions, GNU Make.

**Spec:** `docs/superpowers/specs/2026-05-14-bundle-shared-into-prod-design.md` — read it first; it carries the *why* (Option D vs running tsx in prod, the dependency-classification rationale, the resolution matrix, the two-review-pass history, and native type stripping as a forward pointer).

**Pre-planning de-risking already done (do not re-run, just be aware):**
- **No deep imports of `story-editor-shared`** anywhere in `backend/src`, `frontend/src`, `shared/src` — every import is the bare specifier. Removing the `exports` map is safe (spec risk 3).
- **`@prisma/config@7.8.0` is installed as a direct dependency of `prisma@7.8.0`.** Prisma 7 has its own config-loader package and does not lean on the transitive `ts-node`. The Task 2 spike (Prisma loads `prisma.config.ts` with `ts-node` gone) is a confirmation, not a gamble (spec risk 1).
- **Bundler-characteristic hazards are absent** — `__dirname`/`__filename`/`import.meta`/dynamic-`require`/source-relative asset reads were greped across `backend/src`: none present. `story-editor-shared` is pure Zod/TS (spec risk 6).
- **Current stable versions:** `tsup` 8.5.1, `tsx` 4.22.0 (confirmed via `npm view`). Use whatever `npm view` reports at execution time.
- **The `ts-node` site enumeration** (the wider re-grep from the spec, spec risk 5): `backend/package.json` (`dev`, `venice:probe`, the `ts-node-dev` devDep), `backend/tsconfig.json` (the `ts-node` block), `backend/tests/security/encryption-leak.test.ts` (the seed `spawnSync` + a comment), `backend/prisma/scripts/force-recovery-rotation.ts` (a usage string), `Makefile` (the `seed` target), `docker-compose.override.yml` (a comment). All six are addressed across Tasks 1–2.

---

## File Map

| File | Change | Task |
|---|---|---|
| `backend/tsup.config.ts` | **Create** — tsup config: cjs, node24, sourcemap, `minify: false`, `noExternal: ['story-editor-shared']` | 1 |
| `shared/package.json` | `main` → `./src/index.ts`; remove the `exports` map; remove the `build` script | 1 |
| `shared/tsconfig.build.json` | **Delete** — nothing builds `shared/dist` anymore | 1 |
| `backend/package.json` | `build` → `tsup`; `start` → `node --enable-source-maps dist/index.js`; move `story-editor-shared` to `devDependencies`; add `tsup` to `devDependencies` | 1 |
| `backend/package.json` | `dev` → `tsx watch src/index.ts`; `venice:probe` → `tsx scripts/venice-probe.ts`; remove `ts-node-dev`, add `tsx` (devDeps) | 2 |
| `backend/tsconfig.json` | Remove the now-dead `"ts-node": { "transpileOnly": true }` block | 2 |
| `Makefile` | `seed` target: drop `-e NODE_OPTIONS=--conditions=source` + its comment; `ts-node` → `tsx` | 2 |
| `backend/tests/security/encryption-leak.test.ts` | Seed `spawnSync`: `ts-node` → `tsx`, delete the `NODE_OPTIONS` injection + comment; fix the `[E13]` comment | 2 |
| `backend/prisma/scripts/force-recovery-rotation.ts` | `Usage:` string: `ts-node` → `tsx` | 2 |
| `docker-compose.override.yml` | Rewrite the backend `./shared` mount comment (the mount stays) | 2 |
| `backend/Dockerfile` | builder: drop `RUN npm -w story-editor-shared run build`; dev: rewrite NOTE comment; runner: drop the `shared/dist` COPY + `-w story-editor-shared` from `npm ci` | 3 |
| `backend/docker-entrypoint.sh` | `node dist/index.js` → `node --enable-source-maps dist/index.js` | 3 |
| `.github/workflows/ci.yml` | Add the bundle-inlining assertion step; add the backend boot-smoke step | 4 |
| `CLAUDE.md` | Rewrite the now-false `ts-node-dev` hot-reload Known Gotcha | 5 |
| `.gitignore` | Delete the dead `.watcher.pid` rule (at5 leftover — the watcher is gone) | 5 |
| `backend/tests/shared-resolution.test.ts` | Refresh the stale header comment (`shared/dist` no longer exists) — test body unchanged | 5 |
| `frontend/tests/shared-resolution.test.ts` | Refresh the stale header comment (`shared/dist` no longer exists) — test body unchanged | 5 |
| bd issue `story-editor-8i9` notes | Set the `verify:` line | 5 |

**Ordering invariant — every task leaves the repo working (if transitional):**
- **Task 1** is the coupled atomic core: `shared`→source *and* `backend build`→`tsup` must land together (pointing `shared` at `.ts` source breaks a `tsc`-compiled prod; bundling needs `shared` to point at source). After Task 1, prod is a self-contained bundle and the dev server *still works* on `ts-node-dev` — it resolves `shared`'s plain `main` → `src`, with `--conditions=source` reduced to a dead no-op.
- **Task 2** swaps the dead-no-op `ts-node-dev`/`ts-node` path to `tsx` and removes `ts-node-dev`. Includes the Prisma spike.
- **Tasks 3–4** remove the now-dead Dockerfile coupling and wire the CI guards.
- **Task 5** finalises docs + the bd `verify:` line and runs the full integration check.

Do the tasks in order.

---

### Task 1: Bundle the prod artifact + point `shared` at source

**Files:**
- Create: `backend/tsup.config.ts`
- Modify: `shared/package.json`
- Delete: `shared/tsconfig.build.json`
- Modify: `backend/package.json`

This is the coupled core. It cannot be split: pointing `shared`'s `main` at `.ts` source breaks a `tsc`-compiled prod runtime, and `tsup` bundling needs `shared` pointing at source to inline it — so the `shared` change and the `tsup` change land in one task.

- [ ] **Step 1: Confirm there are no deep imports of the shared package**

Removing the `exports` map can only *widen* resolution, but a deep import (`story-editor-shared/foo`) would still need re-checking. Confirm every import is the bare specifier.

Run:
```bash
grep -rn "story-editor-shared/" backend/src frontend/src shared/src 2>/dev/null || echo "NO DEEP IMPORTS — safe to drop exports"
```
Expected: `NO DEEP IMPORTS — safe to drop exports`

If any deep import is found: **stop and report** — it needs handling out of this plan's scope.

- [ ] **Step 2: Delete `shared/dist` and `backend/dist` so the build is unambiguous**

With both gone, a successful build can only have resolved `shared/src` — there is no stale compiled output to silently consume.

Run:
```bash
rm -rf shared/dist backend/dist
```
Expected: no output.

- [ ] **Step 3: Create `backend/tsup.config.ts`**

Create `backend/tsup.config.ts`:
```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'], // backend is "type": "commonjs"; prod stays `node dist/index.js`
  platform: 'node',
  target: 'node24', // matches node:24-alpine
  sourcemap: true, // prod stack traces map back to source
  clean: true,
  minify: false, // keep require() calls greppable — the CI inline assertion depends on it
  // story-editor-shared is pure Zod/TS — inline it so the prod artifact has no
  // `story-editor-shared` runtime specifier. Everything else in node_modules
  // (Prisma, argon2, pg, express, …) stays external by tsup's default.
  noExternal: ['story-editor-shared'],
});
```

- [ ] **Step 4: Point `shared/package.json` at source**

Find this region of `shared/package.json`:
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
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
```
Replace it with (no `exports` map, no `build` script, `main` → source):
```json
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
```

- [ ] **Step 5: Delete `shared/tsconfig.build.json`**

It was the config for the now-removed `build` script.

Run:
```bash
git rm shared/tsconfig.build.json
```
Expected: `rm 'shared/tsconfig.build.json'`.

- [ ] **Step 6: Update `backend/package.json` — build script, start script, dependency classification**

First check the current stable tsup version:
```bash
npm view tsup version
```
(8.5.1 as of writing — use whatever it reports in the `^x.y.z` below.)

In `backend/package.json`, find:
```json
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "start": "node dist/index.js",
```
Replace with:
```json
  "main": "dist/index.js",
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "start": "node --enable-source-maps dist/index.js",
```

Then find the `dependencies` block and remove the `story-editor-shared` line from it:
```json
    "prisma": "^7.8.0",
    "story-editor-shared": "*",
    "zod": "^4.4.3"
  },
```
becomes:
```json
    "prisma": "^7.8.0",
    "zod": "^4.4.3"
  },
```

Then find the `devDependencies` block and add `story-editor-shared` **and** `tsup` (alphabetical order; `ts-node-dev` stays for now — Task 2 removes it):
```json
    "@types/supertest": "^7.2.0",
    "supertest": "^7.2.2",
    "ts-node-dev": "^2.0.0",
    "typescript": "^6.0.3"
  }
```
becomes:
```json
    "@types/supertest": "^7.2.0",
    "story-editor-shared": "*",
    "supertest": "^7.2.2",
    "ts-node-dev": "^2.0.0",
    "tsup": "^8.5.1",
    "typescript": "^6.0.3"
  }
```

- [ ] **Step 7: Sync the lockfile**

Run:
```bash
npm install
```
Expected: `package-lock.json` updates; `tsup` (+ its `esbuild` transitive) is installed; no errors. `node_modules/story-editor-shared` may stay symlinked (it is still a workspace) — that is fine; the classification move only affects what `npm ci --omit=dev` installs in the prod image.

- [ ] **Step 8: Confirm all three typechecks pass with no `dist` present**

`tsc` resolves `story-editor-shared`'s types via the package `types` field → `shared/src/index.ts` (the same file as before). Frontend `tsc -b` (`moduleResolution: bundler`) resolves it the same way. None need `shared/dist`.

Run:
```bash
npm -w story-editor-shared run typecheck && npm -w story-editor-backend run typecheck && npm -w story-editor-frontend run typecheck
```
Expected: all three exit 0, no errors.

- [ ] **Step 9: Build the bundle and assert `shared` was inlined, externals intact**

Run:
```bash
npm -w story-editor-backend run build
```
Expected: `tsup` runs, prints a build summary, produces `backend/dist/index.js` (+ `backend/dist/index.js.map`), exits 0.

Then run the inlining assertions:
```bash
node --check backend/dist/index.js && echo "OK: bundle is valid CJS"
grep -q '"story-editor-shared"' backend/dist/index.js && { echo "FAIL: story-editor-shared was not inlined"; exit 1; } || echo "OK: story-editor-shared inlined (no runtime specifier)"
grep -q '"@prisma/client"' backend/dist/index.js || { echo "FAIL: @prisma/client missing — it was wrongly bundled"; exit 1; }
echo "OK: @prisma/client stays external"
```
Expected: `OK: bundle is valid CJS`, `OK: story-editor-shared inlined (no runtime specifier)`, `OK: @prisma/client stays external`.

(The bare quoted token `"story-editor-shared"` only appears in a `require("story-editor-shared")` call form; `tsup`'s `minify: false` keeps inlined-module path comments as `// ../shared/src/...` — which do **not** contain that quoted token — so the grep is reliable. If a future `tsup` changes quoting, widen to `grep -qE 'require\((["'\''])story-editor-shared\1\)'`.)

- [ ] **Step 10: Confirm shared's own tooling is undisturbed**

Removing the `build` script + `exports` map must not break shared's `typecheck`/`test`.

Run:
```bash
npm -w story-editor-shared run typecheck && npm -w story-editor-shared run test
```
Expected: both exit 0.

- [ ] **Step 11: Commit**

```bash
git add backend/tsup.config.ts shared/package.json backend/package.json package-lock.json
git commit -m "$(cat <<'EOF'
[8i9] bundle story-editor-shared into the backend prod artifact via tsup

The backend `build` script moves from bare tsc to tsup, which externalises
every node_modules dependency by default and inlines only
story-editor-shared (noExternal). The prod artifact backend/dist/index.js is
now self-contained — no `require("story-editor-shared")` specifier — so
shared/dist, shared's `build` script, shared/tsconfig.build.json, and the
`exports` map are all removed; shared/package.json's `main` points at
./src/index.ts. story-editor-shared moves to the backend's devDependencies
(inlined at build time, not needed at runtime). Prod runtime stays plain
`node --enable-source-maps dist/index.js`. The dev server still works on
ts-node-dev for now (resolves shared's `main` → src); Task 2 swaps it to tsx.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Swap the TS runner to `tsx`; remove `ts-node-dev` / `ts-node` (Prisma spike)

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/tsconfig.json`
- Modify: `Makefile`
- Modify: `backend/tests/security/encryption-leak.test.ts`
- Modify: `backend/prisma/scripts/force-recovery-rotation.ts`
- Modify: `docker-compose.override.yml`

After Task 1, `--conditions=source` is a dead no-op everywhere and the dev server runs on `ts-node-dev` only because it is still installed. This task installs `tsx`, removes `ts-node-dev` (and the `ts-node` it dragged in transitively), and points every TS-source entry point at `tsx`. Step 2 is the Prisma spike — run it before touching anything else, because a failure there is the one thing that re-plans this task.

- [ ] **Step 1: Install `tsx`, remove `ts-node-dev`**

Check the current stable tsx version, then swap:
```bash
npm view tsx version
npm install --save-dev --workspace story-editor-backend tsx
npm uninstall --workspace story-editor-backend ts-node-dev
```
Expected: `tsx` (4.22.x as of writing) added to `backend/package.json` `devDependencies`; `ts-node-dev` removed; `package-lock.json` updated. `ts-node` (which was only a transitive dep of `ts-node-dev`) is now gone too.

- [ ] **Step 2: SPIKE — confirm Prisma still loads `prisma.config.ts` with `ts-node` gone**

`backend/prisma.config.ts` is TypeScript, loaded by the `prisma` CLI. `@prisma/config@7.8.0` (Prisma 7's own config loader, confirmed installed) should handle it without the now-removed transitive `ts-node`.

Run:
```bash
cd backend && npx prisma generate ; echo "exit=$?" ; cd ..
```
Expected: `prisma generate` succeeds, `exit=0`. It reads `prisma.config.ts` for the schema path — success proves the TS config still loads.

**If it fails** with a config-load error (e.g. `Cannot find module 'ts-node'`, or a TS syntax error from inside `prisma.config.ts`): **stop and report `BLOCKED`** with the exact error. The fallback (spec risk 1) is to prepend `NODE_OPTIONS=--import tsx` to the `prisma` invocations in `backend/Dockerfile`, `backend/docker-entrypoint.sh`, `.github/workflows/ci.yml`, and the `Makefile` — that is a small re-plan, not an in-task pivot.

- [ ] **Step 3: Point the `dev` and `venice:probe` scripts at `tsx`**

In `backend/package.json`, find:
```json
    "dev": "NODE_OPTIONS=--conditions=source ts-node-dev --respawn --transpile-only src/index.ts",
```
Replace with:
```json
    "dev": "tsx watch src/index.ts",
```
Then find:
```json
    "venice:probe": "ts-node scripts/venice-probe.ts"
```
Replace with:
```json
    "venice:probe": "tsx scripts/venice-probe.ts"
```

- [ ] **Step 4: Remove the dead `ts-node` block from `backend/tsconfig.json`**

Find (the end of the file):
```json
  "exclude": ["node_modules", "dist", "tests"],
  "ts-node": {
    "transpileOnly": true
  }
}
```
Replace with:
```json
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 5: Update the `Makefile` `seed` target**

Find:
```makefile
seed:
	docker compose exec backend npx prisma generate
	docker compose restart backend
	@sleep 3
	# -e NODE_OPTIONS=--conditions=source: the seed subprocess resolves
	# story-editor-shared from shared/src (no shared/dist is built for dev).
	docker compose exec -e NODE_OPTIONS=--conditions=source backend npx ts-node --transpile-only prisma/seed.ts
```
Replace with:
```makefile
seed:
	docker compose exec backend npx prisma generate
	docker compose restart backend
	@sleep 3
	docker compose exec backend npx tsx prisma/seed.ts
```

- [ ] **Step 6: Update the `[E12]` encryption-leak test's seed subprocess**

In `backend/tests/security/encryption-leak.test.ts`, find the comment region:
```js
  // [E13] Seed-script leak proof. The verify command for [E13] is
  //   npx ts-node prisma/seed.ts && vitest ... --grep seed
```
Replace with:
```js
  // [E13] Seed-script leak proof. The verify command for [E13] is
  //   npx tsx prisma/seed.ts && vitest ... --grep seed
```

Then find the `spawnSync` call and its `env` block:
```js
    const result = spawnSync('npx', ['ts-node', 'prisma/seed.ts'], {
      cwd: backendRoot,
      env: {
        ...process.env,
        // Force the seed into the test DB. setup.ts pins DATABASE_URL for this
        // process, but the spawned child sees its own env — be explicit.
        DATABASE_URL: testDatabaseUrl,
        // The seed calls auth.register() which doesn't need JWT secrets, but
        // auth.service reads them at module load for other exports. Ensure
        // they're set to something so the import side-effect doesn't explode.
        JWT_SECRET: process.env.JWT_SECRET ?? 'test-jwt-secret',
        REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET ?? 'test-refresh-secret',
        APP_ENCRYPTION_KEY:
          process.env.APP_ENCRYPTION_KEY ?? Buffer.alloc(32, 0xab).toString('base64'),
        // The seed transitively imports backend/src modules that import
        // story-editor-shared. As a spawned subprocess it inherits neither the
        // vitest resolve.alias nor the backend `dev` script's --conditions=source,
        // so without this it resolves the package's `default` export to
        // shared/dist — which isn't built for dev/test/CI after story-editor-at5.
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--conditions=source'].filter(Boolean).join(' '),
      },
```
Replace with (`tsx` resolves `story-editor-shared` from source via the package `main` with no flag, so the whole `NODE_OPTIONS` shim is deleted):
```js
    const result = spawnSync('npx', ['tsx', 'prisma/seed.ts'], {
      cwd: backendRoot,
      env: {
        ...process.env,
        // Force the seed into the test DB. setup.ts pins DATABASE_URL for this
        // process, but the spawned child sees its own env — be explicit.
        DATABASE_URL: testDatabaseUrl,
        // The seed calls auth.register() which doesn't need JWT secrets, but
        // auth.service reads them at module load for other exports. Ensure
        // they're set to something so the import side-effect doesn't explode.
        JWT_SECRET: process.env.JWT_SECRET ?? 'test-jwt-secret',
        REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET ?? 'test-refresh-secret',
        APP_ENCRYPTION_KEY:
          process.env.APP_ENCRYPTION_KEY ?? Buffer.alloc(32, 0xab).toString('base64'),
      },
```

- [ ] **Step 7: Update the `force-recovery-rotation.ts` usage string**

In `backend/prisma/scripts/force-recovery-rotation.ts`, find:
```js
  process.stderr.write(
    'Usage: ts-node prisma/scripts/force-recovery-rotation.ts --username <name> [--dry-run]\n',
  );
```
Replace with:
```js
  process.stderr.write(
    'Usage: tsx prisma/scripts/force-recovery-rotation.ts --username <name> [--dry-run]\n',
  );
```

- [ ] **Step 8: Rewrite the `docker-compose.override.yml` backend `./shared` mount comment**

Find:
```yaml
    volumes:
      # Bind-mount both source trees for hot reload: ./backend, and ./shared
      # so editing a shared Zod schema hot-reloads the backend — ts-node-dev
      # resolves story-editor-shared straight from shared/src via the `source`
      # export condition, the same way ./frontend's Vite alias works.
      - ./backend:/app/backend
      - ./shared:/app/shared
```
Replace with:
```yaml
    volumes:
      # Bind-mount both source trees for hot reload: ./backend, and ./shared
      # so editing a shared Zod schema hot-reloads the backend — `tsx watch`
      # resolves story-editor-shared straight from shared/src via the package's
      # `main` field, the same way ./frontend's Vite alias works.
      - ./backend:/app/backend
      - ./shared:/app/shared
```

- [ ] **Step 9: Verify — no `ts-node` references remain, typecheck passes, dev hot-reload works**

First, the static checks:
```bash
grep -rIE --exclude-dir=node_modules --exclude-dir=dist 'conditions=source|\bts-node\b' backend Makefile docker-compose.override.yml && echo "FAIL: ts-node / conditions=source references remain" || echo "OK: no ts-node / conditions=source references"
npm -w story-editor-backend run typecheck
```
Expected: `OK: no ts-node / conditions=source references`; backend typecheck exits 0.

Then the runtime check — dev server boots on `tsx watch`, the `[E12]` test passes with its `tsx` seed subprocess, and a `shared/src` edit hot-reloads the backend:
```bash
make dev
timeout 200 bash -c 'until docker compose exec -T backend wget -qO- http://localhost:4000/api/health 2>/dev/null | grep -q status; do sleep 3; done'
npm -w story-editor-backend run test -- tests/security/encryption-leak.test.ts
touch shared/src/index.ts
sleep 10
docker compose logs --since=40s backend | grep -qiE 'restart|rerun|\[tsx\]' && echo "OK: tsx watch hot-reloaded on a shared/src edit" || echo "CHECK: inspect 'docker compose logs backend' for the tsx restart marker and note the exact substring"
make stop
```
Expected: the stack comes up; the `[E12]` encryption-leak test passes (its seed subprocess now runs under `tsx`); after `touch shared/src/index.ts`, the backend logs show a `tsx watch` restart (`OK: tsx watch hot-reloaded ...`). If the grep prints `CHECK:` instead, read `docker compose logs backend` after a manual `touch shared/src/index.ts`, note the exact restart-log substring `tsx watch` emits, and use it in the Task 5 verify line.

- [ ] **Step 10: Commit**

```bash
git add backend/package.json backend/tsconfig.json Makefile backend/tests/security/encryption-leak.test.ts backend/prisma/scripts/force-recovery-rotation.ts docker-compose.override.yml package-lock.json
git commit -m "$(cat <<'EOF'
[8i9] swap the backend TS runner from ts-node-dev/ts-node to tsx

tsx (a devDependency — it never enters the prod image) replaces ts-node-dev
for the dev server and the transitive ts-node for the seed script, the
Venice probe, and the force-recovery-rotation admin script. Every
`--conditions=source` opt-in is deleted: it became a dead no-op once
story-editor-shared's `main` pointed at source (Task 1). Spiked: `prisma
generate` still loads prisma.config.ts with ts-node gone (@prisma/config
handles it). The [E12] leak test's seed spawnSync drops its NODE_OPTIONS
shim — tsx resolves shared from source with no flag.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Slim the `backend/Dockerfile` + entrypoint

**Files:**
- Modify: `backend/Dockerfile`
- Modify: `backend/docker-entrypoint.sh`

The builder stage no longer pre-builds `shared/dist` (`tsup` inlines `shared/src`); the runner stage no longer copies `shared/dist` or installs the `story-editor-shared` workspace (it is inlined into the bundle, not a runtime dep). The dev stage's NOTE comment is rewritten for the `tsx` model.

- [ ] **Step 1: Drop the shared build from the `builder` stage**

In `backend/Dockerfile`, find:
```dockerfile
# ---- builder -------------------------------------------------------------
FROM deps AS builder
ARG PRISMA_GENERATE_DATABASE_URL
COPY --chown=node:node . .
# Shared must be built before backend tsc — backend's compiled CJS will
# `require('story-editor-shared')` which resolves to shared/dist.
RUN npm -w story-editor-shared run build
RUN DATABASE_URL=${PRISMA_GENERATE_DATABASE_URL} npx -w story-editor-backend prisma generate
RUN npm -w story-editor-backend run build
```
Replace with:
```dockerfile
# ---- builder -------------------------------------------------------------
FROM deps AS builder
ARG PRISMA_GENERATE_DATABASE_URL
COPY --chown=node:node . .
# `npm run build` runs tsup, which inlines story-editor-shared (pure Zod/TS)
# straight into backend/dist — there is no separate shared build step, and the
# prod artifact carries no `story-editor-shared` runtime specifier.
RUN DATABASE_URL=${PRISMA_GENERATE_DATABASE_URL} npx -w story-editor-backend prisma generate
RUN npm -w story-editor-backend run build
```

- [ ] **Step 2: Rewrite the `dev` stage NOTE comment**

Find:
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
# `dev` script) — `dev` relies entirely on shared/src at runtime and
# never generates shared/dist itself.
RUN DATABASE_URL=${PRISMA_GENERATE_DATABASE_URL} npx -w story-editor-backend prisma generate
```
Replace with:
```dockerfile
# ---- dev (used by docker-compose.override.yml) ---------------------------
FROM deps AS dev
ARG PRISMA_GENERATE_DATABASE_URL
ENV NODE_ENV=development
COPY --chown=node:node . .
# NOTE: `dev` builds nothing ahead of time. The dev server runs
# `tsx watch src/index.ts` (backend/package.json's `dev` script) and resolves
# story-editor-shared straight from shared/src via the package's `main` field
# — no compiled shared/dist is ever produced for dev.
RUN DATABASE_URL=${PRISMA_GENERATE_DATABASE_URL} npx -w story-editor-backend prisma generate
```

- [ ] **Step 3: Slim the `runner` stage**

Find:
```dockerfile
# Prod deps only.
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY shared/package.json ./shared/
RUN npm ci --omit=dev --ignore-scripts -w story-editor-backend -w story-editor-shared --include-workspace-root

# Bring in the compiled output for backend AND shared. Backend's runtime
# does `require('story-editor-shared')` → resolves via workspace symlink in
# node_modules/ → shared/dist/index.js.
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/prisma ./backend/prisma
COPY --from=builder /app/shared/dist ./shared/dist
COPY backend/prisma.config.ts ./backend/prisma.config.ts
COPY backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
```
Replace with (all four workspace `package.json`s are still copied — `npm ci` needs them to construct the workspace tree — but `-w story-editor-shared` is dropped from the install, and the `shared/dist` COPY is gone):
```dockerfile
# Prod deps only.
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY shared/package.json ./shared/
RUN npm ci --omit=dev --ignore-scripts -w story-editor-backend --include-workspace-root

# Bring in the bundled backend artifact. `npm run build` (tsup) inlined
# story-editor-shared into backend/dist, so the runtime needs no shared
# package and no shared/dist — just the self-contained bundle.
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/prisma ./backend/prisma
COPY backend/prisma.config.ts ./backend/prisma.config.ts
COPY backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
```

- [ ] **Step 4: Add `--enable-source-maps` to the entrypoint**

In `backend/docker-entrypoint.sh`, find:
```sh
echo "[entrypoint] starting backend"
exec node dist/index.js
```
Replace with:
```sh
echo "[entrypoint] starting backend"
exec node --enable-source-maps dist/index.js
```

- [ ] **Step 5: Verify — the prod image builds, boots, and serves `/api/health`**

Run:
```bash
grep -n "story-editor-shared run build" backend/Dockerfile || echo "OK: no shared build step in Dockerfile"
grep -n "shared/dist" backend/Dockerfile || echo "OK: no shared/dist reference in Dockerfile"
docker compose -f docker-compose.yml up -d --build
timeout 240 bash -c 'until docker compose -f docker-compose.yml exec -T backend wget -qO- http://localhost:4000/api/health 2>/dev/null | grep -q "\"status\":\"ok\""; do sleep 3; done'
echo "OK: prod backend image built, booted, and is healthy"
docker compose -f docker-compose.yml down
```
Expected: `OK: no shared build step in Dockerfile`; `OK: no shared/dist reference in Dockerfile`; `docker compose -f docker-compose.yml up -d --build` builds all stages with no error; the backend prod container (running the bundled `node --enable-source-maps dist/index.js` after `prisma migrate deploy`) becomes healthy within the timeout; `OK: prod backend image built, booted, and is healthy`; the stack tears down.

This step proves the runner stage is correct end-to-end — a missed `COPY`, a wrong `--omit`, or a bundling regression that escaped Task 1's structural checks surfaces here.

- [ ] **Step 6: Commit**

```bash
git add backend/Dockerfile backend/docker-entrypoint.sh
git commit -m "$(cat <<'EOF'
[8i9] slim the backend Dockerfile — no shared build, no shared/dist in prod

The builder stage drops `npm -w story-editor-shared run build` (tsup inlines
shared/src). The runner stage drops the `COPY --from=builder shared/dist` and
`-w story-editor-shared` from `npm ci` — story-editor-shared is inlined into
the bundle and is no longer a runtime dependency. The dev-stage NOTE comment
is rewritten for the tsx model. The entrypoint runs the bundle with
`node --enable-source-maps dist/index.js`.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Wire the CI bundle assertions

**Files:**
- Modify: `.github/workflows/ci.yml`

The existing `Backend build` step now runs `tsup` (Task 1 changed the script — no YAML change needed). Two new steps give CI a real, Docker-free guard on the prod resolution path: the bundle-inlining assertion, and a boot smoke of the built artifact. Together they catch what the vitest suites cannot — vitest uses its own resolver, never the bundle.

- [ ] **Step 1: Add the bundle-inlining assertion after `Backend build`**

In `.github/workflows/ci.yml`, find:
```yaml
      - name: Backend build
        run: npm -w story-editor-backend run build

      - name: Frontend build
        run: npm -w story-editor-frontend run build
```
Replace with:
```yaml
      - name: Backend build
        run: npm -w story-editor-backend run build

      # The backend build is a tsup bundle: story-editor-shared (pure Zod/TS)
      # is inlined, every node_modules dep stays external. Assert both — a
      # regression either way (shared not inlined, or a heavy dep wrongly
      # bundled) is a prod-resolution bug the vitest suites can't catch
      # because they use vitest's own resolver, never the bundle.
      - name: Assert backend bundle inlined shared, kept deps external
        working-directory: backend
        run: |
          if grep -q '"story-editor-shared"' dist/index.js; then
            echo "::error::story-editor-shared was not inlined into the backend bundle" >&2
            exit 1
          fi
          if ! grep -q '"@prisma/client"' dist/index.js; then
            echo "::error::@prisma/client is missing from the bundle externals — it was wrongly bundled" >&2
            exit 1
          fi
          echo "bundle OK: story-editor-shared inlined, @prisma/client external"

      - name: Frontend build
        run: npm -w story-editor-frontend run build
```

- [ ] **Step 2: Add the backend boot smoke after `Prisma migrate (test DB)`**

In `.github/workflows/ci.yml`, find:
```yaml
      - name: Prisma migrate (test DB)
        working-directory: backend
        run: npx prisma migrate deploy

      # Vitest's JSON reporter emits `numTotalTests`. We assert it > 0 on
```
Replace with:
```yaml
      - name: Prisma migrate (test DB)
        working-directory: backend
        run: npx prisma migrate deploy

      # Boot the actual built artifact (node dist/index.js) against the CI
      # Postgres and hit /api/health. This is the one CI guard that the prod
      # entry path resolves and boots — the vitest suites never touch the
      # bundle. NODE_ENV=production so it boots the way prod does; if
      # backend/src/boot/env-validation.ts requires more env in production
      # mode, add it here (the goal is a representative prod boot).
      - name: Backend boot smoke (built artifact)
        working-directory: backend
        env:
          NODE_ENV: production
        run: |
          export APP_ENCRYPTION_KEY=$(node -p "Buffer.alloc(32, 0).toString('base64')")
          node --enable-source-maps dist/index.js &
          APP_PID=$!
          ok=
          for i in $(seq 1 30); do
            if wget -qO- http://localhost:4001/api/health 2>/dev/null | grep -q '"status":"ok"'; then
              ok=1; break
            fi
            sleep 1
          done
          kill "$APP_PID" 2>/dev/null || true
          if [ -z "$ok" ]; then
            echo "::error::backend built artifact did not become healthy on :4001" >&2
            exit 1
          fi
          echo "boot smoke OK: built artifact resolved and served /api/health"

      # Vitest's JSON reporter emits `numTotalTests`. We assert it > 0 on
```
(CI's workflow-level `env:` sets `PORT: 4001`, so the artifact listens on `:4001`. `DATABASE_URL`, `JWT_SECRET`, `REFRESH_TOKEN_SECRET`, `FRONTEND_URL` are inherited from the same workflow-level `env:`.)

- [ ] **Step 3: Verify the new steps locally and the YAML is well-formed**

The bundle-inlining assertion runs the exact commands Task 1 Step 9 already proved — confirm against the current `backend/dist/index.js` (rebuild if it was cleaned):
```bash
npm -w story-editor-backend run build
cd backend
grep -q '"story-editor-shared"' dist/index.js && echo "FAIL: not inlined" || echo "OK: inlined"
grep -q '"@prisma/client"' dist/index.js && echo "OK: prisma external" || echo "FAIL: prisma bundled"
cd ..
```
Expected: `OK: inlined`, `OK: prisma external`.

Then confirm the workflow file still parses and the two new steps are positioned correctly:
```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('OK: ci.yml is valid YAML')"
grep -nE "Backend build|inlined shared|boot smoke|Prisma migrate \(test DB\)|Backend tests" .github/workflows/ci.yml
```
Expected: `OK: ci.yml is valid YAML`; the `grep` shows the new `Assert backend bundle ...` step directly after `Backend build`, and the new `Backend boot smoke ...` step between `Prisma migrate (test DB)` and `Backend tests`. Read the surrounding YAML to confirm indentation is intact. (The boot-smoke step itself is exercised for real when CI runs on push, and the stronger full-Docker-image boot is in the Task 5 verify line.)

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
[8i9] add CI guards for the backend bundle resolution path

Two steps the vitest suites can't cover (they use vitest's resolver, never
the bundle): a bundle-inlining assertion (story-editor-shared inlined,
@prisma/client still external) right after `Backend build`, and a boot smoke
that runs the built `node dist/index.js` artifact against the CI Postgres and
hits /api/health. The `Backend build` step itself is unchanged YAML — it now
runs tsup via the script change from Task 1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Update `CLAUDE.md`, refresh stale at5 artifacts, set the bd verify line, run the full integration check

**Files:**
- Modify: `CLAUDE.md`
- Modify: `.gitignore`
- Modify: `backend/tests/shared-resolution.test.ts`
- Modify: `frontend/tests/shared-resolution.test.ts`
- Modify: bd issue `story-editor-8i9` notes (`bd update`)

Final task: correct the now-false Known Gotcha, sweep up two leftovers from story-editor-at5 that this work makes stale (a dead `.gitignore` rule and the `shared-resolution.test.ts` header comments), set the real `verify:` line, and run it end-to-end. The integration run is the capstone — it exercises every layer: the structural greps, the bundle build + inline assertion, the test suites (with the stack up), `tsx watch` hot-reload, and the prod Docker image build + boot.

- [ ] **Step 1: Rewrite the `ts-node-dev` Known Gotcha in `CLAUDE.md`**

In `CLAUDE.md`'s "Known Gotchas" section, find:
```markdown
- Docker hot reload for the backend requires `ts-node-dev` or `nodemon` in the override compose file — the production Dockerfile does not include these
```
Replace with:
```markdown
- Docker hot reload for the backend uses `tsx watch` (the `dev` script). `tsx` is a backend devDependency — the production image runs the bundled `dist/index.js` via plain `node` and ships no TS runner. The backend `build` script is `tsup`, which inlines `story-editor-shared` into the bundle; there is no `shared/dist` and nothing resolves a `story-editor-shared` specifier at prod runtime
```

- [ ] **Step 2: Confirm no other stale references remain in `CLAUDE.md`**

Run:
```bash
grep -nE 'ts-node|shared/dist|shared-build' CLAUDE.md || echo "OK: no stale ts-node / shared/dist / shared-build references in CLAUDE.md"
```
Expected: `OK: no stale ts-node / shared/dist / shared-build references in CLAUDE.md`. If a hit is found, read its context and correct it (the only expected stale reference is the gotcha rewritten in Step 1; anything else is a bonus catch — fix it in this commit).

- [ ] **Step 3: Delete the dead `.watcher.pid` rule from `.gitignore`**

story-editor-at5 removed the host-side dev watcher and deleted its `.watcher.pid` file, but left the gitignore rule behind — a dead rule for a file that can no longer be created.

In `.gitignore`, find and delete this block (it sits a few lines below `.beads-credential-key`):
```
# make dev watcher PID file
.watcher.pid
```
Delete both lines and the now-redundant blank line that preceded the comment, so the surrounding entries keep single-blank-line spacing. Confirm:
```bash
grep -nE 'watcher' .gitignore || echo "OK: no .watcher.pid rule left in .gitignore"
```
Expected: `OK: no .watcher.pid rule left in .gitignore`.

- [ ] **Step 4: Refresh the stale `shared-resolution.test.ts` header comments**

at5 wrote these two regression-guard tests with header comments describing a `shared/dist` fallback and a "fails fast if the alias is removed" mechanism. After this work `shared/dist` never exists, and with `shared`'s `main` pointing at source the stated failure mode no longer holds — the tests still pass and still smoke-test the vitest alias, but the comments over-claim. **Only the header comments change; the test bodies are untouched.**

In `backend/tests/shared-resolution.test.ts`, find:
```ts
// Regression guard for story-editor-at5. Proves the backend vitest config
// resolves `story-editor-shared` to shared/src — not the compiled
// shared/dist. The bd verify line runs this with `shared/dist` deleted, so
// it fails fast ("Cannot find module") if the resolve.alias is ever removed.
```
Replace with:
```ts
// Resolution smoke for `story-editor-shared` (originally a story-editor-at5
// regression guard). Proves the backend vitest config resolves the shared
// package and that a runtime value imports from it — in the vitest env that
// goes through the `story-editor-shared` -> ../shared/src `resolve.alias` in
// backend/vitest.config.ts. After story-editor-8i9 there is no `shared/dist`
// at all: prod bundles shared into the artifact and dev/test resolve source.
```

In `frontend/tests/shared-resolution.test.ts`, find:
```ts
// Regression guard for story-editor-at5. Proves the frontend vitest config
// resolves `story-editor-shared` to shared/src — not the compiled
// shared/dist. The bd verify line runs this with `shared/dist` deleted, so
// it fails fast ("Cannot find module") if the resolve.alias is ever removed.
```
Replace with:
```ts
// Resolution smoke for `story-editor-shared` (originally a story-editor-at5
// regression guard). Proves the frontend vitest config resolves the shared
// package and that a runtime value imports from it — in the vitest env that
// goes through the `story-editor-shared` -> ../shared/src `resolve.alias` in
// frontend/vitest.config.ts. After story-editor-8i9 there is no `shared/dist`
// at all: prod bundles shared into the artifact and dev/test resolve source.
```

- [ ] **Step 5: Set the bd `verify:` line**

`scripts/bd-link-plan.sh` will have added a `plan:` line to the issue's `--notes` before execution. Preserve it, keep a `spec:` pointer, and set the `verify:` line. Run:
```bash
bd update story-editor-8i9 --notes "plan: docs/superpowers/plans/2026-05-14-bundle-shared-into-prod.md
spec: docs/superpowers/specs/2026-05-14-bundle-shared-into-prod-design.md
verify: rm -rf shared/dist backend/dist && ! grep -rIE --exclude-dir=node_modules --exclude-dir=dist 'conditions=source|\bts-node\b' backend Makefile docker-compose.override.yml .github/workflows && ! test -f shared/tsconfig.build.json && node -e 'const p=require(\"./shared/package.json\"); process.exit(p.exports||(p.scripts&&p.scripts.build)?1:0)' && npm -w story-editor-shared run typecheck && npm -w story-editor-backend run typecheck && npm -w story-editor-frontend run typecheck && npm -w story-editor-backend run build && ! grep -q '\"story-editor-shared\"' backend/dist/index.js && grep -q '\"@prisma/client\"' backend/dist/index.js && npm -w story-editor-shared run test && make dev && timeout 200 bash -c 'until docker compose exec -T backend wget -qO- http://localhost:4000/api/health 2>/dev/null | grep -q status; do sleep 3; done' && npm -w story-editor-backend run test && npm -w story-editor-frontend run test && touch shared/src/index.ts && sleep 10 && docker compose logs --since=40s backend | grep -qiE 'restart|rerun|\[tsx\]' && make stop && docker compose -f docker-compose.yml up -d --build && timeout 240 bash -c 'until docker compose -f docker-compose.yml exec -T backend wget -qO- http://localhost:4000/api/health 2>/dev/null | grep -q status; do sleep 3; done' && docker compose -f docker-compose.yml down"
```
Then confirm: `bd show story-editor-8i9` shows the `plan:`, `spec:`, and the new `verify:` line.

(If Task 2 Step 9 found the `tsx watch` restart marker is *not* matched by `restart|rerun|\[tsx\]`, substitute the exact observed substring into the `grep -qiE` in the verify line before running it.)

- [ ] **Step 6: Run the full verify line end-to-end**

Copy the `verify:` line from `bd show story-editor-8i9` and run it from the repo root.

Expected: exit 0. Specifically, in order:
- `shared/dist` + `backend/dist` deleted — the run starts from a clean slate;
- no `conditions=source` / `ts-node` references in `backend`, `Makefile`, `docker-compose.override.yml`, `.github/workflows`; no `shared/tsconfig.build.json`; `shared/package.json` has no `exports` map and no `build` script;
- all three typechecks pass with `dist` absent;
- `npm -w story-editor-backend run build` produces a bundle that inlines `story-editor-shared` (no `"story-editor-shared"` token) and keeps `@prisma/client` external;
- shared's own test suite passes;
- `make dev` brings the stack up; backend `/api/health` answers; the backend + frontend vitest suites pass (the stack is up first, so backend `globalSetup`'s `db-test-reset.sh` has its Postgres);
- `touch shared/src/index.ts` triggers a `tsx watch` restart in the backend logs;
- `make stop`, then `docker compose -f docker-compose.yml up -d --build` builds and boots the **prod** image stack, and the prod backend (`node --enable-source-maps dist/index.js`) answers `/api/health`;
- the prod stack tears down.

If the hot-reload grep fails: `make dev`, `touch shared/src/index.ts`, inspect `docker compose logs backend` for the exact `tsx watch` restart line, update the `grep -qiE` marker in the `verify:` line (`bd update` again), and re-run.

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md .gitignore backend/tests/shared-resolution.test.ts frontend/tests/shared-resolution.test.ts
git commit -m "$(cat <<'EOF'
[8i9] rewrite the stale ts-node-dev gotcha; sweep up at5 leftovers

Hot reload is `tsx watch` now; the CLAUDE.md gotcha referenced
ts-node-dev/nodemon. The rewrite also records that the prod image ships no TS
runner — it runs the tsup bundle via plain node. Two story-editor-at5
leftovers this work makes stale are swept up: the dead `.watcher.pid` rule in
.gitignore (the watcher is long gone), and the `shared-resolution.test.ts`
header comments (they described a `shared/dist` fallback that no longer
exists — test bodies unchanged). The bd verify line for story-editor-8i9 is
set to the full integration one-liner (structural greps + bundle inline
assertion + typechecks + test suites with the stack up + tsx hot-reload + a
prod Docker image build & boot).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**1. Spec coverage** — every spec section maps to a task:
- *Approach — The prod artifact (tsup)*: `backend/tsup.config.ts` + `backend build` → `tsup` → Task 1. `minify: false`, `noExternal`, `sourcemap`, `format: cjs`, `target: node24` all present in the Task 1 Step 3 config.
- *Approach — The dev/script runner (tsx)*: `dev`/`venice:probe`/seed/probe/admin-script → `tsx` → Task 2.
- *`shared/package.json` final shape*: `main` → src, drop `exports` + `build` script, delete `tsconfig.build.json` → Task 1 Steps 4–5.
- *Dependency classification*: `story-editor-shared` → backend devDeps (Task 1 Step 6); `tsx` + `tsup` → devDeps (Tasks 1–2); `ts-node-dev` removed (Task 2 Step 1). `typescript` stays a devDep — untouched, correctly.
- *Resolution matrix*: typechecks resolve via `types` (Task 1 Step 8); the build inlines shared (Task 1 Step 9); vitest aliases untouched; prod resolves nothing (Task 3 Step 5 boot).
- *What changes — Dockerfile*: builder + dev + runner → Task 3. *entrypoint* → Task 3 Step 4. *Makefile / encryption-leak test / force-recovery-rotation / docker-compose.override.yml* → Task 2. *ci.yml* → Task 4. *CLAUDE.md* → Task 5. *backend/tsconfig.json* `ts-node` block → Task 2 Step 4.
- *Not touched (code/behaviour)*: vitest aliases, the `shared-resolution.test.ts` *test bodies* (Task 5 refreshes only their stale header comments — at5 leftovers, no behaviour change), frontend build path + Dockerfile, `prisma.config.ts`, `docker-compose.yml`, `e2e.yml` — none have behavioural tasks, correctly. (`docker-compose.yml` is exercised read-only by Task 3 Step 5 / Task 5 Step 6's `-f docker-compose.yml` boots.)
- *Beyond spec (added during plan review)*: Task 5 also sweeps two story-editor-at5 leftovers this work makes stale — the dead `.watcher.pid` `.gitignore` rule and the `shared-resolution.test.ts` header comments. Not spec requirements; folded in per the project's "no deferred cleanups" convention because they are at5 residue inside this change's blast radius.
- *Edge cases & risks*: risk 1 (Prisma spike) → Task 2 Step 2 with the `--import tsx` fallback named; risk 2 (externals) → Task 1 Step 9 + Task 4 Step 1 assertions; risk 3 (`exports` removal) → Task 1 Step 1 deep-import grep; risk 4 (`.dockerignore`) → covered by Task 3 Step 5 actually building the image (no new context `COPY`s, so no `.dockerignore` change needed — confirmed by the build succeeding); risk 5 (`ts-node` re-grep breadth) → Task 2 Step 9 + the Task 5 verify line both grep the wide path set; risk 6 (bundler hazards) → pre-planning de-risking note, none present.
- *Testing & verification* (spec steps 0–8): step 0 `rm -rf` → verify line + Task 1 Step 2; steps 1–2 → verify line greps + typechecks; step 3 (suites, stack-up-first) → verify line sequences `make dev` before the suites; step 4 (build + inline) → Task 1 Step 9 + verify line; step 5 (artifact boot) → CI boot smoke (Task 4); step 6 (Docker build + boot) → Task 3 Step 5 + verify line; step 7 (hot reload) → Task 2 Step 9 + verify line; step 8 (shared tooling) → Task 1 Step 10 + verify line.
- *Why bundle, not tsx in prod* / *Relationship to 8i9* / *Forward pointer* — narrative spec sections, no task needed.

**2. Placeholder scan** — no `TBD`/`TODO`/"handle edge cases"/"similar to Task N". Every code step shows exact before/after blocks. The two conditionals are concrete: Task 2 Step 2's spike failure has a named diagnosis + named fallback (`NODE_OPTIONS=--import tsx`); Task 2 Step 9 / Task 5 Steps 5–6's hot-reload marker has a concrete discovery method and the `restart|rerun|[tsx]` default pattern (not a placeholder — a real, broad pattern with a documented narrowing path). The `^8.5.1` / `tsx` versions have an explicit `npm view` check step.

**3. Type / name consistency** — `story-editor-shared` (package name), `backend/dist/index.js` (the one bundle path, used in `tsup.config.ts` entry→output, `main`, `start`, the entrypoint, the inline greps, the runner COPY), `--enable-source-maps` (consistent in `start` script + entrypoint), `tsx watch src/index.ts` (dev script + Dockerfile dev-stage comment + override.yml comment), `noExternal: ['story-editor-shared']` (the single inlining directive). The inline-assertion grep token `'"story-editor-shared"'` and `'"@prisma/client"'` are identical in Task 1 Step 9, Task 4 Step 1, and the Task 5 verify line. The `grep -rIE ... 'conditions=source|\bts-node\b'` path set (`backend Makefile docker-compose.override.yml .github/workflows`) is identical in Task 2 Step 9 and the verify line.

No gaps found.
