# CLAUDE.md — Story Editor

This file is the operating manual for Claude Code on this project. Read it fully before touching any code. Update it when you discover something that should be remembered across sessions.

---

## Project Overview

A self-hosted, web-based story and text editor ("Inkwell") with Venice.ai integration. Users manage stories broken into chapters, attach characters for AI consistency, and invoke AI writing assistance from a TipTap rich text editor. **Authentication is username-based**; each user supplies **their own Venice.ai API key (BYOK)**, which is stored AES-256-GCM encrypted at rest. **All narrative content** (titles, bodies, notes, character bios, outline items, chat messages) is **encrypted at rest** with envelope encryption (per-user random DEK wrapped by an argon2id-derived key from the user's password, with a second wrap under an argon2id-derived key from a one-time recovery code shown at signup — no server-held KEK wraps content).

**Monorepo layout:**
```
/
├── frontend/                  React + Vite + TypeScript + TailwindCSS + TipTap + Zustand + TanStack Query
├── backend/                   Node.js + Express + TypeScript + Prisma (schema/migrations/seed under backend/prisma/)
├── shared/                    story-editor-shared — canonical Zod schemas + wire types, imported by frontend AND backend
├── scripts/                   Utility shell scripts (DB backup + restore-drill, test-DB reset, bd plan-link + close-gate, proxy smoke)
├── tests/e2e/                 Playwright E2E specs (run against a live stack)
├── docs/                      Architecture docs (data-model, api-contract, venice-integration, encryption) + agent-rules/ (rule digests + index.md), agent-workflow.md, superpowers/{plans,specs}/, done/ (closed-work archives)
├── mockups/archive/v1-2025-11/ Read-only archive of the original HTML prototype (Storybook is the live design surface)
├── .claude/                   Skills (/bd-execute, /bd-close-reviewed) + agent defs (security-reviewer, repo-boundary-reviewer)
├── .beads/                    bd (beads) issue tracker — local Dolt DB + tracked issues.jsonl export
├── docker-compose.yml
├── docker-compose.override.yml  (local dev, hot reload)
├── .env.example
├── Makefile
├── AGENTS.md                  Agent quick-reference for the bd workflow (companion to this file)
├── TASKS.md                   Historical journal + ID-mapping table (working tracker is bd)
└── SELF_HOSTING.md
```

**UI source of truth:** Storybook. Run `npm --prefix frontend run storybook` and browse `Primitives/`, `Tokens/`, and the component-namespaced stories before authoring new UI. New components and new feature mockups are written as `*.stories.tsx` files alongside the component source — there is no parallel HTML mockup universe. Theme tokens (`--ink-*`, `--bg-*`, theme blocks, radii, shadows) live in `frontend/src/index.css`; Tailwind v4 exposes them via the CSS-first `@theme` block in that file. Themes (`paper` default, `sepia`, `dark`) switch via `data-theme` on `<html>`. The `lint:design` CI guard (`frontend/scripts/lint-design.mjs`) enforces token-only usage in `frontend/src/`. Historical mockups live read-only at `mockups/archive/v1-2025-11/`.

---

## Quick Start

```bash
# First-time setup
cp .env.example .env        # then edit values (see General rules for current drift)
make dev                    # brings up postgres + backend + frontend
                            # frontend :3000 · backend :4000

# Day-to-day
make dev                    # start stack
make stop                   # stop stack
make logs                   # tail all services
make migrate                # apply pending migrations (prisma migrate deploy) + restart backend to refresh its Prisma client
make reset-db               # DESTRUCTIVE — wipes pgdata volume and re-migrates
make rebuild-frontend       # rebuild + restart after a frontend package.json change
make rebuild-backend        # rebuild + restart after a backend package.json change
make rebuild                # rebuild + restart both images

# Testing (from repo root)
make test                   # shared + backend + frontend (vitest) suites
make test-e2e               # playwright against a running stack
npm -w story-editor-backend run db:test:reset   # reset the test DB before a full suite

# Lint / typecheck / verify (from repo root)
make lint                   # biome check across the whole repo
make typecheck              # shared + backend + frontend typecheck
make verify                 # local CI-equivalent: lint + typecheck + design-lint + builds + tests
                            # (backend tests require `make dev` up — vitest globalSetup hits Postgres)

# Per-workspace typecheck commands. The `shared` workspace is source-only —
# no `build` script; the backend tsup build inlines it via `noExternal`.
# Use `typecheck` for the equivalent compile-time gate.
npm --prefix shared run typecheck     # tsc --noEmit (shared, source-only — no build artifact)
npm --prefix backend run typecheck    # tsc -p tsconfig.test.json --noEmit (backend src + tests)
npm --prefix frontend run typecheck   # tsc -b && tsc -p tsconfig.test.json --noEmit (project refs + tests)

# Working tracker (bd) — see "Task Completion Protocol" below
bd ready                       # list available tasks (no blockers)
bd show <id>                   # detailed view (description + verify: + plan: in --notes)
/bd-execute <id>               # default flow: implement → review → close (requires plan: link)
/bd-close-reviewed <id>        # close-gate skill (called by /bd-execute, or directly for non-loop work)
```

---

## Task Completion Protocol

**Working tracker is bd. All open tasks live in bd; `TASKS.md` is a historical ID-mapping table that maps `[A-Z]\d+` IDs (referenced by plan docs, commit messages, and agent prompts) to their bd issues.** New tasks file directly into bd (`bd create …`); there are no checkboxes to tick.

**Default implementation flow is `/bd-execute <id>`** — the bridge skill that claims the issue, dispatches superpowers' implementer + spec-reviewer + code-quality-reviewer loop with project-rule digests prepended at every dispatch, then hands off to `/bd-close-reviewed`. Operating doc: `docs/agent-workflow.md`.

**`/bd-execute` requires a `plan: <path>` link in the issue's `--notes`.** That's the brainstorm gate: every task gets a written plan before it gets implemented. The plan can be terse if the work is trivial — but it has to exist, and the bd issue has to point at it.

For every task:

1. `bd ready` to find work; `bd show <id>` to read description + `verify:` line + `plan:` link in `--notes`.
2. **If `--notes` has no `plan:` link:** run `superpowers:brainstorming` first, then `superpowers:writing-plans` (writes a plan under `docs/superpowers/plans/YYYY-MM-DD-<slug>.md`), then `bash scripts/bd-link-plan.sh <id> <plan-path>` to record the link.
3. `/bd-execute <id>` — runs the full implement → spec-review → quality-review loop, claims the issue along the way, and hands off to `/bd-close-reviewed` at the end.
4. `/bd-close-reviewed` runs typecheck on affected workspaces, fans path-matched surface reviewers (`security-reviewer`, `repo-boundary-reviewer`), and refuses close on `BLOCK` / `FIX_BEFORE_MERGE` findings. If a reviewer blocks: fix the code (not the test, not the verify) and re-loop. Override requires `--override-block "<reviewer> — <reason>"` plus explicit user-ack.
5. Move to the next task immediately — do not refactor or add scope.

**NEVER `bd close` a task directly.** Always go through `/bd-close-reviewed` so the verify gate, typecheck, and surface reviewers all run. Tasks with `TBD` / `design decision` / empty verify lines require the override path with explicit user-ack to close.

If a task has no verify command, add one to `--notes` (`bd update <id> --notes "verify: <command>\n…"`) before starting.

### Plan-review gate

After writing or updating a plan under `docs/superpowers/plans/`, **STOP**. Quote the plan path and a one-line summary back to the user, then wait for explicit approval before:

- committing the plan file
- running `scripts/bd-link-plan.sh`
- invoking `/bd-execute`
- dispatching any implementer subagent

`AskUserQuestion` answers about scope or approach are **direction approval**, not plan-review approval. They are different gates:

- **Direction gate:** "Should the fix include X? Stack now or wait?" — answered before writing the plan.
- **Plan-review gate:** the user reads the written plan file and confirms.

A plan that passes direction approval can still be wrong in shape, scope, or abstraction. The brainstorming skill's hard gate ("Do NOT invoke any implementation skill … until you have presented a design and the user has approved it") applies to the plan file itself, not to a summary or to the design questions that preceded it. Auto Mode does **not** override this gate — Auto Mode is about reducing interruptions on routine work, not about skipping reviews of multi-task plans.

### When to skip `/bd-execute`

Three cases skip the loop:

- **One-off fix not worth a plan** (typo, dependency bump, doc tweak). Edit, commit, run `/bd-close-reviewed <id>` directly — the close-gate skill works standalone. Use sparingly: if you're skipping the plan more than rarely, the brainstorm gate isn't being respected.
- **Plan-less coordinator parent with plan-bearing children** (brainstorming-split convention). The parent stays plan-less and closes automatically when every child closes. Run `/bd-execute` on each child via `bd ready`, not on the parent.
- **Trivial task with `plan: trivial` + inline rationale in `--notes`.** Same flow as a real plan; `/bd-execute` accepts the trivial form.

### Verify-line convention in bd `--notes`

A single line starting with `verify:`, the runnable command on the rest of that line. Multi-line commands go on one line via `&&` / `;`. The first matching line wins. Non-runnable verifies (`TBD …`, `design decision …`, empty) are accepted but `/bd-close-reviewed` exits non-zero with a "no automated verify" message; closing those requires the override path.

### Historical archives

Closed work from the original bring-up letters lives in immutable `docs/done/done-<section>.md` archives. To find a historical task ID, grep both: `grep -rE "\[<ID>\]" TASKS.md docs/done/`. The letter→scope glossary (S/A/D/AU/E/V/L/B/F/I/T/X plus live M = maintenance, DS = design-system), with per-letter status and archive pointers, lives in `TASKS.md`. Closed `[x]` rows still in TASKS.md (F Phase 4, a few X tasks) are pending rotation into their respective `done-*.md` archives — leave them alone unless you're doing the rotation.

### Local tooling

- **`/bd-execute <BD_ID>`** — `.claude/skills/bd-execute/`. Bridges bd issues into superpowers' subagent-driven-development loop. Reads the plan link from `--notes`, picks rules digests from `docs/agent-rules/index.md` by touch-set, dispatches implementer + spec-reviewer + code-quality-reviewer (Sonnet by default; per-task `model: opus` opt-in) per task, hands off to `/bd-close-reviewed` after the loop reports CLEAN.
- **`/bd-close-reviewed <BD_ID>`** — `.claude/skills/bd-close-reviewed/`. Gates close on typecheck + path-matched surface reviewers + verify-line. Wraps `scripts/bd-close-reviewed.sh` for the mechanical phases.
- **`scripts/bd-link-plan.sh <id> <plan-path>`** — links a plan file to a bd issue's `--notes`. Idempotent; preserves the `verify:` line. Called as a step in the protocol above when the issue lacks a plan link.

---

## Architecture Rules

### General
- TypeScript strict mode is on across all workspaces (shared, backend, frontend) — no `any` types
- All environment variables must be documented in `.env.example` with a comment explaining what they are
- No secrets ever committed to git. `.env` is in `.gitignore`.
- **Error responses & logging.** In non-production (`NODE_ENV !== 'production'`), the global error handler includes `err.stack` in the JSON response body, AI/chat route catch sites `console.error` the full exception, and decrypted narrative content (chapter bodies, prompts assembled for Venice, character bios, chat messages) MAY appear in dev logs and the dev-mode `<DevErrorOverlay>` "Show raw" view — this is intentional, prompt/Venice-call debugging requires it. In production, stack traces are stripped from responses, and decrypted narrative content must NEVER appear in logs, response bodies (outside the owning user's own GET), telemetry, or any other sink. The following are absolute, in *all* environments including dev and tests: plaintext Venice API keys, plaintext passwords, recovery codes, and content DEKs (wrapped or unwrapped). The leak test ([E12]) enforces the narrative-content production rule via a sentinel string. `security-reviewer` enforces the absolute rules; `[AU13]` is the standing no-leak proof for Venice keys.
- **No server-wide Venice API key exists.** Venice keys are per-user (BYOK), AES-256-GCM encrypted at rest under the **per-user content DEK** (via `venice-key.service.ts` → `content-crypto.service.ts`). A user-entered key must never appear in application logs, error responses, stack traces, or the frontend build output ([AU13]) — *in any environment*.
- **There is no server-held encryption env secret.** `APP_ENCRYPTION_KEY` has been retired — it no longer exists and wraps nothing. The BYOK Venice key is now wrapped by the same per-user DEK envelope as narrative content. There is no `CONTENT_ENCRYPTION_KEY` either; the boot validator (`backend/src/boot/env-validation.ts`) warns if either is accidentally introduced. If a stale `APP_ENCRYPTION_KEY` lingers in `.env`, the boot validator warns and ignores it.
- Content DEKs are wrapped by the user's password (argon2id) and by a one-time recovery code (argon2id). **Losing both the password and the recovery code for a given user = irrecoverable data loss for that user's narrative content and stored Venice key.** The server has no way to decrypt when both are gone, by design.
- **`.env.example`:** `VENICE_API_KEY` and `APP_ENCRYPTION_KEY` have been removed (both are gone — BYOK supersedes the former; the Venice key is under the per-user DEK, not a server key). `CONTENT_ENCRYPTION_KEY` is never added — the boot validator warns if it's accidentally introduced.
- **Dependencies: install the current stable mainline by default, not whatever range the LLM remembers.** Before adding a new package — or pinning one that doesn't already exist in `package.json` — check what the current stable is via `npm view <pkg> version` (latest tag) and, if the major-version jump matters (e.g. Express 4 → 5, Vite 5 → 8, Tiptap 2 → 3, Zod 3 → 4), `npm view <pkg> versions --json | tail` to confirm the latest stable on the channel you want. Pin to the latest stable by default. Going in on an older major needs a real reason recorded in the commit (e.g. "blocked on upstream peer X" with a removal trigger), not silence. The historical pattern of landing dependencies several majors behind current and then paying for the bump later (Express 4, the dep-sweep PRs) is what this rule exists to prevent. Apply equally to `dependencies`, `devDependencies`, `peerDependencies`, and tooling pulled in via skill / hook / agent glue. Doesn't apply to *intentional* downgrades to dodge a known regression — those need the same commit-message justification.

### Backend
*Backend implementation rules live in `docs/agent-rules/backend.md` (read by implementer + code-quality-reviewer at dispatch time via `/bd-execute`).*

### Frontend
*Frontend implementation rules live in `docs/agent-rules/frontend.md` (read by implementer + code-quality-reviewer at dispatch time via `/bd-execute`).*

### Database
*Database / repo-layer rules live in `docs/agent-rules/backend.md` (general database rules) and `docs/agent-rules/repo-boundary.md` (narrative-entity boundary, encrypt-on-write / decrypt-on-read template). Every model has `createdAt`; most have `updatedAt`. `Message` carries a nullable `updatedAt` (`null` = never edited; set only by the in-place edit path `message.repo.update`) — it is no longer append-only. `Session` and `RefreshToken` are `createdAt`-only by design. The app is at/near release, so **schema changes must preserve and migrate existing data** — the migration rules live in `backend.md` / `repo-boundary.md` and the gate is in "When to Stop and Ask" below.*

### AI Integration
*AI integration rules (per-user Venice client, prompt service, context budget, `venice_parameters`) live in `docs/agent-rules/backend.md`.*

### Encryption at Rest
*Encryption-at-rest rules live in `docs/agent-rules/repo-boundary.md` (envelope model, request-scoped DEK, ciphertext-egress, leak-test invariant) and `docs/agent-rules/backend.md` (the surrounding backend invariants — no server-held key policy). The DEK survives across requests within a session via the process-memory session store (`backend/src/services/session-store.ts`, binding `{ userId, dek, expiresAt }`) plus a request-scoped `WeakMap` unwrap cache in `content-crypto.service.ts` — shipped across the E3–E15 series; see `docs/encryption.md` for the design.*

---

## External Capability Lookup

Before stating — in code, in design/spec docs, or in conversation — that an external library or SaaS API has, lacks, or behaves a certain way regarding a specific feature, **look it up first**. Do not infer from our wrappers, our type definitions, our prior usage, or memory.

**Lookup order (same for libraries and SaaS APIs):**

1. **Context7 MCP** — `resolve-library-id` then `query-docs`. It indexes vendor API docs (Venice, OpenAI, Anthropic, GitHub) as well as npm packages — try it first regardless of source type.
2. **WebFetch** on the vendor's official docs URL — fallback when Context7 has no entry or its index is thin.

Our internal client wrappers tell you what WE surface, not what the upstream actually exposes. Workarounds, fallbacks, and "we can't because X doesn't support it" claims are the most common form of this failure — verify the negative claim before designing around it.

---

## Testing Rules

- Backend tests use a separate test database defined in `.env.test` — never run tests against the development database
- Run `npm -w story-editor-backend run db:test:reset` before a full test suite run to ensure a clean state
- Each test file sets up its own test data and tears it down — no test should depend on data created by another test
- Do not mock the database in integration tests — use the test DB with real Prisma queries
- Integration tests against narrative entities go through the **repo layer**, not raw Prisma — otherwise the test doesn't exercise the encrypt/decrypt path and is unrepresentative
- The Venice.ai HTTP client must be mocked in all tests — no real API calls in the test suite. **Exception:** the opt-in L-series tests under `backend/tests/live/**` hit a real Venice endpoint using a spending-capped key from `backend/.env.live`. They are excluded from `npm run test:backend` and CI, and are only run via `npm run test:live`. Never import from `backend/tests/live/**` into the default suite, and never wire `.env.live` into production code paths.
- Do not skip or delete a failing test — fix the code until the test passes
- Frontend tests use jsdom — do not write tests that require a real browser (use Playwright for that)
- The encryption leak test ([E12]) must pass before merging any schema change, repo change, or migration that touches narrative entities

---

## Docker & Infrastructure Rules

- The project has no built-in reverse proxy — the docker-compose.yml exposes ports directly (frontend :3000, backend :4000). An external proxy is handled by the operator.
- All Docker services must have `restart: unless-stopped`
- Postgres data must be in a named volume (`pgdata`) so it survives `docker compose down`
- The backend must not start until Postgres passes its health check (`depends_on` with `condition: service_healthy`)
- Multi-stage Dockerfiles only — no single-stage builds in production
- Containers run as a non-root user — dev containers and the backend prod runner all run as the built-in `node` user (uid 1000); the frontend prod image is `nginx:alpine`, which has its own conventional non-root worker model

---

## Naming Conventions

| Thing | Convention | Example |
|---|---|---|
| Files (backend) | camelCase | `auth.service.ts` |
| Files (frontend) | PascalCase for components | `CharacterSheet.tsx` |
| Files (frontend) | camelCase for hooks/lib | `useAuth.ts`, `api.ts` |
| Database models | PascalCase | `Story`, `Chapter` |
| Database fields | camelCase | `worldNotes`, `storyId` |
| API routes | kebab-case nouns | `/api/stories`, `/api/ai/complete` |
| React components | PascalCase | `CharacterSheet` |
| React hooks | camelCase, `use` prefix | `useAuth`, `useStory` |
| Environment vars | SCREAMING_SNAKE_CASE | `JWT_SECRET` |
| Test files | mirror source path + `.test.ts` | `tests/routes/stories.test.ts` |

---

## Git Rules

- Create a new branch for each task group (e.g. `feature/auth`, `feature/stories-crud`)
- Commit after each passing verify command — small, frequent commits
- Commit message format: `[TASK_ID] brief description` — `TASK_ID` is the bd issue id, e.g. `[story-editor-7tg] add nullable Message.updatedAt column`
- Never commit directly to `main`
- Never commit `.env` or any file containing real credentials

---

## Security Review

The `security-reviewer` subagent (`.claude/agents/security-reviewer.md`) is a read-only reviewer tuned to this project's auth / session / key / encryption surface: password hashing, login, JWT issuance + refresh rotation, auth/ownership middleware, helmet / CORS / rate-limit, the BYOK Venice-key path (store/validate/delete + no-leak), the per-user Venice client, the change/reset-password + recovery-code-rotation endpoints (DEK-wrap columns), and the env / encryption-key bootstrap.

**`/bd-close-reviewed` auto-dispatches this reviewer** when the branch diff touches that surface (path-matched), and refuses to close on `BLOCK` / `FIX_BEFORE_MERGE`. That is the normal path — you rarely invoke it by hand. Do not bypass a blocking finding with `--override-block` unless explicitly authorised by the user.

It is **in-lane for any change to**: `backend/src/services/auth.service.ts`, `backend/src/services/venice-key.service.ts`, `backend/src/services/content-crypto.service.ts`, `backend/src/services/venice-call.service.ts`, `backend/src/lib/venice.ts`, `backend/src/services/session-store.ts`, `backend/src/middleware/`, `backend/src/routes/auth.routes.ts`, `backend/src/routes/venice-key.routes.ts`, or the `cookie` / `cors` / `helmet` / `rate-limit` / env bootstrap in `backend/src/index.ts`. (The historical task groups that built these surfaces — AU*, E3/E9/E12/E14, V17/V18, I7 — are closed; their detail lives in `docs/done/done-{AU,E,V,I}.md`.)

For an out-of-band review (a spike not going through the close gate), invoke via the Agent tool with `subagent_type: security-reviewer` and a concrete scope:

**Example invocation:**
```
Agent(
  description: "Review BYOK endpoints",
  subagent_type: "security-reviewer",
  prompt: "Review the BYOK Venice-key endpoints as currently implemented. Scope: backend/src/routes/venice-key.routes.ts + backend/src/services/venice-key.service.ts + content-crypto.service.ts. Confirm: (1) decrypted keys never logged or returned; (2) PUT validates against Venice before storing; (3) response bodies on GET expose only { hasKey, lastSix, endpoint }."
)
```

---

## Repo-Boundary Review

The `repo-boundary-reviewer` subagent (`.claude/agents/repo-boundary-reviewer.md`) is a read-only reviewer tuned to the narrative-entity boundary and the encrypt-on-write / decrypt-on-read symmetry enforced by the repo layer. It owns a narrower surface than `security-reviewer` — the repo-layer invariant from the "Database" rules and the ciphertext-egress / DEK-cache invariants from "Encryption at Rest": every narrative read goes through decrypt and every write through encrypt, no `*Ciphertext`/`*Iv`/`*AuthTag` field appears in any response, `wordCount` is computed from plaintext before encryption, the leak test ([E12]) sentinel covers every narrative table, and no controller/service/route/script touches Prisma directly for a narrative model.

**`/bd-close-reviewed` auto-dispatches this reviewer** when the branch diff touches that surface (path-matched), and refuses to close on `BLOCK` / `FIX_BEFORE_MERGE`. That is the normal path; invoke it by hand only for an out-of-band review.

It is **in-lane for any change to**: `backend/src/repos/**`, `backend/src/services/content-crypto.service.ts`, `backend/src/services/prompt.service.ts` (reads chapter bodies), `backend/src/routes/{stories,chapters,characters,outline,chat}.routes.ts`, any migration touching narrative columns, or any new one-off script under `backend/prisma/scripts/**` or `scripts/**` that touches narrative tables. (The historical task groups that built this boundary — E4–E12 — are closed; detail lives in `docs/done/done-E.md`.)

`security-reviewer` and `repo-boundary-reviewer` are complements, not substitutes — run both when a change touches both surfaces (e.g. a new narrative route that also adds auth middleware). Each stays in its own lane: `security-reviewer` owns auth/session/key/crypto-primitive surface; `repo-boundary-reviewer` owns the narrative-entity boundary.

**Example invocation:**
```
Agent(
  description: "Review chapter repo changes",
  subagent_type: "repo-boundary-reviewer",
  prompt: "Review the chapter repo changes on this branch. Scope: backend/src/repos/chapter.repo.ts + any route/service that calls it. Confirm: (1) no controller/service/route touches Prisma directly for Chapter; (2) every write path encrypts the narrative columns and every read path decrypts them; (3) wordCount is computed from plaintext before encryption; (4) no plaintext is logged or returned outside the owning user's response."
)
```

---

## When to Stop and Ask

Stop and ask before proceeding if:
- A task requires an architectural decision not covered in this file or `TASKS.md`
- A verify command cannot pass due to an external dependency issue (e.g. Venice.ai API is unreachable)
- A task conflicts with a decision already made in a previous task
- You are about to modify the Prisma schema after the initial migration has been run (batch and document — E-series narrative-column additions are already shipped)
- A data-model change is **breaking** — it needs a backfill, a new data-migration branch, or lazy/on-write population of existing rows (e.g. adding a non-null column, a new encrypted narrative column, or dropping/renaming a column on a populated table). Existing data is real now; plan the migration with the user before writing it
- You are about to change the DEK-wrap scheme for existing users (adding a third wrap, changing argon2id parameters, re-introducing a server-held key, etc.) — that's a migration, not a rotation, and requires every user to re-authenticate with their password
- You are about to merge a change to the auth / session / key / crypto surface or the narrative-repo / encryption boundary that the relevant reviewer (`security-reviewer` or `repo-boundary-reviewer`) has not cleared
- You are about to add a new dependency that significantly increases bundle or image size
- You are about to persist plaintext narrative content to disk outside the repo layer (incl. caches, tmp files, export intermediates that don't delete on error)

Do not ask for permission to:
- Choose between equivalent utility libraries (lodash vs native, etc.)
- Add TypeScript types or interfaces
- Add comments or JSDoc
- Improve error messages
- Fix linting warnings

---

## Known Gotchas

- TipTap's `useEditor` hook must be used inside a component with a stable reference — wrap in `useMemo` if you see re-render issues
- Prisma's `cascade` delete behaviour must be set on the relation field using `onDelete: Cascade` — it does not cascade by default
- Venice.ai streaming responses use SSE — use `ReadableStream` on the frontend to consume them, not a standard `fetch().then(res => res.json())`
- `wordCount` on `Chapter` must be computed from the TipTap JSON tree **before encryption** — you can't derive it from ciphertext. Order: parse JSON → count words → write ciphertext + plaintext wordCount in one repo call.
- Refresh token rotation: when a refresh token is used, delete the old one and create a new one in the same transaction
- Docker hot reload for the backend uses `tsx watch` (the `dev` script is `prisma generate && tsx watch` — see the Prisma-client-drift gotcha below). `tsx` is a backend devDependency — the production image runs the bundled `dist/index.js` via plain `node` and ships no TS runner. The backend `build` script is `tsup`, which inlines `story-editor-shared` into the bundle; there is no `shared/dist` and nothing resolves a `story-editor-shared` specifier at prod runtime
- **Dev-container Prisma client drift.** The dev compose keeps `node_modules` in anonymous volumes, so a host-side `npx prisma generate` (or a host-run migration) never reaches the *running* container's generated client. After a schema migration this leaves the container on a stale client and every affected write 500s with `Unknown argument …` until it's regenerated — and the close-gate `verify` runs on the **host**, so it won't catch this. Self-healed: the backend `dev` script runs `prisma generate` on every start, and `make migrate` restarts the backend afterward. After any migration, restart the backend (`docker compose restart backend` or `make dev`) to refresh the client; never hand-edit the generated client
- BYOK Venice key: only `venice-key.service` (store / validate / get — via `content-crypto.service`'s `encryptWithDek`/`decryptWithDek`) and `lib/venice.ts` (per-user client) touch the plaintext key, and only within the lifetime of a single request. Never log it, never echo it, never serialize it to an error object
- `Chapter.content` plaintext mirror was intentionally **dropped** — TipTap JSON (decrypted on read via the chapter repo) is the sole source of truth for chapter bodies; plaintext is derived on demand for export / AI prompts, never stored
- Selection bubble: use `onMouseDown: preventDefault()` on the bubble so clicking it doesn't collapse the user's selection
- Keyboard shortcuts contract (one listener, scoped callbacks): `⌘/Ctrl+Enter` = chat send, `⌥+Enter` = continue-writing, `Escape` = dismiss selection bubble / inline AI card / close modal
- The auth identifier is `username` (lowercased, 3–32 chars, `/^[a-z0-9_-]+$/`). `User.email` exists but is optional metadata — do not use it for login or uniqueness checks


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:7510c1e2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->

---

> **The project protocol above overrides the generic bd template in the integration block.** That block is bd-generated; where it conflicts with this file's "Task Completion Protocol", this file wins:
> - **Never run bare `bd close`** — close through `/bd-close-reviewed` so the verify + typecheck + surface-reviewer gates run. (The block's `bd close <id>` is the raw command, not the project flow.)
> - **`/bd-execute` *does* use `TodoWrite`** as its within-session per-task ledger. The block's "do NOT use TodoWrite" applies to *cross-session* task tracking, which belongs in bd — not to the implementer loop's scratch checklist.
> - **Push only when the user asks, and never commit directly to `main`.** The block's "MANDATORY git push / YOU must push" steps are not how this project operates — work lands on a branch and the user controls when it's pushed/merged.
