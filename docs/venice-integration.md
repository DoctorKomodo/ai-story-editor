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
res.write('event: done\ndata: {}\n\n');
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

We set `venice_parameters.prompt_cache_key = sha256(storyId + modelId)` on every `/api/ai/complete` request. Same story + same model → same Venice backend → higher cache-hit rate → lower latency and cost. The key is deterministic and does not leak story content. Hash is computed server-side in the prompt builder.

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
