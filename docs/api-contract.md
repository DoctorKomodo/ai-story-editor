# API Contract

All endpoints are served from the Express backend at `/api`. Content type is `application/json` unless noted (SSE streams use `text/event-stream`). Timestamps are ISO-8601 UTC. IDs are CUIDs.

---

## Conventions

- **Auth** — unless marked "Public", every endpoint requires the auth middleware ([AU5]) and is scoped to `req.user.id`. Protected endpoints expect `Authorization: Bearer <JWT>`. The refresh-token cookie (`refreshToken`, `HttpOnly; SameSite=Lax; Secure` in prod) is only read by `/api/auth/refresh` and `/api/auth/logout`.
- **Ownership** — every route that references a `:storyId`, `:chapterId`, `:characterId`, `:outlineItemId`, `:chatId`, or `:messageId` passes through the ownership middleware ([AU6]) and returns `403 { error: { message, code: "forbidden" } }` on mismatch.
- **Validation** — request bodies are Zod-validated ([AU / B series]); invalid payloads return `400 { error: { message, code: "validation_error", issues } }`.
- **Errors** — global error handler returns `{ error: { message, code } }`. Never exposes stack traces in `NODE_ENV=production` ([B7]). Common codes: `unauthorized`, `forbidden`, `not_found`, `conflict`, `rate_limited`, `venice_key_required`, `venice_key_invalid`, `internal_error`.
- **Narrative fields** — responses for Story, Chapter, Character, OutlineItem, Chat, Message never include ciphertext siblings (`*Ciphertext`, `*Iv`, `*AuthTag`). The repo layer strips them ([E9]).
- **Secrets** — `passwordHash` is never returned. The decrypted Venice API key is never returned; the "hasKey / lastFour / endpoint" shape is the only read surface ([AU12]).

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
Read/write `User.settingsJson`. Zod enforces allowed keys: `theme`, `proseFont`, `proseSize`, `lineHeight`, `writing.{typewriter,focusParagraph,autosave,smartQuotes,emDashExpansion}`, `dailyGoal`, `chat.{model,temperature,top_p,max_tokens,frequency_penalty}`, `ai.includeVeniceSystemPrompt` (boolean, default `true` when absent — controls `venice_parameters.include_venice_system_prompt` on every `/api/ai/complete` call).
Response `200`: `{ "settings": { … } }`.

### `GET /api/users/me/venice-key` ([AU12])
Response `200`: `{ "hasKey": true, "lastFour": "x9ab", "endpoint": "https://api.venice.ai/api/v1" }`. Never returns the key.

### `PUT /api/users/me/venice-key` ([AU12])
Body: `{ "apiKey": "vn-…", "endpoint?": "https://…" }`. Validates by calling Venice `GET /v1/models` before storing; encrypts via the AU11 helper.
Response `200`: `{ "status": "saved", "lastFour": "x9ab" }`.
Errors: `400 { code: "venice_key_invalid" }` on 401 from Venice (key not stored).

### `DELETE /api/users/me/venice-key` ([AU12])
Nulls the four BYOK columns. Response `200`: `{ "status": "removed" }`.

### `POST /api/users/me/venice-key/verify` ([V18])
Rate-limited 6 req/min/user.
Response `200`: `{ "verified": true, "credits": 2200, "diem": 15.0, "endpoint": "…", "lastFour": "x9ab" }`.

---

## Stories — `/api/stories`

### `GET /api/stories` ([B1])
Response `200`: `{ "stories": [{ "id", "title", "genre", "synopsis", "targetWords", "chapterCount", "wordCount", "updatedAt" }] }`.

### `POST /api/stories` ([B1])
Body: `{ "title": "…", "genre?", "synopsis?", "worldNotes?", "targetWords?", "systemPrompt?" }`.
Response `201`: `{ "story": { … } }`.

### `GET /api/stories/:id` ([B2])
Response `200`: `{ "story": { … full record …, "chapters": [{ id, title, orderIndex, wordCount, status }], "characters": [{ id, name, role, initial, color }] } }`.

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
Body: `{ "title": "…", "content?": "…", "bodyJson?": { … } }`. Backend auto-assigns `orderIndex` and computes `wordCount`.
Response `201`: `{ "chapter": { … } }`.

### `GET /api/stories/:storyId/chapters/:chapterId` ([B3])
Response `200`: `{ "chapter": { "id", "title", "bodyJson", "content", "status", "orderIndex", "wordCount", "updatedAt" } }`.

### `PATCH /api/stories/:storyId/chapters/:chapterId` ([B3], [B10])
Body: any subset of `{ "title", "bodyJson", "content", "status" }`. If `bodyJson` is sent, backend derives `content` + `wordCount` via `tipTapJsonToText()`.
Response `200`: `{ "chapter": { … } }`.

### `DELETE /api/stories/:storyId/chapters/:chapterId` ([B3])
Response `204`.

### `PATCH /api/stories/:storyId/chapters/reorder` ([B4])
Body: `{ "chapters": [{ "id", "orderIndex" }] }` — updated in a single Prisma transaction.
Response `200`: `{ "chapters": [{ "id", "orderIndex" }] }`.

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
Body: `{ "title", "sub?", "status": "done" | "current" | "pending" }`. Backend auto-assigns `order`. Response `201`.

### `PATCH|DELETE /api/stories/:storyId/outline/:outlineItemId`
Standard update/delete.

### `PATCH /api/stories/:storyId/outline/reorder`
Body: `{ "items": [{ "id", "order" }] }`. Single transaction. Response `200`: `{ "items": [{ "id", "order" }] }`.

---

## Chats — `/api/chapters/:chapterId/chats` + `/api/chats/:chatId/messages` ([V15], [V16])

### `POST /api/chapters/:chapterId/chats`
Body: `{ "title?": "…" }`. Response `201`: `{ "chat": { "id", "chapterId", "title", "createdAt" } }`.

### `GET /api/chapters/:chapterId/chats`
Response `200`: `{ "chats": [{ "id", "title", "updatedAt" }] }`.

### `GET /api/chats/:chatId/messages`
Response `200`: `{ "messages": [{ "id", "role", "contentJson", "attachmentJson", "model", "tokens", "latencyMs", "createdAt" }] }`.

### `POST /api/chats/:chatId/messages` — SSE stream
Body: `{ "userMessage": { "contentJson": {…} }, "attachment?": { "selectionText", "chapterId" }, "modelId", "params?": { "temperature", "top_p", "max_tokens", "frequency_penalty" } }`.

Persists the user message (with optional `attachmentJson`), calls Venice via per-user client ([V17]), streams the assistant tokens back as SSE (`event: token`, `event: done`), then persists the assistant message with captured `tokens` + `latencyMs`.

Errors: `409 { code: "venice_key_required" }` when the user has no stored key.

---

## AI — `/api/ai`

### `GET /api/ai/models` ([V1])
Response `200`: `{ "models": [{ "id", "name", "contextLength", "supportsReasoning", "supportsVision" }] }`. Cached 10 min in memory.

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
