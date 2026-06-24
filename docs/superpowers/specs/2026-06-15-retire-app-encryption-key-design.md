# Retire `APP_ENCRYPTION_KEY` — move BYOK Venice keys under the content DEK

**Status:** design / awaiting spec review
**Date:** 2026-06-15
**Surface:** `security-reviewer` + `repo-boundary-reviewer` (touches `venice-key.service.ts` — the new single load+decrypt/encrypt site for the Venice key — plus `lib/venice.ts`, `content-crypto.service.ts`, and the env/crypto bootstrap)

---

## Problem

`APP_ENCRYPTION_KEY` is a 32-byte server-held env secret whose **only** job is to wrap
the per-user BYOK Venice API key (`User.veniceApiKey{Enc,Iv,AuthTag}`) via
`crypto.service.ts`. It predates the content-DEK envelope scheme ([E3]): when the BYOK
path was built ([AU11]–[AU13]) there was no per-user key to wrap the Venice key with, so a
server-held key was the only option.

That option is now redundant. Every place the Venice key is read happens **inside an
authenticated request**, where the per-user content DEK is already available on `req` (via
the request-scoped `WeakMap` populated by the auth middleware). Verified read sites:

- `getVeniceClient(userId)` — `ai.routes.ts:172`, `chat.routes.ts:438`,
  `chapters.routes.ts:356`, `venice.models.service.ts` (via its injected `getClient`).
- `veniceKeyService.{store, getStatus, getAccount}` — `venice-key.routes.ts:{32,41}`,
  `venice-account.routes.ts:58`. (`remove` needs no key.)

None run from a cron, queue, worker, or boot path (greps for `cron|queue|worker|boot|
schedul` against these symbols return nothing). This is the property that distinguishes the
Venice key from **narrative offline-decrypt**, which `docs/encryption.md` deliberately
blocks as a non-goal precisely because the server *cannot* get the DEK while the user is
logged out. The Venice key has no such requirement.

Therefore the Venice key can be encrypted under the user's content DEK — the same key that
already protects narrative content — and `APP_ENCRYPTION_KEY` can be removed entirely. The
result: **no server-held encryption env secret of any kind.** One fewer key for the operator
to generate, store, back up, and rotate.

## Goals

1. Encrypt the BYOK Venice key under the per-user content DEK (`encryptWithDek` /
   `decryptWithDek`), reusing the existing `veniceApiKey{Enc,Iv,AuthTag}` columns.
2. Delete `APP_ENCRYPTION_KEY`, `crypto.service.ts`, and the boot validator. No server-held
   encryption env secret remains.
3. Keep the absolute no-leak invariant: the plaintext Venice key still never appears in any
   log, error, response body (beyond `lastSix`), or telemetry — only its at-rest wrapping
   changes.
4. Consolidate the Venice-key load+decrypt into a single site in `venice-key.service.ts`,
   reducing `lib/venice.ts` to a pure client factory (no DB, no DEK, no crypto) — one decrypt
   site and one encrypt site for the Venice key, the surface `security-reviewer` audits.

## Non-goals

- Changing the content-DEK envelope scheme, argon2id params, or session lifecycle.
- Adding offline/background decrypt of *anything* (still a non-goal; see `encryption.md`
  Revisit #1).
- Preserving existing stored Venice-key ciphertext across the cutover (see Migration —
  drop & re-enter, decided with the user).

---

## Design

### 1. Encryption primitive

The Venice key stops using `crypto.service.{encrypt,decrypt}` (env-keyed) and uses
`encryptWithDek(dek, apiKey)` / `decryptWithDek(dek, payload)` from
`content-crypto.service.ts` — the existing AES-256-GCM primitive keyed by the per-user DEK.

- **Columns unchanged:** `veniceApiKeyEnc` / `veniceApiKeyIv` / `veniceApiKeyAuthTag`.
- **No salt:** the DEK is already a 32-byte random key; argon2 is only needed when deriving
  from a low-entropy secret (password / recovery code), which is not the case here.
- `veniceEndpoint` stays plaintext, as today.

### 2. Module restructure — one decrypt site, pure factory

Today the BYOK key is read-and-decrypted in **two** independent places: `lib/venice.ts`'s
`getVeniceClient` (`venice.ts:84-104`) and `venice-key.service.ts`'s `getStatusAndKey`
(`venice-key.service.ts:136-163`). Before threading the DEK anywhere, collapse these into
one. This keeps the at-rest scheme change to a **single** `decryptWithDek` site (plus the
single `encryptWithDek` site in `store`) — the surface `security-reviewer` audits — and lets
`lib/venice.ts` shed its DB + crypto dependencies entirely.

- **`lib/venice.ts` → pure factory.** Keep `createVeniceClient({ apiKey, endpoint })` and
  `NoVeniceKeyError`. **Delete `createGetVeniceClient` / `getVeniceClient`** (`venice.ts:79-110`)
  and the `decrypt` (crypto.service) + `prisma` imports. The module becomes a dumb
  OpenAI-client constructor again — no DB, no DEK, no crypto.
- **`venice-key.service.ts` → single owner of load+decrypt.** `getStatusAndKey(dek, userId)`
  becomes the *only* place the Venice key is decrypted (`decryptWithDek(dek, …)`), and `store`
  the *only* place it is encrypted (`encryptWithDek(dek, …)`). Add
  `getClient(dek, userId): Promise<OpenAI>` — a thin wrapper that calls `getStatusAndKey`,
  throws `NoVeniceKeyError` when `hasKey` is false, and hands `{ apiKey, endpoint }` to
  `createVeniceClient`. The `buildClient` injection seam that lives on `createGetVeniceClient`
  today moves onto `VeniceKeyServiceDeps`.
- **`venice.models.service.ts` → repoint the seam.** Its default `getClient` becomes
  `veniceKeyService.getClient` (was `lib/venice`'s `getVeniceClient`).

**Why `getClient` lives in the service, not `lib/venice`.** Keeping it in `lib/venice` would
require `lib/venice → venice-key.service` (to load+decrypt the key) *and*
`venice-key.service → lib/venice` (for `createVeniceClient`) — an import cycle. Moving it to
the service resolves the dependency in one direction, and is the more coherent home anyway:
the module that owns the key builds the client from it. Resulting graph is acyclic:

```text
routes ─→ venice-key.service ─→ lib/venice (createVeniceClient, NoVeniceKeyError)
   │                        └─→ content-crypto.service (encrypt/decryptWithDek)
   └─→ venice.models.service ─→ venice-key.service (getClient)
lib/venice ─→ (no DB, no crypto)
```

**Rejected simpler shape:** thread the DEK into both existing decrypt sites and leave
`lib/venice` reading the DB. It works and touches the *same* route call-sites (§3), but keeps
two decrypt sites and a DB-bound `lib/venice`. The consolidation is the same route-level
threading for a smaller audited surface — chosen for that reason, not to reduce threading.

### 3. DEK threading

With load+decrypt consolidated in the service, the DEK is threaded into
`veniceKeyService.{getStatusAndKey, getStatus, getAccount, store, getClient}` and
`veniceModelsService.fetchModels`, obtained at each route via `getDekFromRequest(req)`.
`lib/venice.ts` takes **no** DEK — it only ever sees the already-decrypted
`{ apiKey, endpoint }`.

**Thread it as an explicit `dek: Buffer` parameter**, not `req`:
- Makes the DEK dependency visible in each signature — easier for `security-reviewer` to
  audit than an implicit `req` lookup, and the Buffer is handed straight into encrypt/decrypt.
- Keeps the services unit-testable without constructing Express `req` objects.
- This *differs* from the repo layer, whose interface takes `req` and resolves the DEK
  internally via `encryptForRequest(req, …)` / `decryptForRequest(req, …)`. We pass the Buffer
  here deliberately — not to mirror the repo layer.

The route-level threading breadth is **identical** to the rejected simpler shape: the route
call-sites below pass the DEK either way, because the call graph
(`route → fetchModels → client build`) forces it, not the parameter style.

Touch points (signature + call-site updates):

| File | Symbol | Change |
|---|---|---|
| `lib/venice.ts` | `getVeniceClient` / `createGetVeniceClient` | **deleted** (§2) — pure factory, takes no DEK |
| `services/venice-key.service.ts` | `getStatusAndKey`, `getStatus`, `getAccount`, `store`, new `getClient` | accept `dek`; single decrypt (`getStatusAndKey`) + encrypt (`store`) site; `getClient` builds via `createVeniceClient` |
| `services/venice.models.service.ts` | `fetchModels(userId)` → `fetchModels(dek, userId)`; `getClient` seam → `(dek, userId)`, default `veniceKeyService.getClient` | thread `dek`; only the cache-**miss** path builds a client |
| `routes/ai.routes.ts:172` | was `getVeniceClient(userId)` | → `veniceKeyService.getClient(getDekFromRequest(req), userId)` |
| `routes/ai.routes.ts:{57,82}` | `fetchModels` call sites | pass `getDekFromRequest(req)` |
| `routes/chat.routes.ts:438` | was `getVeniceClient(userId)` | → `veniceKeyService.getClient(getDekFromRequest(req), userId)` |
| `routes/chat.routes.ts:306` | `fetchModels` call site | pass `getDekFromRequest(req)` |
| `routes/chapters.routes.ts:356` | was `getVeniceClient(userId)` | → `veniceKeyService.getClient(getDekFromRequest(req), userId)` |
| `routes/chapters.routes.ts:295` | `fetchModels` call site | pass `getDekFromRequest(req)` |
| `routes/venice-key.routes.ts:{32,41}` | `getStatus` / `store` call sites | pass `getDekFromRequest(req)` |
| `routes/venice-account.routes.ts:58` | `getAccount` call site | pass `getDekFromRequest(req)` |

(`ai.routes.ts:53` carries a comment that says a missing key "surfaces as NoVeniceKeyError
from getVeniceClient" — update it to `veniceKeyService.getClient`.)

**Do not over-thread.** `findModel`, `getModelContextLength`, and
`getModelMaxCompletionTokens` are pure `byUser.get(userId)?.models` cache reads — they build
no client and need no DEK. Only `fetchModels` (the cache-miss path, `await getClient(dek, userId)`
at `venice.models.service.ts:150`) requires it. The cache stores `ModelInfo`, never the key
or the client, so no DEK is retained across its 10-minute TTL. The signature change is
compiler-enforced (TypeScript flags every stale call site), but the table is enumerated in
full so the reviewer isn't left inferring the set.

`getStatus` needs the DEK only to compute `lastSix`. It is always called inside an
authenticated request, so the DEK is in hand. (Rejected alternative: store `lastSix` as a
plaintext column — adds a column to avoid a decrypt we can already do.)

`remove()` is unchanged — it only NULLs columns.

### 4. Deletions

- **Reduce `backend/src/lib/venice.ts` to the pure factory** (§2) — delete `getVeniceClient` /
  `createGetVeniceClient` and the `decrypt` + `prisma` imports; keep `createVeniceClient` +
  `NoVeniceKeyError`. The four importers (`ai`/`chat`/`chapters` routes + `venice.models.service`)
  move to `veniceKeyService.getClient`.
- **Delete `backend/src/services/crypto.service.ts`** — `encrypt`/`decrypt`/
  `loadAppEncryptionKey` lose their only callers; `constantTimeEqual` is already dead (zero
  importers). Any future constant-time compare uses `crypto.timingSafeEqual` directly.
- **Delete `backend/src/boot/env-validation.ts`** and its call at `index.ts:29`. Replace
  with a **one-line boot warning** if `APP_ENCRYPTION_KEY` is still present in the
  environment (stale `.env` after upgrade) — mirroring the existing `CONTENT_ENCRYPTION_KEY`
  warning, so upgrading operators are told the var is now unused rather than having it
  silently ignored. (Keep a minimal `validateEncryptionEnv` or inline the warning in
  `index.ts`; implementer's call — no env var is *required* anymore.)
- **Remove `APP_ENCRYPTION_KEY` from `.env.example`** (L18). No encryption env secret
  remains in the file.

### 5. Migration — drop & re-enter (decided with user)

A Prisma migration NULLs `veniceApiKeyEnc` / `veniceApiKeyIv` / `veniceApiKeyAuthTag` on
every `User` row (their ciphertext is undecryptable once `APP_ENCRYPTION_KEY` is gone).
`veniceEndpoint` may be left as-is (harmless plaintext; overwritten on next `store`).

**Migration mechanics (data-only):** the schema diff is *empty* — no column changes — so
`prisma migrate dev` will generate nothing. Create the migration with
`prisma migrate dev --create-only` (or hand-create the migration directory) and hand-write
the SQL: `UPDATE "User" SET "veniceApiKeyEnc" = NULL, "veniceApiKeyIv" = NULL,
"veniceApiKeyAuthTag" = NULL;`. The migration touches **only** `User.veniceApiKey*` — no
narrative columns — so it is clear of the [E12] narrative-migration gate and out of
`repo-boundary-reviewer`'s lane.

Users re-enter their Venice key once in Settings — the UI already renders the no-key state
(`hasKey:false`). BYOK keys are re-enterable (the user holds them; the source of truth is
Venice), so this is not data loss in the narrative sense.

`SELF_HOSTING.md` gains an upgrade note: *"After upgrading to this version, each user
re-enters their Venice API key once in Settings; `APP_ENCRYPTION_KEY` is no longer needed
and can be removed from your `.env`."*

### 6. Threat-model effect (`docs/encryption.md`)

- ✅ **Improvement:** the "DB dump + `APP_ENCRYPTION_KEY` (env leak)" row no longer leaks
  Venice keys — there is no server-held key. That row reveals only structural metadata.
- ⚠️ **Accepted trade-off — both user-secret rows flip.** The DEK is unwrappable from
  *either* the password or the recovery code, so both rows that today show ❌ for Venice keys
  now show ✅:
  - "DB dump + user's **password**" (encryption.md:272) → Venice key **revealed** (today
    needs `APP_ENCRYPTION_KEY` too).
  - "DB dump + user's **recovery code**" (encryption.md:273) → Venice key **revealed** (same
    reason — unwrap DEK via recovery wrap, then decrypt the key).

  Both table cells must be edited. Minor in practice: a holder of either secret can log in /
  reset and use the key through the app anyway, and a BYOK key is revocable at Venice. The
  user has accepted this.
- Revisit #1 (offline decrypt) keeps `APP_ENCRYPTION_KEY` as a *future* re-introduction if
  that feature is ever built — note that it no longer exists by default.

---

## Files to change

### Code (backend)
- `services/content-crypto.service.ts` — (no change; reuse `encryptWithDek`/`decryptWithDek`)
- `services/venice-key.service.ts` — single load+decrypt site; new `getClient(dek, userId)`;
  thread `dek`; encrypt/decrypt with the DEK; `buildClient` injection seam moves here
- `lib/venice.ts` — reduce to pure factory: delete `getVeniceClient` / `createGetVeniceClient`
  + the `decrypt` and `prisma` imports; keep `createVeniceClient` + `NoVeniceKeyError`
- `services/venice.models.service.ts` — `fetchModels(dek, userId)`; default `getClient` →
  `veniceKeyService.getClient`
- `routes/{ai,chat,chapters}.routes.ts` — `getVeniceClient(userId)` →
  `veniceKeyService.getClient(getDekFromRequest(req), userId)`; pass `getDekFromRequest(req)`
  to `fetchModels`
- `routes/{venice-key,venice-account}.routes.ts` — pass `getDekFromRequest(req)`
- `boot/env-validation.ts` — delete (or reduce to stale-key warning)
- `index.ts` — drop/replace the `validateEncryptionEnv()` call
- `services/crypto.service.ts` — **delete**

### Migration
- New Prisma migration: NULL the three `veniceApiKey*` columns on all `User` rows.

### Tests
- **Delete** `tests/boot/encryption-keys.test.ts` ([E2]) and `tests/services/crypto.service.test.ts`.
  (Or rewrite the boot test to assert the stale-key *warning* instead of the required-key throw.)
- `tests/setup.ts` — remove the `APP_ENCRYPTION_KEY` synthesis (L11); ensure a DEK is on
  `req` wherever the Venice path is exercised (helpers `tests/repos/_req.ts`,
  `tests/routes/_chat-test-helpers.ts` already attach a DEK — reuse).
- Update `tests/routes/venice-key.test.ts`, `tests/routes/venice-account.test.ts`,
  `tests/models/user-venice-key.test.ts`, `tests/security/byok-leak.test.ts` — switch the
  at-rest assertion from app-key to DEK encryption, and provide a DEK.
- `tests/lib/venice-per-user.test.ts` — its **subject moves** from `lib/venice`'s
  `getVeniceClient` to `veniceKeyService.getClient`: the non-caching + "decrypted key flows
  through" assertions relocate to the service test, and the `buildClient` injection seam moves
  from `createGetVeniceClient` to `createVeniceKeyService`. `venice.models.service` tests that
  inject `getClient` adopt the `(dek, userId)` signature; `lib/venice`'s `createVeniceClient`
  (pure factory) tests are unchanged.
- **Add** round-trip + fail-closed tests: Venice key encrypts/decrypts under the DEK; a
  wrong/absent DEK fails closed (no plaintext, throws).
- `tests/security/encryption-leak.test.ts` ([E12]) — **edit**: remove the
  `APP_ENCRYPTION_KEY` injection into the spawned seed child's env (L248-249). `prisma/seed.ts`
  stores no Venice key, so the seed itself needs no change — only the stray env injection.
  Otherwise confirm no regression (Venice key is not narrative content; the [AU13]
  `byok-leak` test remains the no-leak proof for it).

### Documentation — live (edit)
- `docs/encryption.md` — that doc's goals 2 & 4, threat-model table, "What `APP_ENCRYPTION_KEY`
  actually wraps", Revisit #1, change-log entry.
- `docs/data-model.md` — L5, L180, the `User.veniceApiKey*` note.
- `docs/agent-rules/backend.md` — L191, 199, 203, 205, 241.
- `docs/agent-rules/repo-boundary.md` — L90, 183.
- `docs/agent-rules/index.md` + `docs/agent-workflow.md` — drop `crypto.service.ts` from
  the rules-routing / touch-set tables.
- `.claude/agents/security-reviewer.md` — re-point its in-lane list off `crypto.service.ts`
  + the APP_ENCRYPTION_KEY bootstrap and onto the DEK-wrapped Venice path.
- `.claude/agents/repo-boundary-reviewer.md` — L28, 102 (`crypto.service.ts` mentions).
- `SELF_HOSTING.md` — §1 (L11-23), key table L77, BYOK note L95, `.env` template
  L114/163/168, backup §L223; add the re-enter-after-upgrade note.
- `CLAUDE.md` — General-rules bullets on `APP_ENCRYPTION_KEY`/`CONTENT_ENCRYPTION_KEY`,
  gotchas, "When to Stop and Ask" rotation bullet, the `security-reviewer` in-lane file list
  (drop `crypto.service.ts`).
- `.env.example` — remove L18.
- `docs/venice-integration.md` — L11 one-line clarification (now DEK-wrapped). Minor.

### Infra / CI / scripts (functional)
- `.github/workflows/ci.yml` — L42 comment + L145 `export APP_ENCRYPTION_KEY=…` (remove;
  tests no longer require it).
- `scripts/backup-restore-drill.sh` — L97-98 (generate), L131 + L234 (`-e
  APP_ENCRYPTION_KEY`); remove the wiring and confirm the drill still passes.
- `scripts/backup-db.sh` — L16 comment.
- `docker-compose.release.yml` — L15 comment.
- `.github/workflows/secret-scan.yml` — L12 threat-model comment.
- `backend/src/lib/venice-errors.ts` — L281 comment lists `APP_ENCRYPTION_KEY` among
  "none of these are in the Venice exchange"; one-line touch-up (drop the now-removed key).
- `scripts/bd-close-reviewed.sh` — L138 security-reviewer path-matcher has a `services/crypto`
  alternative that now matches only the deleted file (dead branch — `content-crypto` is matched
  separately and is unaffected). Prune it alongside the agent-def updates.

### Untouched (immutable / point-in-time records)
- `docs/done/done-{AU,E,I}.md` — immutable archives.
- All closed `docs/superpowers/plans/*` and `specs/*` (I1/I3/I5-I8, bundle-shared,
  venice-orchestration, x29/x32, F61, outline-consolidation).
- `docs/multi-agent-workflow-plan.md` — historical planning record.
- `docs/api-contract.md` — its venice-key entries ("encrypts at rest") stay accurate.

---

## Verification

- `make typecheck` (shared + backend + frontend).
- `npm -w story-editor-backend run test` (stack up) — including the updated venice-key /
  venice-account / venice-per-user / byok-leak / encryption-leak suites and the new
  round-trip + fail-closed tests.
- `security-reviewer` + `repo-boundary-reviewer` at the close gate (both in-lane).
- Manual: log in, store a Venice key, confirm an AI completion + the Settings account
  balance probe both work end-to-end with no `APP_ENCRYPTION_KEY` in the environment.

## Risks

- **A Venice read path without a DEK on `req`.** Mitigated: all read sites are
  authenticated routes; the implementer must confirm each call site has the DEK and that no
  new unauthenticated/background path consumes the Venice key. Fail-closed test covers the
  absent-DEK case.
- **`NoVeniceKeyError` moves throw-site** from `lib/venice`'s `getVeniceClient` to the
  service's `getClient`. The error type is unchanged (still defined in `lib/venice.ts`,
  imported by the service), and the 409 mapping (`mapVeniceError` in `ai.routes.ts` + the
  global handler) matches by `instanceof`, so it should be unaffected — but the implementer
  must confirm the import path resolves and that no route relied on the throw originating in
  `lib/venice`.
- **Operator confusion on upgrade** (stale `APP_ENCRYPTION_KEY`). Mitigated by the boot
  warning + the `SELF_HOSTING.md` upgrade note.
