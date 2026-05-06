# max_completion_tokens correctness — design spec

**Date:** 2026-05-05
**Branch:** `fix/max-completion-tokens` (cut from `origin/main`)
**Goal:** Fix the per-model output-cap bug that breaks AI inline + chat for any user on a model whose `maxCompletionTokens` is below `0.2 × contextLength`. Bundle two adjacent corrections (selection-bubble action mapping; Venice error-message fidelity).

## Problem

`backend/src/services/prompt.service.ts` currently sets:

```ts
max_completion_tokens = Math.floor(modelContextLength * 0.2)
```

For a 256 000-token-context model that's 51 200. Venice rejects requests above each model's per-model output cap, e.g.:

```
HTTP 400 — Requested max_tokens or max_completion_tokens of 51200,
but the maximum allowed is 32768
```

`mapVeniceError` then translates the 400 into HTTP 502 with body `{ code: "venice_error", message: "Venice returned an unexpected error." }`. The chat hook discards even that code, surfacing `{ code: null }` to the user. Net effect: **inline rewrite/describe and all chat sends fail on every model whose Venice cap is below `0.2 × context`**, and the user-visible error tells them nothing.

Venice's `/v1/models` already exposes the per-model cap as `model_spec.maxCompletionTokens`. Real values across the catalogue:

| Cap | Models (sample) |
|---|---|
| 4 096 | llama-3.3-70b, llama-3.2-3b, venice-uncensored-role-play, several E2EE variants |
| 8 192 | venice-uncensored-1-2, gemma-4 family |
| 16 384 | qwen3-235b family, gemma-3-27b, glm-4.6/4.7, gpt-oss-120b, gpt-4o |
| 24 000 | glm-5.1, glm-4.7-flash-heretic |
| 30 000 | grok-41-fast |
| 32 000 | grok-4-3, glm-5 |
| 32 768 | z-ai-glm-5-turbo, qwen3-5-9b, claude-opus-4-5, deepseek-v3.2 + v4 family, several E2EE |
| 50 000 | mercury-2 |
| 65 536 | qwen-3-6-plus, qwen3-6-27b, qwen3-coder-480b, kimi-k2.5/k2.6, gemini-3-flash, gpt-52, gpt-52-codex, claude-sonnet-4-6 |
| 128 000 | claude-opus-4-7, claude-opus-4-6 (+fast), gpt-53-codex, gpt-54-mini, gpt-54-pro, gpt-55-pro |
| 131 072 | gpt-54, gpt-55 |

A single hardcoded ceiling is wrong in both directions: under-caps capable models, doesn't actually fix small ones if a user setting goes over.

## Decisions (recorded from brainstorm)

1. **Response budget formula.** `responseTokens = min(model_cap, user_setting)`. The 0.2-of-context heuristic dies on the response side. The user's `settings.chat.maxTokens` slider becomes a meaningful upper bound rather than stored-and-ignored.
2. **Prompt budget formula.** Derived: `promptBudgetTokens = contextLength − responseTokens − SAFETY_MARGIN_TOKENS` (512). The 0.8-of-context literal dies. Chapter truncation continues to consume `promptBudgetTokens` unchanged.
3. **Missing model_cap fallback.** When Venice's `/v1/models` omits or zeroes `maxCompletionTokens` for a given model, `mapModel()` substitutes 4 096 and emits a single `console.warn` per affected model at cache-population time. `buildPrompt` itself takes a required number — the fallback lives at the boundary, not in the pure builder.
4. **Test coverage.** Table-driven `prompt.service.test.ts` for `(contextLength, model_cap, user_setting)` combinations including chapter-truncation edges; `venice.models.service.test.ts` for the new field mapping + fallback + warn; new assertions in `routes/ai.complete.test.ts` and `routes/chat.messages.test.ts` that the value reaching the mocked Venice client matches `min(model_cap, user_setting)`; update existing Venice-models fixtures to include `maxCompletionTokens`; `editor-ai.integration.test.tsx` updated for the corrected ACTION_MAP dispatch.
5. **Settings schema cleanup.** Drop the artificial `z.number().max(32_768)` cap on `settings.chat.maxTokens` (replace with a 1 000 000 sanity ceiling against absurd payloads). Frontend slider literal `max={8000}` → `max={32_000}`. The slider is being reworked separately; this change just stops the backend from artificially limiting it.
6. **Bundle the ACTION_MAP fix.** Selection-bubble dispatch in `EditorPage.tsx` currently maps `describe → 'summarise'` and `rewrite → 'rephrase'`. Backend has had real `'describe'` and `'rewrite'` actions since V14. Make it 1:1.
7. **Bundle Venice error-message fidelity fixes.** Three sub-fixes:
   - `mapVeniceError` / `mapVeniceErrorToSse` add `details.veniceMessage` to the JSON body for unmapped statuses, carrying Venice's raw error text (sanitised against known sensitive patterns).
   - HTTP status forwarding: when Venice's status is 400 / 404 / 422, our response uses that status. Other unmapped statuses keep the existing 502 fallback.
   - `useChat.ts` catch block forwards `err.code` from `ApiError` instead of hardcoding `code: null`.

## Architecture

Three numbers flow into one. The Venice models cache sources `model_cap` from Venice; routes source `user_setting` from `User.settingsJson.chat.maxTokens`; the pure builder takes both as required parameters and produces the wire value.

```
responseTokens     = min(model_cap, user_setting)
promptBudgetTokens = contextLength − responseTokens − 512
```

Chapter-truncation logic inside `buildPrompt` continues to consume `promptBudgetTokens`. Nothing else in `buildPrompt`'s signature or callers' shape changes beyond the new required parameter.

## Components

### `backend/src/services/venice.models.service.ts` (extend)

```ts
export interface ModelInfo {
  id: string;
  name: string;
  contextLength: number;
  maxCompletionTokens: number;        // NEW
  supportsReasoning: boolean;
  supportsVision: boolean;
  supportsWebSearch: boolean;
  description: string | null;
  pricing: ModelPricing | null;
}
```

`mapModel()` reads `spec.maxCompletionTokens`. When missing, zero, or non-positive: substitute `4096` and log once per model id per cache-population:

```
[venice.models] model "<id>" exposes no positive maxCompletionTokens; defaulting to 4096
```

New cache method `getModelMaxCompletionTokens(modelId): number` mirrors the existing `getModelContextLength`. Throws the existing `UnknownModelError` on cache miss.

### `backend/src/services/prompt.service.ts` (modify)

```ts
export const SAFETY_MARGIN_TOKENS = 512;

export interface BuildPromptInput {
  // ... existing fields ...
  modelContextLength: number;
  modelMaxCompletionTokens: number;   // NEW — required
  userMaxCompletionTokens: number;    // NEW — required (route resolves; resolver returns Number.POSITIVE_INFINITY when unset)
  // ... existing fields ...
}
```

In the function body, both `responseBudgetTokens = floor(0.2 × ctx)` and `promptBudgetTokens = floor(0.8 × ctx)` are replaced:

```ts
const responseTokens = Math.min(
  input.modelMaxCompletionTokens,
  input.userMaxCompletionTokens,
);
const promptBudgetTokens = Math.max(
  0,
  input.modelContextLength - responseTokens - SAFETY_MARGIN_TOKENS,
);
// ... existing chapter-truncation reads promptBudgetTokens ...
return {
  // ... existing ...
  max_completion_tokens: responseTokens,
};
```

When `responseTokens` exceeds `contextLength − safety`, prompt budget clamps to 0 and chapter is dropped (existing behaviour for over-budget prompts). The response cap is *never* shrunk by prompt-budget pressure — the user/model contract on response length is honoured even when it leaves no room for context.

### `backend/src/services/user-settings-resolvers.ts` (new)

Lift the four duplicated helpers out of `ai.routes.ts` and `chat.routes.ts`:

```ts
export interface UserSettingsShape {
  ai?: { includeVeniceSystemPrompt?: boolean };
  chat?: { maxTokens?: number };
  prompts?: PromptsSettings;
}

export function resolveIncludeVeniceSystemPrompt(raw: unknown): boolean;
export function resolveUserPrompts(raw: unknown): PromptsSettings;
export function resolveUserMaxCompletionTokens(raw: unknown): number;  // returns Number.POSITIVE_INFINITY when unset/invalid
```

Single file, ~50 lines. Both routes import from it. Future settings additions (e.g. `temperature`, `topP` plumbing) land here too.

### `backend/src/routes/ai.routes.ts` and `chat.routes.ts` (modify)

Replace inline resolver definitions with imports. Add two more lookups before the `buildPrompt` call:

```ts
const userMaxCompletionTokens = resolveUserMaxCompletionTokens(userRow?.settingsJson ?? null);
const modelMaxCompletionTokens = veniceModelsService.getModelMaxCompletionTokens(body.modelId);

const built = buildPrompt({
  // ... existing ...
  modelContextLength,
  modelMaxCompletionTokens,
  userMaxCompletionTokens,
  // ... existing ...
});
```

### `backend/src/routes/user-settings.routes.ts` (modify)

```ts
// Before:
maxTokens: z.number().int().min(1).max(32_768).optional(),
// After:
maxTokens: z.number().int().min(1).max(1_000_000).optional(),
```

The 1 000 000 ceiling is a sanity guard against malicious payloads, not a protocol constraint. Any model_cap below the user's setting wins via `min` — no model in the catalogue today is above 131 072.

### `backend/src/lib/venice-errors.ts` (modify)

`mapVeniceError`:
- New: when `err.status` is 400, 404, or 422, use that status on the response (instead of 502).
- New: build `details: { veniceMessage }` from `err.message`, sanitised. Sanitisation scrubs against:
  - the user's Venice key (full or any 4+ char substring of the lastFour we have on `User.veniceKeyLastFour`),
  - any string matching `/sk-[A-Za-z0-9]{16,}/` (defensive, not currently observed in Venice errors).
- The user-facing `message` field stays generic: `"Venice returned an error: <short summary>"` for forwarded 400s and the existing `"Venice returned an unexpected error."` for the 502 fallback.

`mapVeniceErrorToSse`: same `details.veniceMessage` addition. SSE error frame keeps `{ error, code, message, details? }` shape; mid-stream HTTP status forwarding is irrelevant (headers already flushed).

### `frontend/src/hooks/useChat.ts` (modify)

```ts
} catch (err) {
  const message = err instanceof Error ? err.message : 'Chat send failed';
  const code = err instanceof ApiError ? (err.code ?? null) : null;   // NEW: forward code
  useChatDraftStore.getState().markError({ code, message });
  throw err;
}
```

Same pattern at line 205 (empty body branch) and line 237 (stream catch).

### `frontend/src/components/SettingsModelsTab.tsx` (modify)

```tsx
<SliderRow ... min={1} max={32_000} step={64} ... />
```

### `frontend/src/pages/EditorPage.tsx` (modify)

```ts
const ACTION_MAP: Record<Exclude<SelectionAction, 'ask'>, RunArgs['action']> = useMemo(
  () => ({
    rewrite: 'rewrite',
    describe: 'describe',
    expand: 'expand',
  }),
  [],
);
```

### `frontend/src/hooks/useAICompletion.ts` (modify)

```ts
action: 'continue' | 'rephrase' | 'expand' | 'summarise' | 'freeform' | 'rewrite' | 'describe';
```

`'rephrase'` and `'summarise'` stay in the union — backend still accepts them, no callers today, no reason to remove the option.

## Data flow (chat send, illustrative)

```
POST /chats/:id/messages
  └─ load User.settingsJson
       └─ resolveUserMaxCompletionTokens()           → user_setting (number; ∞ if unset)
  └─ veniceModelsService.fetchModels(userId)         → cache populated; mapModel warns if cap missing
       └─ getModelContextLength(modelId)             → contextLength
       └─ getModelMaxCompletionTokens(modelId)       → model_cap
  └─ buildPrompt({
       contextLength,
       modelMaxCompletionTokens: model_cap,
       userMaxCompletionTokens: user_setting,
       ...
     })                                              → max_completion_tokens, prompt_budget
  └─ client.chat.completions.create({
       max_completion_tokens,
       ...
     })
```

## Error handling

| Failure mode | Today | After this change |
|---|---|---|
| Venice 400 (e.g. malformed body, max_tokens > model_cap) | HTTP 502, `code: venice_error`, generic message; chat shows `code: null` | HTTP 400, `code: venice_error`, generic message + `details.veniceMessage` with Venice's text; chat surfaces `code: venice_error` |
| Venice 404 (unknown model) | HTTP 502, `code: venice_error` | HTTP 404, `code: venice_error` + `details.veniceMessage` |
| Venice 422 (validation) | HTTP 502, `code: venice_error` | HTTP 422, `code: venice_error` + `details.veniceMessage` |
| Venice 401 (key invalid) | HTTP 400, `code: venice_key_invalid` (unchanged) | unchanged |
| Venice 402 (insufficient balance) | HTTP 402, `code: venice_insufficient_balance` (unchanged) | unchanged |
| Venice 429 | HTTP 429, `code: venice_rate_limited` (unchanged) | unchanged |
| Venice 5xx | HTTP 502, `code: venice_unavailable` (unchanged) | unchanged |
| Other Venice non-2xx | HTTP 502, `code: venice_error`, generic message | HTTP 502, `code: venice_error` + `details.veniceMessage` |
| Cache miss for unknown model | `UnknownModelError` → 500 (unchanged) | unchanged |
| Missing model_cap from Venice | N/A (field unused) | Falls back to 4 096; one-time `console.warn` at cache fetch |
| `settings.chat.maxTokens` absent / non-numeric / ≤0 | unread | resolver returns `Number.POSITIVE_INFINITY` → `min` reduces to model_cap |

## Testing

| File | Cases |
|---|---|
| `backend/tests/services/prompt.service.test.ts` (extend) | Table-driven `(contextLength, modelMaxCompletionTokens, userMaxCompletionTokens) → max_completion_tokens, prompt_budget`. Edge cases: user > model, user < model, equal, user=∞, tiny chapter (no truncation), huge chapter (top-truncation kicks in), pathological where response > context−safety (prompt budget clamps to 0, chapter dropped, response not shrunk). |
| `backend/tests/services/venice.models.service.test.ts` (extend) | Fixture: model with cap, model without cap, model with cap=0, model with cap as string. Assert mapping, fallback to 4 096, single warn per id per cache fill. |
| `backend/tests/routes/ai.complete.test.ts` (extend) | New assertion: `max_completion_tokens` reaching mocked Venice client equals `min(model_cap, user_setting)` for two model fixtures (one cap above user, one below). |
| `backend/tests/routes/chat-message.test.ts` (extend) | Same as above for chat path. |
| `backend/tests/lib/venice-errors.test.ts` (new) | `mapVeniceError`: 400 forwards as 400; 404 as 404; 422 as 422; other unknowns stay 502. `details.veniceMessage` populated. Sanitisation scrubs key fragments. `mapVeniceErrorToSse`: same body shape; status-forwarding N/A. |
| `frontend/tests/hooks/useChat.test.tsx` (extend) | New assertion: when `apiStream` throws `ApiError(502, "...", "venice_error")`, `markError` is called with `code: "venice_error"`. |
| `frontend/tests/pages/editor-ai.integration.test.tsx` (extend) | New assertions: clicking the bubble's *Describe* button sends `action: "describe"` to `/api/ai/complete`; *Rewrite* sends `action: "rewrite"`. |
| Existing route tests | Update Venice-models JSON fixtures to include `maxCompletionTokens`. |

## Out of scope

- Dynamic slider max (per-selected-model). Slider is being reworked separately; this PR's job is to stop the backend artificially limiting it.
- Reasoning-model token reservation. Chain-of-thought eats from the response budget on `supportsReasoning` models; we don't currently model this. A future task could subtract a reasoning reserve from `responseTokens` before returning. Not blocking.
- Truncation strategy (top-truncation, char-based estimation). Pre-existing behaviour; the bug doesn't motivate touching it.
- Retry / backoff on forwarded 400s. The frontend already surfaces errors via `useErrorStore`; auto-retry on Venice 400s would mask user-actionable failures.

## Acceptance criteria

- AI inline rewrite/describe/expand and chat send all succeed against a 256k-context model with default `settings.chat.maxTokens` (800).
- AI inline calls succeed against a 4 096-cap model (e.g. `llama-3.3-70b`) — `max_completion_tokens` sent to Venice ≤ 4 096.
- A request with `settings.chat.maxTokens = 16_000` against a 4 096-cap model produces `max_completion_tokens = 4096` (model wins).
- A request with `settings.chat.maxTokens = 800` against a 128 000-cap model produces `max_completion_tokens = 800` (user wins).
- Venice 400 surfaces to the dev overlay with the original error text visible (in `details.veniceMessage`); HTTP status on the response is 400.
- Chat error overlay shows `code: "venice_error"` instead of `code: null`.
- `Describe` bubble button sends `action: "describe"`; `Rewrite` sends `action: "rewrite"`.
- All new + extended tests pass; full backend + frontend suites green.
