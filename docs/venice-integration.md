# Venice.ai Integration

Venice is OpenAI API-compatible. We talk to it via the `openai` npm package pointed at Venice's base URL. Venice-specific behaviour (reasoning-token stripping, web search, etc.) is carried in the `venice_parameters` object passed through the SDK's request body; a few other knobs (`prompt_cache_key`, `max_completion_tokens`) are top-level chat-completion fields.

This doc covers: client construction, the `venice_parameters` we set and why, prompt construction, dynamic context budgeting, SSE streaming, reasoning-model handling, prompt caching, rate-limit + balance header use, web-search citations, and error mapping.

---

## Client Setup

The `openai` client is constructed **per user, per request**. There is no server-wide Venice key; each user supplies their own (BYOK) and it's stored AES-256-GCM encrypted at rest under the **per-user content DEK** (via `venice-key.service.ts` → `content-crypto.service.ts`), decrypted only for the lifetime of a request.

```ts
// backend/src/lib/venice.ts
import OpenAI from 'openai';

export class NoVeniceKeyError extends Error {}

const DEFAULT_VENICE_BASE_URL = 'https://api.venice.ai/api/v1';

export async function getVeniceClient(userId: string): Promise<OpenAI> {
  const stored = await getDecryptedVeniceKey(userId); // via venice-key.service
  if (!stored) throw new NoVeniceKeyError();
  return new OpenAI({
    apiKey: stored.apiKey,
    baseURL: stored.endpoint ?? DEFAULT_VENICE_BASE_URL,
  });
}
```

`getVeniceClient` is the only path to Venice — there is no singleton. A missing key throws `NoVeniceKeyError`, which the global error handler maps to HTTP **409** `{ error: { code: "venice_key_required" } }`. Never cache the `OpenAI` instance across users — one account's key must never serve another's request. `backend/src/lib/venice.ts` is the canonical home; `lib/venice-errors.ts` and `services/venice.models.service.ts` are the only other modules that import `openai`.

---

## `venice_parameters` We Set

Venice-specific behaviour passed under `body.venice_parameters` (assembled by `buildVeniceParams` in `venice-call.service.ts`):

| Parameter | Value | When |
|---|---|---|
| `include_venice_system_prompt` | `userSettings.ai.includeVeniceSystemPrompt ?? true` | Every call |
| `strip_thinking_response` | `true` | Selected model has `supportsReasoning: true` — avoid leaking chain-of-thought tokens into the final text |
| `enable_web_search` | `"auto"` | Caller opts in via `enableWebSearch: true` — **chat POST only**; never on `/api/ai/complete` |
| `enable_web_citations` | `true` | Same as above |
| `include_search_results_in_stream` | `true` | Chat POST only, when `enableWebSearch: true` — delivered as a one-shot `event: citations` SSE frame |

`prompt_cache_key` is **not** a `venice_parameter` — it's a top-level chat-completion field (see Prompt Caching).

**`include_venice_system_prompt` is additive, not exclusive.** Inkwell's own system message (the default creative-writing prompt, or the user's `system` prompt override in `User.settingsJson.prompts.system`) is sent as a `system` message on every call. The Venice flag only controls whether Venice *additionally* prepends its built-in creative-writing guidance on top. The AI route reads `req.user.settingsJson.ai.includeVeniceSystemPrompt` (default `true` if missing) and passes it to the prompt builder as an explicit boolean — the builder never hardcodes the value.

---

## Prompt Construction — `src/services/prompt.service.ts`

Inputs: `action`, `selectedText`, `chapterContent`, `characters[]`, `worldNotes`, optional previous-chapter summaries, `modelContextLength`, `modelMaxCompletionTokens`, and `userPrompts` (the user-level prompt overrides, including the `system` override).

Shape — everything stable across turns goes in the `system` message; the `user` message carries only this turn's input (the canonical single-path `buildPrompt`):

1. **System message** — the user's `system` override (`resolvePrompt(userPrompts, 'system')`) if set, otherwise the default creative-writing prompt (`DEFAULT_SYSTEM_PROMPT`); followed by world-notes, character context, the chapter, and the per-action task template.
2. **Character context** — the **full** character field set (`name`, `role`, `age`, `appearance`, `personality`, `voice`, `backstory`, `arc`, `relationships`), not a condensed subset. Character context and `worldNotes` are **never truncated**.
3. **Chapter context** — the current chapter's decrypted prose, truncated from the **top** (oldest content first) when over-budget.
4. **User message** — the per-action payload built by `buildUserPayload` over `selectedText` / the user's instruction.

The prompt builder never sees ciphertext — chapter bodies are decrypted via the chapter repo before entering the builder, and plaintext lives only for the request's lifetime.

### AI actions

`PromptAction` = `continue` / `rephrase` / `expand` / `summarise` / `rewrite` / `describe` / `scene` / `ask`:

- **Continue** — continues from where the selection (or cursor context) ends, matching the established style (`⌥+Enter` cursor-continue).
- **Rephrase / Rewrite** — restate the selected passage with different phrasing, preserving meaning (both collapse onto the `rewrite` override key).
- **Describe** — adds sensory description around the selection.
- **Expand** — adds depth/detail to the selected passage (rendered inline as the AI result card).
- **Summarise** — condenses the selected text.
- **Scene** — the scene composer; the user's free-text `freeformInstruction` is the user-turn message, rendered against the `scene` task template.
- **Ask** — routes the selection into the chat panel as an attachment.

`/api/ai/complete` accepts only `continue` / `rephrase` / `expand` / `summarise` / `rewrite` / `describe`; `ask` and `scene` are chat-surface actions. Each action's task template instructs the model to return **only** the content with no preamble or markdown wrapper.

---

## Prompt resolution

Each per-action task template is resolved via `resolvePrompt(userPrompts, key)` and goes into the **system** message:

1. If `userPrompts[key]` is a non-empty trimmed string → use the override.
2. Otherwise → use `DEFAULT_PROMPTS[key]`.

User-overridable keys (nine): `system`, `continue`, `rewrite`, `expand`, `summarise`, `summariseChapter`, `describe`, `scene`, `ask`. The `rephrase` action collapses onto the `rewrite` key (both share one override). All nine have a `DEFAULT_PROMPTS` template and are persisted in `User.settingsJson.prompts` (nine `string | null` fields, `.strict()`-validated); the Settings → Prompts tab is the sole authoring surface, and there are no per-story overrides.

`scene` and `ask` are template-driven like the rest — their task template still resolves through `resolvePrompt` — but they *additionally* take a free-text `freeformInstruction` as the **user-turn** message (the other actions use the selection as the user-turn payload).

---

## Dynamic Context Budgeting

**Token counts are never hardcoded.** The prompt budget is computed from the selected model's `context_length`, the response allowance, and a fixed safety margin — not a fixed-percentage reserve:

```
budgetForPrompt = modelContextLength - maxCompletionTokens - SAFETY_MARGIN_TOKENS   // 512
```

`modelContextLength` and the model's max-completion cap come from the cached `GET /v1/models` call (`venice.models.service.ts`), refreshed every 10 minutes.

If the composed prompt exceeds `budgetForPrompt`:
- **Truncate** `chapterContent` from the **top** (oldest prose removed first) until the budget is met.
- **Never truncate** the system prompt, character context, or `worldNotes`.

---

## Streaming (SSE)

Venice speaks standard OpenAI SSE when `stream: true` is set. `/api/ai/complete` and the chat POST pass the stream through to the client without buffering. The route uses `.withResponse()` so it can read rate-limit headers off the HTTP response before the body streams, forwards each chunk as a `data:` frame, and terminates with `data: [DONE]`:

```ts
// /api/ai/complete (simplified)
const { data: stream, response } = await client.chat.completions
  .create({ model, messages, stream: true, max_completion_tokens, prompt_cache_key, venice_parameters })
  .withResponse();

res.status(200);
res.setHeader('Content-Type', 'text/event-stream');
res.setHeader('Cache-Control', 'no-cache, no-transform');
// (forward Venice rate-limit headers, then flushHeaders())
for await (const chunk of stream) {
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}
res.write('data: [DONE]\n\n');
res.end();
```

**Once headers are flushed, errors can't use the global error handler** — a mid-stream failure is written as a terminal SSE error frame via `mapVeniceErrorToSse` (then `res.end()`), never `next(err)`. The route also aborts the upstream Venice stream on `req.on('close')`. The frontend reads the stream with a `ReadableStream` reader (not `fetch().then(res => res.json())`) and renders tokens as they arrive.

---

## Chapter summarisation (structured, non-streaming)

Chapter summarisation (`chapters.routes.ts`) is the one Venice call that is **not** SSE. It requests **structured output** — `response_format: { type: 'json_schema', json_schema: { schema: chapterSummaryJsonSchema(), strict: true } }` — and awaits the full completion, then validates the JSON against `chapterSummarySchema`. Its system message is assembled directly as `resolvePrompt(userPrompts, 'system') + resolvePrompt(userPrompts, 'summariseChapter')` (not via `buildPrompt`), it sets `prompt_cache_key` from `chapterId`, and it honours the same per-model reasoning toggle. The resulting summaries are what the prompt service feeds back as previous-chapter context on later `/api/ai/complete` calls, gated by `Story.includePreviousChaptersInPrompt`.

---

## Reasoning Model Handling

Venice tags some models with `supportsReasoning: true` (read from `model_spec.capabilities.supportsReasoning` on `/v1/models`). For a reasoning-capable model:

- `venice_parameters.strip_thinking_response = true` — drops chain-of-thought tokens before the final delta arrives.
- The frontend's thinking-dots placeholder stays on-screen until the first non-thinking token, then switches to streaming render.
- **Per-model reasoning toggle.** Users can disable reasoning for a specific model via `settings.chat.overrides[modelId].reasoning = false`. `resolveReasoningEnabled` (`venice-call.service.ts`) returns `false` only in that case (reasoning stays on by default); the route then sends the top-level `reasoning: { enabled: false }` field on the chat-completion call.

Non-reasoning models never set `strip_thinking_response` and ignore the toggle. (Venice also exposes `disable_thinking` and `reasoning.effort` for finer control — we don't use those.)

---

## Prompt Caching

`prompt_cache_key` is a **top-level** chat-completion body field (sibling of `model` / `messages` / `stream`), **not** nested under `venice_parameters`. Every AI call sets it:

```
prompt_cache_key = sha256(`${contextId}:${modelId}`).slice(0, 32)
```

The context id is `storyId` for `/api/ai/complete`, `chatId` for chat/scene messages, and `chapterId` for chapter summarisation. The key is deterministic per `(contextId, modelId)` pair: same context + same model → same Venice backend → higher cache-hit rate → lower latency and cost.

Key properties:
- **Server-side only** — computed in the route, never accepted from the client.
- **Content-blind** — derived from IDs, not plaintext. Leaking it reveals only that two requests targeted the same context with the same model.
- **Always set** — present on every call regardless of action, model, or web-search flag.
- **Not stored** — recomputed per request.

---

## Rate Limit + Balance Headers

### Rate limit

After each Venice call we read the rate-limit headers off the response and forward them to the frontend (renamed `x-ratelimit-*` → `x-venice-*`), each only when Venice actually sent it:

- `x-venice-remaining-requests` / `x-venice-remaining-tokens`
- `x-venice-limit-requests` / `x-venice-limit-tokens`
- `x-venice-reset-requests` / `x-venice-reset-tokens`

The editor's usage indicator reads these after each AI call to show "X / Y remaining until HH:MM" without a second round-trip.

### Balance

`GET /api/users/me/venice-account` makes a lightweight Venice call to `GET /api_keys/rate_limits` and reads `data.balances.{USD,DIEM}` from the JSON body. Returns `{ verified, balanceUsd, diem, endpoint, lastSix }`. The frontend shows these in the user menu (header pill via `useVeniceAccountQuery`) and the Settings → Venice tab. Per-user rate-limited at 30 req/min.

---

## Citations

When the chat POST sets `enableWebSearch: true`, the backend enables three Venice params together — `enable_web_search: 'auto'`, `enable_web_citations: true`, and `include_search_results_in_stream: true`. The third causes Venice to emit a non-standard **first chunk** carrying a `venice_search_results` array before the usual content chunks.

**Web search is chat-only.** The inline `/api/ai/complete` surface (selection-bubble rewrite / expand / describe / continue) does **not** accept `enableWebSearch` and never sets the web-search params: citation delivery (the `event: citations` frame and the persisted `citationsJson`) is wired only into the chat panel, so enabling web search on the inline surface would charge the user's Venice key for grounding whose citations are silently dropped. Re-introducing inline web search requires first building a sources UI for the inline result card.

We use `include_search_results_in_stream` rather than `return_search_results_as_documents` (which surfaces results as an OpenAI-compatible `venice_web_search_documents` tool call requiring tool-declaration plumbing). In-stream delivery is a drop-in: the SSE passthrough loop intercepts the first chunk, projects it, emits one `event: citations` frame, and forwards zero raw `venice_search_results` bytes to the client.

**Projection** (`backend/src/lib/venice-citations.ts`):

```ts
interface Citation {
  title: string;
  url: string;
  snippet: string;            // renamed from Venice's `content`
  publishedAt: string | null; // renamed from Venice's `date`
}
```

- `content → snippet` — makes "short preview, not the full page" explicit.
- `date → publishedAt` — `| null` prevents the frontend assuming presence.
- Items missing `title` or `url` are dropped silently. Hard cap of 10 items.

**SSE wire format:**

```
<optional, when web search produced results>
event: citations
data: {"citations":[{"title":"...","url":"...","snippet":"...","publishedAt":"2025-..."|null}, ...]}

<content frames, verbatim from Venice>
data: {"id":"chatcmpl-...","choices":[{"delta":{"content":"Thick fog..."}, ...}]}
...

<terminator>
data: [DONE]
```

The `event: citations` frame is emitted at most once per turn, before the first content frame. If Venice returns no results (or web search was off), it's skipped.

**Null vs empty persistence:**

- `citationsJson === null` — web search off, or on but no valid results. The persisted `citationsJsonCiphertext` triple is all-null.
- `citationsJson: [{…}]` (1–10 items) — persisted encrypted via the repo layer.
- `citationsJson === []` is explicitly **not** used — projection yields ≥1 valid citation (array) or 0 (null).

Citations ride the same AES-256-GCM wrap as other narrative content; the encryption leak test scans `Message.citationsJsonCiphertext` for narrative sentinels. URL sanitisation is intentionally **not** done server-side — the frontend MUST render URLs via `<a href={url} target="_blank" rel="noopener noreferrer">` and must never render `snippet` as HTML.

---

## Error catalog

All Venice-related error responses share the shape `{ error: { code, message, retryAfterSeconds?, details?: { veniceMessage? } } }`. `code` is stable and machine-readable; `message` is user-facing; `retryAfterSeconds` is present when known; `details.veniceMessage` is the sanitised raw text Venice returned, when present. "absent" = the field is not serialised into the body; "`null`" = serialised with a `null` value.

| HTTP | `code` | When emitted | `retryAfterSeconds` | User-facing rendering |
|---|---|---|---|---|
| 409 | `venice_key_required` | User has no BYOK key stored; emitted by the `NoVeniceKeyError` branch before any Venice call | absent | "Open Settings" link to the BYOK panel |
| 400 | `venice_key_invalid` | Venice returns 401 (stored key rejected) | absent | "Open Settings" link |
| 429 | `venice_rate_limited` | Venice returns 429 | parsed from `Retry-After`, falling back to `x-ratelimit-reset-*`; `null` when unparseable | live countdown + Retry |
| 402 | `venice_insufficient_balance` | Venice returns 402 | `null` (present, always null) | "Top up at venice.ai →" link |
| 502 | `venice_unavailable` | Venice returns 502/503/504 | absent | Retry only |
| 400/404/422/502 | `venice_error` | Forwarded Venice 400/404/422; fallback for unexpected non-2xx and transport failures | absent | Retry only |
| 400 | `unknown_model` | Client-supplied `modelId` isn't in the cached `/v1/models` list for this user; mapped centrally from `UnknownModelError` (`venice.models.service.ts`) before any Venice call | absent | inline validation error |

`details.veniceMessage` passes through (sanitised) on every row except `venice_key_required` and `unknown_model` (the latter has no `details` field at all — its `message` is `Unknown Venice model: <modelId>`, not the shared Venice-error shape). Error mapping lives in `mapVeniceError` / `mapVeniceErrorToSse` (`backend/src/lib/venice-errors.ts`), which branch on the `openai` SDK's `APIError` subclasses. Every Venice error path emits one `[venice.error]` log line:

```json
{ "route": "ai-complete", "userId": "...", "code": "venice_rate_limited",
  "upstreamStatus": 429, "retryAfterSeconds": 23, "veniceMessage": "...", "streaming": false }
```

**Never** pass raw Venice error bodies, stack traces, or the user's API key to the frontend. The BYOK key must not appear in any log line, error object, or telemetry payload. The mapper scrubs `sk-`-prefixed token fragments from `details.veniceMessage` and the `veniceMessage` log field via `SK_KEY_RE`. The frontend's `VeniceErrorBanner` reads these codes and renders the per-code affordances.

---

## References

- Venice API docs: https://docs.venice.ai
- OpenAI SDK: https://github.com/openai/openai-node (we use `^6.40.0`)
- BYOK + key storage: [encryption.md](./encryption.md)
