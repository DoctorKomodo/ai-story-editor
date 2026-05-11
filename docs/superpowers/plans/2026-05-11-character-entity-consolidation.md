# Character entity consolidation — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate `Character` into a single canonical Zod schema in a new `shared/` npm workspace, surface all 9 narrative fields end-to-end (schema → API → UI → prompt), and add runtime egress validation so the schema is authoritative for the wire format.

**Architecture:** Three workspaces (`backend`, `frontend`, `shared`) under npm-workspaces. Shared schemas defined with `z.strictObject`, consumed by backend (request + egress validation) and frontend (response runtime validation). Backend runtime hits `shared/dist/`; frontend Vite uses an alias to `shared/src/`. Plumbing changes (workspace adoption + Dockerfile + CI) land first as a self-contained block; character-specific work follows.

**Tech Stack:** TypeScript strict, Zod 4, Vitest 4, Express 5, Prisma 7, React 19, Vite 8, TanStack Query. No new libraries beyond Zod-on-frontend.

**Spec:** `docs/superpowers/specs/2026-05-11-character-entity-consolidation-design.md`

**bd:** Will be filed when plan is approved (`bd create … --notes "plan: docs/superpowers/plans/2026-05-11-character-entity-consolidation.md\nverify: …"`).

---

## File structure

**Created (new):**
- `shared/package.json` — workspace manifest
- `shared/tsconfig.json` — broad include, noEmit (vitest, IDE, typecheck)
- `shared/tsconfig.build.json` — extends base, src-only, emits dist
- `shared/src/index.ts` — barrel re-export
- `shared/src/schemas/character.ts` — Zod schemas + types + projection helper
- `shared/tests/character.schema.test.ts` — schema unit tests
- `backend/src/lib/respond.ts` — egress validation helper
- `backend/src/lib/serialize.ts` — `serializeCharacter` (Date → ISO)
- `backend/tests/lib/respond.test.ts` — helper coverage
- `backend/tests/lib/serialize.test.ts` — helper coverage
- `backend/prisma/migrations/<timestamp>_character_field_consolidation/migration.sql` — schema migration

**Modified (workspace adoption):**
- Root `package.json` — workspaces array, vitest in devDeps
- `backend/package.json` — add `story-editor-shared` dep; rename `vitest` to root
- `frontend/package.json` — add `story-editor-shared` dep, `zod` dep; rename `vitest` to root
- Root `package-lock.json` — single lockfile (per-subdir lockfiles deleted)
- `backend/Dockerfile` — context-from-root COPY paths
- `frontend/Dockerfile` — context-from-root COPY paths
- `docker-compose.yml` — context + dockerfile path updates for both services
- `Makefile` — `tsc -w -p shared/tsconfig.build.json` sidecar in `dev`
- `frontend/vite.config.ts` — alias `'story-editor-shared': path.resolve(__dirname, '../shared/src')`
- `.github/workflows/ci.yml` — single root `npm ci`, root-keyed cache, per-step `working-directory` adjustments, shared-build step before tests
- `.github/workflows/e2e.yml` — same lockfile cache update + shared build step

**Modified (character-specific):**
- `backend/prisma/schema.prisma` — drop `physicalDescription*` and `notes*` triples; add `relationships*` triple
- `backend/src/repos/character.repo.ts` — update `ENCRYPTED_FIELDS`, drop hand-rolled input interfaces, import inferred types from shared
- `backend/src/routes/characters.routes.ts` — delete inline Zod schemas, import from shared, use `respond` + `serializeCharacter`; preserve `[D16]` retry loop + reorder semantic checks verbatim
- `backend/src/services/prompt.service.ts` — delete `CharacterContext`, `CharacterRecord`, `toCharacterContext`; consume `CharacterPromptInput[]`; full hybrid XML render with all 9 fields
- `backend/src/routes/ai.routes.ts` — `.map(toCharacterPromptInput)` at the seam
- `backend/src/routes/chat.routes.ts` — `.map(toCharacterPromptInput)` at the seam
- `frontend/src/hooks/useCharacters.ts` — drop hand-rolled `Character` interface, import from shared, runtime-validate responses
- `frontend/src/components/CharacterSheet.tsx` — add `relationships` field (textarea, FieldKey union, Form interface, default, diff helper)
- `frontend/src/components/CharacterSheet.stories.tsx` — story variant with `relationships` populated
- Any frontend file importing `type Character` from `useCharacters` — re-point to `'story-editor-shared'`

**Modified (tests):**
- `backend/tests/services/prompt.service.test.ts` — delete `toCharacterContext` block; new `character XML rendering — full sheet` describe; update existing `charactersBlock XML rendering (h0z)` for hybrid shape
- `backend/tests/repos/character.repo.test.ts` — drop `physicalDescription` / `notes` cases; add `relationships` round-trip
- `backend/tests/routes/characters.test.ts` — extend every shape-returning case with `characterResponseSchema.parse(response.body)` (or list variant)
- `frontend/tests/hooks/useCharacters.test.tsx` — ZodError-on-drift smoke test

---

## Task 1: Scaffold the shared workspace

**Files:**
- Create: `shared/package.json`, `shared/tsconfig.json`, `shared/tsconfig.build.json`, `shared/src/index.ts`, `shared/.gitignore`

- [ ] **Step 1: Create the directory layout**

```bash
mkdir -p shared/src/schemas shared/tests
```

- [ ] **Step 2: Write `shared/package.json`**

```jsonc
{
  "name": "story-editor-shared",
  "version": "0.1.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": { "zod": "^4.4.3" }
}
```

Note: deliberately omits `"type": "module"` — inherits CommonJS to match `backend/package.json` (`"type": "commonjs"`). Vitest hoisted to root devDeps in Task 2; not declared here.

- [ ] **Step 3: Write `shared/tsconfig.json`**

```jsonc
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 4: Write `shared/tsconfig.build.json`**

```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "noEmit": false
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 5: Write `shared/src/index.ts` (empty barrel for now)**

```ts
// Barrel re-exports — populated by Task 6 and Task 7.
export {};
```

- [ ] **Step 6: Write `shared/.gitignore`**

```
dist/
*.tsbuildinfo
```

- [ ] **Step 7: Commit**

```bash
git add shared/
git commit -m "feat(shared): scaffold story-editor-shared workspace skeleton"
```

---

## Task 2: Convert to npm workspaces

**Files:**
- Modify: root `package.json`, `backend/package.json`, `frontend/package.json`
- Delete: `backend/package-lock.json`, `frontend/package-lock.json`
- Created (regenerated): root `package-lock.json`

- [ ] **Step 1: Capture pre-conversion dep snapshot for drift verification**

```bash
(cd backend && npm ls --all --json > /tmp/backend-deps-before.json) || true
(cd frontend && npm ls --all --json > /tmp/frontend-deps-before.json) || true
```

The `|| true` is in case `npm ls` exits non-zero on extraneous-package warnings (harmless for diff purposes).

- [ ] **Step 2: Edit root `package.json`** — add workspaces, hoist vitest, keep existing scripts

Edit the existing root `package.json` to:

```jsonc
{
  "name": "story-editor",
  "private": true,
  "version": "0.1.0",
  "description": "Self-hosted story editor with Venice.ai integration — root workspace.",
  "workspaces": ["backend", "frontend", "shared"],
  "scripts": {
    "lint": "biome check",
    "lint:fix": "biome check --write",
    "format": "biome format --write",
    "format:check": "biome format",
    "test:e2e:visual": "playwright test --config=playwright.visual.config.ts",
    "prepare": "simple-git-hooks"
  },
  "simple-git-hooks": { "pre-commit": "npx lint-staged" },
  "lint-staged": {
    "*.{ts,tsx,js,jsx,json,jsonc}": "biome check --write --no-errors-on-unmatched"
  },
  "devDependencies": {
    "@biomejs/biome": "2.4.13",
    "@playwright/test": "^1.49.1",
    "lint-staged": "16.4.0",
    "simple-git-hooks": "2.13.1",
    "vitest": "^4.1.5"
  }
}
```

- [ ] **Step 3: Edit `backend/package.json`** — add shared dep, remove its local `vitest` entry

In `backend/package.json`'s `dependencies`, add: `"story-editor-shared": "*"`. In its `devDependencies`, remove the `vitest` entry (now hoisted). Leave every other entry untouched.

- [ ] **Step 4: Edit `frontend/package.json`** — add shared + zod deps, remove its local `vitest` entry

In `frontend/package.json`'s `dependencies`, add: `"story-editor-shared": "*"` and `"zod": "^4.4.3"`. In its `devDependencies`, remove the `vitest` entry. Leave every other entry untouched.

- [ ] **Step 5: Delete per-subdir lockfiles**

```bash
rm backend/package-lock.json frontend/package-lock.json
```

- [ ] **Step 6: Install from root — regenerates a single lockfile**

```bash
rm -rf node_modules backend/node_modules frontend/node_modules shared/node_modules
npm install
```

Expected: a single `package-lock.json` appears at repo root; `node_modules/` exists at root with hoisted deps; `node_modules/story-editor-shared` is a symlink to `./shared`.

- [ ] **Step 7: Verify workspace symlink resolves**

```bash
node -e "console.log(require.resolve('story-editor-shared/package.json'))"
```

Expected: a path inside `node_modules/story-editor-shared/`.

- [ ] **Step 8: Capture post-conversion snapshot + diff**

```bash
npm ls --all --json > /tmp/all-deps-after.json
# Manual diff: compare /tmp/backend-deps-before.json + /tmp/frontend-deps-before.json
# against /tmp/all-deps-after.json. Look for major-version drift on
# transitive deps. Most drifts are harmless; flag anything that moves a
# runtime dep up a major.
```

This is a human-judgment check. Document any flagged drifts in the commit message; if a major bump looks risky, stop and consult.

- [ ] **Step 9: Verify backend + frontend still typecheck**

```bash
npm -w story-editor-backend run typecheck
npm -w story-editor-frontend run typecheck
```

Expected: both clean. Backend hasn't imported from shared yet, so its dist/ doesn't matter here.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json backend/package.json frontend/package.json
git rm backend/package-lock.json frontend/package-lock.json
git commit -m "chore: adopt npm workspaces (backend, frontend, shared)"
```

---

## Task 3: Update Dockerfiles + docker-compose for repo-root context

**Files:**
- Modify: `backend/Dockerfile`, `frontend/Dockerfile`, `docker-compose.yml`

- [ ] **Step 1: Edit `docker-compose.yml`** — change build contexts

In the `backend` service's `build` block, change `context: ./backend` to:

```yaml
backend:
  build:
    context: .
    dockerfile: backend/Dockerfile
```

Same for the `frontend` service:

```yaml
frontend:
  build:
    context: .
    dockerfile: frontend/Dockerfile
    args:
      VITE_API_BASE_URL: ${VITE_API_BASE_URL:-}
```

Leave every other key (image tag, env_file, depends_on, healthcheck, ports) unchanged.

- [ ] **Step 2: Rewrite `backend/Dockerfile`** for repo-root context

The new file (full content):

```dockerfile
# backend/Dockerfile
# Built with repo root as context per the workspaces adoption. See
# docker-compose.yml's backend.build.{context,dockerfile}.

ARG PRISMA_GENERATE_DATABASE_URL=postgresql://prisma:prisma@localhost:5432/prisma

# ---- deps ----------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
# Workspace-aware install: copy every workspace manifest and the single root
# lockfile, then npm ci installs all workspaces.
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY shared/package.json ./shared/
RUN npm ci

# ---- builder -------------------------------------------------------------
FROM node:22-alpine AS builder
ARG PRISMA_GENERATE_DATABASE_URL
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/backend/node_modules ./backend/node_modules
COPY --from=deps /app/frontend/node_modules ./frontend/node_modules
COPY --from=deps /app/shared/node_modules ./shared/node_modules
COPY . .
# Shared must be built before backend tsc — backend's compiled CJS will
# `require('story-editor-shared')` which resolves to shared/dist.
RUN npm -w story-editor-shared run build
ENV DATABASE_URL=${PRISMA_GENERATE_DATABASE_URL}
RUN npx -w story-editor-backend prisma generate
RUN npm -w story-editor-backend run build

# ---- dev (used by docker-compose.override.yml) ---------------------------
FROM node:22-alpine AS dev
ARG PRISMA_GENERATE_DATABASE_URL
WORKDIR /app
ENV NODE_ENV=development
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY shared/package.json ./shared/
RUN npm ci
COPY . .
RUN npm -w story-editor-shared run build
RUN DATABASE_URL=${PRISMA_GENERATE_DATABASE_URL} npx -w story-editor-backend prisma generate
EXPOSE 4000
CMD ["npm", "-w", "story-editor-backend", "run", "dev"]

# ---- runner --------------------------------------------------------------
FROM node:22-alpine AS runner
ARG PRISMA_GENERATE_DATABASE_URL
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app

ENV NODE_ENV=production
ENV PORT=4000

# Prod deps only.
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY shared/package.json ./shared/
RUN npm ci --omit=dev -w story-editor-backend -w story-editor-shared --include-workspace-root

# Bring in the compiled output for backend AND shared. Backend's runtime
# does `require('story-editor-shared')` → resolves via workspace symlink in
# node_modules/ → shared/dist/index.js.
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/prisma ./backend/prisma
COPY --from=builder /app/shared/dist ./shared/dist
COPY backend/prisma.config.ts ./backend/prisma.config.ts
COPY backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && DATABASE_URL=${PRISMA_GENERATE_DATABASE_URL} npx -w story-editor-backend prisma generate \
    && chown -R app:app /app

USER app
WORKDIR /app/backend

EXPOSE 4000

HEALTHCHECK --interval=10s --timeout=5s --retries=6 \
  CMD wget -qO- http://localhost:4000/api/health | grep -q '"status":"ok"' || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
```

Note: `WORKDIR /app/backend` in the runner stage is so `node dist/index.js` resolves backend's compiled output correctly. The entrypoint script may need a one-line tweak if it `cd`s based on the old layout — verify in step 5.

- [ ] **Step 3: Rewrite `frontend/Dockerfile`** for repo-root context

The new file:

```dockerfile
# frontend/Dockerfile
# Built with repo root as context per the workspaces adoption.

FROM node:22-alpine AS builder
WORKDIR /app
RUN COREPACK_ENABLE_NPM=1 corepack enable npm \
 && corepack prepare npm@11.13.0 --activate

# Workspace-aware install.
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY shared/package.json ./shared/
RUN npm ci

# Frontend reads shared via Vite alias to shared/src — no shared build step
# needed here. (Backend builds shared in its own Dockerfile.)
COPY . .

ARG VITE_API_BASE_URL=
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN npm -w story-editor-frontend run build

# ---- runner (nginx) ---------------------------------
# (Leave the runner stage from the existing Dockerfile unchanged. Only the
# builder stage's COPY/build paths change.)
```

If the existing frontend Dockerfile has a runner stage (nginx serving the bundle), preserve it byte-for-byte after the `RUN npm -w …run build` line. Read the existing file before editing to capture it; the task is "rewrite the builder stage, preserve the rest."

- [ ] **Step 4: Verify a Docker build**

```bash
docker compose build backend
docker compose build frontend
```

Expected: both succeed. If the entrypoint script needs a path tweak (step 2 note), fix it now.

- [ ] **Step 5: Spot-check the stack runs**

```bash
make dev
sleep 10
curl -fsS http://localhost:4000/api/health
make stop
```

Expected: backend health returns `{"status":"ok"}`.

- [ ] **Step 6: Commit**

```bash
git add backend/Dockerfile frontend/Dockerfile docker-compose.yml
git commit -m "chore(docker): switch build contexts to repo root for workspaces"
```

---

## Task 4: Update CI workflows

**Files:**
- Modify: `.github/workflows/ci.yml`, `.github/workflows/e2e.yml`

- [ ] **Step 1: Edit `.github/workflows/ci.yml`** — single root install, root-keyed cache, shared build step, workspace-aware test invocations

Concrete changes to make:

1. `cache-dependency-path` becomes just `package-lock.json` (drop the two per-subdir lockfile lines).
2. The three `npm ci` steps (root, backend, frontend) collapse to a single `- name: Install deps / run: npm ci`.
3. Add a new step after install, before any test or build step: `- name: Build shared / run: npm -w story-editor-shared run build`.
4. Per-step `working-directory: backend` invocations of `npm run typecheck` / `npm test` / `npm run build` become `npm -w story-editor-backend run typecheck` etc. at the root. Drop `working-directory` from those steps.
5. Same for `frontend`.

For example, a step that previously read:

```yaml
- name: Backend typecheck
  working-directory: backend
  run: npm run typecheck
```

becomes:

```yaml
- name: Backend typecheck
  run: npm -w story-editor-backend run typecheck
```

Steps that invoke non-npm tools (e.g. `npx prisma migrate deploy` against the test DB) keep their `working-directory` if they need it, or qualify with `-w` if the script is a workspace npm script.

- [ ] **Step 2: Edit `.github/workflows/e2e.yml`** — same lockfile cache update + shared build step

Apply the same pattern: drop per-subdir lockfile lines from `cache-dependency-path`; the existing single `npm ci` already worked at root, so no install consolidation needed there. Add `npm -w story-editor-shared run build` before the Playwright invocations (Playwright tests run the full stack which needs shared/dist/ for the backend container).

- [ ] **Step 3: Add the `shared` typecheck step to ci.yml**

After "Install deps" and before "Backend typecheck", add:

```yaml
- name: Shared typecheck
  run: npm -w story-editor-shared run typecheck
```

(Build is for runtime resolution; typecheck is for catching regressions inside shared itself.)

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/e2e.yml
git commit -m "ci: switch CI workflows to root npm ci + shared build step"
```

- [ ] **Step 5: Push branch + watch the first CI run**

Push the working branch (`feature/character-consolidation-ts-rest`) and inspect the `ci.yml` job on GitHub Actions. Expected: green. If anything fails, fix in a follow-up commit on the same task.

---

## Task 5: Wire `Makefile` for shared-build orchestration

**Files:**
- Modify: `Makefile`

- [ ] **Step 1: Inspect existing `Makefile`** to find the `dev` and `test` targets

```bash
grep -nE "^dev:|^test:|^rebuild|^migrate:" Makefile
```

- [ ] **Step 2: Add a `shared-build` target and prerequisite it on `dev` and `test`**

Append to the Makefile (or insert near existing targets — match the file's style):

```makefile
.PHONY: shared-build shared-watch

shared-build:
	npm -w story-editor-shared run build

# Used as a sidecar in `make dev` so backend's ts-node-dev sees fresh
# shared/dist whenever shared/src changes. Backgrounded; caller is
# responsible for terminating when `make dev` exits.
shared-watch:
	npx -w story-editor-shared tsc -p tsconfig.build.json --watch
```

Then update the existing `dev` target to invoke `shared-build` first and launch `shared-watch` in the background. Suggested shape (replacing the existing `dev:` body):

```makefile
dev: shared-build
	@( npm -w story-editor-shared exec -- tsc -p tsconfig.build.json --watch & ) \
	&& docker compose up -d \
	&& echo "shared watcher running in background; run 'make stop' to bring stack down (watcher persists; kill manually if needed)."
```

If the existing `dev` doesn't use `docker compose up -d`, preserve whatever shape it had — just prepend the `shared-build` dep and the watcher launch. The exact mechanics depend on the existing file; the principle is "shared/dist must be fresh before backend dev starts, and stays fresh during dev."

Update the existing `test` target similarly:

```makefile
test: shared-build
	npm -w story-editor-backend test
	npm -w story-editor-frontend test
```

(Adjust to match whatever the existing `test` target ran — just ensure `shared-build` runs first.)

- [ ] **Step 3: Verify**

```bash
make stop  # clean slate
make dev
sleep 10
curl -fsS http://localhost:4000/api/health
make stop
```

Expected: health check passes; shared/dist/ exists after `make dev`.

```bash
make test
```

Expected: backend + frontend test suites pass. (Shared has no tests yet; gets covered in Task 6.)

- [ ] **Step 4: Commit**

```bash
git add Makefile
git commit -m "chore(make): build shared workspace on dev/test; watcher sidecar in dev"
```

---

## Task 6: Define character Zod schemas in shared (TDD)

**Files:**
- Create: `shared/src/schemas/character.ts`, `shared/tests/character.schema.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `shared/tests/character.schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  characterSchema,
  characterCreateSchema,
  characterUpdateSchema,
  characterResponseSchema,
  charactersResponseSchema,
  characterReorderSchema,
} from '../src/schemas/character';

const validCharacter = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  storyId: '550e8400-e29b-41d4-a716-446655440001',
  name: 'Imogen Thorne',
  role: 'protagonist',
  age: '34',
  appearance: 'tall, auburn hair',
  personality: 'wry, distrusts kindness',
  voice: 'measured alto with a Devon edge',
  backstory: 'Widowed at 28.',
  arc: 'from grief-numbed widow to reluctant insurgent',
  relationships: 'Sister to Felix; estranged from her father.',
  orderIndex: 0,
  color: null,
  initial: null,
  createdAt: '2026-05-11T00:00:00.000Z',
  updatedAt: '2026-05-11T00:00:00.000Z',
};

describe('characterSchema', () => {
  it('accepts a fully-populated valid character', () => {
    expect(() => characterSchema.parse(validCharacter)).not.toThrow();
  });

  it('rejects unknown fields (strict)', () => {
    expect(() =>
      characterSchema.parse({ ...validCharacter, nickname: 'Im' }),
    ).toThrow();
  });

  it('rejects missing required name', () => {
    const { name: _name, ...rest } = validCharacter;
    expect(() => characterSchema.parse(rest)).toThrow();
  });

  it('accepts null for every optional narrative field', () => {
    const minimal = {
      ...validCharacter,
      role: null,
      age: null,
      appearance: null,
      personality: null,
      voice: null,
      backstory: null,
      arc: null,
      relationships: null,
    };
    expect(() => characterSchema.parse(minimal)).not.toThrow();
  });

  it('rejects non-ISO datetime in createdAt', () => {
    expect(() =>
      characterSchema.parse({ ...validCharacter, createdAt: 'not a date' }),
    ).toThrow();
  });

  it('rejects non-uuid id', () => {
    expect(() =>
      characterSchema.parse({ ...validCharacter, id: 'not-a-uuid' }),
    ).toThrow();
  });
});

describe('characterCreateSchema', () => {
  it('accepts minimal input (name only)', () => {
    expect(() => characterCreateSchema.parse({ name: 'Bystander' })).not.toThrow();
  });

  it('rejects empty name', () => {
    expect(() => characterCreateSchema.parse({ name: '' })).toThrow();
  });

  it('rejects unknown fields (strict)', () => {
    expect(() =>
      characterCreateSchema.parse({ name: 'X', physicalDescription: 'tall' }),
    ).toThrow();
  });

  it('accepts all 9 narrative fields', () => {
    expect(() =>
      characterCreateSchema.parse({
        name: 'X',
        role: 'rival',
        age: '40',
        appearance: 'tall',
        personality: 'cold',
        voice: 'flat',
        backstory: 'orphan',
        arc: 'redemption',
        relationships: 'rival to Imogen',
      }),
    ).not.toThrow();
  });
});

describe('characterUpdateSchema', () => {
  it('accepts empty input (all fields optional)', () => {
    expect(() => characterUpdateSchema.parse({})).not.toThrow();
  });

  it('still rejects unknown fields (strict preserved through partial)', () => {
    expect(() =>
      characterUpdateSchema.parse({ nickname: 'Im' }),
    ).toThrow();
  });
});

describe('response wrappers', () => {
  it('characterResponseSchema accepts { character }', () => {
    expect(() =>
      characterResponseSchema.parse({ character: validCharacter }),
    ).not.toThrow();
  });

  it('characterResponseSchema rejects extra top-level fields', () => {
    expect(() =>
      characterResponseSchema.parse({ character: validCharacter, foo: 1 }),
    ).toThrow();
  });

  it('charactersResponseSchema accepts { characters: [...] }', () => {
    expect(() =>
      charactersResponseSchema.parse({ characters: [validCharacter] }),
    ).not.toThrow();
  });
});

describe('characterReorderSchema', () => {
  it('accepts { characters: [{ id, orderIndex }] }', () => {
    expect(() =>
      characterReorderSchema.parse({
        characters: [{ id: validCharacter.id, orderIndex: 0 }],
      }),
    ).not.toThrow();
  });

  it('rejects extra fields on each item', () => {
    expect(() =>
      characterReorderSchema.parse({
        characters: [{ id: validCharacter.id, orderIndex: 0, extra: true }],
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
npm -w story-editor-shared test
```

Expected: FAIL with module-not-found on `'../src/schemas/character'`.

- [ ] **Step 3: Implement `shared/src/schemas/character.ts`**

```ts
import { z } from 'zod';

// `z.strictObject` rejects unknown keys at every layer. Strictness is
// preserved through `.partial()` / `.omit()` / etc. — this is the
// load-bearing invariant that closes the Prisma↔Zod drift seam at
// egress validation time.
export const characterSchema = z.strictObject({
  id: z.string().uuid(),
  storyId: z.string().uuid(),
  name: z.string(),
  role: z.string().nullable(),
  age: z.string().nullable(),
  appearance: z.string().nullable(),
  personality: z.string().nullable(),
  voice: z.string().nullable(),
  backstory: z.string().nullable(),
  arc: z.string().nullable(),
  relationships: z.string().nullable(),
  orderIndex: z.number().int().nonnegative(),
  color: z.string().nullable(),
  initial: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const characterCreateSchema = z.strictObject({
  name: z.string().min(1),
  role: z.string().nullable().optional(),
  age: z.string().nullable().optional(),
  appearance: z.string().nullable().optional(),
  personality: z.string().nullable().optional(),
  voice: z.string().nullable().optional(),
  backstory: z.string().nullable().optional(),
  arc: z.string().nullable().optional(),
  relationships: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  initial: z.string().nullable().optional(),
});

export const characterUpdateSchema = characterCreateSchema.partial();

export const characterResponseSchema = z.strictObject({ character: characterSchema });
export const charactersResponseSchema = z.strictObject({
  characters: z.array(characterSchema),
});

export const characterReorderSchema = z.strictObject({
  characters: z.array(
    z.strictObject({
      id: z.string().uuid(),
      orderIndex: z.number().int().nonnegative(),
    }),
  ),
});

export type Character = z.infer<typeof characterSchema>;
export type CharacterCreateInput = z.infer<typeof characterCreateSchema>;
export type CharacterUpdateInput = z.infer<typeof characterUpdateSchema>;
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm -w story-editor-shared test
```

Expected: all schema tests PASS.

- [ ] **Step 5: Run typecheck**

```bash
npm -w story-editor-shared run typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add shared/src/schemas/character.ts shared/tests/character.schema.test.ts
git commit -m "feat(shared): add character Zod schemas with strict-object semantics"
```

---

## Task 7: Add `CharacterPromptInput` projection + helper (TDD)

**Files:**
- Modify: `shared/src/schemas/character.ts`
- Modify: `shared/tests/character.schema.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `shared/tests/character.schema.test.ts`:

```ts
import { type Character, type CharacterPromptInput, toCharacterPromptInput } from '../src/schemas/character';

describe('CharacterPromptInput projection', () => {
  const fullCharacter: Character = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    storyId: '550e8400-e29b-41d4-a716-446655440001',
    name: 'Imogen',
    role: 'protagonist',
    age: '34',
    appearance: 'tall',
    personality: 'wry',
    voice: 'alto',
    backstory: 'widow',
    arc: 'insurgent',
    relationships: 'sister to Felix',
    orderIndex: 0,
    color: null,
    initial: null,
    createdAt: '2026-05-11T00:00:00.000Z',
    updatedAt: '2026-05-11T00:00:00.000Z',
  };

  it('toCharacterPromptInput returns only the 9 narrative fields', () => {
    const projected = toCharacterPromptInput(fullCharacter);
    expect(Object.keys(projected).sort()).toEqual(
      [
        'age',
        'appearance',
        'arc',
        'backstory',
        'name',
        'personality',
        'relationships',
        'role',
        'voice',
      ].sort(),
    );
  });

  it('preserves null values across all optional fields', () => {
    const input: CharacterPromptInput = {
      name: 'X',
      role: null,
      age: null,
      appearance: null,
      personality: null,
      voice: null,
      backstory: null,
      arc: null,
      relationships: null,
    };
    expect(toCharacterPromptInput(input)).toEqual(input);
  });

  it('preserves all populated values', () => {
    const projected = toCharacterPromptInput(fullCharacter);
    expect(projected.name).toBe('Imogen');
    expect(projected.role).toBe('protagonist');
    expect(projected.age).toBe('34');
    expect(projected.appearance).toBe('tall');
    expect(projected.personality).toBe('wry');
    expect(projected.voice).toBe('alto');
    expect(projected.backstory).toBe('widow');
    expect(projected.arc).toBe('insurgent');
    expect(projected.relationships).toBe('sister to Felix');
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
npm -w story-editor-shared test
```

Expected: FAIL on missing exports.

- [ ] **Step 3: Append the projection + helper to `shared/src/schemas/character.ts`**

```ts
// Narrow projection consumed by the prompt builder. Derived from Character
// so it cannot drift; drops structural and timestamp fields that the
// prompt builder doesn't read (and that `id` / `storyId` would be leak
// risks if a future contributor interpolated them into a template).
export type CharacterPromptInput = Pick<
  Character,
  | 'name'
  | 'role'
  | 'age'
  | 'appearance'
  | 'personality'
  | 'voice'
  | 'backstory'
  | 'arc'
  | 'relationships'
>;

// Helper for routes that have a Character-shaped value and need the
// narrow projection. Accepts the structural subset so repo outputs with
// `Date` timestamps still type-check at the call site — timestamps are
// not read.
export function toCharacterPromptInput(c: CharacterPromptInput): CharacterPromptInput {
  return {
    name: c.name,
    role: c.role,
    age: c.age,
    appearance: c.appearance,
    personality: c.personality,
    voice: c.voice,
    backstory: c.backstory,
    arc: c.arc,
    relationships: c.relationships,
  };
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm -w story-editor-shared test
```

Expected: all PASS.

- [ ] **Step 5: Typecheck**

```bash
npm -w story-editor-shared run typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add shared/src/schemas/character.ts shared/tests/character.schema.test.ts
git commit -m "feat(shared): add CharacterPromptInput projection + helper"
```

---

## Task 8: Populate the barrel export

**Files:**
- Modify: `shared/src/index.ts`

- [ ] **Step 1: Write the barrel**

Replace `shared/src/index.ts` contents with:

```ts
export {
  characterSchema,
  characterCreateSchema,
  characterUpdateSchema,
  characterResponseSchema,
  charactersResponseSchema,
  characterReorderSchema,
  toCharacterPromptInput,
} from './schemas/character';

export type {
  Character,
  CharacterCreateInput,
  CharacterUpdateInput,
  CharacterPromptInput,
} from './schemas/character';
```

- [ ] **Step 2: Build shared**

```bash
npm -w story-editor-shared run build
```

Expected: `shared/dist/index.js` and `shared/dist/schemas/character.js` exist.

- [ ] **Step 3: Verify backend can import from `story-editor-shared`**

Create a one-off check (don't commit):

```bash
cd backend && node -e "const s = require('story-editor-shared'); console.log(Object.keys(s).sort().join(','))"
```

Expected: `characterCreateSchema,characterReorderSchema,characterResponseSchema,characterSchema,characterUpdateSchema,charactersResponseSchema,toCharacterPromptInput`. (Type-only exports don't appear in the runtime object.)

- [ ] **Step 4: Verify frontend can import** (Vite alias goes in Task 16 — for now check that the package symlink resolves)

```bash
cd frontend && node -e "const s = require('story-editor-shared'); console.log(Object.keys(s).sort().join(','))"
```

Same expected output as step 3.

- [ ] **Step 5: Commit**

```bash
git add shared/src/index.ts
git commit -m "feat(shared): barrel-export character schemas + types + helper"
```

---

## Task 9: Create `respond()` egress helper (TDD)

**Files:**
- Create: `backend/src/lib/respond.ts`, `backend/tests/lib/respond.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/lib/respond.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Response } from 'express';
import { respond } from '../../src/lib/respond';

function fakeRes(): Response & { _body?: unknown; _status?: number } {
  const res = {
    _status: 200,
    _body: undefined as unknown,
    status(s: number) {
      res._status = s;
      return res;
    },
    json(body: unknown) {
      res._body = body;
      return res;
    },
  };
  return res as unknown as Response & { _body?: unknown; _status?: number };
}

const schema = z.strictObject({ hello: z.string() });

describe('respond()', () => {
  it('parses in non-production and surfaces ZodError on drift', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const res = fakeRes();
      expect(() => respond(schema, res, { hello: 1 } as never)).toThrow();
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('skips parse in production and writes the body as-is', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = fakeRes();
      // Intentionally invalid body — should NOT throw in prod.
      respond(schema, res, { hello: 1 } as never);
      expect(res._body).toEqual({ hello: 1 });
      expect(res._status).toBe(200);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('passes through valid bodies in non-production with default 200 status', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const res = fakeRes();
      respond(schema, res, { hello: 'world' });
      expect(res._body).toEqual({ hello: 'world' });
      expect(res._status).toBe(200);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('respects the status argument', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const res = fakeRes();
      respond(schema, res, { hello: 'world' }, 201);
      expect(res._status).toBe(201);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm -w story-editor-backend test -- tests/lib/respond.test.ts
```

Expected: FAIL on missing module.

- [ ] **Step 3: Implement `backend/src/lib/respond.ts`**

```ts
import type { Response } from 'express';
import type { z } from 'zod';

// Egress validation gate. In non-production, parses `data` against the
// schema to catch drift between the repo's actual output and the wire
// contract declared in `story-editor-shared`. In production, skips the
// parse to avoid per-response latency — dev/test coverage is sufficient
// because drift surfaces during development before reaching prod.
export function respond<T>(
  schema: z.ZodType<T>,
  res: Response,
  data: T,
  status = 200,
): Response {
  if (process.env.NODE_ENV !== 'production') {
    // Throws ZodError on drift; the global error handler renders it
    // (5xx in prod, 500 with stack in dev — both visible during test).
    schema.parse(data);
  }
  return res.status(status).json(data);
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npm -w story-editor-backend test -- tests/lib/respond.test.ts
```

Expected: PASS (4/4).

- [ ] **Step 5: Typecheck**

```bash
npm -w story-editor-backend run typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add backend/src/lib/respond.ts backend/tests/lib/respond.test.ts
git commit -m "feat(backend): add respond() egress validation helper"
```

---

## Task 10: Create `serializeCharacter()` Date → ISO helper (TDD)

**Files:**
- Create: `backend/src/lib/serialize.ts`, `backend/tests/lib/serialize.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/lib/serialize.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { serializeCharacter } from '../../src/lib/serialize';

const dbRow = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  storyId: '550e8400-e29b-41d4-a716-446655440001',
  name: 'Imogen',
  role: 'protagonist',
  age: '34',
  appearance: 'tall',
  personality: 'wry',
  voice: 'alto',
  backstory: 'widow',
  arc: 'insurgent',
  relationships: 'sister to Felix',
  orderIndex: 0,
  color: null,
  initial: null,
  createdAt: new Date('2026-05-11T00:00:00.000Z'),
  updatedAt: new Date('2026-05-11T01:00:00.000Z'),
};

describe('serializeCharacter()', () => {
  it('ISO-strings Date fields', () => {
    const wire = serializeCharacter(dbRow);
    expect(wire.createdAt).toBe('2026-05-11T00:00:00.000Z');
    expect(wire.updatedAt).toBe('2026-05-11T01:00:00.000Z');
  });

  it('passes narrative + structural fields through unchanged', () => {
    const wire = serializeCharacter(dbRow);
    expect(wire.id).toBe(dbRow.id);
    expect(wire.name).toBe('Imogen');
    expect(wire.relationships).toBe('sister to Felix');
    expect(wire.orderIndex).toBe(0);
    expect(wire.color).toBeNull();
  });

  it('does not mutate the input row', () => {
    const snapshot = { ...dbRow, createdAt: dbRow.createdAt, updatedAt: dbRow.updatedAt };
    serializeCharacter(dbRow);
    expect(dbRow.createdAt).toEqual(snapshot.createdAt);
    expect(dbRow.updatedAt).toEqual(snapshot.updatedAt);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm -w story-editor-backend test -- tests/lib/serialize.test.ts
```

Expected: FAIL on missing module.

- [ ] **Step 3: Implement `backend/src/lib/serialize.ts`**

```ts
import type { Character } from 'story-editor-shared';

// Repo-shape input: narrative fields are already plaintext strings (decryption
// happens in the repo), but timestamps are still Date objects from Prisma.
// `Character` (the wire shape) has timestamps as ISO strings. This helper
// converts at the handler boundary so the response matches the schema.
type RepoCharacter = Omit<Character, 'createdAt' | 'updatedAt'> & {
  createdAt: Date;
  updatedAt: Date;
};

export function serializeCharacter(row: RepoCharacter): Character {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npm -w story-editor-backend test -- tests/lib/serialize.test.ts
```

Expected: PASS (3/3).

- [ ] **Step 5: Typecheck**

```bash
npm -w story-editor-backend run typecheck
```

Expected: clean. (Shared is already built from Task 8; the import resolves.)

- [ ] **Step 6: Commit**

```bash
git add backend/src/lib/serialize.ts backend/tests/lib/serialize.test.ts
git commit -m "feat(backend): add serializeCharacter helper (Date → ISO at handler boundary)"
```

---

## Task 11: Prisma schema migration — drop two triples, add one

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_character_field_consolidation/migration.sql`

- [ ] **Step 1: Edit `backend/prisma/schema.prisma`**

In the `Character` model, find and **delete** these six columns (all of them appear together):

```
physicalDescriptionCiphertext String?
physicalDescriptionIv         String?
physicalDescriptionAuthTag    String?
notesCiphertext               String?
notesIv                       String?
notesAuthTag                  String?
```

And **add** these three columns (place them adjacent to the other narrative-ciphertext triples, e.g. after `arcAuthTag`):

```
relationshipsCiphertext       String?
relationshipsIv               String?
relationshipsAuthTag          String?
```

- [ ] **Step 2: Generate the migration**

```bash
cd backend && npx prisma migrate dev --name character_field_consolidation
```

Expected: Prisma creates `prisma/migrations/<timestamp>_character_field_consolidation/migration.sql` with the appropriate `ALTER TABLE` statements (drop three columns × two fields, add three columns × one field). Prisma also applies the migration to the dev database.

Inspect the generated SQL — confirm:
- 6 `ALTER TABLE "Character" DROP COLUMN "..."` statements.
- 3 `ALTER TABLE "Character" ADD COLUMN "...AuthTag"|"...Iv"|"...Ciphertext" TEXT` (or equivalent).
- No unexpected operations.

- [ ] **Step 3: Reset the test database**

```bash
cd backend && npm run db:test:reset
```

Expected: the test DB picks up the migration cleanly.

- [ ] **Step 4: Run the encryption leak test**

```bash
npm -w story-editor-backend test -- tests/security/encryption-leak.test.ts
```

Expected: PASS. The leak test's sentinel scan covers all narrative tables; new columns are picked up automatically.

- [ ] **Step 5: Run the existing character.repo.test.ts to surface what breaks**

```bash
npm -w story-editor-backend test -- tests/repos/character.repo.test.ts
```

Expected: **likely fails** — existing tests reference `physicalDescription` and `notes` fields the schema no longer has, and `CharacterCreateInput` (Task 12) hasn't been updated yet. Capture the failure list; Task 12 + the test updates resolve them.

- [ ] **Step 6: Commit migration alone, before fixing call sites**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat(db): consolidate character ciphertext columns (drop physicalDescription, notes; add relationships)"
```

This is a deliberately small commit so the migration is reviewable in isolation.

---

## Task 12: Update `character.repo.ts` to consume shared types

**Files:**
- Modify: `backend/src/repos/character.repo.ts`
- Modify: `backend/tests/repos/character.repo.test.ts`

- [ ] **Step 1: Edit `backend/src/repos/character.repo.ts`** — drop hand-rolled interfaces, import inferred types from shared, update encrypted-fields array

Apply these changes to the file:

1. Delete the local interfaces `CharacterCreateInput` and the type alias `CharacterUpdateInput`.
2. Add an import: `import type { CharacterCreateInput, CharacterUpdateInput } from 'story-editor-shared';`. (Re-export them from the repo if anything outside it imports those names — `grep -rn "CharacterCreateInput\|CharacterUpdateInput" backend/src` first; if hits exist in routes, the route migration in Task 13 will switch them to the shared import.)
3. Replace the `ENCRYPTED_FIELDS` const:

```ts
const ENCRYPTED_FIELDS = [
  'name',
  'role',
  'age',
  'appearance',
  'voice',
  'arc',
  'personality',
  'backstory',
  'relationships',
] as const;
```

(Removed: `physicalDescription`, `notes`. Added: `relationships`.)

4. The `encryptedDataFrom` function body needs no change — it iterates `ENCRYPTED_FIELDS` and reads each field off the input object. With the input type now inferred from `characterCreateSchema`, TS will reject any reference to `physicalDescription` / `notes` at compile time.

- [ ] **Step 2: Update `backend/tests/repos/character.repo.test.ts`**

Find every case that references `physicalDescription` or `notes` (use `grep`) and remove or replace those assertions with `relationships`. Add a new `relationships` round-trip test in the existing describe block:

```ts
it('encrypts + decrypts `relationships` round-trip', async () => {
  const created = await repo.create({
    storyId,
    name: 'X',
    orderIndex: 0,
    relationships: 'Sister to Felix; estranged from her father.',
  });
  const reread = await repo.findById(created.id);
  expect(reread?.relationships).toBe('Sister to Felix; estranged from her father.');
});
```

- [ ] **Step 3: Run the repo tests**

```bash
npm -w story-editor-backend test -- tests/repos/character.repo.test.ts
```

Expected: PASS (all old `physicalDescription` / `notes` references removed; new `relationships` test passes).

- [ ] **Step 4: Typecheck backend**

```bash
npm -w story-editor-backend run typecheck
```

Expected: errors in `characters.routes.ts` (still references `physicalDescription`/`notes` and the old local interface — Task 13 fixes those). **Do not fix routes here**; commit the repo isolated.

- [ ] **Step 5: Commit (typecheck-failing intermediate is OK — Task 13 closes it)**

```bash
git add backend/src/repos/character.repo.ts backend/tests/repos/character.repo.test.ts
git commit --no-verify -m "feat(repo): consume shared CharacterCreateInput types; relationships round-trip"
```

(`--no-verify` skips the pre-commit lint that would catch the incomplete typecheck state. This is acceptable as a deliberately staged commit; Task 13 lands typecheck-green again.)

---

## Task 13: Update `characters.routes.ts` to consume shared schemas + use `respond()` + `serializeCharacter`

**Files:**
- Modify: `backend/src/routes/characters.routes.ts`
- Modify: `backend/tests/routes/characters.test.ts`

- [ ] **Step 1: Edit `backend/src/routes/characters.routes.ts`** — replace inline schemas with shared imports

1. Delete the inline `CreateCharacterBody`, `UpdateCharacterBody`, and `ReorderCharactersBody` Zod schemas.
2. Replace with imports:

```ts
import {
  characterCreateSchema,
  characterUpdateSchema,
  characterReorderSchema,
  characterResponseSchema,
  charactersResponseSchema,
} from 'story-editor-shared';
import { respond } from '../lib/respond';
import { serializeCharacter } from '../lib/serialize';
```

3. Each handler's `safeParse` call switches schema:

```ts
const parsed = characterCreateSchema.safeParse(req.body);  // was: CreateCharacterBody.safeParse(req.body)
```

(Same for `Update`, `Reorder`.)

4. Each `res.json({ characters })` / `res.status(201).json({ character })` call switches to `respond()` + `serializeCharacter()`:

```ts
// GET /
const characters = await createCharacterRepo(req).findManyForStory(storyId);
respond(charactersResponseSchema, res, { characters: characters.map(serializeCharacter) });

// POST /
respond(characterResponseSchema, res, { character: serializeCharacter(created) }, 201);

// GET /:characterId
respond(characterResponseSchema, res, { character: serializeCharacter(character) });

// PATCH /:characterId
respond(characterResponseSchema, res, { character: serializeCharacter(updated) });

// DELETE /:characterId — no body; keep res.status(204).send()
// PATCH /reorder — no body; keep res.status(204).send()
```

5. Drop the `physicalDescription` / `notes` references from the `repo.create({...})` call in the POST handler (those properties no longer exist on `body`). The remaining create call:

```ts
created = await characterRepo.create({
  storyId,
  name: body.name,
  role: body.role,
  age: body.age,
  color: body.color,
  initial: body.initial,
  appearance: body.appearance,
  voice: body.voice,
  arc: body.arc,
  personality: body.personality,
  backstory: body.backstory,
  relationships: body.relationships,  // NEW
  orderIndex: nextOrderIndex,
});
```

6. **Preserve verbatim**: the `[D16]` POST retry loop, the reorder handler's duplicate-id / duplicate-orderIndex semantic checks (`characters.routes.ts:171-188` in the pre-h0z file), the per-handler `try/catch` + `next(err)` pattern, the ownership middleware setup.

- [ ] **Step 2: Update `backend/tests/routes/characters.test.ts`** — extend shape assertions

For every test that asserts the response body shape, add a `parse()` call against the appropriate response schema:

```ts
import { characterResponseSchema, charactersResponseSchema } from 'story-editor-shared';

// example, in the POST happy-path test:
expect(response.status).toBe(201);
expect(() => characterResponseSchema.parse(response.body)).not.toThrow();
const { character } = characterResponseSchema.parse(response.body);
expect(character.name).toBe('Imogen');
expect(character.relationships).toBe('Sister to Felix.');
```

Drop any assertions referencing `physicalDescription` or `notes`; add `relationships` coverage in the create + read paths.

- [ ] **Step 3: Run the route tests**

```bash
npm -w story-editor-backend test -- tests/routes/characters.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run full backend typecheck**

```bash
npm -w story-editor-backend run typecheck
```

Expected: clean (Task 12's deferred typecheck issue is now closed).

- [ ] **Step 5: Run the encryption leak test again**

```bash
npm -w story-editor-backend test -- tests/security/encryption-leak.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/characters.routes.ts backend/tests/routes/characters.test.ts
git commit -m "feat(routes): characters routes consume shared schemas + respond() + serializeCharacter"
```

---

## Task 14: Update prompt builder to consume `CharacterPromptInput[]` + render full XML

**Files:**
- Modify: `backend/src/services/prompt.service.ts`
- Modify: `backend/tests/services/prompt.service.test.ts`

- [ ] **Step 1: Write the failing tests** — new describe block for full-sheet rendering

Append to `backend/tests/services/prompt.service.test.ts`:

```ts
import type { CharacterPromptInput } from 'story-editor-shared';

describe('character XML rendering — full sheet', () => {
  function baseInput(characters: CharacterPromptInput[]) {
    return {
      action: 'continue' as const,
      selectedText: '',
      chapterContent: '',
      characters,
      worldNotes: null,
      modelContextLength: 8192,
      modelMaxCompletionTokens: 1024,
      userMaxCompletionTokens: Number.POSITIVE_INFINITY,
    };
  }

  const full: CharacterPromptInput = {
    name: 'Imogen Thorne',
    role: 'protagonist',
    age: '34',
    appearance: 'tall, auburn hair shorn at the jaw',
    personality: 'wry, distrusts kindness, holds grudges',
    voice: 'measured alto with a Devon edge',
    backstory: 'Widowed at 28 when her husband died in the mining collapse.',
    arc: 'from grief-numbed widow to reluctant insurgent',
    relationships: 'Sister to Felix; estranged from her father.',
  };

  it('renders all 9 fields — scalars as attrs, prose as nested children', () => {
    const sys = buildPrompt(baseInput([full])).messages[0].content;
    expect(sys).toContain(
      '<character name="Imogen Thorne" role="protagonist" age="34">',
    );
    expect(sys).toContain('  <appearance>tall, auburn hair shorn at the jaw</appearance>');
    expect(sys).toContain('  <personality>wry, distrusts kindness, holds grudges</personality>');
    expect(sys).toContain('  <voice>measured alto with a Devon edge</voice>');
    expect(sys).toContain('  <backstory>Widowed at 28 when her husband died in the mining collapse.</backstory>');
    expect(sys).toContain('  <arc>from grief-numbed widow to reluctant insurgent</arc>');
    expect(sys).toContain('  <relationships>Sister to Felix; estranged from her father.</relationships>');
    expect(sys).toContain('</character>');
  });

  it('scalar-only character (no prose) → self-closing', () => {
    const sys = buildPrompt(baseInput([{
      name: 'X', role: 'rival', age: '40',
      appearance: null, personality: null, voice: null,
      backstory: null, arc: null, relationships: null,
    }])).messages[0].content;
    expect(sys).toContain('<character name="X" role="rival" age="40" />');
  });

  it('name-only character → self-closing with name attribute only', () => {
    const sys = buildPrompt(baseInput([{
      name: 'Bystander', role: null, age: null,
      appearance: null, personality: null, voice: null,
      backstory: null, arc: null, relationships: null,
    }])).messages[0].content;
    expect(sys).toContain('<character name="Bystander" />');
  });

  it('omits attribute fields when null (role, age)', () => {
    const sys = buildPrompt(baseInput([{
      name: 'X', role: null, age: null,
      appearance: 'tall', personality: null, voice: null,
      backstory: null, arc: null, relationships: null,
    }])).messages[0].content;
    expect(sys).toContain('<character name="X">');
    expect(sys).not.toMatch(/role="null"/);
    expect(sys).not.toMatch(/age="null"/);
  });

  it('omits child elements for null/whitespace prose fields', () => {
    const sys = buildPrompt(baseInput([{
      name: 'X', role: null, age: null,
      appearance: 'tall', personality: '   ', voice: '\t',
      backstory: null, arc: null, relationships: null,
    }])).messages[0].content;
    expect(sys).toContain('<appearance>tall</appearance>');
    expect(sys).not.toContain('<personality>');
    expect(sys).not.toContain('<voice>');
  });

  it('empty-name character is skipped entirely', () => {
    const sys = buildPrompt(baseInput([
      { name: '', role: 'noise', age: null, appearance: null, personality: 'noise', voice: null, backstory: null, arc: null, relationships: null },
      { name: 'Real', role: null, age: null, appearance: null, personality: 'real', voice: null, backstory: null, arc: null, relationships: null },
    ])).messages[0].content;
    expect(sys).not.toContain('name=""');
    expect(sys).toContain('<character name="Real">');
  });

  it('escapes & < > " in attributes and & < > in nested text', () => {
    const sys = buildPrompt(baseInput([{
      name: 'A & B "the kid"', role: '<rival>', age: null,
      appearance: 'has < and > and &', personality: null, voice: null,
      backstory: null, arc: null, relationships: null,
    }])).messages[0].content;
    expect(sys).toContain('name="A &amp; B &quot;the kid&quot;"');
    expect(sys).toContain('role="&lt;rival&gt;"');
    expect(sys).toContain('<appearance>has &lt; and &gt; and &amp;</appearance>');
  });

  it('collision: backstory containing </backstory> is escaped', () => {
    const sys = buildPrompt(baseInput([{
      name: 'X', role: null, age: null,
      appearance: null, personality: null, voice: null,
      backstory: 'open </backstory> close', arc: null, relationships: null,
    }])).messages[0].content;
    expect(sys).toContain('<backstory>open &lt;/backstory&gt; close</backstory>');
  });

  it('collision: relationships containing </relationships> is escaped', () => {
    const sys = buildPrompt(baseInput([{
      name: 'X', role: null, age: null,
      appearance: null, personality: null, voice: null,
      backstory: null, arc: null, relationships: 'open </relationships> close',
    }])).messages[0].content;
    expect(sys).toContain('<relationships>open &lt;/relationships&gt; close</relationships>');
  });

  it('collision: name containing </character> is escaped + structure intact', () => {
    const sys = buildPrompt(baseInput([{
      name: '</character>', role: null, age: null,
      appearance: 'ok', personality: null, voice: null,
      backstory: null, arc: null, relationships: null,
    }])).messages[0].content;
    expect(sys).toContain('name="&lt;/character&gt;"');
    // Exactly one real opener and one real closer in the block:
    expect(sys.match(/<character /g)?.length).toBe(1);
    expect(sys.match(/<\/character>/g)?.length).toBe(1);
  });
});
```

Also update the existing `charactersBlock XML rendering (h0z)` describe block — change every assertion that expects the flat `<character name="…" role="…">traits</character>` form to expect the multi-line nested-child form. Self-closing-on-no-prose, role-attr-omission, empty-name-skipped, empty-list-omission, escape-collision behaviours all carry over but now apply to the wider field set.

Concretely, the h0z block's tests look like:

```ts
it('renders <characters>...</characters> with one <character> per entry', () => {
  // OLD assertion:
  // expect(sys).toContain('<character name="Imogen Thorne" role="protagonist">wry</character>');
  // NEW assertion:
  expect(sys).toContain('<character name="Imogen Thorne" role="protagonist">');
  expect(sys).toContain('  <personality>wry</personality>');
  expect(sys).toContain('</character>');
});
```

(Update each `it` similarly. Inputs that were `CharacterContext`-shaped must change to `CharacterPromptInput`-shaped — supply nulls for the fields not under test.)

**Delete entirely** the existing `toCharacterContext (h0z)` describe block in this file. The function is gone.

- [ ] **Step 2: Run tests — expect failure**

```bash
npm -w story-editor-backend test -- tests/services/prompt.service.test.ts
```

Expected: many failures — implementation still emits the old flat form.

- [ ] **Step 3: Implement the new prompt builder shape**

Edit `backend/src/services/prompt.service.ts`:

1. Delete the `CharacterContext` interface (around line 22), `CharacterRecord` interface, and `toCharacterContext` function (added in h0z).
2. Add an import:

```ts
import type { CharacterPromptInput } from 'story-editor-shared';
```

3. Change `BuildPromptInput.characters` type from `CharacterContext[]` to `CharacterPromptInput[]`.
4. Replace `renderCharacterTag` (h0z added the flat version) with the hybrid form:

```ts
function renderCharacterTag(c: CharacterPromptInput): string {
  if (!c.name) return '';
  const attrs = [
    ` name="${escapeXmlAttr(c.name)}"`,
    c.role ? ` role="${escapeXmlAttr(c.role)}"` : '',
    c.age ? ` age="${escapeXmlAttr(c.age)}"` : '',
  ].join('');

  const proseFields = [
    ['appearance', c.appearance],
    ['personality', c.personality],
    ['voice', c.voice],
    ['backstory', c.backstory],
    ['arc', c.arc],
    ['relationships', c.relationships],
  ] as const;

  const children = proseFields
    .filter(([, v]) => v != null && v.trim().length > 0)
    .map(([tag, v]) => `  <${tag}>${escapeXmlText(v!.trim())}</${tag}>`)
    .join('\n');

  if (children.length === 0) return `<character${attrs} />`;
  return `<character${attrs}>\n${children}\n</character>`;
}
```

5. The existing `charactersBlock` construction (h0z added it):

```ts
const charactersBlock =
  input.characters.length > 0
    ? `<characters>\n${input.characters
        .map(renderCharacterTag)
        .filter((s) => s.length > 0)
        .join('\n')}\n</characters>`
    : '';
```

…stays as-is. Only `renderCharacterTag` changes shape internally.

- [ ] **Step 4: Run tests — expect pass**

```bash
npm -w story-editor-backend test -- tests/services/prompt.service.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Typecheck**

```bash
npm -w story-editor-backend run typecheck
```

Expected: errors in `ai.routes.ts` / `chat.routes.ts` (still call `.map(toCharacterContext)`) — Task 15 closes those. Do not fix here.

- [ ] **Step 6: Commit (typecheck-failing intermediate)**

```bash
git add backend/src/services/prompt.service.ts backend/tests/services/prompt.service.test.ts
git commit --no-verify -m "feat(prompt): render full Character sheet as hybrid XML (CharacterPromptInput)"
```

---

## Task 15: Update `ai.routes.ts` + `chat.routes.ts` to use `toCharacterPromptInput`

**Files:**
- Modify: `backend/src/routes/ai.routes.ts`, `backend/src/routes/chat.routes.ts`

- [ ] **Step 1: Edit `backend/src/routes/ai.routes.ts`**

Find the `import { ..., toCharacterContext, ... } from '../services/prompt.service';` line (h0z added `toCharacterContext` to the prompt-service import). Replace with:

```ts
import { /* ...existing without toCharacterContext... */ } from '../services/prompt.service';
import { toCharacterPromptInput } from 'story-editor-shared';
```

Find the `.map(toCharacterContext)` call and replace with `.map(toCharacterPromptInput)`. The variable name (`characters`) and `CharacterContext[]` annotation become `CharacterPromptInput[]` — also update the local annotation if present:

```ts
const characters = rawCharacters.map(toCharacterPromptInput);
```

(Drop the explicit `: CharacterContext[]` annotation; the inferred type from the mapper is `CharacterPromptInput[]`.)

- [ ] **Step 2: Edit `backend/src/routes/chat.routes.ts`**

Identical change pattern to step 1.

- [ ] **Step 3: Run backend typecheck**

```bash
npm -w story-editor-backend run typecheck
```

Expected: clean.

- [ ] **Step 4: Run the AI + chat route tests**

```bash
npm -w story-editor-backend test -- tests/ai/complete.test.ts tests/routes/chat.test.ts
```

Expected: PASS. (The XML wrapper assertions added in h0z still apply; the new full-sheet rendering doesn't change the wrapper-level assertions, only adds nested children that the existing route-level tests don't peek at.)

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/ai.routes.ts backend/src/routes/chat.routes.ts
git commit -m "refactor(routes): characters → toCharacterPromptInput before buildPrompt"
```

---

## Task 16: Frontend Vite alias for `story-editor-shared`

**Files:**
- Modify: `frontend/vite.config.ts`

- [ ] **Step 1: Edit `frontend/vite.config.ts`**

Add the alias to the `resolve.alias` object:

```ts
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'story-editor-shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  // ... rest unchanged
});
```

- [ ] **Step 2: Verify Vite resolves the alias** — create a one-off check (don't commit):

```bash
cat > /tmp/probe.ts <<'EOF'
import { characterSchema } from 'story-editor-shared';
console.log(typeof characterSchema);
EOF
cd frontend && npx vite-node /tmp/probe.ts
```

Expected: prints `object`. Cleanup: `rm /tmp/probe.ts`.

- [ ] **Step 3: Run frontend typecheck**

```bash
npm -w story-editor-frontend run typecheck
```

Expected: clean (the alias is for runtime resolution; TS picks up types via `node_modules/story-editor-shared/package.json`'s `types: ./src/index.ts`).

- [ ] **Step 4: Commit**

```bash
git add frontend/vite.config.ts
git commit -m "chore(frontend): add Vite alias for story-editor-shared"
```

---

## Task 17: Update `useCharacters.ts` — drop interface, runtime-validate responses

**Files:**
- Modify: `frontend/src/hooks/useCharacters.ts`
- Modify: `frontend/tests/hooks/useCharacters.test.tsx` (or create if absent)

- [ ] **Step 1: Edit `frontend/src/hooks/useCharacters.ts`**

1. Delete the local `interface Character`, `interface CharactersResponse`, `interface CharacterResponse`.
2. Add imports:

```ts
import {
  charactersResponseSchema,
  characterResponseSchema,
  type Character,
} from 'story-editor-shared';
```

3. Wrap each `api<...>(...)` call's response in a `.parse()`:

```ts
// list
const raw = await api<unknown>(`/api/stories/${storyId}/characters`);
const { characters } = charactersResponseSchema.parse(raw);
return characters;

// single
const raw = await api<unknown>(`/api/characters/${id}`);
const { character } = characterResponseSchema.parse(raw);
return character;

// create / update mutations — same pattern on the response
```

(Type the `api<unknown>` so the parsed result is the contract; the runtime check is what types compile against.)

4. **Do not re-export `Character`** from this file. Components must import it directly from `story-editor-shared` (Task 18 updates them).

- [ ] **Step 2: Write the failing drift test**

Edit (or create) `frontend/tests/hooks/useCharacters.test.tsx`. Add:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCharacters } from '../../src/hooks/useCharacters';
import * as apiModule from '../../src/lib/api';

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('useCharacters runtime validation', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('surfaces ZodError when the server response is shape-drifted', async () => {
    // Mock api() to return a malformed body (missing required `name`).
    vi.spyOn(apiModule, 'api').mockResolvedValue({
      characters: [{ id: '550e8400-e29b-41d4-a716-446655440000', /* name absent */ }],
    });
    const { result } = renderHook(() => useCharacters('story-id'), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeDefined();
    // ZodError has an `issues` array; thrown as a regular error through TanStack Query.
    expect(String(result.current.error)).toMatch(/zod|issues|required/i);
  });

  it('returns parsed characters on valid response', async () => {
    const valid = {
      characters: [{
        id: '550e8400-e29b-41d4-a716-446655440000',
        storyId: '550e8400-e29b-41d4-a716-446655440001',
        name: 'Imogen', role: null, age: null,
        appearance: null, personality: null, voice: null,
        backstory: null, arc: null, relationships: null,
        orderIndex: 0, color: null, initial: null,
        createdAt: '2026-05-11T00:00:00.000Z',
        updatedAt: '2026-05-11T00:00:00.000Z',
      }],
    };
    vi.spyOn(apiModule, 'api').mockResolvedValue(valid);
    const { result } = renderHook(() => useCharacters('story-id'), { wrapper: wrap() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.[0].name).toBe('Imogen');
  });
});
```

- [ ] **Step 3: Run — expect failure** (drift test) **and** pass (valid-response test)

```bash
npm -w story-editor-frontend test -- src/hooks/useCharacters
```

Expected: PASS after the step-1 changes land. If the existing test file mocks `api` differently, adapt the spy target (some projects mock at the `fetch` level instead).

- [ ] **Step 4: Frontend typecheck**

```bash
npm -w story-editor-frontend run typecheck
```

Expected: **errors** in components that still `import { type Character } from '../hooks/useCharacters'` — Task 18 fixes them. Do not chase down call sites here.

- [ ] **Step 5: Commit (typecheck-failing intermediate)**

```bash
git add frontend/src/hooks/useCharacters.ts frontend/tests/hooks/useCharacters.test.tsx
git commit --no-verify -m "feat(frontend): useCharacters consumes shared schemas + runtime-validates responses"
```

---

## Task 18: Update all component import sites for `Character`

**Files:**
- Modify: every frontend `.ts` / `.tsx` file that imports `type Character` from `useCharacters`

- [ ] **Step 1: Find the call sites**

```bash
grep -rln "from '\(.\{1,\}\)/hooks/useCharacters'" frontend/src/ | xargs grep -ln "type Character"
```

Expected: ~5 files (CharacterSheet, CharacterPopover, CastTab, EditorPage, etc.).

- [ ] **Step 2: Update each file**

For every file in the list, replace:

```ts
import { type Character } from '../hooks/useCharacters';
// or with @-alias:
import { type Character } from '@/hooks/useCharacters';
```

with:

```ts
import { type Character } from 'story-editor-shared';
```

If the file imports other named things from `useCharacters` alongside `Character` (e.g. `useCharactersQuery`), split the import into two lines — leave the hook imports pointing at `useCharacters`, the type at `story-editor-shared`.

- [ ] **Step 3: Frontend typecheck**

```bash
npm -w story-editor-frontend run typecheck
```

Expected: clean.

- [ ] **Step 4: Frontend tests**

```bash
npm -w story-editor-frontend test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/
git commit -m "refactor(frontend): import Character from story-editor-shared, not useCharacters"
```

---

## Task 19: Add `relationships` field to `CharacterSheet`

**Files:**
- Modify: `frontend/src/components/CharacterSheet.tsx`
- Modify: `frontend/src/components/CharacterSheet.stories.tsx`

- [ ] **Step 1: Edit `frontend/src/components/CharacterSheet.tsx`**

Apply these changes:

1. Add `relationships` to the `FieldKey` union:

```ts
type FieldKey = 'name' | 'role' | 'age' | 'appearance' | 'voice' | 'arc' | 'personality' | 'backstory' | 'relationships';
```

(Note: this also adds `backstory`, which the spec's field-set table marked as an existing UI field — verify by reading the current `FieldKey` union. The current state per my read shows the form has fewer fields than the schema; spec says "form exposes 7" today and we now want 9 — confirm the actual baseline.)

2. Add fields to the `Form` interface:

```ts
interface Form {
  name: string;
  role: string;
  age: string;
  appearance: string;
  voice: string;
  arc: string;
  personality: string;
  backstory: string;     // add if missing
  relationships: string; // new
}
```

3. Update `EMPTY_CHARACTER`:

```ts
const EMPTY_CHARACTER: Form = {
  name: '',
  role: '',
  age: '',
  appearance: '',
  voice: '',
  arc: '',
  personality: '',
  backstory: '',
  relationships: '',
};
```

4. Update the load-from-character helper to read `c.backstory ?? ''` and `c.relationships ?? ''`.

5. Update the diff helper's `for of` array to include `backstory` and `relationships`:

```ts
const fields: Array<{ key: Exclude<FieldKey, 'name'>; currentRaw: string; initial: string | null }> = [
  { key: 'role', currentRaw: current.role, initial: original.role },
  { key: 'age', currentRaw: current.age, initial: original.age },
  { key: 'appearance', currentRaw: current.appearance, initial: original.appearance },
  { key: 'voice', currentRaw: current.voice, initial: original.voice },
  { key: 'arc', currentRaw: current.arc, initial: original.arc },
  { key: 'personality', currentRaw: current.personality, initial: original.personality },
  { key: 'backstory', currentRaw: current.backstory, initial: original.backstory },
  { key: 'relationships', currentRaw: current.relationships, initial: original.relationships },
];
```

6. Add a `useId()` call for `relationshipsId` (and `backstoryId` if missing), and render the textarea + label in the form body using the same pattern as the existing prose fields. Place `relationships` last in render order (matches the spec's hybrid XML ordering for cognitive consistency).

- [ ] **Step 2: Add a story variant**

Edit `frontend/src/components/CharacterSheet.stories.tsx`. Add a `FullyPopulated` (or similarly named) story that fills in all 9 fields including `relationships`:

```ts
export const FullyPopulated: Story = {
  args: {
    mode: 'edit',
    initial: {
      id: '550e8400-e29b-41d4-a716-446655440000',
      storyId: '550e8400-e29b-41d4-a716-446655440001',
      name: 'Imogen Thorne',
      role: 'protagonist',
      age: '34',
      appearance: 'tall, auburn hair shorn at the jaw',
      personality: 'wry, distrusts kindness, holds grudges',
      voice: 'measured alto with a Devon edge',
      backstory: 'Widowed at 28 when her husband died in the mining collapse.',
      arc: 'from grief-numbed widow to reluctant insurgent',
      relationships: 'Sister to Felix; estranged from her father.',
      orderIndex: 0,
      color: null,
      initial: null,
      createdAt: '2026-05-11T00:00:00.000Z',
      updatedAt: '2026-05-11T00:00:00.000Z',
    },
  },
};
```

(Adapt to whatever story-prop shape the existing stories use.)

- [ ] **Step 3: Frontend typecheck**

```bash
npm -w story-editor-frontend run typecheck
```

Expected: clean.

- [ ] **Step 4: Frontend tests**

```bash
npm -w story-editor-frontend test -- src/components/CharacterSheet
```

Expected: PASS.

- [ ] **Step 5: Run Storybook briefly** (skip if no time; not blocking)

```bash
npm -w story-editor-frontend run storybook -- --no-open
# In another terminal: curl -fsS http://localhost:6006 > /dev/null
# Then Ctrl+C the storybook process.
```

Confirms the story compiles. Not required for the gate.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/CharacterSheet.tsx frontend/src/components/CharacterSheet.stories.tsx
git commit -m "feat(frontend): expose backstory + relationships fields in CharacterSheet"
```

---

## Task 20: Final verification

**Files:** none modified — verification only.

- [ ] **Step 1: Run the verify line end-to-end**

```bash
npm -w story-editor-shared run build && \
  npm -w story-editor-shared run typecheck && \
  npm -w story-editor-backend run typecheck && \
  npm -w story-editor-frontend run typecheck && \
  npm -w story-editor-shared test && \
  npm -w story-editor-backend test -- tests/services/prompt.service.test.ts tests/repos/character.repo.test.ts tests/lib/respond.test.ts tests/lib/serialize.test.ts tests/routes/characters.test.ts tests/security/encryption-leak.test.ts && \
  npm -w story-editor-frontend test -- useCharacters CharacterSheet
```

Expected: every step PASS.

- [ ] **Step 2: Run the full backend suite** (catches regressions outside the targeted files)

```bash
npm -w story-editor-backend test
```

Expected: PASS. Anything failing should be either a test I missed updating for the new field set, or a real regression worth investigating.

- [ ] **Step 3: Run the full frontend suite**

```bash
npm -w story-editor-frontend test
```

Expected: PASS.

- [ ] **Step 4: `lint:design` regression check**

```bash
npm -w story-editor-frontend run lint:design
```

Expected: PASS (no design-token drift; the new field uses the established form pattern).

- [ ] **Step 5: Encryption leak test re-run**

```bash
npm -w story-editor-backend test -- tests/security/encryption-leak.test.ts
```

Expected: PASS.

- [ ] **Step 6: Confirm barrel exports match the spec's documented set**

```bash
node -e "const s = require('story-editor-shared'); console.log(Object.keys(s).sort().join('\n'))"
```

Expected output (alphabetised):
```
characterCreateSchema
characterReorderSchema
characterResponseSchema
characterSchema
characterUpdateSchema
charactersResponseSchema
toCharacterPromptInput
```

Type-only exports (`Character`, `CharacterCreateInput`, `CharacterUpdateInput`, `CharacterPromptInput`) don't appear at runtime — verify via grep instead:

```bash
grep -E "^export type" shared/src/index.ts
```

Expected: a single line exporting exactly `Character`, `CharacterCreateInput`, `CharacterUpdateInput`, `CharacterPromptInput`.

- [ ] **Step 7: Confirm no stale references remain**

```bash
grep -rnE "toCharacterContext|CharacterContext|CharacterRecord|physicalDescription|notesCiphertext" backend/src frontend/src shared/src 2>/dev/null
```

Expected: zero matches.

- [ ] **Step 8: Confirm `lib/api.ts`-typed responses align with the schemas** (sanity)

```bash
grep -rnE "interface Character\b" frontend/src 2>/dev/null
```

Expected: zero matches.

- [ ] **Step 9: Hand off to `/bd-close-reviewed`** (this skill runs surface reviews + close)

```bash
/bd-close-reviewed <bd-id>
```

(The bd issue ID will be filed when this plan gets bd-linked via `scripts/bd-link-plan.sh`.)

---

## Self-review notes

**Spec coverage:**
- Schema migration (drop physicalDescription/notes, add relationships) → Task 11.
- Single canonical Zod schema → Tasks 6, 7, 8 (shared workspace + schemas + barrel).
- Workspace adoption (npm workspaces + Dockerfile + CI + Makefile) → Tasks 1–5.
- `respond()` egress helper → Task 9.
- `serializeCharacter` Date → ISO → Task 10.
- `z.strictObject` at every layer → Task 6 (implementation + tests).
- Backend route migration (consume shared, use respond + serialize, preserve [D16] + reorder semantic checks) → Task 13.
- Frontend `useCharacters` drop interface + runtime validate → Task 17.
- Component import-site updates (no re-export shim) → Task 18.
- `CharacterSheet` adds `relationships` (and `backstory` if it was missing) → Task 19.
- Prompt builder consumes `CharacterPromptInput[]` and renders hybrid XML → Task 14.
- `ai.routes.ts` / `chat.routes.ts` use `toCharacterPromptInput` → Task 15.
- Lockfile-drift verification (`npm ls --all` diff) → Task 2 step 8.
- CI workflow updates → Task 4.
- Verify line / encryption leak test / barrel inventory check → Task 20.

**Type consistency check:**
- `CharacterPromptInput` (Task 7) is consumed in Task 14 (`renderCharacterTag(c: CharacterPromptInput)`) and Task 15 (`.map(toCharacterPromptInput)`). Field list matches across tasks.
- `Character` type (Task 6, inferred from `characterSchema`) is consumed in Task 18 (frontend imports) — same import path; matches.
- `CharacterCreateInput` / `CharacterUpdateInput` (Task 6) are consumed in Task 12 (repo) and Task 13 (routes). Schemas are strict; both layers reject unknown keys.
- `serializeCharacter` (Task 10) returns the wire `Character` shape — Task 13 maps `repo.create()` output through it before `respond()` validates.

**Stage-failing commits:** Tasks 12, 14, 17 deliberately leave the backend or frontend typecheck red across the commit boundary (the change is split across two files for review locality). Tasks 13, 15, 18 close each loop. Use `git commit --no-verify` only on those staged intermediates; final task verifies the full chain.

**Out-of-scope guard:** plan does not touch other entities' types, ts-rest adoption, OpenAPI generation, `prisma-zod-generator`, character context truncation, or `Story.systemPrompt` — all listed in the spec's Follow-up tasks section, none required to land this PR.
