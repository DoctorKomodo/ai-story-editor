# Encryption at Rest

Design of record for Inkwell's narrative-content encryption. Referenced by every task in the E-series and by [AU9]/[AU10]/[AU15]/[AU16]/[AU17]. If a future task disagrees with this document, update this document first — don't just change the code.

Related files:
- [docs/data-model.md](./data-model.md) — schema; this doc describes what gets encrypted and how.
- [backend/src/services/argon2.config.ts](../backend/src/services/argon2.config.ts) — single source of truth for argon2id parameters.
- [backend/src/services/crypto.service.ts](../backend/src/services/crypto.service.ts) — AES-256-GCM primitive.
- [backend/src/services/content-crypto.service.ts](../backend/src/services/content-crypto.service.ts) — DEK lifecycle (lands in [E3]).

---

## Goals

1. A stolen database dump, on its own, reveals **only** structural metadata (order indices, word counts, timestamps, foreign-key ids, user IDs, status flags, genre, target word count). No narrative content, no BYOK Venice keys.
2. A stolen database **plus** the application host's `APP_ENCRYPTION_KEY` reveals stored BYOK Venice keys but **not** narrative content. Content DEKs are not recoverable from server state alone.
3. Narrative content is disclosed only if an attacker additionally compromises the user's **password** (via phishing, keylogger, credential reuse, client-side malware) **or** their one-time **recovery code**. Without one of those two user-held secrets, the server cannot decrypt the user's content — **by design, even for the operator running the box**.
4. Losing `APP_ENCRYPTION_KEY` loses all stored Venice keys. Losing both the password and the recovery code for a user loses that user's narrative content, permanently. These are accepted trade-offs, not bugs.

## Non-goals

- **Database-side full-text search over narrative content.** Ciphertext is opaque to Postgres; FTS over titles/bodies would require in-application search or a dedicated encrypted-search scheme. Neither is in scope.
- **Server-initiated access to content** (scheduled jobs, admin tooling, background indexers, export-on-behalf-of-user flows that run while the user is offline). The DEK is not available to the server outside of a live authenticated session.
- **Plausible deniability, forward secrecy of the content itself, or multi-device key sync.** We target the DB-dump / env-leak threat, not a nation-state adversary with an implant on the running host.

---

## DEK provenance

Every user has a **content DEK**: 32 random bytes from `crypto.randomBytes(32)`, generated once at signup ([AU9] → [E3]). The DEK is the only key that actually encrypts narrative content.

The DEK is **never stored plaintext** anywhere — not on disk, not in env, not in the JWT, not in logs. It exists plaintext only inside the backend process memory during the lifetime of an authenticated session (see "Session lifecycle" below).

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

**There is no third wrap, and no `contentDekEnc` column that would be wrapped by a server-held KEK.** The app host holds `APP_ENCRYPTION_KEY`, but that key protects **BYOK Venice API keys only** ([AU11]–[AU13]). It has no authority over content. This is the main property that distinguishes "DB dump + env leak" from "DB dump + env leak + user credential compromise" in the threat table.

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
- **What it does NOT change:** the password wrap, the password hash, sessions, refresh tokens, or any narrative ciphertext. The user stays logged in wherever they already are.
- **User recovery path post-invalidation:** the user logs in with their password (unchanged), then calls `POST /api/auth/rotate-recovery-code` ([AU17]) while authenticated. That endpoint unwraps the DEK with the password and mints a fresh recovery code, repopulating the four columns atomically. Until they do this, the account has no working recovery code and password-reset-via-recovery-code ([AU16]) will refuse.

---

## Session lifecycle and DEK survival

The DEK must be unwrapped from the password at login, but the password is not available on subsequent requests (only the JWT is). The DEK therefore has to survive across requests somewhere. **Chosen approach: server-side session table + in-memory DEK cache (referred to as "Option B" during design).**

Rejected alternatives:
- **Re-prompt per request** — DX disaster, not considered.
- **JWT-wrapped session key + DEK-wrapped-by-session-key in the token** — rejected because it places the material required to derive the DEK (`sk` + `dekWrappedBySk`) in the `Authorization` header on every request. A reverse proxy, APM, WAF, or access-log misconfiguration that captures the header then permanently leaks the DEK. The chosen design ensures the DEK only ever exists inside the backend process memory.
- **Refresh-token-wrapped DEK + server-held KEK** — rejected because reintroducing a server-held content KEK violates goal (3). It would let the app host decrypt any user's content whenever it holds a DB row with a live refresh token, which is functionally "the server can decrypt while the user is logged out" — the exact property we're trying to avoid.

### Mechanism

1. **Login** ([AU10] → extended in [E3]):
   1. `verifyPassword` succeeds.
   2. `unwrapDekWithPassword(userId, password)` produces a 32-byte DEK.
   3. A 32-byte random `sessionId` is generated.
   4. A row is written to the `Session` table: `{ sessionId, userId, expiresAt }` (expiry matches the refresh-token expiry — 7 days).
   5. The DEK is stored in an in-process `Map<sessionId, { dek: Buffer, expiresAt: Date }>`.
   6. The access token's JWT payload carries `{ sub: userId, username, sessionId, type: 'access' }`. The DEK and its wrapped forms are **not** in the token.

2. **Request** (any route via auth middleware):
   1. Middleware verifies the JWT (`HS256` pin).
   2. Middleware reads `sessionId` from the payload, looks it up in the in-process map.
   3. If hit: the DEK is attached to the request-scoped `WeakMap` that `content-crypto.service` consumes. Attached to `req.user.dek` is **forbidden** — the `WeakMap` is the only channel, so the DEK is GC-eligible the instant the request finishes.
   4. If miss: 401 with `{ error: { code: 'session_expired', message: 'Please sign in again.' } }`. The frontend treats this like a refresh-token expiry and redirects to `/login`.

3. **Logout**: `POST /api/auth/logout` deletes both the refresh-token row and the `Session` row, and removes the map entry. The access token continues to verify cryptographically until its 15-minute TTL elapses, but any request it makes will miss the session map and 401.

4. **Refresh rotation** ([AU4]): when a refresh token is exchanged for a new access token, the existing session entry is kept (same `sessionId`). The `Session.expiresAt` is extended to match the new refresh-token expiry.

5. **Process restart**: the in-memory map is empty. All previously-authenticated users hit the miss branch and are forced to re-enter their password. This is an accepted trade-off of the scheme — it matches the goal that the server cannot decrypt content outside of a live session. Documented in `SELF_HOSTING.md` ([E15]): "After a deploy, active users must sign in again."

### Horizontal scaling

The in-memory map is single-process. Horizontally scaling the backend requires either:
- **Sticky sessions** (load-balancer pins each `sessionId` to a backend replica), or
- A redesign to "Option C" (stateless JWT-wrapped session key), with the reverse-proxy-leak trade-off explicitly accepted.

For the self-hosted single-container deployment target, sticky sessions are unnecessary — there is only one process.

### Eviction

The map runs a sweeper every 60 seconds that deletes entries past `expiresAt`. A size cap (default 10,000 sessions) prevents an attacker who can churn logins from exhausting memory; beyond the cap, the oldest entries are dropped LRU-style, forcing those users to re-authenticate. Neither the DEK nor the session-id is recoverable once evicted — re-login is the only path back.

### Schema addition ([E3])

```prisma
model Session {
  id         String   @id @default(cuid())
  userId     String
  expiresAt  DateTime
  createdAt  DateTime @default(now())

  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([expiresAt])
}
```

The DEK is **not** stored on the `Session` row. The row only binds a session id to a user and enforces expiry; the in-memory map holds the key material.

---

## Three operations that touch the wraps

### 1. Password change ([AU15]) — user knows current password

Preconditions: authenticated, supplies `{ oldPassword, newPassword }`.

1. Verify `oldPassword` against `User.passwordHash`.
2. Unwrap the DEK using `oldPassword` and `contentDekPasswordSalt` → DEK Buffer.
3. Hash `newPassword` → new `passwordHash`.
4. Re-wrap the **same DEK** under a key derived from `newPassword` with a **fresh** `contentDekPasswordSalt`.
5. In one transaction: write new `passwordHash`, new `contentDekPasswordEnc/Iv/AuthTag/Salt`, delete all the user's refresh tokens and sessions.
6. Return 204.

Columns on `User` that change: `passwordHash`, `contentDekPasswordEnc`, `contentDekPasswordIv`, `contentDekPasswordAuthTag`, `contentDekPasswordSalt`. **The recovery wrap is untouched.** **No narrative ciphertext is touched** — the DEK bytes are the same.

### 2. Password reset ([AU16]) — user has forgotten current password but still has recovery code

Preconditions: unauthenticated, supplies `{ username, recoveryCode, newPassword }`.

1. Look up user by lowercased username.
2. Unwrap the DEK using `recoveryCode` and `contentDekRecoverySalt` → DEK Buffer (throws `InvalidRecoveryCodeError` otherwise).
3. Hash `newPassword` → new `passwordHash`.
4. Re-wrap the DEK under the new password with a fresh `contentDekPasswordSalt`.
5. In one transaction: write new `passwordHash`, new `contentDekPasswordEnc/Iv/AuthTag/Salt`, delete all refresh tokens and sessions.
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

Columns on `User` that change: all four `contentDekRecovery*` columns. **The password wrap is untouched; refresh tokens and sessions are untouched** (the user is mid-session). **No narrative ciphertext is touched.**

---

## What's encrypted vs. plaintext

### Encrypted (ciphertext triples `{Ciphertext, Iv, AuthTag}`)

| Model | Encrypted columns | Task |
|---|---|---|
| `Story` | `title`, `synopsis`, `worldNotes`, `systemPrompt` | [E4] |
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
| `RefreshToken` | everything | No narrative content. |
| `Session` | everything | No narrative content. |

`User.name` is deliberately plaintext: it's an identity field, not narrative content, and needs to be readable by the session lookup middleware without an unwrapped DEK. Displaying the user's name on the top bar after a cold process restart (pre-login) would otherwise be impossible.

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
| DB dump only | ✅ revealed | ❌ (wrapped by `APP_ENCRYPTION_KEY`) | ❌ (wrapped by password + recovery code) | ❌ (argon2id hash resistance) | ❌ |
| DB dump + `APP_ENCRYPTION_KEY` (env leak) | ✅ revealed | ✅ **revealed** | ❌ (wrapped by password + recovery code — no server KEK over content) | ❌ | ❌ |
| DB dump + user's **password** (phishing etc.) | ✅ revealed | ❌ (still need `APP_ENCRYPTION_KEY`) | ✅ **revealed** (unwrap password wrap) | ✅ | ✅ |
| DB dump + user's **recovery code** | ✅ revealed | ❌ | ✅ **revealed** (unwrap recovery wrap) | ❌ directly, but ✅ indirectly (call `POST /api/auth/reset-password` to set a new password) | ❌ (reset-password doesn't rotate the recovery wrap) |
| DB dump + user's password + user's recovery code | ✅ revealed | ❌ | ✅ revealed | ✅ | ✅ |
| DB dump + `APP_ENCRYPTION_KEY` + user's password | ✅ revealed | ✅ revealed | ✅ revealed | ✅ | ✅ |
| **Live process memory** of the running backend (RCE, coredump, debugger) while user is logged in | ✅ revealed | ✅ revealed (if the user makes an AI call in that window) | ✅ revealed (DEK sits in the session map; can also read `APP_ENCRYPTION_KEY` from memory) | ✅ (can forge JWTs with the in-memory `JWT_SECRET`) | ✅ |
| Network sniff of the reverse-proxy → backend hop (if that hop is plaintext HTTP) | Via request bodies over time — leaks narrative content being sent in PATCHes, not just metadata | ❌ directly; ✅ when user uploads key via `PUT /api/users/me/venice-key` | ✅ via request/response bodies; but the DEK itself **does not cross the wire** | ✅ (capture a JWT) | ✅ (capture a `POST /api/auth/rotate-recovery-code` body) |

Key cells worth calling out:

- **"DB dump + `APP_ENCRYPTION_KEY`" does not reveal narrative content.** This is the central property. It's what justifies the extra complexity of the double-wrap scheme over the obvious "single server-held KEK" design. If you're tempted to simplify by adding a server-held content KEK, you lose this row.
- **Live process memory compromise reveals everything.** The DEK of every currently-logged-in user sits in the session map; `APP_ENCRYPTION_KEY` and `JWT_SECRET` are in env. This is the "anyone with root on the box" ceiling. We don't try to defend below it — the user experience is "the operator can see your stuff *while you're using it*, but not when you're logged out, and not from a backup."
- **Reverse-proxy → backend plaintext hop leaks narrative content via request bodies** regardless of at-rest scheme, because the frontend is sending plaintext to the backend (`PATCH /api/chapters/:id` with a TipTap JSON body). At-rest encryption doesn't help here; operators must terminate TLS as close to the backend as possible. The DEK itself never traverses the wire, even under this attack. Documented in `SELF_HOSTING.md`.

### What `APP_ENCRYPTION_KEY` actually wraps

Only BYOK Venice API keys, via `User.veniceApiKeyEnc/Iv/AuthTag`. It has no authority over content. Losing it loses stored Venice keys — users must re-enter their keys once on next login. It does **not** render narrative content unrecoverable.

### What happens when the user loses the password

Recovery code still works → `POST /api/auth/reset-password` sets a new password. Narrative content preserved.

### What happens when the user loses the recovery code

Password still works → the user should log in and call `POST /api/auth/rotate-recovery-code` ([AU17]) to generate a fresh one. Narrative content preserved.

### What happens when the user loses both

**Narrative content for that user is irrecoverable.** The server has no decryption path. This is documented prominently in the signup flow UX and in `SELF_HOSTING.md` ([E15]). Users are strongly advised to store the recovery code out-of-band (printed, password manager, offline USB).

---

## Trade-offs accepted

| Trade-off | Why we accept it |
|---|---|
| **No database-side full-text search on narrative content.** | Encrypted columns are opaque to Postgres. In-application search (decrypt on demand, filter in memory) is feasible for a single user's stories but won't scale to cross-user operator search. Not in scope. |
| **No server-initiated background decrypt** (scheduled export, admin tooling, server-generated AI summaries for logged-out users). | The DEK is only available during a live session. Adding "offline decrypt" requires the Revisit path below (new third wrap). |
| **Deploy = active users must re-authenticate.** | The session-DEK cache is in-process and doesn't survive a restart. Matches the core property that the DEK is never persisted. Documented in `SELF_HOSTING.md`. |
| **Horizontal scale requires sticky sessions.** | The session-DEK cache is per-process. A multi-replica deploy either pins sessions to replicas or accepts a redesign (stateless JWT-wrapped session key, with the reverse-proxy leak trade-off). Single-container self-hosted is the target; not a problem in practice. |
| **Users must store a recovery code out-of-band.** | It's the only way for them to recover from a lost password under a scheme where the server can't decrypt offline. We surface this in UX, but losing both password and recovery code loses the data. |
| **Raising argon2id parameters doesn't retroactively strengthen existing DEK wraps.** | `argon2.needsRehash` rewrites password hashes on next login, but the wrap-key salts are separate and aren't rederived on login. Users who want stronger wrap-key params under new settings must change their password or rotate their recovery code. |

---

## Revisit

If the following requirements appear, this design needs to be revisited — don't silently bolt them on:

### 1. Offline / background decrypt

**Requirement shape:** a scheduled job, admin tool, export queue, or server-generated feature needs to read a user's plaintext content when that user is not currently logged in.

**Why the current design blocks it:** the DEK is unwrappable only from the password or recovery code, neither of which the server has when the user is logged out.

**Migration path:**
1. Add a third wrap column group on `User`: `contentDekServerEnc/Iv/AuthTag` — AES-GCM ciphertext of the DEK wrapped by a key derived from `APP_ENCRYPTION_KEY` (no salt needed; the env key is already 32 bytes).
2. For every existing user: on their next login, the server holds a plaintext DEK — it rewraps under the server key and writes the third wrap, atomically. Users who never log back in keep only password + recovery wraps (no regression).
3. Update the threat-model table: the "DB dump + `APP_ENCRYPTION_KEY`" row **now reveals narrative content**. This is the cost.
4. Document the new capability and its trade-off in this file; update `SELF_HOSTING.md`.

This is a schema migration, not a rotation. It cannot be applied without user consent (effectively): the only way to avoid silently weakening the threat model for existing users is to make the third-wrap column nullable and only populate it for users who opt in or who log in after the change. Decide the default before rolling.

### 2. Stronger argon2id parameters

If OWASP raises the baseline (or we choose to), update [argon2.config.ts](../backend/src/services/argon2.config.ts). Password hashes upgrade automatically via `needsRehash` on next login. **DEK wraps do not** — users must either change password ([AU15]) or rotate recovery code ([AU17]) to produce a new wrap at the new parameters. Document the drift and surface a "security upgrade available" nudge in Settings if we care enough.

### 3. Peppered argon2id

A server-held pepper would give a DB-dump attacker a harder time, but — as noted in the parameters section — it collapses the "DB + env leak" threat-model row into the "DB + env leak + password" row. That's a substantive change to the guarantees. Don't add one without updating this document and communicating the new property to users.

### 4. Multi-device key sync / shared-story collaboration

These are out of scope. Shared-story collaboration in particular would require either a shared DEK (every collaborator can decrypt anything) or per-resource keys with an access-control layer. Neither fits inside the current wrap model; it's a redesign rather than an extension.

### 5. Hardware-backed key material (HSM, Secure Enclave, TPM)

Outside the self-hosted single-container target. If we add a managed-hosting tier, revisit — `APP_ENCRYPTION_KEY` is a natural candidate to move behind an HSM, at which point the threat-model rows involving env leak soften considerably.

---

## Migration handling is deferred

Pre-deployment there are no legacy rows and no existing users, so the auth and crypto services do **not** carry branches that handle pre-[E3] / pre-[AU14] data shapes in routine flows. In particular: [AU15] (`changePassword`) and [AU16] (`resetPassword`) assume every user has fully-populated password + recovery wrap columns — there is no lazy-wrap generation or null-column fallback. A few targeted legacy paths that already exist (e.g. `login()`'s lazy wrap for pre-[E3] users, `verifyPassword`'s bcrypt branch from [AU14], the dual-write / plaintext fallback in `repos/_narrative.ts`) are tracked under [X10] for re-examination once there is real legacy data to consider. When a future feature needs to deal with data predating a schema change, write the migration against the concrete state of the DB at that moment — don't scaffold migration branches speculatively.

## Change log

- **2026-04-22** — Initial document. Option B (server-side session + in-memory DEK cache) chosen. [E1].
- **2026-04-22** — Noted pre-deployment migration-handling posture: no scaffolded migration branches in AU15/AU16; [X10] tracks revisiting other speculative migration paths.
