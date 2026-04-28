> Source of truth: `TASKS.md`. Closed [E]-series tasks archived here on 2026-04-28 to keep `TASKS.md` lean.
> These entries are immutable; any reopen lands as a new task in `TASKS.md`.

---

## 🔒 E — Encryption at Rest (Story Content)

> Envelope encryption: per-user DEK (32-byte random) wrapped **twice** — once by an argon2id-derived key from the user's password, once by an argon2id-derived key from a printable one-time recovery code shown at signup. No server-held KEK wraps content. All narrative content (titles, bodies, notes, character bios, outline items, chat messages) is encrypted client-of-Postgres with AES-256-GCM. Structural metadata (orderIndex, wordCount, status, FK ids, timestamps) stays plaintext so queries, ordering, and progress calcs keep working. Reuses the AES-256-GCM primitive from [AU11] and the argon2id parameters chosen for password hashing ([AU14]). **Invoke `security-reviewer` after [E3] (key model), [E9] (repo layer), and [E12] (leak test) are implemented.** **Also invoke `repo-boundary-reviewer` after [E4]–[E9] (per-entity encryption + repo layer) and [E11] (plaintext drop) — it owns the narrative-entity boundary and encrypt/decrypt symmetry.** ([E10] was cancelled — no legacy plaintext rows existed to backfill.)
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
    - No `contentDekEnc` / server-KEK wrap column. (Pre-existing users from before [E3] do not exist yet; if the app is ever deployed against pre-[E3] users in the future, the migration would generate a fresh DEK on first login after deploy, when the password is available. Deferred under [X10]; [E10] backfill was cancelled — no legacy rows to backfill pre-deployment.)
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

- [~] **[E10]** ~~Backfill migration~~ — **CANCELLED** (pre-deployment, no users / no plaintext rows to backfill; [E11] already dropped the plaintext columns, leaving no source to read from). If this ever becomes relevant (production data predating an encryption rollout), re-open via [X10], which owns post-deployment migration-handling decisions.

- [x] **[E11]** Drop plaintext columns (post-rollout): migration removes `Story.title|synopsis|worldNotes|systemPrompt`, `Chapter.title|bodyJson|content`, `Character.*(narrative)`, `OutlineItem.title|sub`, `Chat.title`, `Message.contentJson|attachmentJson`. One migration file named `drop-plaintext-narrative`. Tests run after migration and confirm all repo reads still work end-to-end. (Originally sequenced after [E10] backfill; [E10] was cancelled pre-deployment and [E11] shipped directly.)
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
