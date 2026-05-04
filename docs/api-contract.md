# API Contract

All endpoints are served from the Express backend at `/api`. Content type is `application/json` unless noted (SSE streams use `text/event-stream`). Timestamps are ISO-8601 UTC. IDs are CUIDs.

---

## Conventions

- **Auth** — unless marked "Public", every endpoint requires the auth middleware ([AU5]) and is scoped to `req.user.id`. Protected endpoints expect `Authorization: Bearer <JWT>`. The refresh-token cookie (`refreshToken`, `HttpOnly; SameSite=Lax; Secure` in prod) is only read by `/api/auth/refresh` and `/api/auth/logout`.
- **Ownership** — every route that references a `:storyId`, `:chapterId`, `:characterId`, `:outlineItemId`, `:chatId`, or `:messageId` passes through the ownership middleware ([AU6]) and returns `403 { error: { message, code: "forbidden" } }` on mismatch (unknown id, or id owned by another user). Per-handler path-integrity checks additionally return `404 { error: { message, code: "not_found" } }` when a nested resource belongs to the caller but to a different `:storyId` than the URL specifies (e.g. `GET /api/stories/A/chapters/:chapterId` where the chapter lives under story B).
- **Validation** — request bodies are Zod-validated ([AU / B series]); invalid payloads return `400 { error: { message, code: "validation_error", issues } }`.
- **Errors** — global error handler returns `{ error: { message, code } }`. Never exposes stack traces in `NODE_ENV=production` ([B7]). Common codes: `unauthorized`, `forbidden`, `not_found`, `conflict`, `rate_limited`, `venice_key_required`, `venice_key_invalid`, `internal_error`.
- **Narrative fields** — responses for Story, Chapter, Character, OutlineItem, Chat, Message never include ciphertext siblings (`*Ciphertext`, `*Iv`, `*AuthTag`). The repo layer strips them ([E9]).
- **Secrets** — `passwordHash` is never returned. The decrypted Venice API key is never returned; the "hasKey / lastSix / endpoint" shape is the only read surface ([AU12]).

---

## Auth — `/api/auth`

### `POST /api/auth/register` — Public
Create a user account with a username + password (supersedes the email+password original in [AU1] via [AU9]).

Request:
```json
{ "username": "eira_v", "password": "correct horse battery staple", "name": "Eira" }
```

Response `201`:
```json
{ "user": { "id": "ckxy…", "username": "eira_v", "name": "Eira", "createdAt": "…" }, "accessToken": "eyJhbGci…" }
```
Sets cookie: `refreshToken=<jwt>; HttpOnly; Path=/api/auth; Max-Age=604800`.

Errors: `409 { code: "conflict", message: "Username unavailable" }` (duplicate username — timing equalised). `400` for validation failures.

### `POST /api/auth/login` — Public
Request: `{ "username": "eira_v", "password": "…" }`
Response `200`: `{ "user": {...}, "accessToken": "…" }` + refresh cookie.
Errors: `401 { code: "unauthorized", message: "Invalid credentials" }` — same body + timing for "user not found" and "password mismatch" ([AU10]).

### `POST /api/auth/refresh` — Public (reads cookie)
Rotates the refresh token in a single transaction. Response `200`: `{ "accessToken": "…" }`. Sets a new refresh cookie.
Errors: `401 { code: "unauthorized", message: "Session expired" }`.

### `POST /api/auth/logout` — Requires access token + cookie
Deletes the DB record for the presented refresh token and clears the cookie. Response `204`.

### `GET /api/auth/me`
Response `200`: `{ "user": { "id", "username", "name", "createdAt" } }`.

---

## User — `/api/users/me`

### `GET /api/users/me/settings` · `PATCH /api/users/me/settings` ([B11])
Read/write `User.settingsJson`. Zod enforces allowed keys: `theme`, `proseFont`, `proseSize`, `lineHeight`, `writing.{typewriter,focusParagraph,autosave,smartQuotes,emDashExpansion}`, `dailyGoal`, `chat.{model,temperature,top_p,max_tokens,frequency_penalty}`, `ai.includeVeniceSystemPrompt` (boolean, default `true` when absent — controls `venice_parameters.include_venice_system_prompt` on every `/api/ai/complete` call), and `prompts` (user-level prompt overrides — see below).

The `prompts` slice sits next to `ai`:

```json
"prompts": {
  "system": "string | null",
  "continue": "string | null",
  "rewrite": "string | null",
  "expand": "string | null",
  "summarise": "string | null",
  "describe": "string | null"
}
```

`null` for any field means use the built-in default. The defaults are exposed read-only via `GET /api/ai/default-prompts`.

Response `200`: `{ "settings": { … } }`.

### `GET /api/users/me/venice-key` ([AU12])
Response `200`: `{ "hasKey": true, "lastSix": "abx9ab", "endpoint": "https://api.venice.ai/api/v1" }`. Never returns the key.

### `PUT /api/users/me/venice-key` ([AU12])
Body: `{ "apiKey": "vn-…", "endpoint?": "https://…" }`. Validates by calling Venice `GET /v1/models` before storing; encrypts via the AU11 helper.
Response `200`: `{ "status": "saved", "lastSix": "abx9ab" }`.
Errors: `400 { code: "venice_key_invalid" }` on 401 from Venice (key not stored).

### `DELETE /api/users/me/venice-key` ([AU12])
Nulls the four BYOK columns. Response `200`: `{ "status": "removed" }`.

### `POST /api/users/me/venice-key/verify` ([V18])
Rate-limited 6 req/min/user.
Response `200`: `{ "verified": true, "balanceUsd": 22.5, "diem": 15.0, "endpoint": "…", "lastSix": "abx9ab" }`. The `balanceUsd` value is read from Venice's `x-venice-balance-usd` response header (matches the figure on Venice's account dashboard) — denominated in USD, not arbitrary "credits". Either of `balanceUsd` / `diem` may be `null` when the corresponding header is absent.

---

## Stories — `/api/stories`

### `GET /api/stories` ([B1])
Response `200`: `{ "stories": [{ "id", "title", "genre", "synopsis", "targetWords", "chapterCount", "wordCount", "updatedAt" }] }`.

### `POST /api/stories` ([B1])
Body: `{ "title": "…", "genre?", "synopsis?", "worldNotes?", "targetWords?" }`.
Response `201`: `{ "story": { … } }`.

### `GET /api/stories/:id` ([B2])
Response `200`: `{ "story": { … full record … } }` — a flat story record only. Chapters and characters are fetched via their own endpoints (`GET /api/stories/:storyId/chapters`, `GET /api/stories/:storyId/characters`).

### `PATCH /api/stories/:id` ([B2])
Body: partial of create shape. Response `200`: `{ "story": { … } }`.

### `DELETE /api/stories/:id` ([B2])
Cascades chapters / characters / outline / chats. Response `204`.

### `GET /api/stories/:id/progress` ([B9])
Response `200`: `{ "wordCount", "targetWords", "percent", "chapters": [{ "id", "wordCount" }] }`.

---

## Chapters — `/api/stories/:storyId/chapters`

### `GET /api/stories/:storyId/chapters` ([B3])
Response `200`: `{ "chapters": [{ "id", "title", "orderIndex", "wordCount", "status", "updatedAt" }] }` — sorted by `orderIndex`.

### `POST /api/stories/:storyId/chapters` ([B3])
Body: `{ "title": "…", "bodyJson?": { … }, "status?" }`. Backend auto-assigns `orderIndex` and computes `wordCount` from `bodyJson`. (Post-[E5]/[E11] the plaintext `content` column is dropped; only the TipTap `bodyJson` tree is persisted, encrypted. Plaintext is derived on demand for export / AI prompts, never stored.)
Response `201`: `{ "chapter": { … } }`.

### `GET /api/stories/:storyId/chapters/:chapterId` ([B3])
Response `200`: `{ "chapter": { "id", "title", "bodyJson", "status", "orderIndex", "wordCount", "updatedAt" } }`. `bodyJson` is the parsed TipTap document tree (decrypted by the chapter repo).

### `PATCH /api/stories/:storyId/chapters/:chapterId` ([B3], [B10])
Body: any subset of `{ "title", "bodyJson", "status", "orderIndex" }`. If `bodyJson` is sent, the backend derives `wordCount` from it via `tipTapJsonToText()`.
Response `200`: `{ "chapter": { … } }`.

### `DELETE /api/stories/:storyId/chapters/:chapterId` ([B3])
Response `204`.

### `PATCH /api/stories/:storyId/chapters/reorder` ([B4])
Body: `{ "chapters": [{ "id", "orderIndex" }] }` — updated in a single Prisma transaction.
Response `204 No Content`. The client re-fetches the list via `GET /api/stories/:storyId/chapters` to pick up the new order.

---

## Characters — `/api/stories/:storyId/characters` ([B5])

### `GET /api/stories/:storyId/characters`
Response `200`: `{ "characters": [{ "id", "name", "role", "age", "appearance", "voice", "arc", "initial", "color", "personality", "backstory", "notes", "physicalDescription" }] }`.

### `POST /api/stories/:storyId/characters`
Body: any subset of the read shape + required `name`. Response `201`: `{ "character": { … } }`.

### `GET|PATCH|DELETE /api/stories/:storyId/characters/:characterId`
Standard CRUD. Response `200`/`204`.

---

## Outline — `/api/stories/:storyId/outline` ([B8])

### `GET /api/stories/:storyId/outline`
Response `200`: `{ "items": [{ "id", "order", "title", "sub", "status" }] }`.

### `POST /api/stories/:storyId/outline`
Body: `{ "title", "sub?", "status" }`. `status` is a free-form short string (1–40 chars) — the mockup uses values like `"queued"`, `"active"`, and `"done"` by convention, but the server doesn't pin an enum. Backend auto-assigns `order`. Response `201`.

### `PATCH|DELETE /api/stories/:storyId/outline/:outlineItemId`
Standard update/delete.

### `PATCH /api/stories/:storyId/outline/reorder`
Body: `{ "items": [{ "id", "order" }] }`. Single transaction. Response `204 No Content`. The client re-fetches via `GET /api/stories/:storyId/outline` to pick up the new order.

---

## Chats — `/api/chapters/:chapterId/chats` + `/api/chats/:chatId/messages` ([V15], [V16])

### `POST /api/chapters/:chapterId/chats`
Body: `{ "title?": "…" }`. Response `201`: `{ "chat": { "id", "chapterId", "title", "createdAt" } }`.

### `GET /api/chapters/:chapterId/chats`
Response `200`: `{ "chats": [{ "id", "title", "updatedAt" }] }`.

### `GET /api/chats/:chatId/messages`
Response `200`: `{ "messages": [{ "id", "role", "contentJson", "attachmentJson", "citationsJson", "model", "tokens", "latencyMs", "createdAt" }] }`. `citationsJson` is `Citation[] | null` — non-null only for assistant turns where Venice web search returned ≥1 valid citation ([V26]).

```ts
// Shared with POST SSE frame payloads.
interface Citation {
  title: string;
  url: string;
  snippet: string;
  publishedAt: string | null;
}
```

### `POST /api/chats/:chatId/messages` — SSE stream
Body: `{ "userMessage": { "contentJson": {…} }, "attachment?": { "selectionText", "chapterId" }, "modelId", "enableWebSearch?": boolean, "params?": { "temperature", "top_p", "max_tokens", "frequency_penalty" } }`.

`enableWebSearch` ([V26]) defaults to `false`. When `true`, the backend sets `venice_parameters.enable_web_search: 'auto'`, `enable_web_citations: true`, and `include_search_results_in_stream: true` for this turn only. When the assistant turn is backed by web search and Venice returned results, the stream opens with a single `event: citations\ndata: {"citations":[...]}\n\n` frame before the first content frame. Absent otherwise (web search off, or on but no results).

Persists the user message (with optional `attachmentJson`), calls Venice via per-user client ([V17]), streams the assistant tokens back as SSE, then persists the assistant message with captured `tokens`, `latencyMs`, and (when present) the projected `citationsJson`.

Errors: `409 { code: "venice_key_required" }` when the user has no stored key.

---

## AI — `/api/ai`

### `GET /api/ai/models` ([V1])
Response `200`: `{ "models": [{ "id", "name", "contextLength", "supportsReasoning", "supportsVision" }] }`. Cached 10 min in memory.

### `GET /api/ai/default-prompts`

Returns the canonical default templates the prompt builder falls back to
when a user has not overridden a given key. Auth-required. Constants
change only on backend deploy — frontend caches with `staleTime: Infinity`.

**Response 200**
```json
{
  "defaults": {
    "system": "string",
    "continue": "string",
    "rewrite": "string",
    "expand": "string",
    "summarise": "string",
    "describe": "string"
  }
}
```

### `GET /api/ai/balance` ([V10])
Response `200`: `{ "usd": 15.0, "diem": 2200 }`.

### `POST /api/ai/complete` — SSE stream ([V5], [V7])
Body: `{ "action": "continue" | "rewrite" | "describe" | "expand" | "summarise" | "ask" | "freeform", "selectedText?", "chapterContent?", "storyId", "modelId", "enableWebSearch?" }`.

Backend: fetches story + characters + world notes via the repo layer (decrypted), calls prompt builder ([V3]) with `modelContextLength` from cache, calls Venice with `stream: true`, pipes SSE back verbatim. Sets `venice_parameters.include_venice_system_prompt` from the authenticated user's `settingsJson.ai.includeVeniceSystemPrompt` (default `true` when absent — user-configurable via Settings → Venice per [F43] / [B11]); conditionally sets `strip_thinking_response`, `enable_web_search`, `enable_web_citations`, and `prompt_cache_key` per [V6]–[V8].

Response headers: `x-venice-remaining-requests`, `x-venice-remaining-tokens` ([V9]).

Errors: `409 { code: "venice_key_required" }`. `429 { code: "rate_limited", retryAfter }` when Venice returns 429. `502 { code: "venice_unavailable" }` on Venice 5xx.

---

## Health — `/api/health` ([B6]) — Public
Response `200`: `{ "status": "ok", "db": "connected" }`.
Response `503`: `{ "status": "degraded", "db": "unreachable" }` when Prisma can't reach Postgres.

---

## Rate Limits

- Global: Helmet + a sensible default (TBD in [AU7]).
- `/api/ai/*`: 20 req/min/IP ([AU7]).
- `/api/users/me/venice-key/verify`: 6 req/min/user ([V18]).
