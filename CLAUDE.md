# CLAUDE.md — Story Editor

This file is the operating manual for Claude Code on this project. Read it fully before touching any code. Update it when you discover something that should be remembered across sessions.

---

## Project Overview

A self-hosted, web-based story and text editor ("Inkwell") with Venice.ai integration. Users manage stories broken into chapters, attach characters for AI consistency, and invoke AI writing assistance from a TipTap rich text editor. **Authentication is username-based**; each user supplies **their own Venice.ai API key (BYOK)**, which is stored AES-256-GCM encrypted at rest. **All narrative content** (titles, bodies, notes, character bios, outline items, chat messages) is **encrypted at rest** with envelope encryption (per-user random DEK wrapped by an argon2id-derived key from the user's password, with a second wrap under an argon2id-derived key from a one-time recovery code shown at signup — no server-held KEK wraps content).

**Monorepo layout:**
```
/
├── frontend/                  React + Vite + TypeScript + TailwindCSS + TipTap + Zustand + TanStack Query
├── backend/                   Node.js + Express + TypeScript + Prisma
├── db/                        Prisma schema and migrations
├── scripts/                   Utility shell scripts (backup, seed, reset)
├── docs/                      Architecture documentation — data-model, api-contract, venice-integration, encryption
├── mockups/archive/v1-2025-11/ Read-only archive of the original HTML prototype (Storybook is the live design surface)
├── docker-compose.yml
├── docker-compose.override.yml  (local dev, hot reload)
├── .env.example
├── Makefile
├── TASKS.md                   Source of truth for all work
└── SELF_HOSTING.md
```

**UI source of truth:** Storybook. Run `npm --prefix frontend run storybook` and browse `Primitives/`, `Tokens/`, and the component-namespaced stories before authoring new UI. New components and new feature mockups are written as `*.stories.tsx` files alongside the component source — there is no parallel HTML mockup universe. Theme tokens (`--ink-*`, `--bg-*`, theme blocks, radii, shadows) live in `frontend/src/index.css`; Tailwind references them via `theme.extend`. Themes (`paper` default, `sepia`, `dark`) switch via `data-theme` on `<html>`. The `lint:design` CI guard (`frontend/scripts/lint-design.mjs`) enforces token-only usage in `frontend/src/`. Historical mockups live read-only at `mockups/archive/v1-2025-11/`.

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
make migrate                # apply pending migrations (prisma migrate deploy)
make reset-db               # DESTRUCTIVE — wipes pgdata volume and re-migrates
make rebuild-frontend       # rebuild + restart after a frontend package.json change
make rebuild-backend        # rebuild + restart after a backend package.json change
make rebuild                # rebuild + restart both images

# Testing (from repo root)
make test                   # backend (vitest) + frontend (vitest) suites
make test-e2e               # playwright against a running stack
cd backend && npm run db:test:reset   # reset the test DB before a full suite

# Running a single task's verify command
/task-verify D9             # runs the `verify:` for [D9] and reports the true exit code
```

---

## Task Completion Protocol

**NEVER mark a task `[x]` until its verify command passes with exit code 0.**

For every task:
1. Read the task and its `verify:` command before writing any code
2. Confirm the task has a `plan:` link or a `trivial:` justification line. If neither, stop and write the plan first (or justify the `trivial:` exception inline). Tasks with only a description are *proposed*, not implementable.
3. Write the implementation
4. Write the test if one is required by the task
5. Run the verify command exactly as written
6. If it fails: fix the code — do not modify the test to make it pass
7. Mark `[x]` only when the verify command exits cleanly
8. Move to the next task immediately — do not refactor or add scope

If a task has no verify command, add one to `TASKS.md` before starting.

### Archived sections

`TASKS.md` only lists **live** sections (open tasks or hot code surfaces). A **subsection** is rotated into `docs/done/done-<section>.md` as soon as all its tasks are `[x]`, in the same PR that closes the last task — not the whole section letter. (Earlier S/A/D/E/V/L archives waited for the entire letter to close; that left mostly-done letters live and noisy. AU/B/I/T were rotated under the new subsection rule on 2026-05-02.) Each archive file is immutable; if a closed section is reopened, add a *new* task to `TASKS.md` rather than editing the archive.

To find a historical task ID, grep across both: `grep -rE "\[<ID>\]" TASKS.md docs/done/`. The `/task-verify` skill assumes `TASKS.md`; for an archived task, run `scripts/extract-verify.sh <ID> docs/done/done-<X>.md` directly (you almost never need to — archived tasks already passed their verify before they were ticked).

Currently archived: **S, A, D, AU, E, V, L, B, I, T**. Currently live in `TASKS.md`: **F (Phase 4 only), X, M, DS**.

### Local tooling
- **`/task-verify <TASK_ID>`** — project-local slash-command skill (`.claude/skills/task-verify/`) that runs the `verify:` command exactly as written and reports the true exit code. Use this before manually ticking a task; it's stricter than raw `npm run` because it resists pipeline tricks like `| grep -iv error` masking failures.
- **`.claude/hooks/pre-tasks-edit.sh`** — a pre-edit hook that automatically ticks a task `[x]` in `TASKS.md` when its verify command passes. Treat an auto-tick as authoritative for the verify gate; you still need the `security-reviewer` clearance (where applicable) before the task group is considered closed.

---

## Task Order

Work through tasks in this order unless instructed otherwise:

**S → A → D → AU → E → V → L → B → F → I → T → X**

| Section | Scope |
|---|---|
| S | scaffold |
| A | architecture docs (`docs/data-model.md`, `docs/api-contract.md`, `docs/venice-integration.md`, `docs/encryption.md`) |
| D | database (schema + migrations + seed) |
| AU | auth — username register/login (supersedes email), refresh rotation, middleware, security headers, **BYOK Venice key** (AU9–AU14) |
| E | encryption at rest — envelope encryption with per-user DEK wrapped by server KEK (E1–E15); see `docs/encryption.md` |
| V | Venice.ai integration — **per-user OpenAI-compatible client**, prompt builder, SSE streaming, reasoning/web-search flags |
| L | live Venice testing — opt-in, dev-only path (`backend/.env.live`, `npm run test:live`, `venice:probe` CLI). Never in the default test run or in CI. |
| B | backend non-AI routes (stories / chapters / characters / outline / chats / user-settings) |
| F | frontend — mockup-fidelity UI; source of truth is Storybook (`npm --prefix frontend run storybook`) |
| I | infra (Dockerfiles, compose, backup, `SELF_HOSTING.md`) |
| T | testing (integration + E2E) |
| X | extras |
| M | maintenance & dependency upgrades — recurring work (Node major bumps, security advisories, lint cleanup) |
| DS | design-system follow-ups — new primitives, token additions, lint:design rule changes, Storybook story patterns |

Hard gates (do not start until the prerequisite is complete):
- **B** requires **AU** — ownership middleware gates every non-auth route.
- **Any narrative-entity CRUD** (Story / Chapter / Character / OutlineItem / Chat / Message — touches both B and F) requires **E3 + E9** — writing plaintext you'd have to re-encrypt later is wasted work and a leak risk.
- **V** beyond `[A4]` requires **AU11 + AU12** — BYOK is the only key path; there is no server-wide Venice key.
- **L** requires **V17** — the probe CLI and live tests reuse the per-user OpenAI-compatible client construction. No separate Venice client lives in `scripts/` or `tests/live/`.
- **F AI features** (`[F33]`–`[F42]`: selection bubble, inline result, chat panel, model picker) require **V5+** streaming endpoints to be routable.
- **E2E tests** (`[T8]`) require the full stack to run via Docker Compose.

---

## Architecture Rules

### General
- TypeScript strict mode is on in both frontend and backend — no `any` types
- All environment variables must be documented in `.env.example` with a comment explaining what they are
- No secrets ever committed to git. `.env` is in `.gitignore`.
- **Error responses & logging.** In non-production (`NODE_ENV !== 'production'`), the global error handler includes `err.stack` in the JSON response body, AI/chat route catch sites `console.error` the full exception, and decrypted narrative content (chapter bodies, prompts assembled for Venice, character bios, chat messages) MAY appear in dev logs and the dev-mode `<DevErrorOverlay>` "Show raw" view — this is intentional, prompt/Venice-call debugging requires it. In production, stack traces are stripped from responses, and decrypted narrative content must NEVER appear in logs, response bodies (outside the owning user's own GET), telemetry, or any other sink. The following are absolute, in *all* environments including dev and tests: plaintext Venice API keys, plaintext passwords, recovery codes, content DEKs (wrapped or unwrapped), and the `APP_ENCRYPTION_KEY`. The leak test ([E12]) enforces the narrative-content production rule via a sentinel string. `security-reviewer` enforces the absolute rules; `[AU13]` is the standing no-leak proof for Venice keys.
- **No server-wide Venice API key exists.** Venice keys are per-user (BYOK), AES-256-GCM encrypted at rest. A user-entered key must never appear in application logs, error responses, stack traces, or the frontend build output ([AU13]) — *in any environment*.
- `APP_ENCRYPTION_KEY` is the only server-held encryption env secret and must be backed up with the same rigour as the DB — it wraps **BYOK Venice keys only**. Losing it makes stored Venice keys unrecoverable, but narrative content remains decryptable (content DEKs are wrapped by user-supplied secrets, not server state). There is no `CONTENT_ENCRYPTION_KEY`.
- Content DEKs are wrapped by the user's password (argon2id) and by a one-time recovery code (argon2id). **Losing both the password and the recovery code for a given user = irrecoverable data loss for that user's narrative content.** The server has no way to decrypt when both are gone, by design.
- **`.env.example` is post-`[I7]`** — `VENICE_API_KEY` has been removed everywhere (it was the legacy server-wide key; BYOK supersedes), and `APP_ENCRYPTION_KEY` is the only encryption-related env var. `CONTENT_ENCRYPTION_KEY` is never added — the scheme changed before `[I7]` ran, and the boot validator (`backend/src/boot/env-validation.ts`) warns if it's accidentally re-introduced.
- **Don't write data-migration branches.** Pre-deployment there are no users, no stored content, and no legacy rows — so code paths that exist only to handle "pre-[Tn]" shapes (null wrap columns, bcrypt hashes, plaintext-only rows, optional `sessionId` claims, etc.) serve a population that doesn't exist and just cost complexity + test surface + review burden. When a task's rollout plan asks for a dual-write, lazy-backfill, or legacy-read fallback, skip it and implement the post-rollout shape directly. If the app is ever deployed against pre-existing data in future, reintroduce only the specific branch needed for that actual population with a dated TODO for its removal. The project was scrubbed of every such branch post-[X10] (bcrypt removed, sessionId required, lazy wraps deleted, plaintext fallbacks deleted).
- **Dependencies: install the current stable mainline by default, not whatever range the LLM remembers.** Before adding a new package — or pinning one that doesn't already exist in `package.json` — check what the current stable is via `npm view <pkg> version` (latest tag) and, if the major-version jump matters (e.g. Express 4 → 5, Vite 5 → 8, Tiptap 2 → 3, Zod 3 → 4), `npm view <pkg> versions --json | tail` to confirm the latest stable on the channel you want. Pin to the latest stable by default. Going in on an older major needs a real reason recorded in the commit (e.g. "blocked on upstream peer X" with a removal trigger), not silence. The historical pattern of landing dependencies several majors behind current and then paying for the bump later (Express 4, the dep-sweep PRs) is what this rule exists to prevent. Apply equally to `dependencies`, `devDependencies`, `peerDependencies`, and tooling pulled in via skill / hook / agent glue. Doesn't apply to *intentional* downgrades to dodge a known regression — those need the same commit-message justification.

### Backend
- All route handlers must be thin — logic goes in service files in `src/services/` and repository wrappers in `src/repos/`
- All request bodies must be validated with Zod before reaching a controller
- All routes except `/api/auth/register`, `/api/auth/login`, `/api/auth/refresh`, and `/api/health` require the auth middleware
- All story, chapter, character, outline, chat, and message routes require both auth middleware AND ownership middleware (scoped to `req.user.id`)
- Errors are handled by the global error handler — do not write per-route try/catch unless it adds meaningful context
- Never expose `passwordHash` in any API response
- Never expose stack traces in responses when `NODE_ENV=production`
- Never return ciphertext fields (`*Ciphertext`, `*Iv`, `*AuthTag`, `contentDekEnc`, `veniceApiKeyEnc`, …) from any endpoint — the repo layer strips them on read
- Never return or log the decrypted Venice API key; `GET /api/users/me/venice-key` returns only `{ hasKey, lastFour, endpoint }` ([AU12])

### Frontend
- JWT access token is stored in memory (Zustand `session` slice) — never in localStorage or sessionStorage
- Refresh token lives in an httpOnly cookie set by the backend — the frontend never reads it directly
- **State management:** Zustand for client/UI state (`session`, `activeStoryId`, `activeChapterId`, `sidebarTab`, `selection`, `inlineAIResult`, `attachedSelection`, `model`, `params`, `tweaks`); TanStack Query for server state (`stories`, `story(id)`, `chapter(id)`, `characters(storyId)`, `outline(storyId)`, `chats(chapterId)`). No other stores, no React Context for app data.
- All API calls go through `src/lib/api.ts` — never call `fetch` directly in components
- Components do not contain business logic — use hooks in `src/hooks/`
- **Styling:** TailwindCSS for layout + utilities. Theme-level design tokens (colors, typography, spacing, radii, shadows) live as CSS custom properties in `src/index.css`. Tailwind's `theme.extend` references those vars. Themes (`paper` / `sepia` / `dark`) switch via `data-theme` on `<html>`. No inline styles; no per-component CSS files.
- Browse Storybook (`npm --prefix frontend run storybook`) before authoring new UI; the `Tokens/` story is authoritative for hex values, type scale, radii, and shadows. Historical reference at `mockups/archive/v1-2025-11/` (read-only).

### Database
- **Narrative entities** (Story, Chapter, Character, OutlineItem, Chat, Message) are accessed **only through the repo layer** in `src/repos/` — controllers and services never call Prisma directly for these models. Repos encrypt on write and decrypt on read ([E9]). Raw Prisma access for these entities outside repos is a bug.
- Non-narrative entities (User, RefreshToken) may be accessed directly via Prisma from services.
- No raw SQL except in migration files.
- Every model has `createdAt`; most have `updatedAt`. `Message` is an append-only log and has `createdAt` only.
- Foreign key fields must have indexes.
- Cascading deletes must be defined in the schema (`onDelete: Cascade`) — do not handle cascade logic in application code.
- Schema changes after the initial migration require explicit approval (see **When to Stop and Ask**). The E-series adds many encrypted columns; plan those migrations in batches. [E10] (backfill) is **cancelled** — pre-deployment there were no legacy plaintext rows, and [E11] already dropped the plaintext columns, leaving no source to read from. [X10] (migration-handling revisit) is **retired** — every legacy branch it was holding space for was deleted in situ. If the app is ever deployed against pre-existing plaintext data in future, reintroduce only the specific branch needed with a dated removal TODO.

### AI Integration
- All Venice.ai calls are proxied through the backend — the frontend only talks to `/api/ai/*`.
- The per-user Venice client (`getVeniceClient(userId)` — [V17]) is the only way to reach Venice. There is no singleton. If the user has no stored key, the call throws `NoVeniceKeyError` mapped to HTTP 409 `{ error: "venice_key_required" }`.
- Prompt construction lives in `src/services/prompt.service.ts` — keep it separate and unit-testable.
- **Context budget is dynamic, not a hardcoded 3000.** The prompt builder reserves 20% of the selected model's `context_length` for the response and uses the remainder for prompt content. Chapter content truncates from the top (oldest first) when over-budget. Character context is condensed to `{ name, role, key traits }`. Character and `worldNotes` are never truncated.
- Per-story `systemPrompt` overrides the default creative-writing system prompt when non-null ([V13]).
- Venice-specific features go via `venice_parameters`: `include_venice_system_prompt` is driven by the user setting `settingsJson.ai.includeVeniceSystemPrompt` (default `true` when the key is absent) — the AI route reads it off `req.user` and passes it to the prompt builder, which never hardcodes the flag. Inkwell's own system message (default or per-story `Story.systemPrompt`) is sent in every case; the flag only controls whether Venice additionally prepends its own creative-writing prompt. Set `strip_thinking_response: true` for reasoning models ([V6]); set `enable_web_search` + `enable_web_citations` when the request opts in ([V7]); set `prompt_cache_key` to a hash of `storyId + modelId` ([V8]).
- Chapter bodies must be decrypted **via the chapter repo** before the prompt builder sees them. The builder never sees ciphertext, and decrypted bodies exist only for the lifetime of the request.

### Encryption at Rest
- **Envelope model:** per-user random DEK (32-byte) wrapped **twice** by AES-256-GCM. Wrap #1: key derived via argon2id from the user's password. Wrap #2: key derived via argon2id from a one-time recovery code shown at signup. Both wraps live on `User` (`contentDekPassword*` and `contentDekRecovery*` columns, each with its own salt). No server-held KEK. Narrative columns store `{Ciphertext, Iv, AuthTag}` triples.
- DEK is random; its **wraps** are password-derived and recovery-code-derived. Password reset requires the recovery code ([AU16]). Password change ([AU15]) only re-wraps the password copy — narrative ciphertext is untouched. Rotating the recovery code ([AU17]) only re-wraps the recovery copy. **The server cannot decrypt user content while the user is logged out** — there is no offline / background / admin decryption path. If that requirement ever appears, it needs a schema migration to add a third wrap. See `docs/encryption.md` Revisit section ([E1]).
- The content-crypto service (`src/services/content-crypto.service.ts` — [E3]) unwraps DEKs only into a **request-scoped `WeakMap`**. Module-level caching of unwrapped DEKs is a bug. **Open design question** (see [AU10] note and [E3]): the DEK must survive across requests within a single session — how that's implemented (process-memory session cache, session-key wrap in access token, `Session` table, etc.) is pending resolution in `docs/encryption.md` and must be finalised before [E3] starts.
- Plaintext narrative content must never appear in logs, error messages, telemetry, or responses to anyone other than the owning user. Plaintext passwords and recovery codes must never appear in logs, error messages, responses, or error objects.
- The leak test ([E12]) inserts a sentinel string and asserts it's absent from every raw row in the narrative tables. Run it after any change to the repo layer, schema, or migrations.

---

## Testing Rules

- Backend tests use a separate test database defined in `.env.test` — never run tests against the development database
- Run `npm run db:test:reset` before a full test suite run to ensure a clean state
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
- Backend container runs as a non-root user

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
| Environment vars | SCREAMING_SNAKE_CASE | `VENICE_API_KEY` |
| Test files | mirror source path + `.test.ts` | `tests/routes/stories.test.ts` |

---

## Git Rules

- Create a new branch for each task group (e.g. `feature/auth`, `feature/stories-crud`)
- Commit after each passing verify command — small, frequent commits
- Commit message format: `[TASK_ID] brief description` e.g. `[AU1] add user registration with bcrypt`
- Never commit directly to `main`
- Never commit `.env` or any file containing real credentials

---

## Security Review

The `security-reviewer` subagent (`.claude/agents/security-reviewer.md`) is a read-only reviewer tuned to this project's auth / session / key / encryption surface. **Invoke it automatically** before marking any of these task groups `[x]`:

- **AU1–AU4** — password hashing, login, JWT issuance, refresh rotation.
- **AU5–AU7** — auth middleware, ownership middleware, helmet / CORS / rate-limit.
- **AU8** — original Venice-key-in-env isolation (now superseded by AU13).
- **AU9–AU10** — username register + login with timing equalisation.
- **AU11** — AES-256-GCM crypto helper (reused by BYOK and encryption-at-rest).
- **AU12** — BYOK Venice-key endpoints (store, validate, delete). Review *after* the frontend build exists.
- **AU13** — no-leak proof for the BYOK path (supersedes AU8).
- **AU14** — argon2id migration path (if taken).
- **AU15 / AU16 / AU17** — change-password, reset-password (recovery-code flow), rotate-recovery-code endpoints. Each touches the DEK-wrap columns and the password hash; review for plaintext/recovery-code leakage, rate-limiting, timing equalisation, and correct transaction boundaries.
- **E3** — per-user DEK generation, password + recovery-code argon2id wraps, request-scoped unwrap cache, session-lifetime DEK availability mechanism (see open design question in [AU10] / Encryption-at-Rest section).
- **E9** — repo-layer boundary (confirm no Prisma bypasses for narrative entities).
- **E12** — encryption leak test integrity.
- **E14** — DEK-wrap rotation script (recovery-code rotation, admin-force-rotation).
- **V17** — per-user Venice client construction; must not cache across users.
- **V18** — Venice-key verify endpoint.
- **I7** — env swap (`VENICE_API_KEY` removed, `APP_ENCRYPTION_KEY` added — no `CONTENT_ENCRYPTION_KEY`).
- Any change to: `backend/src/services/auth.service.ts`, `backend/src/services/crypto.service.ts`, `backend/src/services/content-crypto.service.ts`, `backend/src/services/ai.service.ts`, `backend/src/middleware/`, `backend/src/repos/`, `backend/src/routes/auth.routes.ts`, `backend/src/routes/venice-key.routes.ts`, or the `cookie` / `cors` / `helmet` / `rate-limit` / encryption-key bootstrap in `backend/src/index.ts`.

Invoke via the Agent tool with `subagent_type: security-reviewer` and a concrete scope in the prompt (e.g. "review AU9–AU10 as currently implemented" or "review the repo-layer boundary for E9"). Treat `BLOCK` and `FIX_BEFORE_MERGE` findings as hard gates before ticking the box — if the hook (see `.claude/hooks/pre-tasks-edit.sh`) says the verify passed but the reviewer says `BLOCK`, do not tick.

**Example invocation:**
```
Agent(
  description: "Review BYOK endpoints",
  subagent_type: "security-reviewer",
  prompt: "Review [AU12] as currently implemented. Scope: backend/src/routes/venice-key.routes.ts + backend/src/services/crypto.service.ts + content-crypto.service.ts. Confirm: (1) decrypted keys never logged or returned; (2) PUT validates against Venice before storing; (3) response bodies on GET expose only { hasKey, lastFour, endpoint }."
)
```

---

## Repo-Boundary Review

The `repo-boundary-reviewer` subagent (`.claude/agents/repo-boundary-reviewer.md`) is a read-only reviewer tuned to the narrative-entity boundary and the encrypt-on-write / decrypt-on-read symmetry enforced by the repo layer. It owns a narrower surface than `security-reviewer` — specifically the repo-layer invariant from the "Database" rules and the ciphertext-egress / DEK-cache invariants from "Encryption at Rest". **Invoke it automatically** before marking any of these task groups `[x]`:

- **E4–E8** — per-entity encryption schema + dual-write. Confirm new ciphertext columns are wired through both write and read paths in the matching repo.
- **E9** — repo-layer boundary. The one that defines the invariant; review for any controller/service/route that still talks to Prisma for a narrative model.
- **E11** — plaintext-column drop. Confirm every repo read has already migrated to ciphertext-only before the migration runs. ([E10] backfill was cancelled — no legacy plaintext rows existed pre-deployment.)
- **E12** — leak test. Confirm the sentinel covers every narrative table and the test is not skipped.
- Any change to: `backend/src/repos/**`, `backend/src/services/content-crypto.service.ts`, `backend/src/services/prompt.service.ts` (reads chapter bodies), `backend/src/routes/{stories,chapters,characters,outline,chat}.routes.ts`, or any migration touching narrative columns.
- Any new one-off script under `backend/prisma/scripts/**` or `scripts/**` that touches narrative tables.

Invoke via the Agent tool with `subagent_type: repo-boundary-reviewer` and a concrete scope (e.g. "review the chapter repo changes on this branch" or "review the new `/api/stories/:id/export` route for raw Prisma access"). Treat `BLOCK` and `FIX_BEFORE_MERGE` findings as hard gates before ticking the box.

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
- You are about to rotate `APP_ENCRYPTION_KEY` in any non-dev environment (re-wraps all BYOK Venice keys)
- You are about to change the DEK-wrap scheme for existing users (adding a third wrap, changing argon2id parameters, etc.) — that's a migration, not a rotation, and requires every user to re-authenticate with their password
- You are about to merge an AU or E change that has NOT been cleared by `security-reviewer`
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
- Docker hot reload for the backend requires `ts-node-dev` or `nodemon` in the override compose file — the production Dockerfile does not include these
- BYOK Venice key: only `content-crypto.service` / `crypto.service` touch the plaintext key, and only within the lifetime of a single request. Never log it, never echo it, never serialize it to an error object
- `Chapter.content` plaintext mirror from `[D4]`/`[D10]` is intentionally **dropped** in `[E5]`/`[E11]` — TipTap JSON (decrypted on read via the chapter repo) is the sole source of truth for chapter bodies after that point; plaintext is derived on demand for export / AI prompts, never stored
- Selection bubble: use `onMouseDown: preventDefault()` on the bubble so clicking it doesn't collapse the user's selection
- Keyboard shortcuts contract (one listener, scoped callbacks): `⌘/Ctrl+Enter` = chat send, `⌥+Enter` = continue-writing, `Escape` = dismiss selection bubble / inline AI card / close modal
- The auth identifier is `username` (lowercased, 3–32 chars, `/^[a-z0-9_-]+$/`). `User.email` exists but is optional metadata — do not use it for login or uniqueness checks

