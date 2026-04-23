# Venice.ai Integration

Venice is OpenAI API-compatible. We talk to it via the `openai` npm package pointed at Venice's base URL. Venice-specific behaviour (reasoning-token stripping, web search, prompt cache key, etc.) is carried in the `venice_parameters` object passed through the SDK's request body.

This doc covers: client construction, the `venice_parameters` we set and why, prompt construction, dynamic context budgeting, SSE streaming, reasoning-model handling, prompt caching, rate-limit + balance header use, and error mapping.

---

## Client Setup

The `openai` client is constructed **per user, per request** — [V17] supersedes the singleton sketched in [A4]. There is no server-wide Venice key ([AU13]); each user supplies their own via [AU12] (BYOK) and it's stored AES-256-GCM encrypted at rest.

```ts
// backend/src/services/venice.client.service.ts — [V17]
import OpenAI from 'openai';
import { getUserVeniceKey } from '../services/byok.service';

export class NoVeniceKeyError extends Error {}

export async function getVeniceClient(userId: string): Promise<OpenAI> {
  const stored = await getUserVeniceKey(userId); // decrypts via [AU11]
  if (!stored) throw new NoVeniceKeyError('venice_key_required');
  return new OpenAI({
    apiKey: stored.apiKey,
    baseURL: stored.endpoint ?? 'https://api.venice.ai/api/v1',
  });
}
```

Never cache the `OpenAI` instance across users — one account's key must never serve another's request. [A4]'s `backend/src/lib/venice.ts` now re-exports `NoVeniceKeyError` and the per-user client factory; no other file imports `openai` directly.

---

## `venice_parameters` We Set

Venice-specific behaviour passed under `body.venice_parameters`:

| Parameter | Value | When | Task |
|---|---|---|---|
| `include_venice_system_prompt` | `userSettings.ai.includeVeniceSystemPrompt ?? true` | Every call | [V4] — user-configurable via Settings → Venice. |
| `strip_thinking_response` | `true` | Selected model has `supportsReasoning: true` | [V6] — avoid leaking chain-of-thought tokens into the final text. |
| `enable_web_search` | `"auto"` | Caller opts in via `enableWebSearch: true` | [V7] — research hook for world-building. |
| `enable_web_citations` | `true` | Same as above | [V7] — keep citations for fact claims. |
| `prompt_cache_key` | `sha256(storyId + modelId)` | Always, on every `/api/ai/complete` call | [V8] — route same-story requests to the same backend for cache-hit uplift. |

All five flags pass through the `openai` SDK via `body.venice_parameters`. Tests pin each invariant ([V4] / [V6] / [V7] / [V8] test files in `tests/ai/` + `tests/services/`).

**`include_venice_system_prompt` is additive, not exclusive.** Inkwell's own system message (the default creative-writing prompt, or the per-story `Story.systemPrompt` override from [V13]) is sent as a `system` message on every call. The Venice flag only controls whether Venice additionally prepends its built-in creative-writing guidance on top. The `/api/ai/complete` route reads `req.user.settingsJson.ai.includeVeniceSystemPrompt` (default `true` if missing) and passes it to the prompt builder as an explicit boolean — the builder never hardcodes the value.

---

## Prompt Construction — `src/services/prompt.service.ts`

Inputs: `action`, `selectedText`, `chapterContent`, `characters[]`, `worldNotes`, `modelContextLength`, optional per-story `systemPrompt`.

Shape:

1. **System message** — per-story `Story.systemPrompt` if non-null ([V13]); otherwise the default creative-writing prompt.
2. **Story context block** — `genre`, `worldNotes`, and a **condensed** character list (`{ name, role, key traits }`). Character context + `worldNotes` are never truncated ([V3]).
3. **Chapter context** — the current chapter's decrypted prose, truncated from the top (oldest content first) when over-budget.
4. **Action prompt** — the per-action template ([V12] / [V14]) invoking Continue / Rewrite / Describe / Expand / Summarise / Ask / Freeform over `selectedText`.

The prompt builder never sees ciphertext — chapter bodies are decrypted via the chapter repo ([E9]) before entering the builder, and plaintext lives only for the request's lifetime.

### AI Actions ([V12] + [V14])

- **Continue** — continues from where the selection (or cursor context) ends, matching the established style. ~80 words for `⌥+Enter` cursor-continue.
- **Rewrite** — rewrites the selected passage with different phrasing, preserving meaning.
- **Describe** — adds sensory description around the selection.
- **Expand** — adds depth/detail to the selected passage. Rendered inline as the AI result card ([F34]).
- **Summarise** — condenses the selected text.
- **Ask** — routes the selection into the chat panel as an attachment ([F41]).
- **Freeform** — passes the user's custom instruction as the direct prompt.

Each action has a system prompt that instructs the model to return **only** the content with no preamble or markdown wrapper.

---

## Dynamic Context Budgeting ([V2] + [V3])

**Token counts are never hardcoded.** The prompt builder always consults the current model's `context_length`:

```
budgetForPrompt = modelContextLength - reserveForResponse (20% of context_length, rounded down)
```

The context length comes from the cached `GET /v1/models` call (`venice.models.service.ts` — [V2]), refreshed every 10 minutes.

If the composed prompt exceeds `budgetForPrompt`:
- **Truncate** `chapterContent` from the **top** (oldest prose removed first) until the budget is met.
- **Never truncate** the system prompt, character context, or `worldNotes`.
- If the remaining content still can't fit, surface `413 { code: "context_overflow" }`.

Tests exercise every branch ([T5]): character context present, `worldNotes` present, `include_venice_system_prompt` reflects the caller-supplied setting (default `true`) independent of action type, model, and `Story.systemPrompt`, truncation direction, budget respects `context_length`.

---

## Streaming (SSE)

Venice speaks standard OpenAI SSE when `stream: true` is set. We pass the stream through to the client without buffering:

```ts
// /api/ai/complete — [V5]
const completion = await client.chat.completions.create({
  model: modelId,
  messages,
  stream: true,
  body: { venice_parameters: { ... } },
});

res.setHeader('Content-Type', 'text/event-stream');
res.setHeader('Cache-Control', 'no-cache');
res.setHeader('Connection', 'keep-alive');
for await (const chunk of completion) {
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}
res.write('data: [DONE]\n\n');
res.end();
```

The frontend reads the stream with `ReadableStream` / `TextDecoder` (not `fetch().then(res => res.json())`) and renders tokens into the editor or chat bubble as they arrive ([F15] / [F34] / [F39]).

---

## Reasoning Model Handling ([V6])

Venice tags some models (e.g. `…-reasoning`) with `supportsReasoning: true`. When such a model is selected:

- `venice_parameters.strip_thinking_response = true` — drops chain-of-thought tokens before the final delta arrives.
- The frontend's thinking-dots placeholder stays on-screen until the first non-thinking token, then switches to streaming render ([F34]).

Non-reasoning models never set this flag; the test in `tests/ai/reasoning.test.ts` pins both branches.

---

## Prompt Caching ([V8])

Every `/api/ai/complete` request sets:

```
venice_parameters.prompt_cache_key = sha256(`${storyId}:${modelId}`).slice(0, 32)
```

The hash is **deterministic per (storyId, modelId) pair**: same story + same model → same Venice backend → higher cache-hit rate → lower latency and lower cost for the user. Truncating to 32 hex characters keeps the key compact in Venice's telemetry without sacrificing uniqueness (2^128 collision space is sufficient).

Key properties:
- **Server-side only** — computed in `ai.routes.ts`, never accepted from the client.
- **Content-blind** — the key is derived from IDs, not from plaintext content. Leaking the cache key reveals only that two requests targeted the same story with the same model.
- **Always set** — `prompt_cache_key` is present on every `/api/ai/complete` call regardless of action type, model, or web-search flag.
- **Not stored** — recomputed freshly on each request; no persistence needed.

---

## Rate Limit + Balance Headers

### Rate limit ([V9])

After each Venice call we read:
- `x-ratelimit-remaining-requests`
- `x-ratelimit-remaining-tokens`

…and forward them to the frontend as:
- `x-venice-remaining-requests`
- `x-venice-remaining-tokens`

The editor's usage indicator ([F16]) reads those headers after each AI call.

### Balance ([V10])

`GET /api/ai/balance` makes a lightweight Venice call and returns `x-venice-balance-usd` + `x-venice-balance-diem`. The frontend shows these in the user menu / settings → Venice tab ([F43]).

---

## Error Handling ([V11])

| Venice status | Mapped response | User-visible message |
|---|---|---|
| `401` | `500 { code: "internal_error" }` on the server-wide path *(no longer exists post-[AU13])* · `400 { code: "venice_key_invalid" }` on the `PUT /venice-key` validation path | "Your Venice key is invalid." |
| `403` | `403 { code: "forbidden" }` | "Venice refused the request." |
| `429` | `429 { code: "rate_limited", retryAfter }` | "Venice is rate-limiting you; try again in Ns." |
| `5xx` | `502 { code: "venice_unavailable" }` | "Venice is temporarily unavailable." |
| Network / timeout | `502 { code: "venice_unavailable" }` | Same as above. |

**Never** pass raw Venice error bodies, stack traces, or the user's API key to the frontend. The BYOK key must not appear in any log line, error object, or telemetry payload ([AU13]).

---

## References

- Venice API docs: https://docs.venice.ai
- OpenAI SDK: https://github.com/openai/openai-node (we use `^4.77.0`)
- BYOK + key storage: [encryption.md](./encryption.md) (forthcoming, [E1])

## 2026-04 Venice API audit

This is the [V22] read-only compliance audit of the Story Editor Venice integration against Venice's current public API docs. Run date: 2026-04-23. Sources: Context7 library `/websites/venice_ai` (high-reputation, benchmark 86.2), pulling from `docs.venice.ai/api-reference/*`, `docs.venice.ai/api-reference/endpoint/chat/completions`, `docs.venice.ai/api-reference/endpoint/models/list`, `docs.venice.ai/api-reference/error-codes`, `docs.venice.ai/api-reference/api-spec`, `docs.venice.ai/overview/guides/*`. No WebFetch fallback was needed.

### Compliance findings

**1. Base URL — MATCHES**
- Our side: `DEFAULT_VENICE_BASE_URL = 'https://api.venice.ai/api/v1'` at `backend/src/lib/venice.ts:15`, passed to the OpenAI SDK as `baseURL` at `backend/src/lib/venice.ts:36`.
- Venice: "base_url=`https://api.venice.ai/api/v1`" (docs.venice.ai/overview/getting-started, docs.venice.ai/api-reference/endpoint/chat/completions → `POST /v1/chat/completions`).

**2. Chat completions request shape — MATCHES**
- Our fields: `model`, `messages`, `stream`, `max_tokens`, `stream_options: { include_usage: true }`, `venice_parameters` (`backend/src/routes/ai.routes.ts:218–224`, `backend/src/routes/chat.routes.ts:339–347`).
- Venice: all five are in the documented request body for `POST /v1/chat/completions`. Note: `max_tokens` is flagged "deprecated in favor of max_completion_tokens" in Venice's spec — still accepted, but a future candidate to migrate. `stream_options.include_usage` is documented as "Whether to include usage information in the stream."
- MINOR — `max_tokens` is being phased out in favor of `max_completion_tokens`. Not broken today, but worth tracking.

**3. `venice_parameters` field names — MOSTLY MATCHES, one drift**

| Key we send | Type we send | Venice-documented type | Verdict |
|---|---|---|---|
| `include_venice_system_prompt` | boolean | boolean (default `true`) | MATCHES |
| `strip_thinking_response` | boolean (true on reasoning models) | boolean (default `false`) | MATCHES |
| `enable_web_search` | string `'auto'` | string enum `off` / `on` / `auto` (default `off`) | MATCHES |
| `enable_web_citations` | boolean `true` | boolean (default `false`) | MATCHES |
| `prompt_cache_key` | string (32-hex hash) | string | MATCHES — but lives at **top level**, not inside `venice_parameters` |

- DRIFT — `prompt_cache_key` is nested inside `venice_parameters` in both `backend/src/routes/ai.routes.ts:204` and `backend/src/routes/chat.routes.ts:333`. Venice documents `prompt_cache_key` as a **top-level** chat-completion body parameter ("When supplied, this field may be used to optimize conversation routing to improve cache performance and thus reduce latency" — docs.venice.ai/api-reference/endpoint/chat/completions → Chat Completion Parameters). It does not appear in the `venice_parameters` object schema on docs.venice.ai/api-reference. Placing it there means Venice almost certainly ignores it — cache hits are silently not happening. Severity: degrades latency/caching; does not break correctness.

**4. SSE format — MATCHES**
- Our side: we iterate `for await (const chunk of stream)` from the OpenAI SDK, read `chunk.choices[0]?.delta?.content` (`backend/src/routes/chat.routes.ts:398`), and terminate with `data: [DONE]\n\n` (`backend/src/routes/ai.routes.ts:278`, `backend/src/routes/chat.routes.ts:427`).
- Venice: "Use `data === '[DONE]' continue` … `chunk.choices?.[0]?.delta?.content`" (docs.venice.ai/overview/guides/tee-e2ee-models JS + Python examples). Terminator and shape confirmed.

**5. Reasoning models / `strip_thinking_response` — MATCHES**
- Our side: `veniceModelsService.findModel(body.modelId)` reads `supportsReasoning` from `model_spec.capabilities.supportsReasoning` (`backend/src/services/venice.models.service.ts:55`) and we set `strip_thinking_response: true` when true (`backend/src/routes/ai.routes.ts:193–195`, `backend/src/routes/chat.routes.ts:329–331`).
- Venice: "You can discover a model's capabilities, including whether it supports reasoning … by querying the `/v1/models` endpoint. The response will include fields like `supportsReasoning`" (docs.venice.ai/overview/guides/reasoning-models). Example response shows `model_spec.capabilities.supportsReasoning: false`.
- Note: Venice has since added `disable_thinking` and `reasoning.effort` / `reasoning_effort` parameters for finer-grained control — we don't use them, which is fine for now but a future enrichment opportunity.

**6. Web search / citations response shape — GAP (read-only, not parsed)**
- Our side: we set `enable_web_search: 'auto'` + `enable_web_citations: true` on request (`backend/src/routes/ai.routes.ts:198–201`), but we never parse citations out of the response chunks — chunks are passed through verbatim as SSE frames. `chat.routes.ts` persists `accumulatedContent` (delta text only) to the message log; any `citations` array on `choices[0].message` or in a search-result chunk is dropped.
- Venice: documents `include_search_results_in_stream` (experimental — emits search results as the first chunk) and `return_search_results_as_documents` (surfaces results as an OpenAI-compatible tool call named `venice_web_search_documents`). We don't set either, so Venice's behavior defaults to inlining citations in the model's text output.
- Verdict: not broken — but the frontend can't render a citations sidebar until the backend chooses one of the two modes and parses it. Flag as a gap rather than drift.

**7. Models endpoint (`model_spec.availableContextTokens` + `capabilities`) — MATCHES**
- Our side: `mapModel()` reads `raw.model_spec.availableContextTokens` (number) and `raw.model_spec.capabilities.{supportsReasoning, supportsVision}` (`backend/src/services/venice.models.service.ts:52–57`), and filters to `raw.type === 'text'` (line 93).
- Venice (verbatim from docs.venice.ai/api-reference/endpoint/models/list example response): top-level `type: "text"`, `model_spec.availableContextTokens: 131072`, `model_spec.capabilities.supportsReasoning: false`, `model_spec.capabilities.supportsVision: false`. Field paths confirmed unchanged.

**8. Rate-limit headers — MATCHES**
- Our side: we forward `x-ratelimit-remaining-requests` and `x-ratelimit-remaining-tokens` (`backend/src/routes/ai.routes.ts:241–248`, `backend/src/routes/chat.routes.ts:364–371`), and read `x-venice-balance-usd` + `x-venice-balance-diem` for `/balance` (`backend/src/routes/ai.routes.ts:90–93`).
- Venice: all four headers are documented verbatim on docs.venice.ai/api-reference → "Rate Limiting Information" and "Account Balance Information".
- Note: Venice also publishes `x-ratelimit-limit-{requests,tokens}` and `x-ratelimit-reset-{requests,tokens}` — we don't forward these. Not drift; just an opportunity for a richer frontend usage display.

**9. Error mapping — PARTIAL DRIFT**
- Our side: `mapVeniceError` / `mapVeniceErrorToSse` in `backend/src/lib/venice-errors.ts:64–154`. We branch on `APIError` subclasses (`AuthenticationError` → 400 `venice_key_invalid`; `RateLimitError` → 429 `venice_rate_limited`; 502/503/504 → 502 `venice_unavailable`; default → 502 `venice_error`). We extract `retry-after` from SDK `err.headers`.
- Venice: the documented error body shape is `{ error: string, details?: object }` (DetailedError, docs.venice.ai/api-reference/endpoint/video/queue) OR a StandardError `{ error: string, code: string }` shape referenced from the chat completions error table (docs.venice.ai/api-reference/endpoint/chat/completions). 401 error codes are `AUTHENTICATION_FAILED`, `AUTHENTICATION_FAILED_INACTIVE_KEY`, `INVALID_API_KEY`; 402 is `INSUFFICIENT_BALANCE`; 429 is `RATE_LIMIT_EXCEEDED`.
- Drift points:
  - DRIFT — we do **not** handle 402 `INSUFFICIENT_BALANCE` distinctly. The OpenAI SDK will surface 402 as a generic `APIError` with `status: 402`, which our `mapVeniceError` falls through to the "unexpected status" branch and returns 502 `venice_error`. That's wrong: 402 is actionable by the user ("top up credits"), and should surface as a distinct code. Severity: user-facing — users will see "Venice returned an unexpected error" when they've run out of credits.
  - MINOR — the `retry-after` header is referenced in Venice's 429 guidance (docs.venice.ai/overview/guides/image-editing: "checking the `Retry-After` header"), but Venice's chat/completions rate-limit headers are `x-ratelimit-reset-{requests,tokens}` (delta-seconds for tokens, unix-ts for requests). If Venice does not set `Retry-After` on 429s from `/v1/chat/completions`, `parseRetryAfter` will return `null` and the frontend never gets a concrete retry hint. Worth probing against a live 429 (L-series) to confirm which header Venice actually sets.

### Gap list

- ❌ `[V23]` move `prompt_cache_key` out of `venice_parameters` into the top-level chat-completion body — currently buried at `backend/src/routes/ai.routes.ts:204` and `backend/src/routes/chat.routes.ts:333`, which almost certainly means Venice ignores it and we are paying for cold prompts on every call.
- ⚠ `[V24]` handle 402 `INSUFFICIENT_BALANCE` in `backend/src/lib/venice-errors.ts` — map to a distinct `venice_insufficient_balance` code with a user-facing message pointing at `venice.ai/settings/api`, so the frontend can render a "Top up credits" CTA rather than a generic "unexpected error".
- ⚠ `[V25]` migrate `max_tokens` → `max_completion_tokens` — `max_tokens` is documented as deprecated; bump the field name in `buildPrompt`'s return shape and the two `chat.completions.create` call sites.
- ⚠ `[V26]` decide on a citations delivery mode and parse it — either set `venice_parameters.include_search_results_in_stream: true` and parse the first SSE chunk, or set `return_search_results_as_documents: true` and parse the `venice_web_search_documents` tool call. Until one is wired, the `enable_web_citations: true` we send is effectively decorative — citations land as inline text and the frontend cannot render a sources panel.
- ⚠ `[V27]` verify `retry-after` header presence on Venice 429s — if Venice sends `x-ratelimit-reset-tokens` instead of / in addition to `Retry-After`, extend `parseRetryAfter` in `backend/src/lib/venice-errors.ts:27–45` to fall back to the `x-ratelimit-reset-*` headers.
- ⚠ `[V28]` (low priority) surface `x-ratelimit-limit-{requests,tokens}` and `x-ratelimit-reset-{requests,tokens}` alongside the remaining-* headers we already forward, so the frontend can compute "X / Y remaining until HH:MM" without a second round-trip.
