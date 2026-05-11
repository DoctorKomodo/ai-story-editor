# Backend Rules Digest

> **Read by:** `/bd-execute` prepends this file to the implementer +
> code-quality-reviewer prompts when the plan's touch-set includes
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
- **Validate every request body with Zod** before the controller sees
  it. No untyped `req.body` reads.
- **No per-route `try/catch`** unless the catch adds genuinely useful
  context. The global error handler in `src/index.ts` owns the default
  shape; per-route catches that just `res.status(500).json(...)` are
  noise and cost coverage of the global path.
- All routes except `/api/auth/register`, `/api/auth/login`,
  `/api/auth/refresh`, and `/api/health` require the auth middleware.
- All story / chapter / character / outline / chat / message routes
  require auth middleware **and** ownership middleware (scoped to
  `req.user.id`).
- **Never expose `passwordHash`** in any response.
- **Never expose stack traces** when `NODE_ENV=production`.
- **Never return ciphertext fields** (`*Ciphertext`, `*Iv`, `*AuthTag`,
  `contentDekEnc`, `veniceApiKeyEnc`, …) from any endpoint. The repo
  layer strips them on read; if you see one in a response, it's a bug.
- **Never return or log the decrypted Venice API key.** The
  `GET /api/users/me/venice-key` endpoint returns only
  `{ hasKey, lastFour, endpoint }`. The plaintext key never serializes.

## Database access

- **Narrative entities** (`Story`, `Chapter`, `Character`,
  `OutlineItem`, `Chat`, `Message`) are accessed **only through the
  repo layer**. Controllers, services, and routes never call Prisma
  directly for these models. The repo layer encrypts on write,
  decrypts on read; bypassing it leaks ciphertext or skips encryption.
- **Non-narrative entities** (`User`, `RefreshToken`) may be accessed
  directly via Prisma from services.
- **No raw SQL** outside migration files.
- Foreign key fields **must have indexes**.
- Cascading deletes are defined in the **schema** (`onDelete: Cascade`),
  not in application code.
- Schema changes after the initial migration require explicit
  approval (see CLAUDE.md "When to Stop and Ask"). Plan migrations
  in batches.

## AI integration (Venice.ai)

- All Venice calls are **proxied through the backend** — the frontend
  only talks to `/api/ai/*`.
- The **per-user Venice client** (`getVeniceClient(userId)`, `[V17]`)
  is the only path to Venice. There is **no singleton**, and there is
  **no server-wide Venice key**. If the user has no stored key, the
  call throws `NoVeniceKeyError`, mapped to HTTP **409**
  `{ error: "venice_key_required" }`.
- Prompt construction lives in `src/services/prompt.service.ts` —
  keep it separate and unit-testable. The builder never sees
  ciphertext: chapter bodies are decrypted via the chapter repo
  before reaching the builder, and decrypted bodies exist only for
  the lifetime of the request.
- **Context budget is dynamic.** Reserve 20% of the selected model's
  `context_length` for the response and use the remainder for prompt
  content. Chapter content truncates from the **top** (oldest first)
  when over-budget. Character context is condensed to
  `{ name, role, key traits }`. Character context and `worldNotes`
  are **never truncated**.
- Per-story `systemPrompt` overrides the default creative-writing
  system prompt when non-null (`[V13]`).
- Venice-specific features go via `venice_parameters`:
  - `include_venice_system_prompt` is driven by the user setting
    `settingsJson.ai.includeVeniceSystemPrompt` (default `true` when
    absent). The AI route reads it off `req.user` and passes it to
    the prompt builder; the builder must **never hardcode** this
    flag. Inkwell's own system message (default or per-story
    `Story.systemPrompt`) is sent in every case; the flag only
    controls whether Venice additionally prepends its own
    creative-writing prompt.
  - `strip_thinking_response: true` for reasoning models (`[V6]`).
  - `enable_web_search` + `enable_web_citations` when the request
    opts in (`[V7]`).
  - `prompt_cache_key` set to a hash of `storyId + modelId`
    (`[V8]`).

- **Canonical message-array shape (k1r).** Every action goes through the
  same code path in `buildPrompt`. The `system` message carries everything
  stable across turns (system prompt + world-notes + characters + chapter +
  per-action task template); the `user` message carries only what the user
  contributed this turn. No `if (action === ...)` branches in `buildPrompt`'s
  system-message assembly. Per-action `freeformInstruction`-required
  validation lives in `buildUserPayload`'s switch arms (`scene` / `ask` /
  `freeform`). New actions inherit this shape automatically — add a
  `DEFAULT_PROMPTS.<action>` entry, a `UserPromptKey` member, a
  `buildUserPayload` arm describing the user payload, and the rest is free.
  See
  `docs/superpowers/specs/2026-05-10-k1r-prompt-building-unification-design.md`
  for rationale (why `ask` was special pre-k1r, why we unified).

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
  Password reset requires the recovery code (`[AU16]`). Password
  change (`[AU15]`) only re-wraps the password copy — narrative
  ciphertext is untouched. Recovery-code rotation (`[AU17]`) only
  re-wraps the recovery copy.
- The server **cannot decrypt user content while the user is logged
  out** — there is no offline / background / admin decryption path.
  This is by design.
- The content-crypto service (`src/services/content-crypto.service.ts`,
  `[E3]`) unwraps DEKs **only into a request-scoped `WeakMap`**.
  Module-level caching of unwrapped DEKs is a bug.
- `APP_ENCRYPTION_KEY` is the only server-held encryption env secret.
  It wraps **BYOK Venice keys only**. There is no
  `CONTENT_ENCRYPTION_KEY`, and one must not be reintroduced — the
  boot validator (`backend/src/boot/env-validation.ts`) warns if it
  is.

## Testing (backend lane)

- **vitest** is the runner. Tests live under `backend/tests/`.
- **Use the test database** defined in `.env.test`, not the dev DB.
  Run `npm run db:test:reset` before a full suite.
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

## TypeScript discipline

- Strict mode is on. **No `any` types.** Prefer `unknown` plus a
  narrowing guard when the shape is genuinely dynamic; reach for
  `as` casts only when there's no alternative and document the
  invariant in a single-line comment.

## Library-version awareness

- For fast-moving libraries (Express, Prisma, Zod, Vitest, Helmet,
  argon2id), **prefer the Context7 MCP `query-docs` tool over
  muscle-memory recall** for syntax and migration questions —
  training data lags. This applies whenever you'd otherwise type
  out an API call from memory for a library that has shipped a
  major version in the last ~12 months.

## Forbidden

- Server-wide Venice keys (any environment).
- Plaintext Venice API keys, plaintext passwords, recovery codes,
  content DEKs (wrapped or unwrapped), or `APP_ENCRYPTION_KEY` in
  logs, error messages, response bodies, telemetry, or any other
  sink — in **all** environments including dev and tests.
- Decrypted narrative content in production logs, telemetry, or any
  response other than the owning user's own GET. (Dev-mode logging
  of decrypted content for prompt debugging is intentional and
  permitted; the leak test enforces the production rule via a
  sentinel.)
- Bypassing the repo layer for any narrative entity.
- Module-level caching of unwrapped DEKs.
- Pre-deployment data-migration branches (dual-write / lazy-backfill /
  legacy-read fallbacks for populations that don't exist). If you
  see a task that looks like one, implement the post-rollout shape
  directly. See CLAUDE.md "General" for the rationale.
