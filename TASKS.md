# Story Editor — Development Tasks

> A self-hosted, web-based story and text editor with Venice.ai AI integration. Users can manage multiple stories, break them into chapters, attach characters for consistency, and invoke AI assistance directly from the editor.

---

## Tech Stack

- **Frontend:** React + Vite + TypeScript + TailwindCSS + TipTap
- **Backend:** Node.js + Express + TypeScript + Prisma
- **Database:** PostgreSQL
- **Auth:** JWT (access token) + refresh token (httpOnly cookie)
- **AI:** Venice.ai API — OpenAI-compatible, proxied through backend
- **Venice SDK:** `openai` npm package pointed at Venice base URL (`https://api.venice.ai/api/v1`)
- **Containerisation:** Docker + Docker Compose
- **Testing:** Vitest + Supertest (backend), Vitest + React Testing Library (frontend), Playwright (E2E)

---

## ⚙️ S — Tech Stack & Project Setup

- [x] **[S1]** Scaffold monorepo with `/frontend`, `/backend`, `/db` folders and root-level `docker-compose.yml`, `.env.example`, `.gitignore`, and `README.md`
  - verify: `test -f docker-compose.yml && test -d frontend && test -d backend && test -d db`

- [x] **[S2]** Create `docker-compose.yml` with services: `frontend` (port 3000), `backend` (port 4000), `postgres` (port 5432). All services use named volumes. Postgres uses a health check. No reverse proxy service.
  - verify: `docker compose config --quiet && docker compose up -d && sleep 8 && docker compose ps | grep -E "(healthy|running)" | wc -l | grep -E "^[3-9]"`

- [x] **[S3]** Configure environment variable strategy — `.env.example` documents all required vars for backend (`DATABASE_URL`, `JWT_SECRET`, `REFRESH_TOKEN_SECRET`, `VENICE_API_KEY`, `FRONTEND_URL`, `PORT`) and frontend (`VITE_API_URL`). Add `.env` to `.gitignore`.
  - verify: `test -f .env.example && grep -q VENICE_API_KEY .env.example && grep -q JWT_SECRET .env.example && grep "\.env" .gitignore`

- [x] **[S4]** Set up Vite + React + TypeScript frontend with TailwindCSS, path aliases (`@/` -> `src/`), and a working dev server.
  - verify: `cd frontend && npm install && npm run build 2>&1 | grep -iv "error" && echo "BUILD OK"`

- [x] **[S5]** Set up Express + TypeScript backend with folder structure: `src/routes`, `src/controllers`, `src/services`, `src/middleware`, `src/lib`. Install: `openai`, `prisma`, `@prisma/client`, `zod`, `bcryptjs`, `jsonwebtoken`, `morgan`, `helmet`, `cors`, `express-rate-limit`.
  - verify: `cd backend && npm install && npm run build 2>&1 | grep -iv "error" && echo "BUILD OK"`

- [x] **[S6]** Add `Makefile` at project root with targets: `dev`, `stop`, `migrate`, `seed`, `reset-db`, `test`, `test-e2e`, `logs`
  - verify: `make --dry-run dev && make --dry-run migrate && make --dry-run test`

- [x] **[S7]** Install and configure Vitest + Supertest for backend. Create `backend/tests/setup.ts` connecting to test DB, running migrations, exporting teardown.
  - verify: `cd backend && npm run test:backend -- --run tests/setup.test.ts`

- [x] **[S8]** Create `.env.test` with a separate test `DATABASE_URL`. Add `npm run db:test:reset` script that drops, recreates, and migrates the test DB.
  - verify: `cd backend && npm run db:test:reset && echo "TEST DB OK"`

- [x] **[S9]** Install and configure Vitest + React Testing Library + jsdom for frontend. Add `frontend/tests/setup.ts` with jest-dom matchers.
  - verify: `cd frontend && npm run test:frontend -- --run tests/setup.test.tsx`

- [x] **[S10]** Install Playwright at root level. Configure against `http://localhost:3000`. Write a placeholder smoke test that visits the home page and asserts a heading is visible.
  - verify: `npx playwright install chromium && docker compose up -d && npx playwright test --reporter=line tests/smoke.spec.ts`

---

## 🏗️ A — Architecture

- [x] **[A1]** Write `docs/data-model.md` with a mermaid ER diagram: User -> Stories -> Chapters, User -> Stories -> Characters. All fields listed per entity.
  - verify: `test -f docs/data-model.md && grep -q "Character" docs/data-model.md && grep -q "Chapter" docs/data-model.md`

- [x] **[A2]** Write `docs/api-contract.md` documenting every REST endpoint: method, path, auth required, request body, response schema, error codes.
  - verify: `test -f docs/api-contract.md && grep -q "/api/stories" docs/api-contract.md && grep -q "/api/ai/complete" docs/api-contract.md`

- [x] **[A3]** Write `docs/venice-integration.md` covering: OpenAI-compatible client setup, venice_parameters used and why, prompt construction strategy, dynamic context window budgeting, streaming implementation, reasoning model handling, prompt caching strategy, rate limit and balance header usage.
  - verify: `test -f docs/venice-integration.md && grep -q "venice_parameters" docs/venice-integration.md && grep -q "context_length" docs/venice-integration.md`

- [x] **[A4]** Create `backend/src/lib/venice.ts` — single place that initialises the OpenAI client with Venice base URL and API key. Export the client instance. No other file imports `openai` directly.
  - verify: `cd backend && npm run test:backend -- --run tests/lib/venice.test.ts`

---

## 🗄️ D — Database

- [x] **[D1]** Write full Prisma schema in `backend/prisma/schema.prisma`: `User`, `Story`, `Chapter`, `Character`, `RefreshToken`. Correct relations, FK indexes, cascading deletes.
  - verify: `cd backend && npx prisma validate && echo "SCHEMA VALID"`

- [x] **[D2]** `User`: `id` (cuid), `email` (unique), `passwordHash`, `createdAt`, `updatedAt`
  - verify: `cd backend && npx prisma validate && npx prisma db push --force-reset --accept-data-loss 2>&1 | grep -iv error && npm run test:backend -- --run tests/models/user.test.ts`

- [x] **[D3]** `Story`: `id`, `title`, `synopsis`, `genre`, `worldNotes`, `createdAt`, `updatedAt`, `userId` FK. Cascade delete chapters and characters.
  - verify: `cd backend && npm run test:backend -- --run tests/models/story.test.ts`

- [x] **[D4]** `Chapter`: `id`, `title`, `content`, `orderIndex`, `wordCount`, `createdAt`, `updatedAt`, `storyId` FK.
  - verify: `cd backend && npm run test:backend -- --run tests/models/chapter.test.ts`

- [x] **[D5]** `Character`: `id`, `name`, `role`, `physicalDescription`, `personality`, `backstory`, `notes`, `createdAt`, `updatedAt`, `storyId` FK.
  - verify: `cd backend && npm run test:backend -- --run tests/models/character.test.ts`

- [x] **[D6]** `RefreshToken`: `id`, `token` (unique), `userId` FK, `expiresAt`, `createdAt`. Cascade delete when user deleted.
  - verify: `cd backend && npm run test:backend -- --run tests/models/refresh-token.test.ts`

- [x] **[D7]** Run and commit initial migration: `npx prisma migrate dev --name init`.
  - verify: `test -d backend/prisma/migrations && ls backend/prisma/migrations | grep init`

- [x] **[D8]** Write seed script: demo user (`demo@example.com` / `password`), one story, two chapters, two characters.
  - verify: `cd backend && npx ts-node prisma/seed.ts && echo "SEED OK"`

### D — Mockup-driven schema extensions

> Additive to D1–D8 (completed). No column renames or drops — new fields only. Source: `mockups/frontend-prototype/README.md` §Data Model + §Screens.

- [x] **[D9]** Extend `Story` schema with `targetWords Int?` (story progress target, e.g. 90000 — displayed in sidebar footer) and `systemPrompt String?` (per-story creative-writing system prompt; null → prompt builder falls back to default).
  - verify: `cd backend && npx prisma validate && npm run test:backend -- --run tests/models/story-settings.test.ts`

- [x] **[D10]** Extend `Chapter` schema with `bodyJson Json?` (TipTap JSON — canonical going forward) and `status String @default("draft")` (`draft` / `revised` / `final` — drives chapter status chip). Keep existing `content String` as a plain-text mirror derived from `bodyJson` on save so text search and text export keep working.
  - verify: `cd backend && npx prisma validate && npm run test:backend -- --run tests/models/chapter-body-json.test.ts`

- [x] **[D11]** Extend `Character` with mockup-card fields: `age String?`, `appearance String?`, `voice String?`, `arc String?`, `initial String?` (1-char sidebar avatar letter), `color String?` (avatar background hex). Existing `physicalDescription`/`personality`/`backstory`/`notes` are retained; UI may migrate values into the new fields over time.
  - verify: `cd backend && npx prisma validate && npm run test:backend -- --run tests/models/character-mockup.test.ts`

- [x] **[D12]** New model `OutlineItem`: `id`, `storyId` FK (cascade), `order Int`, `title String`, `sub String?`, `status String` (`done` / `current` / `pending`), timestamps. Index on `(storyId, order)`.
  - verify: `cd backend && npm run test:backend -- --run tests/models/outline-item.test.ts`

- [x] **[D13]** New models `Chat` + `Message`. `Chat`: `id`, `chapterId` FK (cascade), `title String?`, timestamps. `Message`: `id`, `chatId` FK (cascade), `role` (`user` / `assistant` / `system`), `contentJson Json`, `attachmentJson Json?` (Ask-AI selection payload: `{ selectionText, chapterId }`), `model String?`, `tokens Int?`, `latencyMs Int?`, `createdAt`. Index on `(chatId, createdAt)`.
  - verify: `cd backend && npm run test:backend -- --run tests/models/chat.test.ts tests/models/message.test.ts`

- [x] **[D14]** Extend `User` with `name String?` (display name shown in top-bar user menu) and `settingsJson Json?` (stores non-sensitive client preferences — theme, prose font, prose size, line height, writing toggles, daily goal, chat model + params).
  - verify: `cd backend && npx prisma validate && npm run test:backend -- --run tests/models/user-profile.test.ts`

- [x] **[D15]** Username-based identity (supersedes email as the primary credential — [D2] completed task remains unchanged; this task adds a new field and relaxes `email`): add `User.username String @unique` (stored lowercase, 3–32 chars, `/^[a-z0-9_-]+$/`). Make `User.email String?` nullable — email becomes optional metadata, not the login identifier. Migration backfills `username` from the local-part of each existing user's email, appending a numeric suffix on collision.
  - verify: `cd backend && npx prisma validate && npm run test:backend -- --run tests/models/user-username.test.ts`

- [x] **[D16]** BYOK Venice-key storage on `User`: add `veniceApiKeyEnc String?` (AES-256-GCM ciphertext, base64), `veniceApiKeyIv String?` (12-byte IV, base64), `veniceApiKeyAuthTag String?` (GCM auth tag, base64), `veniceEndpoint String?` (optional endpoint override, default `https://api.venice.ai/api/v1`). All nullable — users without a stored key cannot invoke AI.
  - verify: `cd backend && npx prisma validate && npm run test:backend -- --run tests/models/user-venice-key.test.ts`

---

## 🔐 AU — Auth & Security

- [x] **[AU1]** `auth.service.ts`: `register()` hashes with bcryptjs (12 rounds), creates user, returns record without `passwordHash`.
  - verify: `cd backend && npm run test:backend -- --run tests/auth/auth.service.test.ts`

- [x] **[AU2]** `auth.service.ts`: `login()` validates credentials, returns JWT access token (15min) and refresh token (7 days, stored in `RefreshToken` table).
  - verify: `cd backend && npm run test:backend -- --run tests/auth/login.test.ts`

- [x] **[AU3]** Auth routes: `POST /api/auth/register`, `POST /api/auth/login` (sets httpOnly cookie), `POST /api/auth/logout` (clears cookie + deletes DB record), `GET /api/auth/me`.
  - verify: `cd backend && npm run test:backend -- --run tests/auth/auth.routes.test.ts`
  - security notes (from AU1 security review):
    - Map `EmailAlreadyRegisteredError` to a generic 409 `{ error: 'Email unavailable' }` (or a 200 "check your inbox" response if email verification is added) — do NOT echo `err.message` to the client; it leaks the user list.
    - Equalize register-endpoint response time across the duplicate-vs-new branch: run a dummy `bcrypt.hash` on the duplicate-email path so both branches pay the ~200ms cost. Prevents timing-based user enumeration.
    - Same pattern for `POST /api/auth/login`: identical error body ("Invalid credentials") and comparable timing for "user not found" vs "password wrong" — never branch the response shape.

- [x] **[AU4]** `POST /api/auth/refresh` — reads httpOnly cookie, validates against DB, issues new access token, rotates refresh token in a single transaction.
  - verify: `cd backend && npm run test:backend -- --run tests/auth/refresh.test.ts`

- [x] **[AU5]** Auth middleware: validates JWT from `Authorization: Bearer` header, attaches `req.user`. Returns 401 if missing or invalid.
  - verify: `cd backend && npm run test:backend -- --run tests/middleware/auth.middleware.test.ts`

- [x] **[AU6]** Ownership middleware: verifies story/chapter/character belongs to `req.user.id`. Returns 403 if not.
  - verify: `cd backend && npm run test:backend -- --run tests/middleware/ownership.middleware.test.ts`

- [x] **[AU7]** Helmet.js, CORS (origin from `FRONTEND_URL`), rate limit on `/api/ai/*` (20 req/min per IP).
  - verify: `cd backend && npm run test:backend -- --run tests/middleware/security.test.ts`

- [x] **[AU8]** Venice API key only in backend `.env`. Test confirms no `VENICE` string in frontend build output.
  - verify: `cd frontend && npm run build && ! grep -r "VENICE" dist/ && echo "API KEY NOT LEAKED"`

### AU — Username auth + BYOK Venice key

> [AU1] is completed with email+bcrypt. Per CLAUDE.md these supersede the *behaviour* of [AU1]–[AU3] and [AU8] without editing those entries. Trigger the security-reviewer subagent after [AU13] is implemented (auth-surface change + new crypto).

- [x] **[AU9]** `auth.service.ts` signup supersede: `register({ name, username, password })`. Normalize username (trim + lowercase) before uniqueness check + storage. Validate: `name` 1–80 chars (optional in DB, required in signup), `username` matches `/^[a-z0-9_-]{3,32}$/`, `password` ≥ 8 chars in production (≥ 4 dev-only, gated on `NODE_ENV`). Duplicate-username path runs a dummy `bcrypt.hash` to equalize timing with the happy path. **Once [E3] lands:** signup also calls `content-crypto.service.generateDekAndWraps(password)` and persists the eight DEK-wrap columns + salts in the same transaction as the `User` row. Response: user without `passwordHash`, surfacing `{ id, name, username, createdAt, recoveryCode }` — the `recoveryCode` field is returned **exactly once** at registration and must be surfaced clearly in the UI ([F-series] signup flow) with a "save this now, it will not be shown again" warning.
  - verify: `cd backend && npm run test:backend -- --run tests/auth/register-username.test.ts`

- [x] **[AU10]** `POST /api/auth/login` supersede: accepts `{ username, password }` (lowercased server-side before lookup). Identical 401 body (`{ error: "Invalid credentials" }`) for "user not found" and "password mismatch". Identical wall-clock timing (run a dummy bcrypt compare against a fixed junk hash when the user doesn't exist). Sets refresh token as httpOnly cookie, returns access token in body.
  - verify: `cd backend && npm run test:backend -- --run tests/auth/login-username.test.ts`

> **⚠ Open design question for [E3]:** under Option D the DEK is unwrapped from the password at login, but the password is not available on subsequent requests (only the JWT is). The DEK therefore must survive across requests somewhere. Candidates, to decide in [E1]: **(a)** re-prompt the user for their password on every request (rejected — DX disaster); **(b)** process-memory session cache keyed by JWT `jti`, evicted on logout / token rotation / process restart (pragmatic for single-host self-hosted deployments; violates the current "request-scoped `WeakMap` only" rule and must be documented); **(c)** unwrap-once, re-wrap with a random session key returned to the client in the access token (the access token becomes the wrapper key; server stores only the session-wrapped DEK); **(d)** unwrap-once, store session-wrapped DEK in a `Session` table keyed by `jti`, session key derived from a cookie-side secret. The choice affects `content-crypto.service.ts`, `auth.service.ts`, `auth.middleware.ts`, the `Session` / `RefreshToken` schema, and the leak-test assertions in [E12]. **Do not start [E3] until this is resolved and documented in `docs/encryption.md`.**

- [x] **[AU11]** `backend/src/services/crypto.service.ts` — AES-256-GCM helper. Reads `APP_ENCRYPTION_KEY` from env (32 bytes, base64). Exposes `encrypt(plaintext): { ciphertext, iv, authTag }` (all base64) and `decrypt({ ciphertext, iv, authTag }): plaintext`. Constant-time comparison helpers. Unit tests cover roundtrip, malformed inputs (throws), tampered auth tag (throws).
  - verify: `cd backend && npm run test:backend -- --run tests/services/crypto.service.test.ts`

- [x] **[AU12]** BYOK user-key endpoints (all require auth + ownership-of-self):
  - `GET /api/users/me/venice-key` → `{ hasKey: boolean, lastFour: string | null, endpoint: string | null }`. **Never returns the key.**
  - `PUT /api/users/me/venice-key` → body `{ apiKey, endpoint? }`. Validates by calling Venice `GET /v1/models` with the key before storing. On success: encrypts via [AU11], writes `veniceApiKeyEnc/Iv/AuthTag/Endpoint`, returns `{ status: "saved", lastFour }`. On 401 from Venice: returns 400 `{ error: "venice_key_invalid" }` without storing.
  - `DELETE /api/users/me/venice-key` → nulls all four BYOK columns. Returns `{ status: "removed" }`.
  - verify: `cd backend && npm run test:backend -- --run tests/routes/venice-key.test.ts`

- [x] **[AU13]** Supersedes [AU8] with BYOK semantics: no env-level `VENICE_API_KEY` exists anywhere (remove from `.env.example` in [I7]). The user-entered key must never appear in application logs, error responses, stack traces, or the frontend build output. Tests: (a) install a log spy, trigger the full BYOK flow, assert the raw key never appears in any log line; (b) frontend build contains no `VENICE` substring; (c) `GET /api/users/me/venice-key` roundtrip never exposes the ciphertext fields.
  - verify: `cd backend && npm run test:backend -- --run tests/security/byok-leak.test.ts && cd ../frontend && npm run build && ! grep -r "VENICE" dist/ && echo "BYOK LEAK-PROOF"`

- [x] **[AU14]** (Optional, security upgrade) Swap `bcryptjs(12)` for `argon2id` (OWASP 2024 top pick). On next login, if stored hash is bcrypt, re-hash password with argon2id and update. Requires `APP_ENCRYPTION_KEY`-independent `ARGON2_PEPPER` (optional). **Hard prerequisite for [E3]** — the argon2id parameter config is shared between password hashing and DEK-wrap key derivation.
  - verify: `cd backend && npm run test:backend -- --run tests/auth/argon2-migration.test.ts`

- [x] **[AU15]** `POST /api/auth/change-password` — authenticated endpoint that accepts `{ oldPassword, newPassword }`. Flow: (1) verify `oldPassword` against the stored hash via `auth.service.ts`; (2) call `content-crypto.service.unwrapDekWithPassword(userId, oldPassword)` → DEK; (3) re-hash the new password; (4) call `rewrapPasswordWrap(userId, dek, newPassword)`; (5) write the new password hash and the new `contentDekPasswordEnc/Iv/AuthTag/Salt` in a single transaction; (6) delete all existing refresh tokens for the user (forcing re-login elsewhere); (7) return 204. Never log either password. Rate-limited per-user (not per-IP). Narrative ciphertext is **not** touched — tests assert no `*Ciphertext` column changes. **Invoke `security-reviewer` after implementation.**
  - verify: `cd backend && npm run test:backend -- --run tests/auth/change-password.test.ts`

- [x] **[AU16]** `POST /api/auth/reset-password` — unauthenticated endpoint that accepts `{ username, recoveryCode, newPassword }`. Flow: (1) look up user by lowercased username; (2) call `content-crypto.service.unwrapDekWithRecoveryCode(userId, recoveryCode)` → DEK (throws on wrong code); (3) re-hash the new password; (4) call `rewrapPasswordWrap(userId, dek, newPassword)`; (5) write the new password hash and the new password wrap in a single transaction; (6) delete all existing refresh tokens for the user; (7) return 204. Identical 401 body and identical wall-clock timing for "user not found" vs. "wrong recovery code" (same approach as [AU10]: run a dummy argon2id against a fixed junk salt when the user doesn't exist). Rate-limited aggressively (per-IP + per-username). Recovery code never logged. Narrative ciphertext not touched. Note: the user's existing recovery wrap is **not** rotated here — if the user wants a new recovery code, they must call [AU17] after logging in. **Invoke `security-reviewer` after implementation.**
  - verify: `cd backend && npm run test:backend -- --run tests/auth/reset-password.test.ts`

- [x] **[AU17]** `POST /api/auth/rotate-recovery-code` — authenticated endpoint that accepts `{ password }`. Flow: (1) verify password; (2) unwrap DEK with password; (3) generate a new recovery code; (4) call `rewrapRecoveryWrap(userId, dek)` which writes the new `contentDekRecoveryEnc/Iv/AuthTag/Salt`; (5) return `{ recoveryCode: "<new code>" }` **exactly once** — warn in the response envelope that it will not be shown again. Old recovery code becomes unusable the instant the transaction commits. Rate-limited per-user. **Invoke `security-reviewer` after implementation.**
  - verify: `cd backend && npm run test:backend -- --run tests/auth/rotate-recovery-code.test.ts`

---

## 🔒 E — Encryption at Rest (Story Content)

> Envelope encryption: per-user DEK (32-byte random) wrapped **twice** — once by an argon2id-derived key from the user's password, once by an argon2id-derived key from a printable one-time recovery code shown at signup. No server-held KEK wraps content. All narrative content (titles, bodies, notes, character bios, outline items, chat messages) is encrypted client-of-Postgres with AES-256-GCM. Structural metadata (orderIndex, wordCount, status, FK ids, timestamps) stays plaintext so queries, ordering, and progress calcs keep working. Reuses the AES-256-GCM primitive from [AU11] and the argon2id parameters chosen for password hashing ([AU14]). **Invoke `security-reviewer` after [E3] (key model), [E9] (repo layer), and [E12] (leak test) are implemented.**
>
> **Three operations, clearly separated:**
> - **Password change** (user knows old password): unwrap DEK with old-password-derived key, rewrap with new-password-derived key. Recovery-code wrap untouched. Narrative ciphertext is **not** rewritten — only the ~60-byte password wrap on `User` changes. See [AU15].
> - **Password reset** (user forgot old password): unwrap DEK with recovery-code-derived key, rewrap password wrap with new-password-derived key. Narrative ciphertext is not rewritten. Requires the recovery code — losing both password and recovery code = irrecoverable data loss for that user's content. See [AU16].
> - **Offline / background decrypt** (admin tooling, scheduled jobs, server-initiated features): **not supported.** The server only holds the DEK while the user is mid-request (in a request-scoped `WeakMap`). If a future feature needs this, it requires a schema migration to add a server-held wrap — not a rotation.
>
> **Threat model:** DB dump alone reveals structural metadata only (`orderIndex`, `wordCount`, `status`, `genre`, `targetWords`, FK ids, timestamps). DB + env leak reveals the same — no `CONTENT_ENCRYPTION_KEY` exists under this scheme. Narrative content is disclosed only if an attacker additionally compromises a user's password (via phishing, keylogger, credential reuse, etc.) or recovery code. **Revisit** in `docs/encryption.md` if offline decrypt becomes a requirement.

- [x] **[E1]** Write `docs/encryption.md`: DEK / wrap model, exact field list (what's encrypted vs plaintext), threat model (DB dump alone vs DB + env leak vs password/recovery-code compromise), trade-offs accepted (no DB-side FTS / title sort; no offline/background decrypt). **Must include:**
  - **"DEK provenance" section** — the DEK is random per user; its **wraps** are password-derived and recovery-code-derived (argon2id). No server-held KEK wraps content.
  - **"argon2id parameters" section** — document `m`, `t`, `p`, salt length, output length, and where those parameters are sourced from ([AU14]). Note that the same parameters are reused for password hashing and DEK-wrap key derivation.
  - **"Recovery code" section** — 128-bit entropy minimum, printable format (suggest BIP-39-style word list or base32 with checksum), shown exactly once at signup, never stored plaintext server-side, user-guided to store out-of-band. Document the rotate-recovery-code flow ([AU17]).
  - **"Three operations"** — password change ([AU15]), password reset ([AU16]), rotate recovery code ([AU17]). For each, state which columns on `User` change and confirm narrative ciphertext is untouched.
  - **"Threat model" section** — tabulate what each of {DB dump, DB + app host, password compromise, recovery-code compromise, password + recovery-code compromise} reveals.
  - **"Revisit" section** — explicitly name the offline-decrypt trade-off and describe the migration path if the requirement appears (add a third wrap; no way to avoid re-wrapping every user's DEK during that migration).
  - This is the design-of-record; subsequent E-tasks reference it.
  - verify: `test -f docs/encryption.md && grep -q "argon2id" docs/encryption.md && grep -q "recovery code" docs/encryption.md && grep -q "DEK" docs/encryption.md && grep -q "threat model" docs/encryption.md && grep -q "password-derived" docs/encryption.md && grep -q "Revisit" docs/encryption.md`

- [x] **[E2]** Env + boot validation: content DEKs are **not** wrapped by a server-held KEK under this scheme, so there is no `CONTENT_ENCRYPTION_KEY` env var. `APP_ENCRYPTION_KEY` remains (wraps BYOK Venice keys only — see [AU11] / [AU13]) and must still be validated at boot. Backend startup asserts `APP_ENCRYPTION_KEY` is set and correctly sized; fails fast with a clear, actionable message otherwise. Include a generation one-liner (`node -e "console.log(crypto.randomBytes(32).toString('base64'))"`) in `.env.example` comments. A boot test confirms there is **no** `CONTENT_ENCRYPTION_KEY` requirement (guards against the env accidentally being reintroduced).
  - verify: `! grep -q "CONTENT_ENCRYPTION_KEY" .env.example && grep -q "APP_ENCRYPTION_KEY" .env.example && cd backend && npm run test:backend -- --run tests/boot/encryption-keys.test.ts`

- [x] **[E3]** Per-user DEK + content-crypto service:
  - Schema (on `User`, all non-null after backfill):
    - `contentDekPasswordEnc String`, `contentDekPasswordIv String`, `contentDekPasswordAuthTag String`, `contentDekPasswordSalt String` — AES-256-GCM ciphertext of the DEK wrapped by `argon2id(password, contentDekPasswordSalt, params)`.
    - `contentDekRecoveryEnc String`, `contentDekRecoveryIv String`, `contentDekRecoveryAuthTag String`, `contentDekRecoverySalt String` — ciphertext of the same DEK wrapped by `argon2id(recoveryCode, contentDekRecoverySalt, params)`. Two independent salts (not shared) so compromise of one does not accelerate attack on the other.
    - No `contentDekEnc` / server-KEK wrap column. (Pre-existing users from before [E3] do not exist yet; if the app is already deployed, the migration generates a fresh DEK on first login after deploy, when the password is available. Document this in [E10].)
  - `backend/src/services/content-crypto.service.ts`:
    - `generateDekAndWraps(password)` — returns `{ dek: Buffer, recoveryCode: string, passwordWrap, recoveryWrap }`. Called at signup ([AU9]).
    - `unwrapDekWithPassword(userId, password)` — returns the DEK Buffer. Called at login ([AU3]) and password change ([AU15]).
    - `unwrapDekWithRecoveryCode(userId, recoveryCode)` — returns the DEK Buffer. Called at password reset ([AU16]).
    - `rewrapPasswordWrap(userId, dek, newPassword)` — writes new `contentDekPasswordEnc/Iv/AuthTag/Salt` for that user in a transaction. Called by [AU15] and [AU16].
    - `rewrapRecoveryWrap(userId, dek)` — returns the new `recoveryCode` (shown once), writes new `contentDekRecoveryEnc/Iv/AuthTag/Salt`. Called by [AU17].
    - `encryptForUser(userId, plaintext)` → `{ ciphertext, iv, authTag }` and `decryptForUser(userId, { ciphertext, iv, authTag })` → `plaintext`. Both require the unwrapped DEK to already be in the request-scoped `WeakMap` (populated by the auth middleware at login); throw `DekNotAvailableError` otherwise — never re-derive lazily.
    - Unwrapped DEKs live **only** in a request-scoped `WeakMap` — never a module-level cache, never written to disk, never serialised.
    - argon2id parameters imported from a single config module shared with [AU14]'s password-hash parameters.
  - verify: `cd backend && npm run test:backend -- --run tests/services/content-crypto.service.test.ts`

- [x] **[E4]** Encrypt `Story` narrative fields. Schema: add `titleCiphertext/Iv/AuthTag`, `synopsisCiphertext/Iv/AuthTag`, `worldNotesCiphertext/Iv/AuthTag`, `systemPromptCiphertext/Iv/AuthTag`. Keep plaintext `title`, `synopsis`, `worldNotes`, `systemPrompt` temporarily for dual-write during rollout (dropped in [E11]). `genre`, `targetWords`, timestamps, `userId` remain plaintext.
  - verify: `cd backend && npx prisma validate && npm run test:backend -- --run tests/models/story-encrypted.test.ts`

- [x] **[E5]** Encrypt `Chapter` narrative fields + **drop the plaintext `content` mirror** from [D4]/[D10]. Schema: add `titleCiphertext/Iv/AuthTag` and `bodyCiphertext/Iv/AuthTag` (ciphertext of the serialised TipTap JSON tree). Keep `bodyJson` and `content` plaintext during dual-write; both dropped in [E11]. `wordCount` stays plaintext (derived from the tree at save time, before encryption). `orderIndex`, `status`, `storyId`, timestamps remain plaintext. **Search/export features that rely on `content` must be reworked to decrypt on demand** ([B10] updated accordingly).
  - verify: `cd backend && npx prisma validate && npm run test:backend -- --run tests/models/chapter-encrypted.test.ts`

- [x] **[E6]** Encrypt `Character` narrative fields. Schema: add `_Ciphertext/_Iv/_AuthTag` triples for `name`, `role`, `appearance`, `voice`, `arc`, `age`, `personality`, `backstory`, `notes`, `physicalDescription`. `color`, `initial`, `storyId`, timestamps remain plaintext (UI-only hints + structural fields).
  - verify: `cd backend && npx prisma validate && npm run test:backend -- --run tests/models/character-encrypted.test.ts`

- [x] **[E7]** Encrypt `OutlineItem` narrative fields. Schema: add `titleCiphertext/Iv/AuthTag` and `subCiphertext/Iv/AuthTag`. `order`, `status`, `storyId`, timestamps remain plaintext.
  - verify: `cd backend && npx prisma validate && npm run test:backend -- --run tests/models/outline-encrypted.test.ts`

- [x] **[E8]** Encrypt `Chat` + `Message`. `Chat.title` → ciphertext triple. `Message.contentJson` + `Message.attachmentJson` → ciphertext triples (serialised JSON encrypted as a single blob per column). `role`, `model`, `tokens`, `latencyMs`, timestamps remain plaintext — needed for the chat header meta row + regeneration flows.
  - verify: `cd backend && npx prisma validate && npm run test:backend -- --run tests/models/chat-message-encrypted.test.ts`

- [x] **[E9]** Repository layer — transparent encrypt-on-write / decrypt-on-read. `src/repos/story.repo.ts`, `chapter.repo.ts`, `character.repo.ts`, `outline.repo.ts`, `chat.repo.ts`, `message.repo.ts` wrap Prisma. Controllers and services call repos, never Prisma directly for these entities. Repos resolve `userId` from the request context and use [E3]'s service. No controller touches ciphertext. Prompt builder ([V3]) reads via these repos.
  - verify: `cd backend && npm run test:backend -- --run tests/repos/`

- [ ] **[E10]** Backfill migration: encrypt all existing plaintext rows for every user via the repo layer. Script: `backend/prisma/scripts/encrypt-backfill.ts`. Idempotent (safe to re-run; skips rows whose ciphertext columns are non-null). Runs inside a transaction per user. Logs counts, no content.
  - verify: `cd backend && npx ts-node prisma/scripts/encrypt-backfill.ts && npm run test:backend -- --run tests/migrations/encrypt-backfill.test.ts`

- [x] **[E11]** Drop plaintext columns (post-rollout): after [E10] has run, migration removes `Story.title|synopsis|worldNotes|systemPrompt`, `Chapter.title|bodyJson|content`, `Character.*(narrative)`, `OutlineItem.title|sub`, `Chat.title`, `Message.contentJson|attachmentJson`. One migration file named `drop-plaintext-narrative`. Tests run after migration and confirm all repo reads still work end-to-end.
  - verify: `cd backend && ls prisma/migrations | grep drop-plaintext-narrative && npm run test:backend -- --run tests/repos/`

- [x] **[E12]** Encryption leak test: a test that inserts a story with a known sentinel string (`"SENTINEL_E12_DO_NOT_LEAK"`), then opens a raw `pg` connection (bypassing Prisma + repos) and reads every row of `stories`, `chapters`, `characters`, `outline_items`, `chats`, `messages`. Assertion: the sentinel appears in zero rows. Ensures no plaintext narrative content landed in the DB.
  - verify: `cd backend && npm run test:backend -- --run tests/security/encryption-leak.test.ts`

- [x] **[E13]** Update [D8]'s seed to write via the repo layer. New script `backend/prisma/seed.ts` (replaces D8's behavior, doesn't edit the [D8] task entry): creates demo user via [AU9], generates DEK via [E3], then seeds via repos so demo data lands encrypted.
  - verify: `cd backend && npx ts-node prisma/seed.ts && npm run test:backend -- --run tests/security/encryption-leak.test.ts -- --grep seed`

- [x] **[E14]** DEK-wrap rotation: there is no `CONTENT_ENCRYPTION_KEY` to rotate. Per-user rotation of the recovery-code wrap is the useful primitive. Covered by [AU17]'s `POST /api/auth/rotate-recovery-code` endpoint plus a matching admin-triggerable script `backend/prisma/scripts/force-recovery-rotation.ts` that invalidates the current recovery wrap for a named user (e.g. user reports the code leaked and is locked out of the UI). **Does not touch narrative ciphertext** — only the ~60-byte recovery wrap on `User` changes. Logs only counts + usernames acted on. Documented in [E1]'s `docs/encryption.md`.
  - verify: `cd backend && npm run test:backend -- --run tests/services/dek-wrap-rotation.test.ts`

- [x] **[E15]** SELF_HOSTING.md key-backup and user-recovery section (amends [I6]): documents that **`APP_ENCRYPTION_KEY`** must be backed up with the same rigour as Postgres (loss = all stored BYOK Venice keys become unrecoverable, but content remains decryptable on next login). Content DEKs are **not** recoverable from server state alone — they are unwrappable only with the user's password or recovery code. Per-user guidance: users must store their signup-time recovery code out-of-band (printed, password manager, offline). **Losing both password and recovery code = irrecoverable data loss for that user's narrative content.** Operator guidance: run a recovery drill on a staging instance quarterly — register a demo user, save the recovery code, "forget" the password, reset via recovery code, confirm content decrypts.
  - verify: `grep -q "APP_ENCRYPTION_KEY" SELF_HOSTING.md && grep -q "recovery code" SELF_HOSTING.md && grep -q "backup" SELF_HOSTING.md && grep -q "data loss" SELF_HOSTING.md`

---

## 🤖 V — Venice.ai Integration

> Venice is OpenAI API-compatible. Use the `openai` npm package with Venice's base URL. Venice-specific features are passed via the `venice_parameters` object.

- [x] **[V1]** `GET /api/ai/models` — calls Venice `GET /v1/models`, filters to text models only, returns each model's `id`, `name`, `context_length`, and capability flags (`supportsReasoning`, `supportsVision`). Cache result in memory for 10 minutes.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/models.test.ts`

- [x] **[V2]** `backend/src/services/venice.models.service.ts` — fetches and caches model list. Exposes `getModelContextLength(modelId): number`. Used by the prompt builder to set dynamic context budgets. No token counts are hardcoded anywhere in the codebase.
  - verify: `cd backend && npm run test:backend -- --run tests/services/venice.models.service.test.ts`

- [x] **[V3]** `backend/src/services/prompt.service.ts` — builds prompts given: `action`, `selectedText`, `chapterContent`, `characters[]`, `worldNotes`, `modelContextLength`. Budget: reserve 20% of `modelContextLength` for the response. Use the remainder for prompt content. If budget exceeded, truncate `chapterContent` from the top (oldest content first). Never truncate character context or worldNotes.
  - verify: `cd backend && npm run test:backend -- --run tests/services/prompt.service.test.ts`

- [x] **[V4]** Prompt builder sets `venice_parameters.include_venice_system_prompt` from a caller-supplied `includeVeniceSystemPrompt` boolean. When the flag is `true`, Venice's own creative-writing prompt is prepended; when `false`, only Inkwell's system message (default or per-story `Story.systemPrompt`) is in effect. Default when omitted is `true`. Unit test covers all three branches: explicit `true` → flag is `true`; explicit `false` → flag is `false`; omitted → flag is `true`. The flag value is never hardcoded inside the prompt builder.
  - verify: `cd backend && npm run test:backend -- --run tests/services/prompt.venice-params.test.ts`

- [x] **[V5]** `POST /api/ai/complete` — accepts `{ action, selectedText, chapterId, storyId, modelId }` (plus optional `freeformInstruction`). Loads the chapter body + story characters + `worldNotes` server-side via the repo layer (decrypted on read) — the client never sends plaintext chapter content. Reads `req.user.settingsJson.ai.includeVeniceSystemPrompt` (default `true` if the key is missing) and passes it to the prompt builder. Calls prompt builder with model context length from cache. Calls Venice with `stream: true`. Pipes SSE stream back to client. 404 when chapter or story isn't owned by the caller; 409 `venice_key_required` when no BYOK key is stored.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/complete.test.ts`

- [x] **[V6]** Reasoning model support: if selected model has `supportsReasoning: true`, set `venice_parameters.strip_thinking_response = true` in the Venice request. Test confirms this is applied to reasoning models and not others.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/reasoning.test.ts`

- [x] **[V7]** Web search: add optional `enableWebSearch` boolean to `POST /api/ai/complete`. When true, set `venice_parameters.enable_web_search = "auto"` and `venice_parameters.enable_web_citations = true`. Useful for users researching facts for their story world.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/web-search.test.ts`

- [x] **[V8]** Prompt caching: set `venice_parameters.prompt_cache_key` to a deterministic hash of `storyId + modelId` on all `/api/ai/complete` requests. This improves cache hit rates by routing requests with the same story context to the same Venice backend infrastructure. Document in `docs/venice-integration.md`.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/prompt-cache.test.ts`

- [x] **[V9]** Rate limit header forwarding: after each Venice call, read `x-ratelimit-remaining-requests` and `x-ratelimit-remaining-tokens` from Venice response headers. Attach as `x-venice-remaining-requests` and `x-venice-remaining-tokens` on the backend response so the frontend can display usage.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/rate-limit-headers.test.ts`

- [x] **[V10]** `GET /api/ai/balance` (auth required) — reads `x-venice-balance-usd` and `x-venice-balance-diem` from a lightweight Venice API call and returns them. Frontend shows this in the user menu.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/balance.test.ts`

- [x] **[V11]** Venice error handling: map error codes to user-friendly messages. Handle `401` (invalid API key — log server-side, show generic error to user), `429` (rate limited — include reset time in response), `503` (Venice unavailable). Never expose raw Venice errors or stack traces to the frontend.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/error-handling.test.ts`

- [x] **[V12]** AI action system prompts — write and test the system prompt and user prompt template for each action. Each instructs the model to act as a creative writing assistant and return only the content with no preamble:
  - **Continue** — continues from where the selection ends, matching the established style
  - **Rephrase** — rewrites the selected text with different phrasing, preserving meaning
  - **Expand** — adds more detail, description, and depth to the selected passage
  - **Summarise** — condenses the selected text to its essential points
  - **Freeform** — passes the user's custom instruction as the direct prompt
  - verify: `cd backend && npm run test:backend -- --run tests/services/prompt.actions.test.ts`

### V — Mockup-driven additions

- [x] **[V13]** Per-story system prompt in prompt builder: when `Story.systemPrompt` is non-null, use it as the primary system message; otherwise fall back to the default creative-writing system prompt. Unit tests cover both paths and confirm the Venice `include_venice_system_prompt` flag is driven entirely by the user setting — unaffected by whether `Story.systemPrompt` is set or null.
  - verify: `cd backend && npm run test:backend -- --run tests/services/prompt.system-prompt.test.ts`

- [x] **[V14]** Extend AI action set to cover mockup selection-bubble + chat actions: `rewrite`, `describe`, `expand` (inline result card), `continue` (cursor-context ~80-word continuation for ⌥↵), `ask` (routes selection into chat as attachment). Each has a dedicated prompt template. Complements [V12] — do not remove existing actions.
  - verify: `cd backend && npm run test:backend -- --run tests/services/prompt.mockup-actions.test.ts`

- [x] **[V15]** Chat persistence: `POST /api/chapters/:chapterId/chats` creates a chat; `GET /api/chapters/:chapterId/chats` lists; `POST /api/chats/:chatId/messages` appends a user message, streams an assistant reply via Venice (SSE passthrough), persists both messages with `tokens` + `latencyMs` captured from the Venice response.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/chat-persistence.test.ts`

- [x] **[V16]** Ask-AI attachment payload: `POST /api/chats/:chatId/messages` accepts optional `{ attachment: { selectionText, chapterId } }`. Stored as `attachmentJson` on the user message. Prompt builder prepends attachment text as additional user-role context when present.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/ask-ai-attachment.test.ts`

- [x] **[V17]** Per-user Venice client (supersedes the singleton in [A4]): `getVeniceClient(userId)` reads the user's encrypted key + endpoint, decrypts via [AU11], constructs a per-call `OpenAI` instance bound to that key + endpoint. Never cached across users. If the user has no stored key, throws `NoVeniceKeyError` (mapped to 409 `{ error: "venice_key_required" }` with a hint pointing at `/settings#venice`). Replaces all call sites across [V1]–[V12], [V15].
  - verify: `cd backend && npm run test:backend -- --run tests/lib/venice-per-user.test.ts`

- [x] **[V18]** `POST /api/users/me/venice-key/verify` — re-validates the stored key by calling Venice (`GET /v1/models` + balance headers). Returns `{ verified: boolean, credits: number | null, diem: number | null, endpoint: string | null, lastFour: string | null }`. Frontend's Settings → Venice "Verified · 2.2k credits" pill reads this. Rate-limited per user (6 req/min) to avoid Venice abuse.
  - verify: `cd backend && npm run test:backend -- --run tests/routes/venice-key-verify.test.ts`

---

## 🔌 L — Live Venice testing (opt-in, dev-only)

Optional live-API path for validating V-series work against a real Venice endpoint without exercising the frontend. **Never part of the default test suite.** A spending-capped API key is supplied out-of-band via `backend/.env.live`, which is gitignored. Live tests and the probe CLI are the only consumers — production code paths remain BYOK-only.

- [x] **[L1]** `backend/.env.live.example` (committed) documents `LIVE_VENICE_API_KEY`, `LIVE_VENICE_ENDPOINT`, `LIVE_VENICE_MODEL` with comments about spending caps and scope. `backend/.env.live` added to `.gitignore`. No production code path reads these variables — grep proves it.
  - verify: `bash -c 'grep -q "^backend/.env.live$" .gitignore && test -f backend/.env.live.example && ! grep -rn "LIVE_VENICE_" backend/src'`

- [x] **[L2]** Vitest config split: `backend/tests/live/**` excluded from the default run (`vitest.config.ts` `test.exclude`); a second config `vitest.live.config.ts` includes **only** that folder. `package.json` adds `"test:live": "vitest --run --config vitest.live.config.ts"`. Default `npm run test:backend` continues to exclude live tests.
  - verify: `cd backend && { npm run test:backend -- --run 2>&1 || true; } | grep -v 'tests/live/' | grep 'Test Files' > /dev/null && test -f vitest.live.config.ts`

- [x] **[L3]** `backend/scripts/venice-probe.ts` — `ts-node` CLI that loads `backend/.env.live`, exposes `--models`, `--prompt <text>`, `--stream`, `--model <id>`. Uses the same OpenAI-compatible client construction as [V17]. Prints response body (and SSE chunks when `--stream`). Exits 1 on Venice error, 2 on missing `.env.live`. `package.json` adds `"venice:probe": "ts-node scripts/venice-probe.ts"`.
  - verify: `cd backend && npm run venice:probe -- --help | grep -q 'venice-probe'`

- [x] **[L4]** Live integration tests in `backend/tests/live/venice.live.test.ts`: (1) `GET /v1/models` returns a non-empty text-model list; (2) non-streaming completion returns a non-empty string; (3) streaming completion yields ≥1 SSE delta then a `[DONE]`. Each uses `it.skipIf(!process.env.LIVE_VENICE_API_KEY)` so the file is safe with no key present. **Not** added to CI.
  - verify: `cd backend && test -f tests/live/venice.live.test.ts && npm run test:live -- --run 2>&1 | grep -qE '(skipped|passed)'`

---

## 🖥️ B — Backend (non-AI routes)

- [x] **[B1]** `GET /api/stories` and `POST /api/stories`. GET returns all user stories with chapter count and total word count. POST validates with Zod.
  - verify: `cd backend && npm run test:backend -- --run tests/routes/stories.test.ts`

- [x] **[B2]** `GET|PATCH|DELETE /api/stories/:id`. All require auth + ownership middleware.
  - verify: `cd backend && npm run test:backend -- --run tests/routes/story-detail.test.ts`

- [x] **[B3]** Chapters full CRUD under `/api/stories/:storyId/chapters`. POST auto-assigns `orderIndex`. `wordCount` computed and stored on create/update.
  - verify: `cd backend && npm run test:backend -- --run tests/routes/chapters.test.ts`

- [x] **[B4]** `PATCH /api/stories/:storyId/chapters/reorder` — accepts `{ chapters: [{ id, orderIndex }] }`, updates all in a single Prisma transaction.
  - verify: `cd backend && npm run test:backend -- --run tests/routes/chapters-reorder.test.ts`

- [x] **[B5]** Characters full CRUD under `/api/stories/:storyId/characters`. All fields validated with Zod.
  - verify: `cd backend && npm run test:backend -- --run tests/routes/characters.test.ts`

- [ ] **[B6]** `GET /api/health` returns `{ status: "ok", db: "connected" }`. Returns 503 if DB unreachable.
  - verify: `curl -sf http://localhost:4000/api/health | grep '"status":"ok"'`

- [x] **[B7]** Global error handler: consistent `{ error: { message, code } }` JSON. No stack traces in production.
  - verify: `cd backend && npm run test:backend -- --run tests/middleware/error-handler.test.ts`

### B — Mockup-driven additions

- [x] **[B8]** Outline CRUD under `/api/stories/:storyId/outline`: list, create, patch, delete, plus `PATCH …/outline/reorder` (single transaction). Auth + ownership middleware required.
  - verify: `cd backend && npm run test:backend -- --run tests/routes/outline.test.ts`

- [x] **[B9]** `GET /api/stories/:id/progress` — returns `{ wordCount, targetWords, percent, chapters: [{ id, wordCount }] }` for the sidebar progress footer (`42,318 / 90,000 words · 47%`).
  - verify: `cd backend && npm run test:backend -- --run tests/routes/story-progress.test.ts`

- [x] **[B10]** Chapter save pipeline: when PATCH payload includes `bodyJson`, backend derives plain text + `wordCount` from the JSON tree (pure function `tipTapJsonToText()`) and writes both `bodyJson` and `content` in the same update. Existing text-only PATCH path (from [B3]) continues to work.
  - verify: `cd backend && npm run test:backend -- --run tests/services/tiptap-to-text.test.ts tests/routes/chapters-body-json.test.ts`

- [ ] **[B11]** User settings passthrough: `GET /api/users/me/settings` and `PATCH /api/users/me/settings` read/write `User.settingsJson`. Zod schema enforces allowed keys (theme, proseFont, proseSize, lineHeight, writing toggles, daily goal, chat model + params, `ai.includeVeniceSystemPrompt` boolean defaulting to `true`).
  - verify: `cd backend && npm run test:backend -- --run tests/routes/user-settings.test.ts`

---

## 🎨 F — Frontend

- [ ] **[F1]** React Router: `/login`, `/register`, `/` (dashboard), `/stories/:id` (editor). Auth guard redirects to `/login`.
  - verify: `cd frontend && npm run test:frontend -- --run tests/routing.test.tsx`

- [ ] **[F2]** `useAuth()` hook: provides `user`, `login()`, `logout()`, `register()`. JWT stored in memory. Calls `/api/auth/refresh` on app load.
  - verify: `cd frontend && npm run test:frontend -- --run tests/hooks/useAuth.test.tsx`

- [ ] **[F3]** API client `src/lib/api.ts`: attaches Bearer token, retries once after 401 refresh, throws typed errors.
  - verify: `cd frontend && npm run test:frontend -- --run tests/lib/api.test.ts`

- [ ] **[F4]** Login and Register pages with inline validation. Redirect to `/` on success.
  - verify: `cd frontend && npm run test:frontend -- --run tests/pages/auth.test.tsx`

- [ ] **[F5]** Dashboard: story card grid with title, genre, synopsis, chapter count, word count, last edited. "New Story" opens create modal.
  - verify: `cd frontend && npm run test:frontend -- --run tests/pages/dashboard.test.tsx`

- [ ] **[F6]** Create/edit story modal: title (required), genre, synopsis, worldNotes fields.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/StoryModal.test.tsx`

- [ ] **[F7]** Editor layout: left sidebar (chapters), centre (TipTap), right (AI panel, collapsible). Story title in top bar.
  - verify: `cd frontend && npm run test:frontend -- --run tests/pages/editor.test.tsx`

- [ ] **[F8]** TipTap editor: bold, italic, headings 1-3, paragraph, word count in footer.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Editor.test.tsx`

- [ ] **[F9]** Autosave: 2s debounce, shows "Saving…" / "Saved ✓" / "Save failed — retrying".
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Autosave.test.tsx`

- [ ] **[F10]** Chapter list sidebar: ordered, with word counts. Click to load. "Add chapter" button. Drag handles via dnd-kit.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/ChapterList.test.tsx`

- [ ] **[F11]** Chapter drag-to-reorder: optimistic update, calls reorder endpoint, reverts on failure.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/ChapterReorder.test.tsx`

- [ ] **[F12]** AI assistant panel: action buttons (Continue, Rephrase, Expand, Summarise) + freeform input. Shows highlighted editor text as context.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/AIPanel.test.tsx`

- [ ] **[F13]** Venice model selector: dropdown from `GET /api/ai/models`. Shows model name and context window size (e.g. "128K"). Groups reasoning-capable models. Persists to localStorage.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/ModelSelector.test.tsx`

- [ ] **[F14]** Web search toggle: checkbox in AI panel enabling `enableWebSearch`. Only visible when selected model supports it.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/WebSearchToggle.test.tsx`

- [ ] **[F15]** Streaming AI response: renders tokens as they arrive. "Insert at cursor" appends into TipTap at cursor position. "Copy" button.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/AIStream.test.tsx`

- [ ] **[F16]** Venice usage indicator: reads `x-venice-remaining-requests` and `x-venice-remaining-tokens` headers after each AI call. Shows in AI panel (e.g. "482 requests / 1.2M tokens remaining").
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/UsageIndicator.test.tsx`

- [ ] **[F17]** Account balance: calls `GET /api/ai/balance` on editor load. Shows USD and Diem balance in user menu.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/BalanceDisplay.test.tsx`

- [ ] **[F18]** Characters panel: sidebar tab listing story characters. "Add character" button. Click to open character sheet.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/CharacterList.test.tsx`

- [ ] **[F19]** Character sheet modal: all fields, save and delete with confirm dialog.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/CharacterSheet.test.tsx`

- [ ] **[F20]** Export: download chapter or full story as `.txt`, client-side.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Export.test.tsx`

- [ ] **[F21]** Dark mode: toggle in top nav, persisted to localStorage, TailwindCSS `dark:` classes.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/DarkMode.test.tsx`

### F — Mockup-fidelity implementation (Inkwell design)

> Source of truth: `mockups/frontend-prototype/design/*.jsx` (component reference), `mockups/frontend-prototype/design/styles.css` (full token set), `mockups/frontend-prototype/screenshots/*.png` (visual reference). The README in that folder is the spec. F22–F49 recreate this faithfully; they do NOT replace F1–F21 — they build on top of them.

- [ ] **[F22]** Install Zustand + TanStack Query. Scaffold `src/store/` with typed slices: `session`, `activeStoryId`, `activeChapterId`, `sidebarTab`, `selection` (`{ text, range, rect } | null`), `inlineAIResult` (`{ action, text, status, output } | null`), `attachedSelection` (`{ text, chapter } | null`), `model`, `params` (temp/top_p/max/freqPenalty), `tweaks` (theme/layout/proseFont).
  - verify: `cd frontend && npm run test:frontend -- --run tests/store/`

- [ ] **[F23]** Port design tokens from `mockups/frontend-prototype/design/styles.css` into Tailwind theme: colors, spacing scale, radii (`--radius` 3px, `--radius-lg` 6px), shadows (`--shadow-card`, `--shadow-pop`), fonts (`--serif`, `--sans`, `--mono`). Implement three themes (`paper` default, `sepia`, `dark`) via `data-theme` attribute on `<html>`, exposed as CSS custom properties.
  - verify: `cd frontend && npm run test:frontend -- --run tests/theme.test.tsx`

- [ ] **[F24]** Auth screen mockup redesign (replaces plain form from [F4] visually; logic reused): two-column `1fr 1fr` grid. Left hero (bg `--bg-sunken`, 36/44 padding, radial gradient) — brand lockup (feather + italic "Inkwell" 22px) + serif italic pull quote (22/1.5, max-width 440px) + mono metadata footer. Right form (360px card) — serif 28/500 title, 13px `--ink-3` subtitle, `.auth-field` rows (label 12/500 + optional 11px hint + `.text-input` 8/10 padding 13.5px). Password field eye-toggle. Submit with 600ms spinner. Mode switch link. Shield-icon footer. Sub-720px: single column, hide hero.
  - verify: `cd frontend && npm run test:frontend -- --run tests/pages/auth-design.test.tsx`

- [ ] **[F25]** App shell: CSS grid `grid-template-columns: 260px 1fr 360px; grid-template-rows: 44px 1fr; grid-template-areas: "topbar topbar topbar" "sidebar editor chat"`. Three `data-layout` variants on root: `""`/`three-col` (full), `nochat` (`260px 1fr 0`), `focus` (`0 1fr 0`). Focus toggle via top-bar button + keyboard shortcut.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/AppShell.test.tsx`

- [ ] **[F26]** Top bar (44px, `border-bottom: 1px solid var(--line)`, padding `0 14px`, `gap: 16px`): brand cell with right border (244px min-width) · centre breadcrumbs `Story / Ch N / Chapter title` with `--ink-5` separators · right group with save indicator (green dot + "Saved · 12s ago") + word count (mono 12px) + History / Focus / Settings icon buttons + 26px initial-avatar opening 220px user menu (name + `@username` mono header; Settings / Your stories / Account & privacy / divider / Sign out in `--danger`).
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/TopBar.test.tsx`

- [ ] **[F27]** Sidebar (260px, `border-right: 1px solid var(--line)`): story-picker header (book icon + story title + chevron — clickable, opens [F30]) with plus button, Chapters/Cast/Outline tab row (1px bottom accent on active), scrollable tab body, story progress footer (`X / Y words · Z%` + 2px linear progress bar).
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Sidebar.test.tsx`

- [ ] **[F28]** Cast sidebar tab: Principal (first 2 characters) + Supporting (rest) sections with 11px uppercase `.08em` tracking `--ink-4` headers. `.char-card`: 28px colored circular avatar with serif-italic `initial`, name (13/500), role + age (11px `--ink-4`). Click avatar → opens Character Popover ([F37]) anchored to avatar.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/CastTab.test.tsx`

- [ ] **[F29]** Outline sidebar tab: Story Arc section. `.outline-item` rows with 6px left bullet (left 12, top 12). States: `done` (green), `current` (black + 3px halo ring), default (`--ink-5`). dnd-kit drag-reorder wired to [B8] reorder endpoint with optimistic update + revert-on-failure.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/OutlineTab.test.tsx`

- [ ] **[F30]** Story Picker modal (480px): story rows — 34×44 serif-italic initial tile + title (serif 15px) + mono metadata `genre · X / Y`. Active row: "open" pill + `border: 1px solid var(--ink)`. Footer: "N stories in vault" + Import .docx button + New story primary button.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/StoryPicker.test.tsx`

- [ ] **[F31]** Editor format bar (40px, padding `6px 24px`): groups separated by 1px dividers. 28×28 `.fb-btn` icon buttons. Groups in order: Undo/Redo · Style selector (Body pill with chevron, serif) · Bold/Italic/Underline/Strike · H1/H2/Quote · Bullet/Ordered list · Link/Highlight · spacer · Find/Focus. Wired to TipTap marks/nodes; `.active` reflects real editor state.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/FormatBar.test.tsx`

- [ ] **[F32]** Paper editor layout: `max-width: 720px` centered, top padding 48, side padding 80, bottom padding 240. Document title serif 28/600. Sub row: uppercase tracking `.04em` mono-feel — genre · "Draft N" · word count · status chip. Chapter heading serif italic 22, `margin-top: 48px`, right-aligned sans `§ NN` label, 1px bottom border. Prose: `var(--serif)` 18px, line-height 1.7, `text-wrap: pretty`.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Paper.test.tsx`

- [ ] **[F33]** Selection bubble: document `mouseup` + `keyup` listener reads `window.getSelection()`; if non-collapsed and inside the prose region, positions a dark pill (bg `--ink`, text `--bg`, 4px padding, `0 6px 18px rgba(0,0,0,.22)` shadow) 44px above selection rect, centered horizontally, clamped to paper area. Hides on: collapsed selection, selection outside prose, scroll, Escape. `onMouseDown: preventDefault()` on the bubble itself so clicks don't clear selection. Four actions (Rewrite / Describe / Expand · thin divider · Ask AI).
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/SelectionBubble.test.tsx`

- [ ] **[F34]** Inline AI result card (below prose): wraps selection as serif italic quote with left border. Thinking state: three bouncing `.think-dot`s with 0 / .15 / .3s stagger, 1s `think` keyframe. Streams tokens from `POST /api/ai/complete` SSE into the card, replacing thinking with live serif 16px output. Action row: Replace (diff-replaces selection in TipTap), Insert after (appends after selection), Retry (regenerates), spacer, Discard (dismisses card).
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/InlineAIResult.test.tsx`

- [ ] **[F35]** Continue-writing affordance: dashed `var(--ai)` (muted purple) pill "Continue writing" + mono hint "⌥↵ generates ~80 words in your voice". On click or ⌥+Enter: calls `/api/ai/complete` with `continue` action + cursor context; renders streaming output inline as `<span class="ai-continuation">` (purple tinted). Summary bar: Keep (commits span as normal prose) / Retry / Discard.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/ContinueWriting.test.tsx`

- [ ] **[F36]** Character reference TipTap extension: custom mark `charRef` with attr `characterId`. Renders as a span with 1px dotted underline in `var(--ink-5)` and `cursor: help`. `mouseenter` opens Character Popover ([F37]) anchored below the word. Persists in `chapters.bodyJson`; no separate table.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/CharRefMark.test.tsx`

- [ ] **[F37]** Character Popover (280px absolute): serif name (16px) + uppercase role / age caption. Three fields — Appearance / Voice / Arc — each with mono uppercase caption and serif value. Footer buttons: Edit (opens character sheet) · Consistency check (calls [X8] when available, otherwise hidden). Used from sidebar Cast tab ([F28]) and from `.char-ref` hover in prose ([F36]).
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/CharacterPopover.test.tsx`

- [ ] **[F38]** Chat panel (360px, `border-left: 1px solid var(--line)`): header (40px) with Chat/History pill tabs (active uses `--accent-soft`) + New chat + Settings icon buttons. Model bar (bg `--bg-sunken`, 10/14 padding): row 1 "MODEL" 10px uppercase `.08em` label + model picker button (18×18 black "V" venice mark + mono model name + `.ctx-chip` e.g. `32k` + chevron — opens [F42]); row 2 mono params `temp 0.85  top_p 0.95  max 800` + right-aligned `70B · Dolphin 2.9.2`. Scrollable body. Composer anchored bottom. Placeholder [F12] superseded by this.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/ChatPanel.test.tsx`

- [ ] **[F39]** Chat messages: user — sans 13px, `--accent-soft` pill bubble, 8/12 padding, `--radius-lg`. Assistant — serif 13.5/1.55, no background, 2px left border in `--ai`; meta row below with Copy / Regenerate / `412 tok · 1.8s`. Attachment previews above user bubble: serif italic quote with mono "FROM CH. N" caption + left border. Suggestion chips (8/10 sans 12.5px with icon + label). Dashed context chip at end (mono 11px: `"Chapter 3 · 4 characters · 2.4k tokens attached to context"`).
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/ChatMessages.test.tsx`

- [ ] **[F40]** Chat composer: auto-grow textarea (max 120px). When `attachedSelection` is set: render attachment preview block above the textarea (paperclip icon + mono "ATTACHED FROM CH. N" caption + 2-line-clamped serif italic quote + X to clear). Send button 28×28 black square with arrow-up icon (disabled when input empty AND no attachment). Below input: mode tabs (Ask / Rewrite / Describe — sans 11px; active `--accent-soft`) + right-aligned "⌘↵ send" hint. `Cmd/Ctrl+Enter` submits.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/ChatComposer.test.tsx`

- [ ] **[F41]** Ask-AI flow: selection bubble "Ask AI" writes `attachedSelection` into Zustand, auto-opens chat panel (layout → `three-col` if in `nochat`), pre-fills composer with "Help me with this passage — ", focuses composer, clears prose selection.
  - verify: `cd frontend && npm run test:frontend -- --run tests/flows/ask-ai.test.tsx`

- [ ] **[F42]** Model Picker modal (480px): radio-card list — name, params, ctx, speed, notes (same card component as Settings → Models tab). Selected card: `border-color: var(--ink)`. Click selects and closes. Shared component between chat-panel model bar trigger ([F38]) and Settings → Models ([F44]).
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/ModelPicker.test.tsx`

- [ ] **[F43]** Settings modal (720px centered) shell + Venice tab: backdrop `rgba(20,18,12,.4)` with 3px blur. Header: "Settings" serif 18/500 + sub "Configure Venice.ai integration, writing preferences, and self-hosting" + close X. Horizontal tab nav (1px bottom accent on active): Venice / Models / Writing / Appearance. **No self-hosting tab** (removed per stakeholder direction; env-file configured externally). Footer: mono "Changes save automatically to your local vault" hint + Cancel + Done primary. Venice tab fields: API key (password input + eye toggle + "Verified · 2.2k credits" green status pill, red pill on 401), endpoint override, organization; Feature toggles (Chat completions / Text continuation / Inline rewrite / Image generation / Character extraction / Embeddings / **Include Venice creative-writing prompt** — bound to `settings.ai.includeVeniceSystemPrompt` via [B11], default on, hint "Prepend Venice's built-in creative writing guidance on top of Inkwell's own system prompt."); Privacy toggles (request logging, send-story-context). **NB:** The API key input is only meaningful if BYOK is adopted (see conflict #2 in handoff); otherwise this tab shows the server-key health status read-only.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Settings.shell-venice.test.tsx`

- [ ] **[F44]** Settings → Models tab: radio-card model list (reuses card from [F42]) + generation parameter sliders (temperature, top_p, max_tokens, frequency_penalty with live value readout) + system prompt textarea (serif, per-story, writes to `Story.systemPrompt` via [V13] + [B2]).
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Settings.models.test.tsx`

- [ ] **[F45]** Settings → Writing tab: toggles — Typewriter mode, Focus paragraph, Auto-save, Smart quotes, Em-dash expansion — plus Daily goal (words) number input. Persists via [B11].
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Settings.writing.test.tsx`

- [ ] **[F46]** Settings → Appearance tab: 3-tile theme picker (Paper / Sepia / Dark with live swatch preview per README token overrides) · prose font select (Iowan Old Style / Palatino / Garamond / IBM Plex Serif) · prose size slider (14–24px) · line-height slider (1.3–2.0). Writes apply immediately via `data-theme` + CSS custom properties, persist via [B11]. Supersedes [F21] scope.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Settings.appearance.test.tsx`

- [ ] **[F47]** Keyboard shortcuts hook `useKeyboardShortcuts`: `⌘/Ctrl+Enter` sends in chat composer, `⌥+Enter` triggers continue-writing from cursor, `Escape` dismisses selection bubble / inline AI card / closes open modal. Single document-level listener, scoped callbacks registered per-component.
  - verify: `cd frontend && npm run test:frontend -- --run tests/hooks/useKeyboardShortcuts.test.tsx`

- [ ] **[F48]** Autosave per mockup: 4s idle debounce on editor changes (README §Persistence). Three states in top bar indicator: "Saving…" / "Saved · Ns ago" (relative time, updates every 5s) / "Save failed — retrying in Ns". **Supersedes [F9]'s 2s debounce** — when implementing F9, use 4s. Chapter body sent as `bodyJson` (TipTap JSON) to [B10].
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Autosave-mockup.test.tsx`

- [ ] **[F49]** Shared transitions: backdrop fade-in 160ms ease-out; modal content translate-y 8→0 + scale .98→1 at 180ms `cubic-bezier(.2,.9,.3,1)`; popovers + selection bubble opacity 0 + translateY 4 → 1 at 140ms ease-out; thinking dots `think` keyframe 1s ease-in-out infinite with 0/.15/.3s stagger. Implement as shared CSS classes + a `Transition` wrapper component.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Animations.test.tsx`

---

## ☁️ I — DevOps & Infra

- [ ] **[I1]** Multi-stage Dockerfile for backend: `builder` compiles TypeScript, `runner` runs as non-root user.
  - verify: `docker build -t story-editor-backend ./backend && docker inspect story-editor-backend | grep -q "User"`

- [ ] **[I2]** Multi-stage Dockerfile for frontend: `builder` runs `npm run build`, `runner` serves dist on port 3000.
  - verify: `docker build -t story-editor-frontend ./frontend && docker run --rm -d -p 3001:3000 story-editor-frontend && sleep 3 && curl -sf http://localhost:3001 | grep -q "html" && docker stop $(docker ps -q --filter ancestor=story-editor-frontend)`

- [ ] **[I3]** `docker-compose.yml` final: backend `depends_on` postgres with `condition: service_healthy`. `restart: unless-stopped` on all services. Postgres in named volume `pgdata`.
  - verify: `docker compose down -v && docker compose up -d && sleep 10 && curl -sf http://localhost:4000/api/health | grep '"status":"ok"'`

- [ ] **[I4]** `docker-compose.override.yml` for local dev: hot reload mounts, all ports exposed, `NODE_ENV=development`.
  - verify: `docker compose -f docker-compose.yml -f docker-compose.override.yml config --quiet && echo "OVERRIDE OK"`

- [ ] **[I5]** `scripts/backup-db.sh`: runs `pg_dump` inside the postgres container, saves timestamped `.sql.gz` to `./backups/`.
  - verify: `bash scripts/backup-db.sh && ls backups/*.sql.gz | head -1`

- [ ] **[I6]** `SELF_HOSTING.md`: prerequisites, first-run steps, updating, backup/restore, port layout (frontend :3000, backend :4000), note that reverse proxy is expected upstream but not included.
  - verify: `test -f SELF_HOSTING.md && grep -q "docker compose up" SELF_HOSTING.md && grep -q "VENICE_API_KEY" SELF_HOSTING.md`

- [ ] **[I7]** BYOK env swap: remove `VENICE_API_KEY` from `.env.example` and supporting docs; add `APP_ENCRYPTION_KEY` (32-byte base64, documented with a generation one-liner in [I6]'s SELF_HOSTING.md). Backend startup fails fast with a clear message if `APP_ENCRYPTION_KEY` is missing or wrong length. Update [I6]'s `SELF_HOSTING.md` to reflect the BYOK model (each user enters their own key in Settings — operator does not need a Venice account).
  - verify: `grep -q "APP_ENCRYPTION_KEY" .env.example && ! grep -q "VENICE_API_KEY" .env.example && cd backend && npm run test:backend -- --run tests/boot/encryption-key.test.ts`

---

## 🧪 T — Testing

- [ ] **[T1]** Auth route integration tests: register, duplicate email, login, wrong password, refresh, logout.
  - verify: `cd backend && npm run test:backend -- --run tests/auth/`

- [ ] **[T2]** Stories route integration tests: CRUD, ownership enforcement, word count aggregation.
  - verify: `cd backend && npm run test:backend -- --run tests/routes/stories.test.ts tests/routes/story-detail.test.ts`

- [ ] **[T3]** Chapters route integration tests: CRUD, reordering, word count on save.
  - verify: `cd backend && npm run test:backend -- --run tests/routes/chapters.test.ts tests/routes/chapters-reorder.test.ts`

- [ ] **[T4]** Characters route integration tests: CRUD, story scoping, cascade delete.
  - verify: `cd backend && npm run test:backend -- --run tests/routes/characters.test.ts`

- [ ] **[T5]** Prompt builder unit tests: all 5 action types, character context present, worldNotes present, `include_venice_system_prompt` reflects the caller-supplied `includeVeniceSystemPrompt` setting (default `true`) independent of action type, model, and `Story.systemPrompt`, truncation removes from top of chapterContent only, budget respects model context length.
  - verify: `cd backend && npm run test:backend -- --run tests/services/prompt.service.test.ts tests/services/prompt.actions.test.ts`

- [ ] **[T6]** Venice AI service unit tests (mocked HTTP): correct payload, stream forwarded, reasoning model flag applied correctly, rate limit headers extracted, error codes mapped, no raw Venice errors leaked.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/`

- [ ] **[T7]** Frontend component tests: Editor, AIPanel, ModelSelector, UsageIndicator, CharacterSheet, WebSearchToggle.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/`

- [ ] **[T8]** Playwright E2E: register -> create story -> add two chapters -> type content -> add character -> trigger AI Continue (streaming response appears) -> confirm "Saved ✓" -> verify usage indicator updates.
  - verify: `docker compose up -d && npx playwright test tests/e2e/full-flow.spec.ts --reporter=line`

- [ ] **[T9]** Full suite run — all tests pass before marking complete.
  - verify: `cd backend && npm run test:backend -- --run && cd ../frontend && npm run test:frontend -- --run && echo "ALL TESTS PASSED"`

---

## 💡 X — Extras (after core is complete)

- [ ] **[X1]** Word count goals per chapter with progress bar in chapter list.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/WordCountGoal.test.tsx`

- [ ] **[X2]** Focus mode: keyboard shortcut hides all UI chrome. Escape to exit.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/FocusMode.test.tsx`

- [ ] **[X3]** Account settings: change password, delete account with cascade.
  - verify: `cd backend && npm run test:backend -- --run tests/routes/account.test.ts && cd ../frontend && npm run test:frontend -- --run tests/pages/account.test.tsx`

- [ ] **[X4]** Image generation: "Generate image" button calls `POST /api/ai/image` which forwards to Venice's image generation endpoint. Result inserted as a TipTap image node.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/image.test.ts`

- [ ] **[X5]** DOCX export (per chapter + whole story): backend converts `bodyJson` → .docx via the `docx` npm package; frontend "Import .docx" sits in Story Picker footer ([F30]) and triggers `POST /api/stories/:id/export/docx`.
  - verify: `cd backend && npm run test:backend -- --run tests/routes/export-docx.test.ts`

- [ ] **[X6]** EPUB export (whole story): stitches chapters in `orderIndex` order into a single .epub. Async — returns a job id, polled for the download URL.
  - verify: `cd backend && npm run test:backend -- --run tests/routes/export-epub.test.ts`

- [ ] **[X7]** Import .docx into a story: parses headings as chapter splits, creates Chapter rows with derived `bodyJson` + `content`.
  - verify: `cd backend && npm run test:backend -- --run tests/routes/import-docx.test.ts`

- [ ] **[X8]** Consistency check (character popover footer button): sends the character bible entry + the last N chapters (budget-aware via [V3]) to the selected model, returns an annotated list of discrepancies ("Eira's eye colour — grey in Ch.2 but hazel in Ch.5"). Renders as a scrollable list in the popover's expanded state.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/consistency-check.test.ts`

- [ ] **[X9]** Typewriter mode + Focus paragraph rendering (Settings → Writing toggles from [F45]): typewriter keeps active line vertically centred via padding manipulation; focus paragraph dims all but the current paragraph via an `opacity: .35` rule controlled by `data-focus-active` on the prose container.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/FocusParagraph.test.tsx`

- [ ] **[X10]** Migration-handling revisit (pre-deployment: no legacy rows exist, so migration branches in the core path were removed or never added). When real users exist, re-examine and decide: (a) `login()` lazy-wrap generation for pre-[E3] users (`auth.service.ts`); (b) `verifyPassword` bcrypt legacy branch + `login()` `needsRehash` silent upgrade from [AU14]; (c) optional `sessionId` on access/refresh token payloads (pre-[E3] tokens); (d) `readEncrypted` plaintext fallback in `repos/_narrative.ts` during the [E10]→[E11] rollout window; (e) `message.repo` JSON-parse legacy-string fallback. If a code path has no real legacy population to serve, delete it; otherwise document the exact migration window it covers. Only meaningful after the core feature set ships.
  - verify: (manual review — no automated verify)
