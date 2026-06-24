# Backend Rules Digest

> **Read by:** `/bd-execute` prepends this file to the implementer +
> task-reviewer prompts when the plan's touch-set includes
> backend code (per `docs/agent-rules/index.md`). Keep prose tight,
> imperative, and self-contained — the implementer/reviewer subagent
> will not read other docs at dispatch time.

## Lane

`backend/**` — Express + Prisma + TypeScript service. The frontend
talks to it over `/api/*`. AI calls are proxied; the frontend never
talks to Venice.ai directly.

## Route handlers

- Handlers stay **thin**. Logic goes in `src/services/*.service.ts`;
  data access for narrative entities goes through `src/repos/*.repo.ts`.
- Routers are built by `createXRouter()` factories and mounted in
  `src/index.ts`. Put `router.use(requireAuth)` at the top of an authed
  router; nested routers (`/stories/:storyId/chapters`) use
  `Router({ mergeParams: true })` to see the parent param.
- **Validate every request body with Zod** before the handler sees it,
  via `validateBody` (see "Responses & serialization"). No untyped
  `req.body` reads.
- **No per-route `try/catch`** unless the catch adds genuinely useful
  context. A handler either uses the `validateBody` wrapper (which
  forwards a throw to `next`) or ends with `catch (err) { next(err) }`;
  the global error handler in `src/index.ts` owns the default shape.
  Per-route catches that just `res.status(500).json(...)` are noise and
  cost coverage of the global path.
- `req.user` is `{ id, sessionId }`. **`requireAuth` also attaches the
  request-scoped DEK** (`attachDekToRequest`) from the session store —
  that is the DEK the narrative repos consume. No auth middleware → no
  DEK → the repo throws `DekNotAvailableError`.

## Auth & ownership

- **Public routes** (no `requireAuth`): `POST /api/auth/{register,login,
  logout,reset-password}` and `GET /api/health`. Everything else
  requires auth.
- Story / chapter / character / outline / chat / message routes require
  **both** `requireAuth` and `requireOwnership(type, { idParam })`.
  `idParam` defaults to `${type}Id`; pass `{ idParam: 'id' }` when the
  route param is `:id`.
- **No id-enumeration oracle:** an unknown id and an unowned id collapse
  to the **same 403**. After ownership passes, a row that then reads back
  null is a delete race — return **404**, not 500.
- `requireAuth` returns **two distinct 401s**: `unauthorized` (no session
  cookie / session unknown to the store) vs `session_expired` (cookie
  present, session evicted or server restarted). They are separate codes
  on purpose — the frontend redirects to login on both, but only shows the
  "session expired" banner on `session_expired`. Don't collapse them.
- **Session lifetime:** 7-day sliding idle window (each authenticated
  request extends the expiry) with a hard 30-day absolute cap. Both
  enforced in the in-memory session store (`session-store.ts`).
- **CSRF posture:** a global default-deny `Origin`/`Referer` check
  (`middleware/origin-check.middleware.ts`) covers all `/api` routes for
  every non-safe method (`POST`/`PUT`/`PATCH`/`DELETE`). This is
  **token-less** — it works because: (a) no state-changing GET routes
  exist, (b) only `express.json()` is mounted (no urlencoded/multipart
  on mutating routes), (c) no method-override middleware. If a future
  route violates any of these three conditions, `SameSite=Lax` becomes
  the only remaining CSRF defense (which has a documented ~2-minute
  top-level-navigation-POST hole) — such a route MUST add an explicit
  CSRF token.
- **Never expose `passwordHash`** or any `User` secret column
  (`contentDekPassword*`, `contentDekRecovery*`, `veniceApiKeyEnc`).
  These live on `User`, are **not** touched by the narrative repo layer,
  and are kept off the wire by the hand-built response objects in their
  own routes — not by any automatic stripping.
- **Never expose stack traces** when `NODE_ENV=production`.
- **Never return narrative ciphertext triples** (`*Ciphertext` / `*Iv` /
  `*AuthTag`). The narrative repo strips these on read and `serialize*`
  builds the final wire shape; a triple in a response means a path
  bypassed the repo.
- **Never return or log the decrypted Venice API key.**
  `GET /api/users/me/venice-key` returns only
  `{ hasKey, lastSix, endpoint }`.

## Responses & serialization

The egress side of a handler is as conventional as the ingress side.
Three steps, used by every CRUD route:

1. **Never return a repo row directly.** Pass it through the matching
   `serialize*` helper in `src/lib/serialize.ts`. These do an **explicit
   field pick, not a spread** — deliberately. The repo's
   `projectDecrypted` strips only the ciphertext triples; the runtime row
   still carries `userId` (Story), `chatId` (Message), and `Date` objects.
   A spread leaks those onto the wire and throws against the
   `strictObject` shared schemas. **The serialize layer — not the repo —
   produces the wire shape** (no owner ids, ISO-string timestamps).
2. **Send success through `respond(schema, res, data, status?)`**
   (`src/lib/respond.ts`), passing the shared wire schema. In non-prod it
   re-parses the payload against the schema to catch repo↔contract drift;
   in prod it skips the parse. Default status 200; pass 201 on create.
3. **Use the canonical error envelope `{ error: { message, code } }`**
   for every hand-written error (404 `not_found`, 403 `forbidden`, 409,
   …). For request-body validation use `validateBody(schema, handler)` /
   `validateQuery` (`src/middleware/validate.ts`) — the standard entry
   point that parses and, on failure, emits the project's 400 shape
   (`code: "validation_error"` with an `issues[]` array) via
   `badRequestFromZod`. For *manual* (non-Zod) validation, emit the same
   shape with `badRequest(res, message, path)` (`src/lib/bad-request.ts`).
   Don't hand-roll `safeParse` + an ad-hoc 400.

## Database access

- **Narrative entities** (`Story`, `Chapter`, `Character`,
  `OutlineItem`, `Chat`, `Message`) are accessed **only through the
  repo layer**. Controllers, services, and routes never call Prisma
  directly for these models. The repo layer encrypts on write,
  decrypts on read; bypassing it leaks ciphertext or skips encryption.
- **Non-narrative entities** (`User`) may be accessed
  directly via Prisma from services.
- **No raw SQL** outside migration files.
- Foreign key fields **must have indexes**.
- Cascading deletes are defined in the **schema** (`onDelete: Cascade`),
  not in application code.
- Schema changes after the initial migration require explicit
  approval (see CLAUDE.md "When to Stop and Ask"). Plan migrations
  in batches.
- **Migrations run against real, populated tables** (the app is
  at/near release). Preserve and migrate existing rows: backfill new
  non-null columns, make column drops/renames two-step or reversible,
  never assume a table is empty. A breaking or lossy change — one
  needing a backfill, a data-migration branch, or lazy/on-write
  population — is a stop-and-ask (CLAUDE.md "When to Stop and Ask").

## AI integration (Venice.ai)

- All Venice calls are **proxied through the backend** — the frontend
  only talks to `/api/ai/*`. There is **no singleton client and no
  server-wide Venice key**.
- The **per-user Venice client** (`getVeniceClient(userId)`) is the only
  path to Venice. If the user has no stored key it throws
  `NoVeniceKeyError`, which the global error handler maps to HTTP **409**
  in the canonical envelope (`{ error: { message, code:
  "venice_key_required" } }`).
- **Every other Venice failure is mapped at the route, not by the global
  handler.** In a non-streaming catch call `mapVeniceError(err, res, ctx)`
  (`src/lib/venice-errors.ts`): it returns `true` when it wrote a
  structured response (and you stop) and `false` when you should
  `next(err)`. It picks the status + `venice_*` code per failure class,
  scrubs `sk-…` tokens, and never echoes Venice's raw body. You don't need
  the code/status table — `mapVeniceError` owns it; see
  `docs/venice-integration.md` if you do.
- **SSE streaming routes have a hard boundary at header flush.**
  `/api/ai/complete` streams `data: <chunk>\n\n` frames ending with
  `data: [DONE]\n\n`. Once `res.flushHeaders()` has run you **cannot** use
  the global error handler — on a mid-stream error write a terminal frame
  via `mapVeniceErrorToSse(...)` (falling back to a `stream_error` frame)
  then `res.end()`; **never call `next(err)`**. Honour `req.on('close')`
  by aborting the upstream Venice stream so connections don't leak.
- Prompt construction lives in `src/services/prompt.service.ts` — keep it
  separate and unit-testable. It never sees ciphertext: chapter bodies are
  decrypted via the chapter repo before reaching it, and decrypted bodies
  exist only for the lifetime of the request.
- **Context budget is dynamic:** the model's `context_length` minus the
  response allowance (max-completion-tokens) minus a fixed safety margin
  (`SAFETY_MARGIN_TOKENS`, currently 512) — not a fixed-percentage
  reserve. Chapter context truncates from the **top** (oldest first) when
  over budget. Character context and `worldNotes` are **never truncated**;
  character context renders the full field set, not a condensed subset.
- Inkwell's own system message is sent in **every** call — the default
  creative-writing prompt, or per-story `Story.systemPrompt` when non-null.
- Venice features go via `venice_parameters` (see
  `docs/venice-integration.md` for the full shape — reasoning models get
  `strip_thinking_response`; web-search opt-in adds `enable_web_search` +
  `enable_web_citations`, chat surface only). Two load-bearing rules:
  - `include_venice_system_prompt` is driven by the user setting
    `settingsJson.ai.includeVeniceSystemPrompt` (default `true` when
    absent), read off `req.user` and passed to the builder — the builder
    must **never hardcode** it. The flag controls only whether Venice
    *additionally* prepends its own creative-writing prompt; Inkwell's own
    system message is sent regardless.
  - `prompt_cache_key` is a Venice **top-level** field (sibling of
    `model` / `messages` / `stream`), **not** nested under
    `venice_parameters`. It's a hash of the context id + `modelId`.
- **Canonical message-array shape.** Every action goes through the same
  `buildPrompt` path: the `system` message carries everything stable across
  turns (system prompt + world-notes + characters + chapter + per-action
  task template); the `user` message carries only this turn's input. **No
  `if (action === …)` branches** in the system-message assembly — per-action
  user-payload validation lives in `buildUserPayload`'s switch arms, keyed by
  `PromptAction`. Override/template strings use a separate, *not* 1:1
  `UserPromptKey` union (`rephrase` reuses the `rewrite` key;
  `summariseChapter` / `system` have no action). A new action = a
  `PromptAction` member + a `buildUserPayload` arm + a `DEFAULT_PROMPTS`
  template (new `UserPromptKey`, or reuse one). See
  `docs/superpowers/specs/2026-05-10-k1r-prompt-building-unification-design.md`.

## Encryption at rest (backend lane)

- The repo-boundary digest (`repo-boundary.md`) owns the
  encrypt-on-write / decrypt-on-read template and ciphertext-egress
  rules. This section covers the surrounding backend invariants.
- **Envelope model:** per-user random 32-byte DEK, wrapped twice by
  AES-256-GCM. Wrap #1 is keyed via argon2id from the user's
  password; wrap #2 is keyed via argon2id from a one-time recovery
  code shown at signup. Both wraps live on `User`
  (`contentDekPassword*` and `contentDekRecovery*` columns, each
  with its own salt). **No server-held KEK** wraps content.
- The DEK itself is random; only its **wraps** are user-secret-derived.
  Password reset requires the recovery code. Password change only
  re-wraps the password copy — narrative ciphertext is untouched.
  Recovery-code rotation only re-wraps the recovery copy.
- The server **cannot decrypt user content while the user is logged
  out** — there is no offline / background / admin decryption path.
  This is by design.
- The content-crypto service (`src/services/content-crypto.service.ts`)
  unwraps DEKs **only into a request-scoped `WeakMap`** (keyed by the
  request object, populated by `requireAuth`). Module-level caching of
  unwrapped DEKs is a bug.
- There is **no server-held encryption env secret**. `APP_ENCRYPTION_KEY`
  has been retired: the BYOK Venice key is now wrapped by the per-user
  content DEK (via `content-crypto.service.ts` in `venice-key.service.ts`).
  There is no `CONTENT_ENCRYPTION_KEY`, and one must not be reintroduced —
  the boot validator (`backend/src/boot/env-validation.ts`) warns if it is.
- `JWT_SECRET` and `REFRESH_TOKEN_SECRET` are also **retired** (removed
  with the cookie-session auth cutover). The boot validator warns if they
  linger in `.env`. There is no JWT signing secret — authentication is
  handled via the in-memory session store (`session-store.ts`).

## Testing (backend lane)

- **vitest** is the runner. Tests live under `backend/tests/`.
- **Use the test database** defined in `.env.test`, not the dev DB.
  Run `npm run db:test:reset` before a full suite. Note: vitest's
  `globalSetup` resets + migrates the DB against the running compose
  stack on **every** invocation (even a single-file run), so a backend
  test always needs `make dev` up first.
- **Integration tests against narrative entities go through the repo
  layer**, not raw Prisma. Otherwise the test doesn't exercise the
  encrypt/decrypt path and is unrepresentative.
- **Mock the Venice HTTP client** in all tests. The opt-in L-series
  live tests under `backend/tests/live/**` are excluded from the
  default suite and CI; only run via `npm run test:live`.
- **The encryption leak test (`[E12]`) must pass** before merging any
  schema change, repo change, or migration that touches narrative
  entities.
- See CLAUDE.md "Testing Rules" for cross-lane policy
  (`no .skip`/`.only`, no DB mocking, no real-API calls in default
  suite).

## Library-version awareness (backend lane)

- Fast-movers in this lane to version-check before pinning: Express,
  Prisma, Zod, Vitest, Helmet, argon2id. (The "prefer Context7
  `query-docs` over muscle-memory" principle and the dependency policy
  live in `general.md`.)

## Forbidden

- Server-wide Venice keys (any environment).
- Plaintext Venice API keys, plaintext passwords, recovery codes,
  or content DEKs (wrapped or unwrapped) in logs, error messages,
  response bodies, telemetry, or any other sink — in **all**
  environments including dev and tests.
- Decrypted narrative content in production logs, telemetry, or any
  response other than the owning user's own GET. (Dev-mode logging
  of decrypted content for prompt debugging is intentional and
  permitted; the leak test enforces the production rule via a
  sentinel.)
- Bypassing the repo layer for any narrative entity.
- Returning a repo row directly (spread) instead of through a
  `serialize*` pick — leaks `userId` / `chatId`.
- Module-level caching of unwrapped DEKs.
- Calling `next(err)` after SSE headers have been flushed.
