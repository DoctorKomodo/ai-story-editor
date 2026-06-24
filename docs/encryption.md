# Encryption at Rest

Design of record for Inkwell's narrative-content encryption. Referenced by every task in the E-series and by [AU9]/[AU10]/[AU15]/[AU16]/[AU17]. If a future task disagrees with this document, update this document first — don't just change the code.

Related files:
- [docs/data-model.md](./data-model.md) — schema; this doc describes what gets encrypted and how.
- [backend/src/services/argon2.config.ts](../backend/src/services/argon2.config.ts) — single source of truth for argon2id parameters.
- [backend/src/services/content-crypto.service.ts](../backend/src/services/content-crypto.service.ts) — DEK lifecycle (lands in [E3]); also the encrypt/decrypt site for the BYOK Venice key (via `encryptWithDek` / `decryptWithDek`).
- [backend/src/services/venice-key.service.ts](../backend/src/services/venice-key.service.ts) — the single load + decrypt / validate + encrypt site for the BYOK Venice key.

---

## Goals

1. A stolen database dump, on its own, reveals **only** structural metadata (order indices, word counts, timestamps, foreign-key ids, user IDs, status flags, genre, target word count). No narrative content, no BYOK Venice keys.
2. A stolen database dump **plus** an env/`.env` file leak reveals **nothing more than the dump alone** — there is no server-held encryption key that wraps Venice keys or content. The env no longer contains an encryption secret that would unlock stored keys.
3. Narrative content is disclosed only if an attacker additionally compromises the user's **password** (via phishing, keylogger, credential reuse, client-side malware) **or** their one-time **recovery code**. Without one of those two user-held secrets, the server cannot decrypt the user's **content or their stored BYOK Venice key** — **by design, even for the operator running the box**.
4. The BYOK Venice key is now wrapped by the **per-user content DEK** (same envelope as narrative content), so losing a server-side env secret no longer loses Venice keys. Losing both the password and the recovery code for a user loses that user's narrative content **and** their stored Venice key, permanently. These are accepted trade-offs, not bugs.

## Non-goals

- **Database-side full-text search over narrative content.** Ciphertext is opaque to Postgres; FTS over titles/bodies would require in-application search or a dedicated encrypted-search scheme. Neither is in scope.
- **Server-initiated access to content** (scheduled jobs, admin tooling, background indexers, export-on-behalf-of-user flows that run while the user is offline). The DEK is not available to the server outside of a live authenticated session.
- **Plausible deniability, forward secrecy of the content itself, or multi-device key sync.** We target the DB-dump / env-leak threat, not a nation-state adversary with an implant on the running host.

---

## DEK provenance

Every user has a **content DEK**: 32 random bytes from `crypto.randomBytes(32)`, generated once at signup ([AU9] → [E3]). The DEK is the only key that actually encrypts narrative content.

The DEK is **never stored plaintext** anywhere — not on disk, not in env, not in the session cookie (which carries only an opaque session id), not in logs. It exists plaintext only inside the backend process memory during the lifetime of an authenticated session (see "Session lifecycle" below).

The DEK is stored wrapped **twice** on the `User` row. Each wrap is an independent AES-256-GCM encryption of the DEK under a different argon2id-derived key:

| Wrap | Derivation | Purpose | When used |
|---|---|---|---|
| **Password wrap** (password-derived) | `argon2id(password, contentDekPasswordSalt, ARGON2_PARAMS) → 32-byte key` | Everyday unwrap during login | `POST /api/auth/login` |
| **Recovery wrap** (recovery-code-derived) | `argon2id(recoveryCode, contentDekRecoverySalt, ARGON2_PARAMS) → 32-byte key` | Disaster recovery when the password is lost | `POST /api/auth/reset-password` |

Both wraps protect the **same 32-byte DEK**. The salts are independent — compromise of one does not accelerate attack on the other. The wraps themselves are stored as `{Ciphertext, Iv, AuthTag, Salt}` quadruples on `User`:

```
contentDekPasswordEnc      base64  — AES-GCM ciphertext of the DEK
contentDekPasswordIv       base64  — 12-byte IV for the password wrap
contentDekPasswordAuthTag  base64  — 16-byte GCM tag for the password wrap
contentDekPasswordSalt     base64  — 16-byte salt used to derive the password-wrap key

contentDekRecoveryEnc      base64  — AES-GCM ciphertext of the DEK
contentDekRecoveryIv       base64  — 12-byte IV for the recovery wrap
contentDekRecoveryAuthTag  base64  — 16-byte GCM tag for the recovery wrap
contentDekRecoverySalt     base64  — 16-byte salt used to derive the recovery-wrap key
```

**There is no third wrap, and no `contentDekEnc` column that would be wrapped by a server-held KEK.** There is no server-held encryption key for content. This is the main property that distinguishes "DB dump + env leak" from "DB dump + user credential compromise" in the threat table.

**The BYOK Venice key** (`User.veniceApiKey*` columns) is also wrapped by the per-user content DEK — specifically via `content-crypto.service.ts`'s `encryptWithDek` / `decryptWithDek` in `venice-key.service.ts`. It is therefore protected by exactly the same envelope as narrative content: a DB dump alone cannot reveal it; the attacker also needs the user's password or recovery code. A server-side env leak reveals nothing about stored Venice keys.

---

## argon2id parameters

Single source of truth: [backend/src/services/argon2.config.ts](../backend/src/services/argon2.config.ts) ([AU14]). The same parameters are used for:

1. Password hashing on the `User.passwordHash` column ([AU14]).
2. Password-wrap key derivation for the DEK ([E3]).
3. Recovery-wrap key derivation for the DEK ([E3]).

| Parameter | Value | Source |
|---|---|---|
| `type` | `argon2id` | OWASP Password Storage Cheat Sheet 2024, top pick |
| `memoryCost` (m) | 19,456 KiB (~19 MiB) | OWASP 2024 baseline |
| `timeCost` (t) | 2 | OWASP 2024 baseline |
| `parallelism` (p) | 1 | OWASP 2024 baseline |
| Salt length | 16 bytes | `DEK_WRAP_SALT_BYTES` in `argon2.config.ts`. Password-hash path uses argon2's built-in salt. |
| Output length (wrap key) | 32 bytes | AES-256 key size |

**Drift detection:** on successful login, `argon2.needsRehash(hash, ARGON2_PARAMS)` is evaluated and the password hash is silently rewritten if parameters have moved since the stored hash was produced ([AU14]). This does not touch the DEK wraps — **raising argon2id parameters for wrap-key derivation requires an [AU17]-style rewrap** (rotate-recovery-code path) or a password-change to produce a new wrap at the new parameters. Parameter drift in wrap-key derivation is therefore a deliberate choice, not an automatic operation.

**Peppering:** parameters do not include a server-held pepper. A pepper would undermine goal (3) — it would let the app host decrypt any user's DEK given only the password wrap + the salt from a DB dump, collapsing two threat-model rows into one. If a pepper is added in the future, the threat model below needs to be revised.

---

## Recovery code

Generated exactly once per user at signup ([AU9] → [E3]) and returned in the `POST /api/auth/register` response as a one-time `recoveryCode` field. **Never stored server-side in any form except the argon2id-derived wrap of the DEK.** The plaintext code is never persisted, logged, or re-displayed.

| Property | Value |
|---|---|
| Entropy | ≥128 bits (we target 160 bits — 10 groups of 16 bits each) |
| Encoding | base32 Crockford, grouped `XXXX-XXXX-XXXX-...` for readability. BIP-39-style wordlist is an acceptable alternative; the format choice is documented in the response schema. |
| Checksum | Last group is a CRC-16 of the preceding bits so typos are caught client-side before hitting the reset endpoint. Not a security property — just UX. |
| Lifetime | Valid until rotated via [AU17]. No expiry. |
| Normalisation before use | Uppercase, strip hyphens/whitespace, then argon2id with `contentDekRecoverySalt`. |

**UX contract** (frontend responsibility, enforced by [AU9] API shape):
- The signup flow must display the recovery code prominently with a "save this now — it will not be shown again" warning before allowing the user to leave the screen.
- The UI offers "copy to clipboard" and "download as .txt". No server-side "email it to me" — by design, the server does not retain the plaintext code.
- A follow-up screen asks the user to re-enter the code to confirm they've stored it, before creating their first story.

### Rotating the recovery code

Handled by `POST /api/auth/rotate-recovery-code` ([AU17]). The user must be authenticated and must supply their current password. The endpoint unwraps the DEK with the password, generates a fresh recovery code, re-wraps the DEK under the new code's argon2id-derived key, and writes new `contentDekRecoveryEnc/Iv/AuthTag/Salt` in a single transaction. The new code is returned exactly once; the old code is invalid the instant the transaction commits.

An admin-triggerable variant lives in `backend/prisma/scripts/force-recovery-rotation.ts` ([E14]) for the case where a user reports their code has leaked and they can't reach the UI to rotate it themselves.

### Admin-forced recovery-wrap invalidation ([E14])

The admin has neither the user's password nor the old recovery code, so they cannot unwrap the DEK and therefore cannot mint a replacement wrap directly. The only safe primitive available server-side is **invalidation**: NULL the four `contentDekRecovery*` columns on `User`.

- **Invoked by:** the operator, at the CLI — `ts-node backend/prisma/scripts/force-recovery-rotation.ts --username <name> [--dry-run]`. The script normalises the username the same way [AU9] does (trim + lowercase), looks the user up, and issues a single transactional `UPDATE` setting the four recovery columns to `null`. Logs only the action taken, the normalised username, and the user id — never wrap values, DEK material, password hashes, or narrative content.
- **What it changes:** the four `contentDekRecovery*` columns on `User` (~60 bytes of ciphertext + salt metadata).
- **What it does NOT change:** the password wrap, the password hash, the user's in-memory sessions, or any narrative ciphertext. The user stays logged in wherever they already are.
- **User recovery path post-invalidation:** the user logs in with their password (unchanged), then calls `POST /api/auth/rotate-recovery-code` ([AU17]) while authenticated. That endpoint unwraps the DEK with the password and mints a fresh recovery code, repopulating the four columns atomically. Until they do this, the account has no working recovery code and password-reset-via-recovery-code ([AU16]) cannot succeed (at present it surfaces as a generic internal error rather than a clean 4xx — the operator should tell the user to log in and rotate via AU17 rather than attempt password reset).

---

## Session lifecycle and DEK survival

The DEK must be unwrapped from the password at login, but the password is not available on subsequent requests. The DEK therefore has to survive across requests somewhere. **Chosen approach: an in-memory session store keyed by an opaque session id, carried to the browser in an opaque httpOnly cookie.** Sessions are **never persisted** — there is no `Session` table, no token signing, and no signing secret. The cookie value *is* the opaque `sessionId`; it carries no claims or payload. This is the OWASP-recommended session pattern (Session Management Cheat Sheet): a high-entropy, server-side session id in an httpOnly cookie.

> **Historical note.** An earlier design (the original "Option B" as first shipped) fronted this same in-memory store with a signed 15-minute access JWT plus a 7-day refresh JWT persisted in a `RefreshToken` table. Both `JWT_SECRET` and `REFRESH_TOKEN_SECRET` were belt-and-suspenders over a lookup the app already performs every request (the DEK fetch), so the JWT/refresh layer and the `Session`/`RefreshToken` tables were removed — see `docs/superpowers/specs/2026-06-16-cookie-session-auth-design.md`. The boot validator (`backend/src/boot/env-validation.ts`) now warns if either retired secret lingers in `.env`.

Rejected alternatives (still relevant — they explain why the DEK only ever lives in process memory):
- **Re-prompt per request** — DX disaster, not considered.
- **Carrying DEK material in the credential** (e.g. a session key + a DEK wrapped by it, stored in the cookie or an `Authorization` header) — rejected because it places the material required to derive the DEK on the wire on every request. A reverse proxy, APM, WAF, or access-log misconfiguration that captures the credential then permanently leaks the DEK. The chosen design ensures the DEK only ever exists inside the backend process memory.
- **Persisted-session-wrapped DEK + server-held KEK** — rejected because reintroducing a server-held content KEK violates goal (3). It would let the app host decrypt any user's content whenever it holds a persisted session row, which is functionally "the server can decrypt while the user is logged out" — the exact property we're trying to avoid.

### Mechanism

1. **Login** (`auth.service.ts` `login()`):
   1. `verifyPassword` succeeds.
   2. `unwrapDekWithPassword(user, password)` produces a 32-byte DEK.
   3. A 32-byte random `sessionId` is generated (`crypto.randomBytes(32).toString('hex')` — 256 bits, well above OWASP's 128-bit floor).
   4. `openSession({ sessionId, userId, dek, createdAt: new Date(now), expiresAt: new Date(now + IDLE_TTL_MS) })` stores the entry in the in-process `Map` (`backend/src/services/session-store.ts`). **No DB row is written; no token is signed.**
   5. The route sets an opaque httpOnly cookie whose value is the raw `sessionId` (`sessionCookieName()` → `__Host-session` in production / `session` in dev; `sessionCookieOptions()` → `HttpOnly`, `Secure` in prod, `SameSite=Lax`, `Path=/`, `Max-Age = ABSOLUTE_TTL_MS` (see the TTLs table below — the server-side idle window is 7 days; the browser cookie Max-Age and the server session expiry are tracked independently). The DEK and its wrapped forms are **never** sent to the browser.

2. **Request** (any route via `requireAuth` in `auth.middleware.ts`):
   1. Middleware reads the `sessionId` from the cookie (`req.cookies[sessionCookieName()]`) — there is no signature to verify.
   2. `getSession(sessionId)` looks it up in the in-process map.
   3. If hit: the DEK is attached to the request-scoped `WeakMap` that `content-crypto.service` consumes (`attachDekToRequest`). Putting it on `req.user.dek` is **forbidden** — the `WeakMap` is the only channel, so the DEK is GC-eligible the instant the request finishes. `req.user` carries only `{ id, sessionId }`.
   4. If the cookie is absent: 401 with `{ error: { code: 'unauthorized', message: 'Unauthorized' } }`.
   5. If the cookie is present but no live session matches (process restarted, evicted, expired, or revoked): 401 with `{ error: { code: 'session_expired', message: 'Session expired' } }`. The frontend treats this distinctly (shows a "please sign in again" banner) and redirects to `/login`.

3. **Idle slide + absolute cap**: every authenticated request slides the idle expiry to `now + IDLE_TTL_MS` via `extendSessionExpiry`, which **clamps** to `createdAt + ABSOLUTE_TTL_MS` — a session can never live past 30 days from login regardless of activity. The middleware re-issues the cookie (with a refreshed `Max-Age`) **only** when the cookie is within ~24h of expiring (`COOKIE_REFRESH_THRESHOLD_MS`), to avoid a `Set-Cookie` on every response — including SSE streams. The cookie is set **before** `next()` so it precedes any streamed body.

4. **Logout**: `POST /api/auth/logout` calls `closeSession(sessionId)` to drop the in-memory entry and clears the cookie (via the same `sessionCookieName()` / options resolver). There is no DB delete — there is no row to delete. A lost cookie cannot be replayed once its entry is gone.

5. **Process restart**: the in-memory map is empty. All previously-authenticated users hit the miss branch (`session_expired`) and are forced to re-enter their password. This is an accepted trade-off of the scheme — it matches the goal that the server cannot decrypt content outside of a live session. Documented in `SELF_HOSTING.md` ([E15]): "After a deploy, active users must sign in again."

### TTLs

`backend/src/services/session-store.ts` defines two windows:

| Constant | Value | Role |
|---|---|---|
| `IDLE_TTL_MS` | 7 days | Sliding idle timeout — bumped on every authenticated request. |
| `ABSOLUTE_TTL_MS` | 30 days | Hard cap from `createdAt`; the idle slide is clamped to it, so even a continuously-active session lapses (and re-derives the DEK via a fresh login) after 30 days. |

Both are additionally bounded by process uptime (a restart wipes the store). OWASP requires both an idle *and* an absolute timeout; this satisfies both.

### Horizontal scaling

The in-memory map is single-process by design (the DEK lives in one process's memory). Horizontally scaling the backend would require either **sticky sessions** (the load balancer pins each `sessionId` to a replica) or a **shared session store** (e.g. Redis) — a separate change, out of scope here. For the self-hosted single-container deployment target there is only one process, so neither is needed.

### Eviction

The map runs a sweeper every 60 seconds (`SWEEP_INTERVAL_MS`) that deletes entries past `expiresAt`. A size cap (`MAX_SESSIONS`, default 10,000, overridable via the `SESSION_STORE_MAX` env var) prevents an attacker who can churn logins from exhausting memory: on `openSession` at the cap the store sweeps expired entries first, then force-evicts the least-recently-accessed *live* entry (and `console.warn`s, so the operator sees cap pressure rather than silent forced-logouts). The per-IP `/login` rate limiter is the primary defense against this pressure. Neither the DEK nor the session id is recoverable once evicted — re-login is the only path back.

### Why no `Session` table

Sessions are authoritative **only** in process memory; nothing about a session is written to Postgres. A DB dump therefore contains no session material at all — the previous design's persisted-refresh-token exposure is gone structurally. The cost is that all session authority — including the explicit "sign out everywhere" path (`closeSessionsForUser`, used on password change) — lives only in process memory and is wiped on restart, by design.

---

## Three operations that touch the wraps

### 1. Password change ([AU15]) — user knows current password

Preconditions: authenticated, supplies `{ oldPassword, newPassword }`.

1. Verify `oldPassword` against `User.passwordHash`.
2. Unwrap the DEK using `oldPassword` and `contentDekPasswordSalt` → DEK Buffer.
3. Hash `newPassword` → new `passwordHash`.
4. Re-wrap the **same DEK** under a key derived from `newPassword` with a **fresh** `contentDekPasswordSalt`.
5. In one transaction: write new `passwordHash`, new `contentDekPasswordEnc/Iv/AuthTag/Salt`.
6. Evict the user's in-memory sessions via `closeSessionsForUser(userId)`, **then** mint a fresh session for the caller (`openSession`) and re-set their cookie. Order is load-bearing: evict-all-then-open keeps the caller logged in (with a new `sessionId`) while forcing every *other* device through `/login`. Opening before evicting would let `closeSessionsForUser` nuke the just-minted session.
7. Return 204.

Columns on `User` that change: `passwordHash`, `contentDekPasswordEnc`, `contentDekPasswordIv`, `contentDekPasswordAuthTag`, `contentDekPasswordSalt`. **The recovery wrap is untouched.** **No narrative ciphertext is touched** — the DEK bytes are the same.

### 2. Password reset ([AU16]) — user has forgotten current password but still has recovery code

Preconditions: unauthenticated, supplies `{ username, recoveryCode, newPassword }`.

1. Look up user by lowercased username.
2. Unwrap the DEK using `recoveryCode` and `contentDekRecoverySalt` → DEK Buffer (throws `InvalidRecoveryCodeError` otherwise).
3. Hash `newPassword` → new `passwordHash`.
4. Re-wrap the DEK under the new password with a fresh `contentDekPasswordSalt`.
5. In one transaction: write new `passwordHash`, new `contentDekPasswordEnc/Iv/AuthTag/Salt`. Then evict the user's in-memory sessions via `closeSessionsForUser(userId)` — this path is unauthenticated, so it mints no replacement session; the user logs in afresh with the new password.
6. Return 204.

Columns on `User` that change: `passwordHash`, all four `contentDekPassword*` columns. **The recovery wrap is untouched** — the same recovery code still works. (If the user wants a new recovery code after reset, they log in and call [AU17].) **No narrative ciphertext is touched.**

Timing-equalisation and rate-limiting ([AU10]-style): run a dummy argon2id against a fixed junk salt when the user doesn't exist, so "unknown user" and "wrong recovery code" look identical. Per-IP + per-username rate limiting because this is an unauthenticated endpoint that lets an attacker with the recovery code take over an account.

### 3. Rotate recovery code ([AU17]) — user wants a fresh recovery code

Preconditions: authenticated, supplies `{ password }`.

1. Verify `password` against `User.passwordHash`.
2. Unwrap the DEK using `password` and `contentDekPasswordSalt` → DEK Buffer.
3. Generate a fresh recovery code (see "Recovery code" section).
4. Re-wrap the DEK under the new recovery code with a fresh `contentDekRecoverySalt`.
5. In one transaction: write new `contentDekRecoveryEnc/Iv/AuthTag/Salt`.
6. Return `{ recoveryCode }` exactly once with a "save this now" warning in the envelope.

Columns on `User` that change: all four `contentDekRecovery*` columns. **The password wrap is untouched; the user's in-memory sessions are untouched** (the user is mid-session and stays logged in). **No narrative ciphertext is touched.**

---

## What's encrypted vs. plaintext

### Encrypted (ciphertext triples `{Ciphertext, Iv, AuthTag}`)

| Model | Encrypted columns | Task |
|---|---|---|
| `Story` | `title`, `synopsis`, `worldNotes` | [E4] |
| `Chapter` | `title`, `body` (serialised TipTap JSON tree) | [E5] |
| `Character` | `name`, `role`, `appearance`, `voice`, `arc`, `age`, `personality`, `backstory`, `notes`, `physicalDescription` | [E6] |
| `OutlineItem` | `title`, `sub` | [E7] |
| `Chat` | `title` | [E8] |
| `Message` | `contentJson`, `attachmentJson` | [E8] |

### Plaintext (structural / UI-only / non-sensitive)

| Model | Plaintext columns | Why |
|---|---|---|
| `Story` | `id`, `userId`, `genre`, `targetWords`, `createdAt`, `updatedAt` | Dashboard sort + filter; target word count fuels progress UI. |
| `Chapter` | `id`, `storyId`, `orderIndex`, `status`, `wordCount`, `createdAt`, `updatedAt` | Ordering, sidebar progress footer (`42,318 / 90,000 words · 47%`) — `wordCount` is computed from the TipTap tree at save time, before encryption. |
| `Character` | `id`, `storyId`, `color`, `initial`, `createdAt`, `updatedAt` | UI-only hints (avatar colour + letter). |
| `OutlineItem` | `id`, `storyId`, `order`, `status`, `createdAt`, `updatedAt` | Ordering + status column. |
| `Chat` | `id`, `chapterId`, `createdAt`, `updatedAt` | FK + timeline ordering. |
| `Message` | `id`, `chatId`, `role`, `model`, `tokens`, `latencyMs`, `createdAt` | Chat header meta row + regeneration flows. |
| `User` | `id`, `username`, `email`, `name`, `passwordHash`, `settingsJson`, `veniceEndpoint`, the four `veniceApiKey*` BYOK columns, the eight `contentDek*` wrap columns, timestamps | See above — no narrative content here. `settingsJson` holds theme/font/etc. UI prefs only; it must never carry free-text story content. |

There are no session/token tables: sessions live only in process memory (see "Session lifecycle and DEK survival"), so nothing about a session is ever written to Postgres.

`User.name` is deliberately plaintext: it's an identity field, not narrative content, and is returned by `/api/auth/me` and the login response without needing an unwrapped DEK. Displaying the user's name on the top bar must not depend on the content DEK.

### Never persisted

- The plaintext DEK (only in-memory, in the session map + request-scoped `WeakMap`).
- The plaintext password (verified then discarded; may exist briefly in `req.body` which the Express runtime recycles).
- The plaintext recovery code (returned exactly once at signup / rotation, then discarded).
- The plaintext BYOK Venice API key (only in-memory inside `getVeniceClient(userId)` ([V17]), for the duration of a single Venice request).

These must never appear in logs, error objects, telemetry, crash dumps, or HTTP responses to anyone (including the owning user, except for the recovery code at the two moments it's generated and the Venice key's last-4 on `GET /api/users/me/venice-key`).

---

## Threat model

"Reveals X" means the attacker can produce plaintext X given the stated input. "Does not reveal X" means the attacker cannot produce plaintext X without at least one more input from another row / column.

| Attacker has... | Structural metadata | BYOK Venice keys | Narrative content | Login as user | Rotate user's recovery code |
|---|---|---|---|---|---|
| DB dump only | ✅ revealed | ❌ (wrapped by the per-user DEK — same envelope as narrative content) | ❌ (wrapped by password + recovery code) | ❌ (argon2id hash resistance) | ❌ |
| DB dump + env/`.env` leak (no server encryption key exists) | ✅ revealed | ❌ (no server key wraps Venice keys — env leak adds nothing) | ❌ (no server KEK over content — same as DB dump alone) | ❌ | ❌ |
| DB dump + user's **password** (phishing etc.) | ✅ revealed | ✅ **revealed** (Venice key is under the per-user DEK, unwrapped via the password wrap) | ✅ **revealed** (unwrap password wrap) | ✅ | ✅ |
| DB dump + user's **recovery code** | ✅ revealed | ✅ **revealed** (Venice key is under the per-user DEK, unwrapped via the recovery wrap) | ✅ **revealed** (unwrap recovery wrap) | ❌ directly, but ✅ indirectly (call `POST /api/auth/reset-password` to set a new password) | ❌ (reset-password doesn't rotate the recovery wrap) |
| DB dump + user's password + user's recovery code | ✅ revealed | ✅ revealed | ✅ revealed | ✅ | ✅ |
| **Live process memory** of the running backend (RCE, coredump, debugger) while user is logged in | ✅ revealed | ✅ revealed (if the user makes an AI call in that window — plaintext key lives in a single request) | ✅ revealed (DEK sits in the session map) | ✅ (read a live `sessionId` straight from the in-memory session map and replay it as a cookie) | ✅ |
| Network sniff of the reverse-proxy → backend hop (if that hop is plaintext HTTP) | Via request bodies over time — leaks narrative content being sent in PATCHes, not just metadata | ❌ directly; ✅ when user uploads key via `PUT /api/users/me/venice-key` | ✅ via request/response bodies; but the DEK itself **does not cross the wire** | ✅ (capture the session cookie off the wire and replay it) | ✅ (capture a `POST /api/auth/rotate-recovery-code` body) |
| **Stolen session cookie** (host malware reading the cookie jar, or a sniffed cookie on a misconfigured plain-HTTP prod — which the design forbids) | ❌ not directly (cookie is just an opaque id) | ✅ indirectly (act as the user; trigger an AI call) | ✅ indirectly (act as the user via the live session, whose DEK is in memory) | ✅ (replay the cookie until its idle/absolute window lapses or the process restarts) | ❌ (`POST /api/auth/rotate-recovery-code` re-verifies the password, which the cookie does not carry) |

Key cells worth calling out:

- **"DB dump + env leak" does not reveal the BYOK Venice key or narrative content.** There is no server-held encryption key. The env leak row is now equivalent to the DB-dump-alone row — adding the env to the attacker's haul adds nothing. This is a stronger guarantee than the previous design (where `APP_ENCRYPTION_KEY` in env revealed all stored Venice keys).
- **"DB dump + user's password" now reveals the Venice key** — because the Venice key is now wrapped by the same per-user DEK as narrative content. This is a deliberate trade-off: the Venice key's protection now matches narrative content's protection exactly. Previously, a password alone was not enough to recover the Venice key (you also needed `APP_ENCRYPTION_KEY`).
- **Live process memory compromise reveals everything.** The DEK of every currently-logged-in user sits in the session map, alongside every live `sessionId` (which can be replayed as a cookie). This is the "anyone with root on the box" ceiling. We don't try to defend below it — the user experience is "the operator can see your stuff *while you're using it*, but not when you're logged out, and not from a backup."
- **A stolen session cookie is the credential.** The cookie value is an opaque, server-side session id — it carries no claims and there is no signing secret to forge, so the *only* way to act as a user is to obtain a cookie that maps to a live in-memory session. The mitigations are: `HttpOnly` (an XSS cannot read it), `Secure` in production (via the `__Host-session` prefix — the browser only returns it over HTTPS), `SameSite=Lax` plus the global default-deny Origin/Referer CSRF check (a cross-site page cannot ride it), and the 7-day-idle / 30-day-absolute TTLs plus process-uptime bound, which cap how long a stolen cookie stays valid. Logout (`closeSession`) and "sign out everywhere" (`closeSessionsForUser`) revoke it immediately in-process.
- **Reverse-proxy → backend plaintext hop leaks narrative content via request bodies** regardless of at-rest scheme, because the frontend is sending plaintext to the backend (`PATCH /api/chapters/:id` with a TipTap JSON body). At-rest encryption doesn't help here; operators must terminate TLS as close to the backend as possible. The DEK itself never traverses the wire, even under this attack. Documented in `SELF_HOSTING.md`.

### What `APP_ENCRYPTION_KEY` actually wraps — Removed

`APP_ENCRYPTION_KEY` no longer exists. It was removed in [story-editor-nst]. The BYOK Venice key (`User.veniceApiKey*` columns) is now wrapped by the **per-user content DEK** via `content-crypto.service.ts` (`encryptWithDek` / `decryptWithDek`), the same envelope that protects narrative content. There is no server-held encryption key.

### What happens when the user loses the password

Recovery code still works → `POST /api/auth/reset-password` sets a new password. Narrative content preserved.

### What happens when the user loses the recovery code

Password still works → the user should log in and call `POST /api/auth/rotate-recovery-code` ([AU17]) to generate a fresh one. Narrative content preserved.

### What happens when the user loses both

**Narrative content for that user is irrecoverable — and so is their stored BYOK Venice key.** Both are protected by the same per-user DEK; the server has no decryption path for either. This is documented prominently in the signup flow UX and in `SELF_HOSTING.md` ([E15]). Users are strongly advised to store the recovery code out-of-band (printed, password manager, offline USB).

---

## Trade-offs accepted

| Trade-off | Why we accept it |
|---|---|
| **No database-side full-text search on narrative content.** | Encrypted columns are opaque to Postgres. In-application search (decrypt on demand, filter in memory) is feasible for a single user's stories but won't scale to cross-user operator search. Not in scope. |
| **No server-initiated background decrypt** (scheduled export, admin tooling, server-generated AI summaries for logged-out users). | The DEK is only available during a live session. Adding "offline decrypt" requires the Revisit path below (new third wrap). |
| **Deploy = active users must re-authenticate.** | The session-DEK cache is in-process and doesn't survive a restart. Matches the core property that the DEK is never persisted. Documented in `SELF_HOSTING.md`. |
| **Horizontal scale requires sticky sessions or a shared store.** | The session-DEK cache is per-process. A multi-replica deploy either pins each session to a replica (sticky sessions) or moves the store out of process (e.g. Redis) — a separate change. Single-container self-hosted is the target; not a problem in practice. |
| **Users must store a recovery code out-of-band.** | It's the only way for them to recover from a lost password under a scheme where the server can't decrypt offline. We surface this in UX, but losing both password and recovery code loses the data. |
| **Raising argon2id parameters doesn't retroactively strengthen existing DEK wraps.** | `argon2.needsRehash` rewrites password hashes on next login, but the wrap-key salts are separate and aren't rederived on login. Users who want stronger wrap-key params under new settings must change their password or rotate their recovery code. |

---

## Revisit

If the following requirements appear, this design needs to be revisited — don't silently bolt them on:

### 1. Offline / background decrypt

**Requirement shape:** a scheduled job, admin tool, export queue, or server-generated feature needs to read a user's plaintext content when that user is not currently logged in.

**Why the current design blocks it:** the DEK is unwrappable only from the password or recovery code, neither of which the server has when the user is logged out.

**Migration path:**
1. Introduce a new server-held env key (e.g. `APP_OFFLINE_KEY` — do **not** reuse the retired `APP_ENCRYPTION_KEY` name). Add a third wrap column group on `User`: `contentDekServerEnc/Iv/AuthTag` — AES-GCM ciphertext of the DEK wrapped by a key derived from `APP_OFFLINE_KEY`.
2. For every existing user: on their next login, the server holds a plaintext DEK — it rewraps under the server key and writes the third wrap, atomically. Users who never log back in keep only password + recovery wraps (no regression).
3. Update the threat-model table: a new "DB dump + `APP_OFFLINE_KEY` (env leak)" row **now reveals narrative content**. This is the cost.
4. Document the new capability and its trade-off in this file; update `SELF_HOSTING.md`.

This is a schema migration, not a rotation. It cannot be applied without user consent (effectively): the only way to avoid silently weakening the threat model for existing users is to make the third-wrap column nullable and only populate it for users who opt in or who log in after the change. Decide the default before rolling.

### 2. Stronger argon2id parameters

If OWASP raises the baseline (or we choose to), update [argon2.config.ts](../backend/src/services/argon2.config.ts). Password hashes upgrade automatically via `needsRehash` on next login. **DEK wraps do not** — users must either change password ([AU15]) or rotate recovery code ([AU17]) to produce a new wrap at the new parameters. Document the drift and surface a "security upgrade available" nudge in Settings if we care enough.

### 3. Peppered argon2id

A server-held pepper would give a DB-dump attacker a harder time, but — as noted in the parameters section — it collapses the "DB + env leak" threat-model row into the "DB + env leak + password" row. That's a substantive change to the guarantees. Don't add one without updating this document and communicating the new property to users.

### 4. Multi-device key sync / shared-story collaboration

These are out of scope. Shared-story collaboration in particular would require either a shared DEK (every collaborator can decrypt anything) or per-resource keys with an access-control layer. Neither fits inside the current wrap model; it's a redesign rather than an extension.

### 5. Hardware-backed key material (HSM, Secure Enclave, TPM)

Outside the self-hosted single-container target. If we add a managed-hosting tier and re-introduce a server-held encryption key (see Revisit #1), that key is a natural candidate to move behind an HSM, at which point the threat-model rows involving an env leak of that key soften considerably.

---

## Migration handling

The auth and crypto scheme was finalized before the app reached real users, so no user ever had a pre-[E3] / pre-[AU14] data shape and the auth and crypto services carry **no** branches to handle one. (This covers the *historical* auth/crypto legacy only — the app is now at/near release with real rows, so *forward* schema changes must preserve and migrate existing data; see `docs/agent-rules/repo-boundary.md` and CLAUDE.md "When to Stop and Ask".) [AU15] (`changePassword`) and [AU16] (`resetPassword`) assume every user has fully-populated password + recovery wrap columns — no lazy-wrap generation, no null-column fallback. The small set of speculative legacy branches that had been tolerated under [X10] (`login()`'s lazy wrap, `verifyPassword`'s bcrypt branch + `needsRehash` upgrade, optional `sessionId` on tokens, `_narrative.ts` plaintext fallback, `message.repo`'s JSON-parse try/catch) was removed in situ — `bcryptjs` is no longer a dependency, the optional-`sessionId` branch on the old access tokens is gone (those tokens were themselves retired in the 2026-06-16 cutover — see the change log), and the only DEK wraps a user can ever have are the ones generated at signup. When a future feature needs to deal with data predating a schema change, write the migration against the concrete state of the DB at that moment — don't scaffold migration branches speculatively, and scope any such branch to a dated TODO for removal once the rollout window closes.

## Change log

- **2026-04-22** — Initial document. Option B (server-side session + in-memory DEK cache) chosen. [E1].
- **2026-04-22** — Noted pre-deployment migration-handling posture: no scaffolded migration branches in AU15/AU16; [X10] tracks revisiting other speculative migration paths.
- **2026-04-24** — [X10] retired: every speculative legacy branch deleted (bcrypt verify path, needsRehash upgrade, login lazy-wrap, optional sessionId, `_narrative.ts` plaintext fallback, `message.repo` JSON-parse fallback). `bcryptjs` + `@types/bcryptjs` dropped from deps. sessionId is now required on all tokens.
- **2026-06-15** — [story-editor-nst] `APP_ENCRYPTION_KEY` retired. The BYOK Venice key is now encrypted under the **per-user content DEK** (via `content-crypto.service.ts` `encryptWithDek`/`decryptWithDek` in `venice-key.service.ts`). `crypto.service.ts` (the AES-256-GCM primitive keyed by `APP_ENCRYPTION_KEY`) is deleted. There is no longer a server-held encryption env secret. Goals updated: Goal 2 now reflects that env leak adds nothing beyond the DB dump alone; Goal 4 updated to reflect that losing both password and recovery code now also loses the Venice key. Threat model table updated accordingly — "DB dump + password" and "DB dump + recovery code" rows now show Venice keys as ✅ recoverable with the same credential that recovers narrative content.
- **2026-06-16** — Cookie-session auth cutover (`docs/superpowers/specs/2026-06-16-cookie-session-auth-design.md`). The signed-JWT access token + persisted-refresh-token layer was retired: `JWT_SECRET` and `REFRESH_TOKEN_SECRET` are gone (boot validator warns if they linger), the `Session` and `RefreshToken` tables are dropped, and `POST /api/auth/refresh` is removed. The opaque `sessionId` carried in an httpOnly cookie (`__Host-session` in prod / `session` in dev) is now the sole credential, resolved against the in-memory session store (`getSession`). Session lifetime is a 7-day sliding idle TTL clamped to a 30-day absolute cap; logout/eviction is in-memory only (`closeSession` / `closeSessionsForUser`). CSRF is `SameSite=Lax` + a global default-deny Origin/Referer check. Session-transport and threat-model sections rewritten accordingly; the DEK-envelope design is unchanged.
