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

## Current focus

- **In flight:** F-series follow-ups (F51–F67 share branch + PR per memory note); T8.1 done on its own branch awaiting merge.
- **Deferred:** none.
- **Cold sections (archived in `docs/done/`):** S, A, D, E, V, L.
- **Hot sections (live work, see below):** AU, B, F, I, T, X.

---

## S — archived

All [S]-series tasks complete — archived in [`docs/done/done-S.md`](docs/done/done-S.md).

---

## A — archived

All [A]-series tasks complete — archived in [`docs/done/done-A.md`](docs/done/done-A.md).

---

## D — archived

All [D]-series tasks complete — archived in [`docs/done/done-D.md`](docs/done/done-D.md).

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

## E — archived

All [E]-series tasks complete — archived in [`docs/done/done-E.md`](docs/done/done-E.md).

---

## V — archived

All [V]-series tasks complete — archived in [`docs/done/done-V.md`](docs/done/done-V.md).

---

## L — archived

All [L]-series tasks complete — archived in [`docs/done/done-L.md`](docs/done/done-L.md).

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

- [x] **[B6]** `GET /api/health` returns `{ status: "ok", db: "connected" }`. Returns 503 if DB unreachable.
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

- [x] **[B11]** User settings passthrough: `GET /api/users/me/settings` and `PATCH /api/users/me/settings` read/write `User.settingsJson`. Zod schema enforces allowed keys (theme, proseFont, proseSize, lineHeight, writing toggles, daily goal, chat model + params, `ai.includeVeniceSystemPrompt` boolean defaulting to `true`).
  - verify: `cd backend && npm run test:backend -- --run tests/routes/user-settings.test.ts`

- [x] **[B12]** `POST /api/auth/sign-out-everywhere` — authenticated endpoint that deletes every refresh token belonging to the caller, closes their in-memory sessions, and clears the caller's refresh cookie. 204 on success. Idempotent at the DB level. Rate-limited via the same `SENSITIVE_AUTH_LIMIT_OPTIONS` bucket as change-password / rotate-recovery-code. Used by `[F61]` Account & Privacy panel.
  - verify: `cd backend && npm run test:backend -- --run tests/auth/sign-out-everywhere.test.ts`

### B — Post-B-series follow-ups (work next, before F)

Surfaced by the final cross-cutting review of the B-series branch + the V22 Venice-API audit. V-series contract gaps, Venice-API drift fixes, and one deferred schema fix. Work these before starting F so the frontend codes against a settled contract.

- [x] **[V19]** Wrap `POST /api/chapters/:chapterId/chats` response body in `{ chat }` envelope to match `docs/api-contract.md:156`. Currently returns the bare `chat` object at the top level. Update `backend/src/routes/chat.routes.ts` and any test assertions in `backend/tests/ai/chat-persistence.test.ts` that relied on the flat shape.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/chat-persistence.test.ts`

- [x] **[V20]** Add `.strict()` to `CreateChatBody`, `PostMessageBody`, and the nested `attachment` sub-schema in `backend/src/routes/chat.routes.ts` so stray / misspelled keys return 400 instead of being silently dropped. Mirror the B-series precedent (`validation_error` envelope via `backend/src/lib/bad-request.ts`). Add tests for unknown-key rejection on both endpoints.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/chat-persistence.test.ts`

- [x] **[V21]** Implement `GET /api/chats/:chatId/messages` returning `{ messages: [{ id, role, contentJson, attachmentJson, model, tokens, latencyMs, createdAt }] }` per `docs/api-contract.md:161`. Route goes under `createChatMessagesRouter()` (`backend/src/routes/chat.routes.ts`), ordered by `createdAt asc`. Reuse `createMessageRepo(req).findManyForChat(chatId)` (ownership enforced by the repo). Required by the frontend chat panel to hydrate history on mount.
  - verify: `cd backend && npm run test:backend -- --run tests/routes/chat-messages-list.test.ts`

- [x] **[V22]** Code review of the Venice integration as implemented (V1–V21) against the **actual** Venice.ai API reference. Fetch the current Venice docs (Context7 preferred: resolve library id for `venice.ai` / `venice-ai`; web fallback: `https://docs.venice.ai/api-reference`) and compare against: `backend/src/services/venice.client.ts` (per-user OpenAI-compatible client construction, `[V17]`), `backend/src/services/prompt.service.ts` (prompt builder, dynamic context budget, `venice_parameters` passthrough), `backend/src/services/ai.service.ts` (streaming, reasoning strip, web search, prompt cache key), `backend/src/routes/ai.routes.ts` + `backend/src/routes/chat.routes.ts` (SSE shape, error mapping — `NoVeniceKeyError` → 409 `venice_key_required`, upstream auth → 401, rate limit → 429), and `backend/src/routes/venice-key.routes.ts` (`PUT`/`GET`/`DELETE` + `[V18]` verify). Confirm: (1) endpoint base URL + path for chat completions matches current Venice docs; (2) `venice_parameters` field names match exactly (`include_venice_system_prompt`, `strip_thinking_response`, `enable_web_search`, `enable_web_citations`, `prompt_cache_key`); (3) SSE `data: [DONE]` terminator + delta shape matches; (4) reasoning model handling is correct for the models Venice currently documents; (5) web-search citations are extracted from the Venice response shape Venice actually returns today; (6) model-listing endpoint (if used) still returns `context_length` under the same field name. Produce a written gap list — any mismatch becomes a follow-up task `[V23+]`. Do NOT fix gaps in this task; this is review-only. Output goes to `docs/venice-integration.md` under a new "### 2026-04 Venice API audit" section. If Context7 has no Venice entry, fall back to `WebFetch` against `https://docs.venice.ai/api-reference/api-spec` and `https://docs.venice.ai/welcome/guides/venice-parameters`.
  - verify: `test -s docs/venice-integration.md && grep -q '2026-04 Venice API audit' docs/venice-integration.md`

- [x] **[V23]** Move `prompt_cache_key` out of `venice_parameters` and onto the top-level chat-completion body. V22 audit flagged that Venice documents `prompt_cache_key` as a top-level field alongside `model` / `messages` / `stream`, not nested under `venice_parameters`; burying it in the nested object means Venice silently ignores the key and we pay cold-prompt cost on every call. Touch `backend/src/routes/ai.routes.ts` (~line 204) and `backend/src/routes/chat.routes.ts` (~line 333 — the `chatPromptCacheKey` call site) to spread the key at the top level of the `create()` args instead. Keep the computation helper (`chatPromptCacheKey` / the storyId+modelId sha256 helper in ai.routes) unchanged — this is a positioning fix only. Extend one test in each of `tests/ai/prompt-cache.test.ts` + `tests/ai/chat-persistence.test.ts` to assert the Venice-client mock receives `prompt_cache_key` at the top level and NOT inside `venice_parameters`.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/prompt-cache.test.ts tests/ai/chat-persistence.test.ts`

- [x] **[V24]** Map Venice 402 `INSUFFICIENT_BALANCE` to a dedicated application error instead of the current generic 502 `venice_unavailable`. Update `backend/src/lib/venice-errors.ts`: add a 402 branch to `mapVeniceError` + `mapVeniceErrorToSse` emitting `{ error: { code: 'venice_insufficient_balance', message: '…', retryAfter: null } }` with HTTP 402 (JSON path) or an equivalent SSE frame followed by `[DONE]`. Add a hint URL `https://venice.ai/settings/api` in the message so the frontend can render a "Top up credits" CTA. Tests: add a unit test to `tests/lib/venice-errors.test.ts` (or the nearest equivalent) with a faked `APIError` whose `status === 402` and body code `'INSUFFICIENT_BALANCE'`. Do NOT leak the decrypted Venice key in the error envelope.
  - verify: `cd backend && npm run test:backend -- --run tests/lib/venice-errors.test.ts`

- [x] **[V25]** Rename `max_tokens` → `max_completion_tokens` across the prompt builder output and the two `chat.completions.create` call sites (`ai.routes.ts`, `chat.routes.ts`). Venice's current chat-completions spec flags `max_tokens` as deprecated in favor of `max_completion_tokens` (same semantics). Low-risk rename — the field is still accepted — but getting ahead of the deprecation avoids a silent behavioral change when Venice eventually drops the alias. Update `backend/src/services/prompt.service.ts` return shape (the field name in `BuildPromptResult`) plus both callers. Update any tests that read `max_tokens` off the builder output or off the mocked Venice call args.
  - verify: `cd backend && npm run test:backend -- --run tests/services/prompt.service.test.ts tests/ai/complete.test.ts tests/ai/chat-persistence.test.ts`

- [x] **[V26]** Chat panel web-search citations — backend delivery, parsing, and persistence. Full design + rationale in [`docs/superpowers/specs/2026-04-23-v26-chat-citations-design.md`](docs/superpowers/specs/2026-04-23-v26-chat-citations-design.md); follow the spec exactly. Summary: (1) Extend `PostMessageBody` in `backend/src/routes/chat.routes.ts` with optional `enableWebSearch?: boolean` (default `false`, `.strict()` stays); when `true` the handler sets `venice_parameters.enable_web_search = 'auto'`, `enable_web_citations = true`, `include_search_results_in_stream = true` before starting the stream. (2) New helper `backend/src/lib/venice-citations.ts` exporting `Citation = { title: string, url: string, snippet: string, publishedAt: string | null }` + `projectVeniceCitations(raw)` — maps Venice's `{ title, url, content, date }` shape → ours, drops items missing title/url, caps at 10. (3) In the chat POST stream loop, detect the Venice-only `venice_search_results` chunk property, project it, emit ONE SSE frame `event: citations\ndata: {"citations":[...]}\n\n` before the first content `data:`, consume (do NOT forward) that chunk; skip the frame when projection yields empty. (4) Add encrypted narrative triple `citationsJsonCiphertext / citationsJsonIv / citationsJsonAuthTag` (all `String?`) to `Message` in `backend/prisma/schema.prisma`; regenerate migration via `prisma migrate dev --name add_message_citations` — schema DDL only, no backfill. (5) Extend `backend/src/repos/message.repo.ts`: add `'citationsJson'` to `ENCRYPTED_FIELDS`, extend `MessageCreateInput`, write via `writeCiphertextOnly`. (6) In the V21 `GET /` handler projection, add `citationsJson: m.citationsJson ?? null`. (7) Update `docs/api-contract.md` § Chats (`enableWebSearch?` body field + Citation type + citations SSE frame), `docs/venice-integration.md` (new § Citations + update V22 Gap-list entry for V26 to point at this spec), `docs/data-model.md` § Message (+ citationsJson column). Null-vs-empty: null means "no search / no results"; never store `[]`. No ciphertext or Venice key leaks in logs or responses. Frontend rendering is `[F50]`; inline-AI web-search reconsideration is `[X11]`.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/chat-citations.test.ts tests/routes/chat-messages-list.test.ts tests/ai/chat-persistence.test.ts tests/security/encryption-leak.test.ts`

- [x] **[V27]** Extend `parseRetryAfter` in `backend/src/lib/venice-errors.ts:27–45` to fall back to the `x-ratelimit-reset-requests` / `x-ratelimit-reset-tokens` headers when the standard `Retry-After` header is absent. V22 audit flagged this as uncertain — Venice may populate only the reset-* headers on chat-completion 429s. Use whichever `reset-*` value is smaller (soonest) as the retry hint. Add unit coverage in `tests/lib/venice-errors.test.ts` for: (a) only `Retry-After` set, (b) only `x-ratelimit-reset-tokens` set, (c) both set — soonest wins, (d) neither set → returns `null`. If feasible, add an opt-in L-series probe under `backend/tests/live/` that hammers a low-cap endpoint to confirm which header(s) Venice actually sends today; gate it behind the existing `npm run test:live` entrypoint.
  - verify: `cd backend && npm run test:backend -- --run tests/lib/venice-errors.test.ts`

- [x] **[V28]** (low priority) Forward `x-ratelimit-limit-requests`, `x-ratelimit-limit-tokens`, `x-ratelimit-reset-requests`, `x-ratelimit-reset-tokens` alongside the `remaining-*` headers we already forward in `ai.routes.ts` (SSE response headers before first flush) and `chat.routes.ts`. Prefix with `x-venice-` to stay consistent with the existing `x-venice-remaining-*` naming. Rationale: the frontend can then compute "X / Y remaining until HH:MM" without a second round-trip. Extend the streaming tests to assert the additional headers are copied through when present on the upstream response.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/rate-limit-headers.test.ts tests/ai/chat-rate-limit-headers.test.ts`

- [x] **[D17]** Investigate and, if confirmed needed, add `@@unique([storyId, orderIndex])` to `Chapter` and `@@unique([storyId, order])` to `OutlineItem` in `backend/prisma/schema.prisma`. Background: B3/B4/B8 left `TODO(B4)` / `TODO(schema)` markers in the chapter + outline repos because the `aggregate(_max) → insert` auto-assign pattern in their POST handlers is racy — concurrent POSTs to the same story can produce duplicate `orderIndex` / `order` rows with no DB-level guard. Breaking schema changes are acceptable (there is no deployed data to migrate per CLAUDE.md's "migration handling is deferred" rule). After adding the constraint, update the POST handlers to catch Prisma `P2002` (unique violation) and retry the aggregate, and extend the reorder transaction to use a two-phase swap (negative temp values → final) to avoid unique-constraint violations mid-transaction. Remove the two TODO markers. If the investigation concludes the constraint is not worth the complexity cost, document the rationale in `docs/data-model.md` and remove the TODOs.
  - verify: `cd backend && npm run test:backend -- --run tests/routes/chapters.test.ts tests/routes/chapters-reorder.test.ts tests/routes/outline.test.ts`

---

## 🎨 F — Frontend

- [x] **[F1]** React Router: `/login`, `/register`, `/` (dashboard), `/stories/:id` (editor). Auth guard redirects to `/login`.
  - verify: `cd frontend && npm run test:frontend -- --run tests/routing.test.tsx`

- [x] **[F2]** `useAuth()` hook: provides `user`, `login()`, `logout()`, `register()`. JWT stored in memory. Calls `/api/auth/refresh` on app load.
  - verify: `cd frontend && npm run test:frontend -- --run tests/hooks/useAuth.test.tsx`

- [x] **[F3]** API client `src/lib/api.ts`: attaches Bearer token, retries once after 401 refresh, throws typed errors.
  - verify: `cd frontend && npm run test:frontend -- --run tests/lib/api.test.ts`

- [x] **[F4]** Login and Register pages with inline validation. Redirect to `/` on success.
  - verify: `cd frontend && npm run test:frontend -- --run tests/pages/auth.test.tsx`

- [x] **[F5]** Dashboard: story card grid with title, genre, synopsis, chapter count, word count, last edited. "New Story" opens create modal.
  - verify: `cd frontend && npm run test:frontend -- --run tests/pages/dashboard.test.tsx`

- [x] **[F6]** Create/edit story modal: title (required), genre, synopsis, worldNotes fields.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/StoryModal.test.tsx`

- [x] **[F7]** Editor layout: left sidebar (chapters), centre (TipTap), right (AI panel, collapsible). Story title in top bar.
  - verify: `cd frontend && npm run test:frontend -- --run tests/pages/editor.test.tsx`

- [x] **[F8]** TipTap editor: bold, italic, headings 1-3, paragraph, word count in footer.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Editor.test.tsx`

- [x] **[F9]** Autosave: 2s debounce, shows "Saving…" / "Saved ✓" / "Save failed — retrying".
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Autosave.test.tsx`

- [x] **[F10]** Chapter list sidebar: ordered, with word counts. Click to load. "Add chapter" button. Drag handles via dnd-kit.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/ChapterList.test.tsx`

- [x] **[F11]** Chapter drag-to-reorder: optimistic update, calls reorder endpoint, reverts on failure.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/ChapterReorder.test.tsx`

- [x] **[F12]** AI assistant panel: action buttons (Continue, Rephrase, Expand, Summarise) + freeform input. Shows highlighted editor text as context.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/AIPanel.test.tsx`

- [x] **[F13]** Venice model selector: dropdown from `GET /api/ai/models`. Shows model name and context window size (e.g. "128K"). Groups reasoning-capable models. Persists to localStorage.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/ModelSelector.test.tsx`

- [x] **[F14]** Web search toggle: checkbox in AI panel enabling `enableWebSearch`. Only visible when selected model supports it.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/WebSearchToggle.test.tsx`

- [x] **[F15]** Streaming AI response: renders tokens as they arrive. "Insert at cursor" appends into TipTap at cursor position. "Copy" button.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/AIStream.test.tsx`

- [x] **[F16]** Venice usage indicator: reads `x-venice-remaining-requests` and `x-venice-remaining-tokens` headers after each AI call. Shows in AI panel (e.g. "482 requests / 1.2M tokens remaining").
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/UsageIndicator.test.tsx`

- [x] **[F17]** Account balance: calls `GET /api/ai/balance` on editor load. Shows USD and Diem balance in user menu.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/BalanceDisplay.test.tsx`

- [x] **[F18]** Characters panel: sidebar tab listing story characters. "Add character" button. Click to open character sheet.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/CharacterList.test.tsx`

- [x] **[F19]** Character sheet modal: all fields, save and delete with confirm dialog.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/CharacterSheet.test.tsx`

- [x] **[F20]** Export: download chapter or full story as `.txt`, client-side.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Export.test.tsx`

- [x] **[F21]** Dark mode: toggle in top nav, persisted to localStorage, TailwindCSS `dark:` classes.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/DarkMode.test.tsx`

### F — Mockup-fidelity implementation (Inkwell design)

> Source of truth: `mockups/frontend-prototype/design/*.jsx` (component reference), `mockups/frontend-prototype/design/styles.css` (full token set), `mockups/frontend-prototype/screenshots/*.png` (visual reference). The README in that folder is the spec. F22–F49 recreate this faithfully; they do NOT replace F1–F21 — they build on top of them.

- [x] **[F22]** Install Zustand + TanStack Query. Scaffold `src/store/` with typed slices: `session`, `activeStoryId`, `activeChapterId`, `sidebarTab`, `selection` (`{ text, range, rect } | null`), `inlineAIResult` (`{ action, text, status, output } | null`), `attachedSelection` (`{ text, chapter } | null`), `model`, `params` (temp/top_p/max/freqPenalty), `tweaks` (theme/layout/proseFont).
  - verify: `cd frontend && npm run test:frontend -- --run tests/store/`

- [x] **[F23]** Port design tokens from `mockups/frontend-prototype/design/styles.css` into Tailwind theme: colors, spacing scale, radii (`--radius` 3px, `--radius-lg` 6px), shadows (`--shadow-card`, `--shadow-pop`), fonts (`--serif`, `--sans`, `--mono`). Implement three themes (`paper` default, `sepia`, `dark`) via `data-theme` attribute on `<html>`, exposed as CSS custom properties.
  - verify: `cd frontend && npm run test:frontend -- --run tests/theme.test.tsx`

- [x] **[F24]** Auth screen mockup redesign (replaces plain form from [F4] visually; logic reused): two-column `1fr 1fr` grid. Left hero (bg `--bg-sunken`, 36/44 padding, radial gradient) — brand lockup (feather + italic "Inkwell" 22px) + serif italic pull quote (22/1.5, max-width 440px) + mono metadata footer. Right form (360px card) — serif 28/500 title, 13px `--ink-3` subtitle, `.auth-field` rows (label 12/500 + optional 11px hint + `.text-input` 8/10 padding 13.5px). Password field eye-toggle. Submit with 600ms spinner. Mode switch link. Shield-icon footer. Sub-720px: single column, hide hero.
  - verify: `cd frontend && npm run test:frontend -- --run tests/pages/auth-design.test.tsx`

- [x] **[F25]** App shell: CSS grid `grid-template-columns: 260px 1fr 360px; grid-template-rows: 44px 1fr; grid-template-areas: "topbar topbar topbar" "sidebar editor chat"`. Three `data-layout` variants on root: `""`/`three-col` (full), `nochat` (`260px 1fr 0`), `focus` (`0 1fr 0`). Focus toggle via top-bar button + keyboard shortcut.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/AppShell.test.tsx`

- [x] **[F26]** Top bar (44px, `border-bottom: 1px solid var(--line)`, padding `0 14px`, `gap: 16px`): brand cell with right border (244px min-width) · centre breadcrumbs `Story / Ch N / Chapter title` with `--ink-5` separators · right group with save indicator (green dot + "Saved · 12s ago") + word count (mono 12px) + History / Focus / Settings icon buttons + 26px initial-avatar opening 220px user menu (name + `@username` mono header; Settings / Your stories / Account & privacy / divider / Sign out in `--danger`).
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/TopBar.test.tsx`

- [x] **[F27]** Sidebar (260px, `border-right: 1px solid var(--line)`): story-picker header (book icon + story title + chevron — clickable, opens [F30]) with plus button, Chapters/Cast/Outline tab row (1px bottom accent on active), scrollable tab body, story progress footer (`X / Y words · Z%` + 2px linear progress bar).
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Sidebar.test.tsx`

- [x] **[F28]** Cast sidebar tab: Principal (first 2 characters) + Supporting (rest) sections with 11px uppercase `.08em` tracking `--ink-4` headers. `.char-card`: 28px colored circular avatar with serif-italic `initial`, name (13/500), role + age (11px `--ink-4`). Click avatar → opens Character Popover ([F37]) anchored to avatar.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/CastTab.test.tsx`

- [x] **[F29]** Outline sidebar tab: Story Arc section. `.outline-item` rows with 6px left bullet (left 12, top 12). States: `done` (green), `current` (black + 3px halo ring), default (`--ink-5`). dnd-kit drag-reorder wired to [B8] reorder endpoint with optimistic update + revert-on-failure.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/OutlineTab.test.tsx`

- [x] **[F30]** Story Picker modal (480px): story rows — 34×44 serif-italic initial tile + title (serif 15px) + mono metadata `genre · X / Y`. Active row: "open" pill + `border: 1px solid var(--ink)`. Footer: "N stories in vault" + Import .docx button + New story primary button.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/StoryPicker.test.tsx`

- [x] **[F31]** Editor format bar (40px, padding `6px 24px`): groups separated by 1px dividers. 28×28 `.fb-btn` icon buttons. Groups in order: Undo/Redo · Style selector (Body pill with chevron, serif) · Bold/Italic/Underline/Strike · H1/H2/Quote · Bullet/Ordered list · Link/Highlight · spacer · Find/Focus. Wired to TipTap marks/nodes; `.active` reflects real editor state.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/FormatBar.test.tsx`

- [x] **[F32]** Paper editor layout: `max-width: 720px` centered, top padding 48, side padding 80, bottom padding 240. Document title serif 28/600. Sub row: uppercase tracking `.04em` mono-feel — genre · "Draft N" · word count · status chip. Chapter heading serif italic 22, `margin-top: 48px`, right-aligned sans `§ NN` label, 1px bottom border. Prose: `var(--serif)` 18px, line-height 1.7, `text-wrap: pretty`.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Paper.test.tsx`

- [x] **[F33]** Selection bubble: document `mouseup` + `keyup` listener reads `window.getSelection()`; if non-collapsed and inside the prose region, positions a dark pill (bg `--ink`, text `--bg`, 4px padding, `0 6px 18px rgba(0,0,0,.22)` shadow) 44px above selection rect, centered horizontally, clamped to paper area. Hides on: collapsed selection, selection outside prose, scroll, Escape. `onMouseDown: preventDefault()` on the bubble itself so clicks don't clear selection. Four actions (Rewrite / Describe / Expand · thin divider · Ask AI).
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/SelectionBubble.test.tsx`

- [x] **[F34]** Inline AI result card (below prose): wraps selection as serif italic quote with left border. Thinking state: three bouncing `.think-dot`s with 0 / .15 / .3s stagger, 1s `think` keyframe. Streams tokens from `POST /api/ai/complete` SSE into the card, replacing thinking with live serif 16px output. Action row: Replace (diff-replaces selection in TipTap), Insert after (appends after selection), Retry (regenerates), spacer, Discard (dismisses card).
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/InlineAIResult.test.tsx`

- [x] **[F35]** Continue-writing affordance: dashed `var(--ai)` (muted purple) pill "Continue writing" + mono hint "⌥↵ generates ~80 words in your voice". On click or ⌥+Enter: calls `/api/ai/complete` with `continue` action + cursor context; renders streaming output inline as `<span class="ai-continuation">` (purple tinted). Summary bar: Keep (commits span as normal prose) / Retry / Discard.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/ContinueWriting.test.tsx`

- [x] **[F36]** Character reference TipTap extension: custom mark `charRef` with attr `characterId`. Renders as a span with 1px dotted underline in `var(--ink-5)` and `cursor: help`. `mouseenter` opens Character Popover ([F37]) anchored below the word. Persists in `chapters.bodyJson`; no separate table.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/CharRefMark.test.tsx`

- [x] **[F37]** Character Popover (280px absolute): serif name (16px) + uppercase role / age caption. Three fields — Appearance / Voice / Arc — each with mono uppercase caption and serif value. Footer buttons: Edit (opens character sheet) · Consistency check (calls [X8] when available, otherwise hidden). Used from sidebar Cast tab ([F28]) and from `.char-ref` hover in prose ([F36]).
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/CharacterPopover.test.tsx`

- [x] **[F38]** Chat panel (360px, `border-left: 1px solid var(--line)`): header (40px) with Chat/History pill tabs (active uses `--accent-soft`) + New chat + Settings icon buttons. Model bar (bg `--bg-sunken`, 10/14 padding): row 1 "MODEL" 10px uppercase `.08em` label + model picker button (18×18 black "V" venice mark + mono model name + `.ctx-chip` e.g. `32k` + chevron — opens [F42]); row 2 mono params `temp 0.85  top_p 0.95  max 800` + right-aligned `70B · Dolphin 2.9.2`. Scrollable body. Composer anchored bottom. Placeholder [F12] superseded by this.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/ChatPanel.test.tsx`

- [x] **[F39]** Chat messages: user — sans 13px, `--accent-soft` pill bubble, 8/12 padding, `--radius-lg`. Assistant — serif 13.5/1.55, no background, 2px left border in `--ai`; meta row below with Copy / Regenerate / `412 tok · 1.8s`. Attachment previews above user bubble: serif italic quote with mono "FROM CH. N" caption + left border. Suggestion chips (8/10 sans 12.5px with icon + label). Dashed context chip at end (mono 11px: `"Chapter 3 · 4 characters · 2.4k tokens attached to context"`).
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/ChatMessages.test.tsx`

- [x] **[F40]** Chat composer: auto-grow textarea (max 120px). When `attachedSelection` is set: render attachment preview block above the textarea (paperclip icon + mono "ATTACHED FROM CH. N" caption + 2-line-clamped serif italic quote + X to clear). Send button 28×28 black square with arrow-up icon (disabled when input empty AND no attachment). Below input: mode tabs (Ask / Rewrite / Describe — sans 11px; active `--accent-soft`) + right-aligned "⌘↵ send" hint. `Cmd/Ctrl+Enter` submits.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/ChatComposer.test.tsx`

- [x] **[F41]** Ask-AI flow: selection bubble "Ask AI" writes `attachedSelection` into Zustand, auto-opens chat panel (layout → `three-col` if in `nochat`), pre-fills composer with "Help me with this passage — ", focuses composer, clears prose selection.
  - verify: `cd frontend && npm run test:frontend -- --run tests/flows/ask-ai.test.tsx`

- [x] **[F42]** Model Picker modal (480px): radio-card list — name, params, ctx, speed, notes (same card component as Settings → Models tab). Selected card: `border-color: var(--ink)`. Click selects and closes. Shared component between chat-panel model bar trigger ([F38]) and Settings → Models ([F44]).
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/ModelPicker.test.tsx`

- [x] **[F43]** Settings modal (720px centered) shell + Venice tab: backdrop `rgba(20,18,12,.4)` with 3px blur. Header: "Settings" serif 18/500 + sub "Configure Venice.ai integration, writing preferences, and self-hosting" + close X. Horizontal tab nav (1px bottom accent on active): Venice / Models / Writing / Appearance. **No self-hosting tab** (removed per stakeholder direction; env-file configured externally). Footer: mono "Changes save automatically to your local vault" hint + Cancel + Done primary. Venice tab fields: API key (password input + eye toggle + "Verified · 2.2k credits" green status pill, red pill on 401), endpoint override, organization; Feature toggles (Chat completions / Text continuation / Inline rewrite / Image generation / Character extraction / Embeddings / **Include Venice creative-writing prompt** — bound to `settings.ai.includeVeniceSystemPrompt` via [B11], default on, hint "Prepend Venice's built-in creative writing guidance on top of Inkwell's own system prompt."); Privacy toggles (request logging, send-story-context). **NB:** The API key input is only meaningful if BYOK is adopted (see conflict #2 in handoff); otherwise this tab shows the server-key health status read-only.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Settings.shell-venice.test.tsx`

- [x] **[F44]** Settings → Models tab: radio-card model list (reuses card from [F42]) + generation parameter sliders (temperature, top_p, max_tokens, frequency_penalty with live value readout) + system prompt textarea (serif, per-story, writes to `Story.systemPrompt` via [V13] + [B2]).
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Settings.models.test.tsx`

- [x] **[F45]** Settings → Writing tab: toggles — Typewriter mode, Focus paragraph, Auto-save, Smart quotes, Em-dash expansion — plus Daily goal (words) number input. Persists via [B11].
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Settings.writing.test.tsx`

- [x] **[F46]** Settings → Appearance tab: 3-tile theme picker (Paper / Sepia / Dark with live swatch preview per README token overrides) · prose font select (Iowan Old Style / Palatino / Garamond / IBM Plex Serif) · prose size slider (14–24px) · line-height slider (1.3–2.0). Writes apply immediately via `data-theme` + CSS custom properties, persist via [B11]. Supersedes [F21] scope.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Settings.appearance.test.tsx`

- [x] **[F47]** Keyboard shortcuts hook `useKeyboardShortcuts`: `⌘/Ctrl+Enter` sends in chat composer, `⌥+Enter` triggers continue-writing from cursor, `Escape` dismisses selection bubble / inline AI card / closes open modal. Single document-level listener, scoped callbacks registered per-component.
  - verify: `cd frontend && npm run test:frontend -- --run tests/hooks/useKeyboardShortcuts.test.tsx`

- [x] **[F48]** Autosave per mockup: 4s idle debounce on editor changes (README §Persistence). Three states in top bar indicator: "Saving…" / "Saved · Ns ago" (relative time, updates every 5s) / "Save failed — retrying in Ns". **Supersedes [F9]'s 2s debounce** — when implementing F9, use 4s. Chapter body sent as `bodyJson` (TipTap JSON) to [B10].
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Autosave-mockup.test.tsx`

- [x] **[F49]** Shared transitions: backdrop fade-in 160ms ease-out; modal content translate-y 8→0 + scale .98→1 at 180ms `cubic-bezier(.2,.9,.3,1)`; popovers + selection bubble opacity 0 + translateY 4 → 1 at 140ms ease-out; thinking dots `think` keyframe 1s ease-in-out infinite with 0/.15/.3s stagger. Implement as shared CSS classes + a `Transition` wrapper component.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Animations.test.tsx`

- [x] **[F50]** Chat panel web-search toggle + `<MessageCitations />` — frontend half of `[V26]` (see [spec](docs/superpowers/specs/2026-04-23-v26-chat-citations-design.md)). Requires V26 to be shipped first. Two components: (1) Web-search checkbox in the chat composer (beneath the message input, next to the model picker). Wiring: when checked, the next `POST /api/chats/:chatId/messages` sends `enableWebSearch: true`; checkbox resets to unchecked after each send (per-turn, not session-wide) to prevent silently burning credits across a long conversation. Gated by `capabilities.supportsWebSearch` on the selected model (mirror `[F14]` pattern). UI hint text: "Web search — may increase response time + cost." (2) `<MessageCitations />` inline disclosure under each assistant message with a non-null `citationsJson`: a `Sources (N)` pill that expands to a card listing each citation's `title` (linked via `<a href={url} target="_blank" rel="noopener noreferrer">`), plain-text `snippet` (NEVER as HTML — this is third-party web content), and optional `publishedAt`. Hidden when `citationsJson` is null. Consumes the chat messages list from `GET /api/chats/:chatId/messages`. Must also parse the `event: citations` SSE frame during a live turn so the pill appears as soon as the frame arrives (before the content stream completes). Tests: pill hidden when null, pill count matches array length, expansion reveals all items, links open in new tab with `rel="noopener noreferrer"`, snippet rendered as plain text, toggle gated by `supportsWebSearch`, toggle resets between sends, live SSE `event: citations` frame is parsed and rendered before content completes.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/MessageCitations.test.tsx tests/components/ChatComposer.test.tsx`

### F — Page integration (mount mockup-fidelity components)

> F22–F50 shipped each component standalone with focused tests; the running app still renders the F1–F21 surfaces. F51–F58 wire the new components into `EditorPage` / `DashboardPage` so the user actually sees them. Each task is integration-only — no new component design.

- [x] **[F51]** Mount AppShell + TopBar + Sidebar in EditorPage. Replace the F7 three-pane layout with `<AppShell topbar sidebar editor chat />`. Top bar consumes `useStoryQuery(activeStoryId)` for breadcrumbs, autosave hook output for the save indicator, `useFocusToggle` for the Focus button, and routes UserMenu's `onOpenSettings` / `onOpenStoriesList` to F43 / F30 modal state. Sidebar renders `<ChapterList>` (existing F10) as `chaptersBody`, `<CastTab>` as `castBody`, `<OutlineTab>` as `outlineBody`. Story-picker header opens F30; the `+` button creates the active tab's entity (chapter / character / outline item). Active tab driven by `useSidebarTabStore`.
  - verify: `cd frontend && npm run test:frontend -- --run tests/pages/editor.test.tsx tests/pages/editor-shell.integration.test.tsx`

- [x] **[F52]** Replace `<Editor>` (F8) with `<FormatBar>` (F31) + `<Paper>` (F32) in EditorPage's editor slot. Paper consumes the active chapter from `useChapterQuery`; format bar binds to the same TipTap editor instance via `onReady`. Mount uses `formatBarExtensions` (StarterKit + Underline + Link + Highlight + AIContinuation + CharRef). FormatBar's "Find" callback opens an in-paper find UI placeholder (TODO) — Focus button still routes to `useFocusToggle`. Word count + status chip in Paper's sub-row come from chapter metadata. Existing F8 component may be deleted once no test references it.
  - verify: `cd frontend && npm run test:frontend -- --run tests/pages/editor.test.tsx tests/pages/editor-paper.integration.test.tsx`

- [x] **[F53]** Mount AI surfaces in the editor: `<SelectionBubble proseSelector=".paper-prose" onAction={...} />` at the page root, `<InlineAIResult editor={...} onRetry={...} />` below the paper, `<ContinueWriting editor={...} storyId chapterId modelId />` after the last paragraph (or wherever the cursor is at end-of-doc — pragmatic call: render at end of the paper region). Bubble's `'rewrite' | 'describe' | 'expand'` actions seed `useInlineAIResultStore` and call `useAICompletion().run` with the matching action; bubble's `'ask'` action calls `triggerAskAI(...)` (F41). Wire `onRetry` to re-run the last completion args.
  - verify: `cd frontend && npm run test:frontend -- --run tests/pages/editor-ai.integration.test.tsx`

- [x] **[F54]** Wire `<CharacterPopover>` (F37) to two anchors: (a) charRef mark hover via `useCharRefHoverDispatcher` (F36) — popover opens below the underlined word, with the 150ms anchor-leave / 200ms popover-leave grace window the F37 author deferred to the wirer; (b) Cast tab `onOpenCharacter` — popover anchored to the clicked avatar element. The character data comes from `useCharactersQuery(storyId)`. Edit footer button opens F19 character sheet modal (existing `<CharacterSheet>`); Consistency check stays hidden until [X8] ships.
  - verify: `cd frontend && npm run test:frontend -- --run tests/pages/character-popover.integration.test.tsx`

- [x] **[F55]** Mount the chat surfaces in the chat slot: `<ChatPanel messagesBody composer onOpenModelPicker onNewChat onOpenSettings />` with `<ChatMessages chatId chapterTitle attachedCharacterCount attachedTokenCount />` as messagesBody and `<ChatComposer onSend={...} />` as composer. Chat selection: derive the active chat for the active chapter via `useChatsQuery(chapterId)`; "New chat" creates a new chat via `POST /api/chapters/:id/chats`. Compose's `onSend` posts to `/api/chats/:chatId/messages` (with `enableWebSearch` from F50 + `attachment` from F41). Mount the F30 `<StoryPicker>`, F42 `<ModelPicker>`, and F43 `<Settings>` modals at the page root, opened via state flipped by the TopBar / Sidebar / ChatPanel callbacks. Replace F12 `<AIPanel>` use with this stack.
  - verify: `cd frontend && npm run test:frontend -- --run tests/pages/chat-panel.integration.test.tsx tests/pages/editor.test.tsx`

- [x] **[F56]** Replace the F9 `<AutosaveIndicator>` consumer in EditorPage with the F48 mockup version: thread `useAutosave`'s `{ status, savedAt, retryAt }` triple into the new indicator slot inside `<TopBar>` (or render it as a sibling of the breadcrumb meta group). Send chapter saves with `bodyJson` (TipTap JSON) per F48 spec — confirm the existing PATCH already routes through the F8 → Paper rewrite from F52. Delete F9's two-arg indicator API once no test references the old shape.
  - verify: `cd frontend && npm run test:frontend -- --run tests/pages/editor-autosave.integration.test.tsx tests/components/Autosave-mockup.test.tsx`

- [x] **[F57]** Migrate scattered `keydown` listeners to `useKeyboardShortcuts` (F47): replace the document-level `keydown` blocks in `<SelectionBubble>`, `<InlineAIResult>`, `<ContinueWriting>`, `<StoryPicker>`, `<ModelPicker>`, `<Settings>`, `<CharacterPopover>` with `useEscape` / `useAltEnter` / `useModEnter` registrations. Pick priorities so an open modal's Escape closes the modal first (priority 100), then popovers (50), then the selection bubble (10). Confirm Cmd/Ctrl+Enter still submits in `<ChatComposer>` — that one stays a textarea-local listener, not document-level. Delete each component's now-redundant raw listener block.
  - verify: `cd frontend && npm run test:frontend -- --run tests/hooks/useKeyboardShortcuts.test.tsx tests/components/SelectionBubble.test.tsx tests/components/InlineAIResult.test.tsx tests/components/StoryPicker.test.tsx tests/components/ModelPicker.test.tsx tests/components/Settings.shell-venice.test.tsx tests/components/CharacterPopover.test.tsx tests/components/ContinueWriting.test.tsx`

- [x] **[F58]** Refresh DashboardPage to the mockup: render the F30 `<StoryPicker>` content as the primary entry surface (open by default at `/`) instead of (or alongside) the F5 card grid. Selecting a story navigates to `/stories/:id`; New story still opens the F6 `<StoryModal>`. Apply the F49 `t-modal-in` keyframe to centred modal cards (Settings, StoryPicker, ModelPicker) — the F49 author flagged this as deferred because the keyframe's `translate(-50%, -50%)` conflicts with the existing `grid place-items-center` centring; refactor each modal's wrapper to centre via the keyframe-compatible transform so the entrance animation fires.
  - verify: `cd frontend && npm run test:frontend -- --run tests/pages/dashboard.test.tsx tests/components/StoryPicker.test.tsx`

### F — Core completion (gaps blocking a usable app)

> Surfaced by the 2026-04-25 prototype-vs-tasks audit. These are the items remaining before "core up and running" — auth-loop closure, editor-flow completeness, empty/edge states, and Settings cleanup. **Each task below requires a detailed implementation plan written before code starts** — dispatch `superpowers:writing-plans` (or run `/plan`) to produce one under `docs/superpowers/plans/<task-id>-<slug>.md`, get sign-off, then execute.
>
> Tasks tagged **[design-first]** also need a mockup committed to `mockups/frontend-prototype/design/` (or an addendum file) before the implementation plan is written, since the original prototype does not show the screen.
>
> X-series extras are deliberately deferred — these tasks restrict scope to what's needed for end-to-end usability.

- [x] **[F59]** **[design-first]** Recovery-code handoff at signup. `[AU9]` returns a one-time `recoveryCode` in the registration response; today the frontend discards it. Surface it as a dedicated full-screen interstitial (or modal) immediately after `useAuth().register()` resolves, with explicit "I have stored this — continue" gating. Copy-to-clipboard + download-as-`.txt` actions; warning that the code is shown ONCE; no nav until the user confirms. Persist nothing client-side — the code lives only in the user's possession from this point on. Required prerequisite for `[F60]`. Design must mock the interstitial first.
  - verify: `cd frontend && npm run test:frontend -- --run tests/pages/recovery-code-handoff.test.tsx`

- [x] **[F60]** **[design-first]** Forgot-password / reset-with-recovery-code flow. Backend `[AU16]` accepts `{ username, recoveryCode, newPassword }` and re-wraps the DEK. Add a "Forgot password?" link on the login screen that routes to `/reset-password`; the page collects username + recovery code + new password (with confirmation). On success, navigate to `/login` with a success toast. Surface clear failure copy for the recovery-code-mismatch case (DON'T leak whether the username exists). Mock the page first — no design exists in the prototype today.
  - verify: `cd frontend && npm run test:frontend -- --run tests/pages/reset-password.test.tsx`

- [x] **[F61]** **[design-first]** Account & privacy panel. The user-menu's "Account & privacy" entry currently opens nothing. Build a tabbed (or sectioned) view exposing: change password (`[AU15]`), rotate recovery code (`[AU17]` — show the new one with the same handoff UI as `[F59]`), sign out everywhere (revoke all refresh tokens — backend may need a `[B12]` follow-up if not yet shipped), and a placeholder for "delete account" (defer wiring to `[X3]`). Reuse the `[F43]` Settings modal shell pattern. Mock the layout before implementation.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/AccountPrivacy.test.tsx`

- [x] **[F62]** **[design-first]** charRef mark authoring path. `[F36]` ships the mark + popover but nothing applies it — no popovers ever fire because no marks exist. Spec the affordance (recommended starting point: `@`-trigger autocomplete from the active story's cast, with up/down keyboard nav + Enter to insert; alternative: "Mention character…" entry in the `[F33]` selection bubble alongside Rewrite/Describe/Expand/Ask AI). Decision must be in the design before implementation. Persists into `chapters.bodyJson` via `setCharRef({ characterId })` (already exists). Visual feedback while typing (filtering the list).
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/CharRefAuthoring.test.tsx`

- [ ] **[F63]** **[design-first]** Chat history pane content. `[F38]` mounts a History tab whose body is the placeholder string `"History — coming in a future task"`. Render the list of chats for the active chapter via `useChatsQuery(chapterId)` — each row showing title (or first user-message preview), relative timestamp, and message count. Click selects-and-loads the chat into the Chat tab. Define archive/pin/delete semantics in the design (recommended minimum: just delete + select; archive/pin punted). Decide what "New chat" does to the previous one.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/ChatHistory.test.tsx`

- [x] **[F64]** **[design-first]** Empty dashboard + editor empty-state hint strip. (1) DashboardPage with zero stories renders a single bare line today — design a hero with brand mark, copy ("Your stories live here"), and a primary "New story" CTA (which opens `[F6]` StoryModal). (2) Editor with an empty chapter renders no affordances; the prototype's `editor.jsx:95-108` shows a three-row hint strip ("select text → bubble", "hover names → card", "⌥↵ → continue"). Mock both before implementation.
  - verify: `cd frontend && npm run test:frontend -- --run tests/pages/dashboard-empty.test.tsx tests/components/EditorEmptyHints.test.tsx`

- [ ] **[F65]** Terminal-401 redirect to login. `[F3]`'s api client retries refresh once; when the refresh itself returns 401, the user is left on a broken page. Wire the existing `setUnauthorizedHandler(...)` (already in `frontend/src/lib/api.ts`) so a terminal failure clears `useSessionStore` and navigates to `/login`. Confirm `useInitAuth()` correctly handles a hard 401 on app boot. Add a small "Your session expired — please sign in again" toast/banner on the login page when redirected from a terminal 401. No design needed — uses existing toast/error patterns.
  - verify: `cd frontend && npm run test:frontend -- --run tests/lib/api-401-terminal.test.ts tests/pages/auth.test.tsx`

- [x] **[F66]** Resolve `[F45]` smart-quotes / em-dash drift. Decision: extend `[B11]` settings JSON with `writing.smartQuotes: boolean` and `writing.emDashExpansion: boolean`, drop the localStorage shim, and wire two TipTap input rules (curly quotes on `"`/`'`, em-dash on `--`) gated by the settings. OR delete the toggles outright. Plan must capture the decision + rationale. (Auto-save toggle stays in localStorage — that's a frontend behaviour with no backend semantics.)
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Settings.writing.test.tsx tests/components/EditorInputRules.test.tsx`

- [x] **[F67]** Resolve `[F43]` feature toggles + privacy toggles dead UI. Six "Features" toggles (Chat completions / Text continuation / Inline rewrite / Image generation / Character extraction / Embeddings) and two "Privacy" toggles (request logging, send-story-context) are no-ops. Decision: simplest path is to delete them — the operator already controls feature access via deployment config, and per-user feature-flagging adds significant backend surface for marginal benefit. Alternative: extend `[B11]` with a `features` + `privacy` block and gate AI calls client-side. Plan must record the decision; default to deletion unless we can articulate a concrete user need.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/Settings.shell-venice.test.tsx`

### F — Phase 4 (Storybook)

> Phase 4 of the design-system migration: stand up Storybook as the live design surface, author stories for the eight primitives + the design tokens, backfill stories for the twelve Phase-2 ports, and retire the parallel `mockups/frontend-prototype/` HTML universe. Full handoff doc: [docs/HANDOFF.md](docs/HANDOFF.md) § Phase 4. Visual-regression slot is already tracked as **[X24]**.

- [x] **[F68]** Install Storybook 9.x in the frontend workspace and wire the theme decorator. Run `cd frontend && npx storybook@latest init --type react-vite`, then **before committing** confirm the resolved version with `npm view storybook version` (HANDOFF.md notes SB9 vs SB8 differ in the `addon-essentials` bundle, the `@storybook/react-vite` renderer entry, and the `backgrounds` parameter API). Delete the wizard-generated `frontend/src/stories/` sample directory. Replace `.storybook/preview.tsx` verbatim with the snippet in [docs/HANDOFF.md](docs/HANDOFF.md) § "Wire tokens + themes" — that decorator imports `frontend/src/index.css` (so the theme tokens apply inside Storybook) and adds a paper/sepia/dark global toolbar that toggles `document.documentElement.dataset.theme`. Confirm the viewport addon is listed in `.storybook/main.ts` under `addons` (Storybook installs it by default in 9.x). No stories ship in this task — F69 / F70 / F71 add them; this task is pure infrastructure.
  - verify: `cd frontend && npm run build-storybook -- --quiet && [ -d storybook-static ]`

- [x] **[F69]** Author primitive stories for the seven non-Modal primitives in `frontend/src/design/` (`Button`, `IconButton`, `Field`, `Input`, `Textarea`, `Pill`, `Spinner`) — one sibling `*.stories.tsx` per primitive, single PR. Modal owns its own task ([F70]) because it needs a stateful demo wrapper. State matrix, Biome / `lint:design` interactions (folded in from the dropped reactive task), and per-task TDD steps in the plan.
  - plan: [docs/superpowers/plans/F69-storybook-primitive-stories.md](docs/superpowers/plans/F69-storybook-primitive-stories.md)
  - verify: `cd frontend && npm run build-storybook -- --quiet && npm run lint:design && npx biome ci src/design/`

- [x] **[F70]** Author `Modal.stories.tsx` with a stateful `ModalDemo` wrapper covering the five behavioural axes (size, dismissable, role, focus trap, `labelledBy`). Demo wrapper + per-story manual verification matrix in the plan.
  - plan: [docs/superpowers/plans/F70-storybook-modal-story.md](docs/superpowers/plans/F70-storybook-modal-story.md)
  - verify: `cd frontend && npm run build-storybook -- --quiet && npm run lint:design && npx biome ci src/design/Modal.stories.tsx`

- [x] **[F71]** Author `Tokens.stories.tsx` — colour / type / radius / shadow swatches with a runtime `useLayoutEffect` hex/font readout that auto-refreshes on theme flip. Replaces [docs/Design System Handoff.html](docs/Design%20System%20Handoff.html) § Tokens. Token audit step + full code in the plan.
  - plan: [docs/superpowers/plans/F71-storybook-tokens-story.md](docs/superpowers/plans/F71-storybook-tokens-story.md)
  - verify: `cd frontend && npm run build-storybook -- --quiet && npm run lint:design`

- [x] **[F72]** Add `Build Storybook` step to `.github/workflows/ci.yml`. Single new step: `- name: Build Storybook` running `npm --prefix frontend run build-storybook -- --quiet`. Slot it after the existing **Frontend build** step (around line 113) and before the **Test** section. Catches "story breaks because primitive prop renamed" before review. No further changes — visual regression is owned by [X24].
  - verify: `grep -q "build-storybook" .github/workflows/ci.yml`

- [x] **[F73]** Backfill stories for the twelve components actively ported in Phase 2 (PR #39 commit `93d58d9`) — eleven new `*.stories.tsx` files (EditorPage skipped), single PR. Bundles, per-component story matrix, `Editor` TipTap demo-wrapper special case, [X22] sequencing note in the plan.
  - plan: [docs/superpowers/plans/F73-storybook-component-backfill.md](docs/superpowers/plans/F73-storybook-component-backfill.md)
  - verify: `cd frontend && npm run build-storybook -- --quiet && npm run lint:design && for c in AutosaveIndicator BalanceDisplay UsageIndicator AIResult ChapterList CharacterList DarkModeToggle Editor Export CharacterSheet StoryModal; do test -f src/components/$c.stories.tsx || { echo "missing: $c.stories.tsx"; exit 1; }; done`

- [ ] **[F74]** Retire the parallel HTML universe — multi-PR destructive cleanup gated on hard prerequisites. PR-A rewrites `CLAUDE.md`'s "UI source of truth" rule + sweeps repo references; PR-B `git mv`s `mockups/frontend-prototype/` and `docs/Design System Handoff.html` into `mockups/archive/v1-2025-11/`; F75 updates the README. Prerequisites gate ([F68]–[F73] merged + [X24] green on main + ≥1 feature shipped via the new workflow), full PR scripts in the plan.
  - plan: [docs/superpowers/plans/F74-retire-html-mockups.md](docs/superpowers/plans/F74-retire-html-mockups.md)
  - verify: `! [ -d mockups/frontend-prototype ] && [ -d mockups/archive/v1-2025-11 ] && ! grep -rqE '(mockups/frontend-prototype|Design System Handoff)' CLAUDE.md docs/ .github/ README.md`

- [ ] **[F75]** Update repo `README.md` "Design system" / "Contributing" section to point at Storybook + the `lint:design` guard. Use the copy block from [docs/HANDOFF.md](docs/HANDOFF.md) § Step 4 verbatim, adjusted to the project's existing tone. Land in the same PR as F74's Step 3 (archive) for atomicity, OR as a follow-up — operator's call. No design needed.
  - verify: `grep -q -i 'storybook' README.md && grep -q 'lint:design' README.md`

---

## ☁️ I — DevOps & Infra

- [x] **[I1]** Multi-stage Dockerfile for backend: `builder` compiles TypeScript, `runner` runs as non-root user.
  - verify: `docker build -t story-editor-backend ./backend && docker inspect story-editor-backend | grep -q "User"`

- [x] **[I2]** Multi-stage Dockerfile for frontend: `builder` runs `npm run build`, `runner` serves dist on port 3000.
  - verify: `docker build -t story-editor-frontend ./frontend && docker run --rm -d -p 3001:3000 story-editor-frontend && sleep 3 && curl -sf http://localhost:3001 | grep -q "html" && docker stop $(docker ps -q --filter ancestor=story-editor-frontend)`

- [x] **[I3]** `docker-compose.yml` final: backend `depends_on` postgres with `condition: service_healthy`. `restart: unless-stopped` on all services. Postgres in named volume `pgdata`.
  - verify: `docker compose down -v && docker compose up -d && sleep 10 && curl -sf http://localhost:4000/api/health | grep '"status":"ok"'`

- [x] **[I4]** `docker-compose.override.yml` for local dev: hot reload mounts, all ports exposed, `NODE_ENV=development`.
  - verify: `docker compose -f docker-compose.yml -f docker-compose.override.yml config --quiet && echo "OVERRIDE OK"`

- [x] **[I5]** `scripts/backup-db.sh`: runs `pg_dump` inside the postgres container, saves timestamped `.sql.gz` to `./backups/`.
  - verify: `bash scripts/backup-db.sh && ls backups/*.sql.gz | head -1`

- [x] **[I6]** `SELF_HOSTING.md`: prerequisites, first-run steps, updating, backup/restore, port layout (frontend :3000, backend :4000), note that reverse proxy is expected upstream but not included.
  - verify: `test -f SELF_HOSTING.md && grep -q "docker compose up" SELF_HOSTING.md && grep -q "APP_ENCRYPTION_KEY" SELF_HOSTING.md`

- [x] **[I7]** BYOK env swap: remove `VENICE_API_KEY` from `.env.example` and supporting docs; add `APP_ENCRYPTION_KEY` (32-byte base64, documented with a generation one-liner in [I6]'s SELF_HOSTING.md). Backend startup fails fast with a clear message if `APP_ENCRYPTION_KEY` is missing or wrong length. Update [I6]'s `SELF_HOSTING.md` to reflect the BYOK model (each user enters their own key in Settings — operator does not need a Venice account).
  - verify: `grep -q "APP_ENCRYPTION_KEY" .env.example && ! grep -q "VENICE_API_KEY" .env.example && cd backend && npm run test:backend -- --run tests/boot/encryption-keys.test.ts`

- [x] **[I8]** Automated backup–restore drill: `scripts/backup-restore-drill.sh` exercises the full round trip — register a user, encrypt a chapter, dump the database, wipe + restore, log back in, and confirm the decrypted body matches the seeded sentinel. Re-uses the [I1] backend image and the existing dev postgres (isolated drill database, never touches the primary DB). Extends [I5]'s `backup-db.sh` with `--db` and `--out` flags. Operator-facing — also serves as the automated form of [E15]'s quarterly recovery drill.
  - verify: `bash scripts/backup-restore-drill.sh`

- [x] **[I9]** Same-origin `/api/` proxy on the frontend in both dev (Vite) and prod (nginx). Closes the gap from [I2]/[I3] where `frontend/nginx.conf` had no upstream rule and `frontend/vite.config.ts` had no dev proxy, so any UI request to `/api/...` (register, login, story CRUD, AI streaming) returned 404/500 against the live stack despite the backend being reachable on `:4000`. Same-origin keeps the refresh-cookie's `path=/api/auth` scope intact, avoids a CORS preflight on every request, and means `FRONTEND_URL` does not need to differ from the SPA host. Renames the dead `VITE_API_URL` build arg to `VITE_API_BASE_URL` so an operator-supplied override actually reaches `api.ts:resolveBaseUrl`. Default (empty) keeps origin-relative `/api`; setting it picks a different API host with the operator's CORS configuration.
  - verify: `docker compose up -d && bash scripts/i9-proxy-smoke.sh`

---

## 🧪 T — Testing

- [x] **[T1]** Auth route integration tests: register, duplicate email, login, wrong password, refresh, logout.
  - verify: `cd backend && npm run test:backend -- --run tests/auth/`

- [x] **[T2]** Stories route integration tests: CRUD, ownership enforcement, word count aggregation.
  - verify: `cd backend && npm run test:backend -- --run tests/routes/stories.test.ts tests/routes/story-detail.test.ts`

- [x] **[T3]** Chapters route integration tests: CRUD, reordering, word count on save.
  - verify: `cd backend && npm run test:backend -- --run tests/routes/chapters.test.ts tests/routes/chapters-reorder.test.ts`

- [x] **[T4]** Characters route integration tests: CRUD, story scoping, cascade delete.
  - verify: `cd backend && npm run test:backend -- --run tests/routes/characters.test.ts`

- [x] **[T5]** Prompt builder unit tests: all 5 action types, character context present, worldNotes present, `include_venice_system_prompt` reflects the caller-supplied `includeVeniceSystemPrompt` setting (default `true`) independent of action type, model, and `Story.systemPrompt`, truncation removes from top of chapterContent only, budget respects model context length.
  - verify: `cd backend && npm run test:backend -- --run tests/services/prompt.service.test.ts tests/services/prompt.actions.test.ts`

- [x] **[T6]** Venice AI service unit tests (mocked HTTP): correct payload, stream forwarded, reasoning model flag applied correctly, rate limit headers extracted, error codes mapped, no raw Venice errors leaked.
  - verify: `cd backend && npm run test:backend -- --run tests/ai/`

- [x] **[T7]** Frontend component tests: Editor, AIPanel, ModelSelector, UsageIndicator, CharacterSheet, WebSearchToggle.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/`

- [x] **[T8]** Playwright E2E (tier-2 PR-blocking smoke). Drives the live `make dev` stack through register → create story → BYOK Venice key save → add chapter → type into TipTap → trigger AI Continue → assert streamed mock response in the Continue-Writing region → assert the mock saw a chat-completion call. Venice is mocked in-process via `tests/e2e/fixtures/mock-venice.ts` (in-proc OpenAI-compatible HTTP server speaking SSE on `/v1/chat/completions` + `/v1/models`); the dockerised backend reaches it via `host.docker.internal` thanks to `extra_hosts: host-gateway` in the dev compose override. Per-user BYOK `endpoint` field steers the per-user OpenAI client at the mock without touching production code paths. Tier-3 (`tests/e2e-extended/` + cross-browser / soak runs) is intentionally NOT introduced here — add when first such case appears. Two assertions from the original blurb — "Saved ✓" autosave indicator and UsageIndicator delta — are tracked under [T8.1] (autosave never fires under the live stack inside the spec, suggesting a TanStack Query refetch races the local-draft useEffect in `EditorPage:215`; UsageIndicator only mounts inside `<AIPanel>`, which the Continue-Writing path doesn't surface).
  - verify: `docker compose up -d && npx playwright test tests/e2e/full-flow.spec.ts --reporter=line`

- [x] **[T8.1]** Restore the autosave + usage-indicator assertions to the [T8] full-flow spec. The first hypothesis (the `[activeChapterId, chapterQuery.data]` effect wiping `draftBodyJson` on a late-arriving query resolve) was confirmed and fixed — the seed effect now tracks the last-seeded chapter id via a ref so the seed is strictly idempotent per chapter; for chapters that load with `bodyJson === null` it seeds with the canonical empty TipTap doc so `useAutosave`'s baseline-skip logic doesn't swallow the user's first keystroke. Two further bugs surfaced once the chain unblocked: (a) `useAutosave`'s `mountedRef` was never reset to `true` on remount, so under React.StrictMode dev the first synthetic cleanup permanently disabled every scheduled save (every `if (!mountedRef.current) return;` guard fired); (b) the EditorPage autosave was POSTing `{ bodyJson, wordCount }` but the backend `UpdateChapterBody` is `.strict()` and recomputes `wordCount` server-side, so every PATCH was a 400. UsageIndicator was orphaned at F55 when `<AIPanel>` was unmounted — restored it inside `<ContinueWriting>` (which already exposes `completion.usage` via `useAICompletion`) and updated `tests/e2e/fixtures/mock-venice.ts` to send `x-ratelimit-remaining-{requests,tokens}` headers; the spec now asserts the rendered "4.2K requests / 988K tokens remaining" text after the AI completion finishes.
  - verify: `docker compose up -d && npx playwright test tests/e2e/full-flow.spec.ts --reporter=line`
  - verify: `docker compose up -d && npx playwright test tests/e2e/full-flow.spec.ts --reporter=line`

- [x] **[T9]** Full suite run — all tests pass before marking complete.
  - verify: `cd backend && npm run test:backend -- --run && cd ../frontend && npm run test:frontend -- --run && echo "ALL TESTS PASSED"`

---

## 💡 X — Extras (after core is complete)

- [ ] **[X1]** Word count goals per chapter with progress bar in chapter list.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/WordCountGoal.test.tsx`

- [ ] **[X2]** Focus mode: keyboard shortcut hides all UI chrome. Escape to exit.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/FocusMode.test.tsx`

- [ ] **[X3]** Remaining account-settings scope: (a) edit display name (no editor exists today — `User.name` is set once at register time to the username and cannot be changed; backend has no `PATCH /api/users/me` for name/username); (b) actually wire delete-account with cascade (F61 ships the disabled placeholder button referencing this task). Change-password / rotate-recovery / sign-out-everywhere already shipped under [F61]/[B12]/[AU15]/[AU17] and are NOT in this task's scope.
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

<!-- [X10] Migration-handling revisit — retired (completed in situ, not reopening). All the
     legacy branches this task was reserving room for (pre-[E3] lazy-wrap, bcrypt verify
     branch + needsRehash, optional sessionId, readEncrypted plaintext fallback,
     message.repo JSON-parse fallback) have been deleted. bcryptjs + @types/bcryptjs
     dropped from deps. If the app is ever deployed against pre-existing data in future,
     reintroduce only the specific branch needed for that actual population, with a
     dated TODO for its removal. -->

- [ ] **[X11]** (optional) Reconsider whether `/api/ai/complete` should keep `enable_web_search` on at all. Context: V7 wired web-search opt-in (`enableWebSearch?: boolean` on the `/api/ai/complete` body). V26 scoped citations to the chat panel only, so on the inline-AI surface users currently pay Venice web-search cost with zero user-visible benefit — citations are dropped silently. Decide one of: (a) turn web search OFF across all inline AI actions (simplest, removes the wasted spend); (b) keep it ON as a silent fact-grounding nudge for accuracy (tolerable but undocumented); (c) extend V26's delivery to inline AI (requires a new F-design for a sources UI on the inline card — the selection bubble / inline AI card has no mockup for this today). Write the decision + rationale into `docs/venice-integration.md` § Web Search. If (a), also remove `enableWebSearch` from `ai.routes.ts` body schema + update `docs/api-contract.md` § `/api/ai/complete`. If (c), spawn a follow-up F-task and a follow-up V-task.
  - verify: (design decision — no automated verify)

- [x] **[X12]** Coordinated React 19 bump (frontend). Dependabot split the upgrade into PRs #11 (`react-dom + @types/react-dom → 19`) and #16 (`react + @types/react → 19`); each fails independently because the `@types/react` / `@types/react-dom` peer constraint forces them to move together. Close both dependabot PRs and do one manual bump of all four: `react`, `react-dom`, `@types/react`, `@types/react-dom` to `^19`. Then: (1) run the full frontend test suite, (2) smoke the app in the browser — focus on StrictMode double-effect behaviour, the TipTap editor, the selection bubble, the DnD sortable list, and the TanStack Query cache — React 19 tightens StrictMode in a way that can surface previously-masked effect bugs. No app code should need changing for 18→19 in our surface; if it does, the migration doc at https://react.dev/blog/2024/04/25/react-19-upgrade-guide is the reference.
  - verify: `cd frontend && npm run build && npx tsc -b && npm test`

- [x] **[X13]** Coordinated Prisma 7 bump (backend). Dependabot split the upgrade into PRs #12 (`@prisma/client → 7`) and #15 (`prisma → 7`); both need to move together and each exposes real breaking changes in Prisma 6→7: (a) `PrismaClient` no longer exported from the root `@prisma/client` entry (moved to a subpath or requires an explicit `output` directive in `schema.prisma`); (b) `$transaction` callback's `tx` parameter is now untyped (`implicit any`) unless the generator config is updated; (c) several query-result shapes tightened. Close #12 (dependabot hadn't opened a matching `prisma` CLI bump in that PR). Do one manual bump of both `prisma` and `@prisma/client` to `^7`, regenerate the client, fix every import/type break. Run the full backend suite + E12 leak test to confirm no silent data-shape drift.
  - verify: `cd backend && npm run build && npx tsc --noEmit && npm test`

- [x] **[X14]** OpenAI SDK v6 bump (`openai 4 → 6`). PR #17 fails on the `Headers → SdkHeaders` rename — tip of a major SDK rewrite. Blast radius is contained: our only ingress is `backend/src/lib/venice.ts` (the `getVeniceClient` factory), with types leaking into `backend/src/services/ai.service.ts` and the AI routes. Scope: port `createVeniceClient` to the v6 client shape, re-validate the custom `fetch` override + `maxRetries: 0` behaviour, update SSE streaming call-sites if the stream iterator API changed, refresh all `openai`-typed signatures in ai.service + related services. Re-run the `venice:probe` CLI and the L-series live tests against a capped Venice key to confirm real-wire compatibility.
  - verify: `cd backend && npm run build && npx tsc --noEmit && npm test && npm run venice:probe`

- [x] **[X15]** Clear `act(...)` warnings from the frontend test suite. CI currently emits a stream of `Warning: An update to <Component> inside a test was not wrapped in act(...)` (spotted on `LoginPage` via an indirect render, likely through the router / auth-gate redirect, and probably elsewhere). Not a correctness bug today — suites pass — but (a) the noise hides real regressions in new warnings, and (b) React 19 (see X12) makes unawaited state updates more likely to flake or error under its stricter scheduler, so these should be cleaned before that bump lands. Fix pattern: replace sync `fireEvent` / `getBy…` immediately after state-changing events with `await userEvent.click(...)` / `await screen.findBy…` / `await waitFor(() => ...)`. Sweep every `*.test.tsx` file; run the full frontend suite with `--reporter=verbose` and assert zero `act(` warnings in stderr.
  - verify: `cd frontend && npm test 2>&1 | tee /tmp/vitest-out.log && ! grep -q 'wrapped in act' /tmp/vitest-out.log`

- [ ] **[X16]** Resolve `pg@8` `client.query() when the client is already executing a query` DeprecationWarning surfaced under the X13 Prisma 7 + `@prisma/adapter-pg` migration. Backend `npm test` and `npm run venice:probe` now emit `(node:NNNN) DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0` once per process. Source is the adapter shim — `node-postgres` is reusing a single `Client` for overlapping queries inside a Prisma `$transaction` callback. Three resolution paths in priority order: (1) wait for `@prisma/adapter-pg` to ship a release that switches to `pg.Pool`-per-statement (track https://github.com/prisma/prisma/issues — search `adapter-pg DeprecationWarning`); (2) bump to `pg@^9` if Prisma's adapter declares it as a peer; (3) if neither lands within ~6 weeks, file an upstream issue with a minimal repro and add a `process.removeAllListeners('warning')` filter scoped to that exact code (NOT a blanket suppress). Do not introduce a global silencer of node warnings in tests — masks future real deprecations.
  - verify: `cd backend && npm test 2>&1 | tee /tmp/backend-test.log && ! grep -q 'client.query() when the client is already executing' /tmp/backend-test.log`

- [ ] **[X17]** Find / Replace UI in the editor. Wire `<FormatBar>`'s `onToggleFind` callback to a small inline find bar inside `<Paper>` that highlights matches, supports next/previous, and optionally Replace. Decision (capture in plan): inline strip vs floating popover. Match the prototype's mockup if one is added; otherwise design-first. F52 ships the FormatBar Find button as `disabled` with a `title="Find — coming in [X17]"` tooltip; X17 lifts the disabled state and wires the actual feature.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/EditorFind.test.tsx`

- [ ] **[X18]** Display name in the registration flow. Today `frontend/src/components/AuthForm.tsx` collects only `username` + `password`; `frontend/src/hooks/useAuth.ts:register()` defaults the backend-required `name` to the username so the schema's `nameSchema` (min 1) passes. Add a third `Display name` field to the register variant of `<AuthForm>` (login variant unchanged), validate min 1 / max 80 client-side to mirror `nameSchema`, and pass it through `register({ name, username, password })`. Update `Credentials` (or split into `LoginCredentials` / `RegisterCredentials`) so the type captures the register-only field. Sweep the existing register tests to assert `name` is sent in the body. Pairs with [X3]'s display-name editor — together they let users set + later edit a name distinct from the login handle.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/AuthForm.test.tsx tests/hooks/useAuth.test.tsx tests/pages/recovery-code-handoff.test.tsx`

- [ ] **[X20]** Finish the [X15] act-warning sweep — it was ticked but a verbose run still emits **60** `An update to <Component> inside a test was not wrapped in act(...)` lines across **9** files: `AppShell.test.tsx`, `ChatComposer.test.tsx`, `ChatPanel.test.tsx`, `InlineAIResult.test.tsx`, `ModelPicker.test.tsx`, `SelectionBubble.test.tsx`, `Settings.appearance.test.tsx`, `Settings.models.test.tsx`, `Sidebar.test.tsx`. Two distinct root causes seen so far: (a) TanStack Query settle-after-test — the `useUserSettingsQuery` resolution fires `setSizeDraft` / `setTweaks` / etc. inside seed `useEffect`s after the test's last `await` returns (`SettingsAppearanceTab.tsx:208,252,276`); fix per-test by `await waitFor(() => expect(...).toBe(...))` on a settings-derived element, or by adding a settle-helper to `tests/setup.ts` and calling it after every render; (b) Zustand `setState` from outside React combined with `useLayoutEffect`-driven re-positioning (`SelectionBubble.tsx:157`); some tests already wrap `setState` in `act()` but the chained re-render still leaks. The X15 fix pattern (`await userEvent.click` / `await screen.findBy…` / `await waitFor`) is correct — apply consistently. Verify with the exact command in [X15] (`--reporter=verbose`, asserting zero `not wrapped in act` lines).
  - verify: `cd frontend && bash -c 'npm run test:frontend -- --run --reporter=verbose 2>&1 | grep -c "not wrapped in act"' | tee /tmp/act-count && [ "$(cat /tmp/act-count)" = "0" ]`

- [x] **[X19]** Migrate backend to **Express 5** (`express ^4.21.x → ^5.x`). Dependabot PR #30 fails because Express 5 swapped its router to `path-to-regexp@8`, which removed two pieces of legacy syntax we use today: (1) optional path params written as `:foo?` (e.g. `/api/stories/:storyId?` and similar in `auth.routes.ts` / `chat.routes.ts` / others) — must become explicit dual route registrations or use the new named-group form per the path-to-regexp@8 docs; (2) bare wildcard `*` (e.g. the rate-limit binding `/api/ai/*` in `backend/src/middleware/security.ts`) — must become `/api/ai/{*splat}` (or `*path`). Other Express 5 changes to verify: `req.body` is now `undefined` (not `{}`) when no body parser ran — confirm no handler reads `req.body.x` without first checking; async error propagation now works without `next(err)` in awaited handlers, but our global error handler in `backend/src/middleware/error.ts` should still catch — leave as-is; `res.redirect('back')` removed (we don't use it; grep to confirm). Steps: (a) sweep every route file for `?` optional params and `*` wildcards (`grep -RnE "['\"][^'\"]*[:*?][^'\"]*['\"]" backend/src/routes backend/src/middleware`); (b) bump `express`, `@types/express` (already on 5), `express-rate-limit` (verify peer); (c) re-run `npm run test:backend` — expect failures only in `tests/middleware/security.test.ts` and any route test exercising optional params, then fix in code, not in tests; (d) confirm helmet + cookie-parser + cors middleware ordering still works (Express 5 keeps the same `(req, res, next)` signature). Coordinate with `security-reviewer` because middleware bootstrap is in scope.
  - verify: `cd backend && npm run test:backend`

- [ ] **[X21]** Track upstream Prisma fix for `@hono/node-server` advisory **GHSA-92pp-h63x-v22m** (path-traversal in `serveStatic` via repeated slashes). Pulled in transitively as `prisma → @prisma/dev → @hono/node-server@<1.19.13`. `@prisma/dev` is the package powering `prisma studio` / `prisma dev` — it's a dev-only surface and is not loaded by `@prisma/client` at runtime, so production hosts (which only run `prisma migrate deploy`) are not exposed. The Prisma maintainers ship bundled-dep bumps in patch releases; periodically re-run `cd backend && npm audit` and bump `prisma` / `@prisma/client` / `@prisma/adapter-pg` together when a clean version is available. Don't take `npm audit fix --force` — its proposed fix is `prisma@6.19.3`, a major-version downgrade. Close this when the audit advisory disappears without a downgrade, or when the underlying advisory is withdrawn.
  - verify: `cd backend && bash -c 'npm audit --omit=dev --json 2>/dev/null | jq ".vulnerabilities | to_entries | map(select(.value.via[] | type==\"object\" and .source==1107173)) | length"' | tee /tmp/x21-count && [ "$(cat /tmp/x21-count)" = "0" ]`

- [ ] **[X22]** Refactor the remaining four hand-rolled modal components onto the `<Modal>` primitive shipped in [frontend/src/design/primitives.tsx](frontend/src/design/primitives.tsx). PR #39's design-system migration converted `CharacterSheet` and `StoryModal` to the primitive but left four built-in-place dialogs because they would have ballooned the PR: `AccountPrivacyModal.tsx`, `Settings.tsx` (the settings shell — multi-tab modal), `StoryPicker.tsx`, `ModelPicker.tsx`. Each currently renders its own backdrop + container + close-on-Escape / click-outside / focus-trap logic. Port them to `<Modal>` + `<ModalHeader>` / `<ModalBody>` / `<ModalFooter>`, lifting any non-standard behaviour (Settings' tab strip, StoryPicker's footer actions, ModelPicker's filter input) into the body slot. Each port should delete the local backdrop literal and rely on `bg-backdrop` from the primitive. Settings is the largest — consider whether its multi-tab layout warrants a `<ModalTabbed>` variant of the primitive rather than open-coding the tab strip inside `<ModalBody>`; if so, design it once and reuse. Watch for regressions in: Escape-to-close, click-outside-to-close (where each modal currently chooses), focus return on close, and theme parity across paper/sepia/dark.
  - verify: `cd frontend && npm run test:frontend -- --run tests/components/AccountPrivacyModal.test.tsx tests/components/Settings.test.tsx tests/components/StoryPicker.test.tsx tests/components/ModelPicker.test.tsx && npm run lint:design`

- [ ] **[X23]** Add a `--success` design token to the system and retire the one-off allowlisted green pill in [frontend/src/components/Settings.tsx:418](frontend/src/components/Settings.tsx#L418). Today that line carries `/* lint:design-allow — one-off success-pill green; no --success token in the system yet. */` because it's the only place in the app rendering a success state. Define `--color-success` (and an optional `--color-success-soft` background pair) in [frontend/src/index.css](frontend/src/index.css) `@theme` block with values that hold up across paper / sepia / dark themes (the dark theme variant matters most — pick a green that doesn't vibrate against the dark surface). Map a Tailwind utility (`bg-success`, `text-success`, `border-success`) by virtue of the `@theme` `--color-*` mapping. Replace the allowlisted line and remove the marker comment. Audit other components for ad-hoc green usages that should also adopt the token (grep for `green-` and `emerald-` — design-lint should already flag these but worth a manual pass for arbitrary-value escapes). Pairs naturally with adding `--color-warning` / `--color-danger` if other tasks need them, but don't pre-emptively add unused tokens.
  - verify: `cd frontend && npm run lint:design && grep -nE 'lint:design-allow' frontend/src/components/Settings.tsx | tee /tmp/x23-allowlist && [ ! -s /tmp/x23-allowlist ]`

- [ ] **[X24]** Phase 4 visual-regression slot — Playwright theme-sweep over design-system primitives + ported components (Option B from [docs/HANDOFF.md](docs/HANDOFF.md) § "Visual regression"). PR #39 deferred this in favour of vitest token-class assertions; the visual regression risk is non-zero because TipTap re-themes, modal backdrops, and focus-ring behaviour can drift silently when tokens change. The Phase 4 review (2026-04-30) committed to Option B because Playwright is already wired (`@playwright/test ^1.49.1` at the root, [playwright.config.ts](playwright.config.ts), specs under [tests/e2e/](tests/e2e/)) — Option A (`@storybook/test-runner`) was explicitly rejected to avoid duplicate baseline infrastructure. Add Playwright spec(s) under [tests/e2e/](tests/e2e/) that, for each theme, open the four primitive-using modals (`CharacterSheet`, `StoryModal`, plus the X22 ports once landed) and the editor surface, then `expect(page).toHaveScreenshot()` each. Wire the theme switch via `data-theme` on `<html>` (the same mechanism the Settings → Appearance tab uses). Snapshots live under `tests/e2e/__screenshots__/` and are platform-pinned (Playwright will refuse cross-OS diffs by default — pin to Linux to match CI). The first run baselines; subsequent runs fail on diff. Decide whether to gate this in CI or run it locally on demand — three themes × ~6 surfaces × OS-pinned baselines is fragile in shared CI, so a developer-run `npm run test:e2e:visual` script may be the better default until the design stabilises.
  - verify: `cd frontend && npm run test:e2e -- --grep @visual`
