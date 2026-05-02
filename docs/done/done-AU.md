> Source of truth: `TASKS.md`. Closed [AU]-series tasks archived here on 2026-05-02 to keep `TASKS.md` lean.
> These entries are immutable; any reopen lands as a new task in `TASKS.md`.

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
