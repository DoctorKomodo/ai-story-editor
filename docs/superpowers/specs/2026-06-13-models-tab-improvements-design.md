# Settings → Models page improvements — design

**Date:** 2026-06-13
**Surface:** Settings → Models tab (`SettingsModelsTab`) and the underlying text-gen param-resolution layer (frontend `resolveChatParams` + backend `resolveTextGenParams`).

## Problem

Four user-requested changes to the Models tab and the params it controls:

1. The default temperature (`0.85`) is lower than wanted.
2. The Max-tokens slider has a flat hardcoded ceiling (`32_000`) unrelated to the model's real cap, and the default value (`min(800, cap)`) is far below most models' capacity.
3. Generation params only reflect the *saved active* model — selecting a different model in the picker rail doesn't show or let you edit its params until you click "Use this model".
4. There's no control over reasoning. Reasoning-capable models always reason (we only strip the thinking from output); there's no per-model on/off.

## Decisions (from brainstorming)

- **Reasoning is two-state**, not three: no forced-on detection (Venice's `/models` API exposes `supportsReasoning` but not whether reasoning can be disabled). `supportsReasoning === false` → toggle disabled+off; `supportsReasoning === true` → enabled toggle, **default On**.
- **Task 2 = ceiling AND default** (deliberate app-wide budget change — see Risks).
- **Task 1 = bump the global fallback only** (Venice per-model defaults still win when present).
- **Task 3 = edit the highlighted model** (sliders read+write the highlighted model's overrides regardless of active status).

## Changes

### 1. Default temperature → 1.0

Change `GLOBAL_TEXT_GEN_DEFAULTS.temperature` from `0.85` to `1.0` in:
- `backend/src/lib/text-gen-defaults.ts` (source of truth)
- `frontend/src/lib/textGenDefaults.ts` (mirror)

These are drift-tested against each other (`backend/tests/lib/text-gen-defaults.test.ts`). This value is the **fallback only**: resolution precedence stays `override → Venice default → global default`, so a model exposing a Venice `defaultTemperature` is unaffected. Update the drift test and any test asserting `0.85`.

### 2. Max-tokens ceiling AND default

Introduce a shared ceiling constant `MAX_OUTPUT_TOKENS_CEILING = 32_000`, mirrored on both sides next to the text-gen-defaults mirror (same drift-test discipline).

- **Slider upper bound:** `min(activeModel.maxCompletionTokens, MAX_OUTPUT_TOKENS_CEILING)` — replaces the hardcoded `32_000` literal in `SettingsModelsTab`.
- **Default value (no override):** change the no-override branch in **both** resolvers from `min(GLOBAL_TEXT_GEN_DEFAULTS.maxTokens, cap)` to `min(cap, MAX_OUTPUT_TOKENS_CEILING)`:
  - `frontend/src/hooks/useUserSettings.ts` → `resolveChatParams`
  - `backend/src/services/user-settings-resolvers.ts` → `resolveTextGenParams`

The existing override-exceeds-cap clamping (`source: 'override-capped'`) is unchanged.

Two follow-on fixes in the no-override branch:
- **Stale comment + source label (branch, don't flat-relabel).** The no-override branch in `resolveTextGenParams` (and its frontend mirror) currently labels the source `'venice-default'` *by deliberate design* — the existing comment explains the model's published `maxCompletionTokens` is the authoritative bound, so the model cap, not the global floor, is the source of truth. After this change the value is `min(cap, CEILING)`, so the label depends on which bound binds. Branch on it rather than picking any single flat label: `maxSource = cap <= MAX_OUTPUT_TOKENS_CEILING ? 'venice-default' : 'global-default'` — `'venice-default'` when the value is the model's Venice cap (`cap ≤ CEILING`), `'global-default'` when our ceiling constant clamps it (`cap > CEILING`). Note on frequency: most models expose an output cap **≥ 32K**, so `cap > CEILING` (→ `'global-default'`, value = our ceiling) is the *common* outcome and `'venice-default'` is the sub-32K minority — but the branch is correct for both, which is why it beats any flat relabel. Do **not** add a new `ParamSource`/`ChatParamSource` enum value — the label is a debug-only provenance hint (DevErrorOverlay), and a new value would ripple into both unions, their doc comments, and tests for no benefit. Update the now-stale comment to describe the `min(cap, CEILING)` logic and the branch. Update any test asserting the old single source value to expect the branched value.
- **`GLOBAL_TEXT_GEN_DEFAULTS.maxTokens` (800) is intentionally retained** as the UI fallback for the no-model-selected object in `SettingsModelsTab` — it no longer drives per-model resolution. Keep the drift test; add a one-line code comment noting it's a UI fallback only so a future reader doesn't think it still feeds resolution.

**Temperature 1.0 is in-range:** the temperature slider is `min={0} max={2}`, so the new default sits mid-range, not pinned at a bound. No slider change needed for task 1.

### 3. Params section follows the highlighted model

`ModelPickerInline` currently owns `highlightedId` internally and doesn't expose it; the parent binds the params section to `settings.chat.model` (the saved active model).

- Make `ModelPickerInline`'s highlight **controlled**: add props `highlightedId: string | null` and `onHighlightChange: (id: string) => void`; remove the internal `useState` and its sync effect (`ModelPickerInline.tsx:198-206`). The component renders the detail pane from the `highlightedId` prop and calls `onHighlightChange(id)` on row click.
- `SettingsModelsTab` owns `highlightedId` and **must replicate the async-recovery the removed effect provided.** `models` (TanStack Query) and `activeId` (settings) both arrive asynchronously; on first render both can be empty/null, so the seed is null. The parent needs an effect: *when `highlightedId` is null and a candidate becomes available, set it* — `useEffect(() => { if (highlightedId == null) { const next = activeId ?? models[0]?.id ?? null; if (next != null) setHighlightedId(next); } }, [highlightedId, activeId, models])`. Without this, `highlightedId` stays null after load and `slidersDisabled` is stuck on.
- `SettingsModelsTab` passes `highlightedId` down and binds the params section (sliders + reasoning toggle) to the **highlighted** model. Slider/toggle handlers write `overrides[highlightedId]`.
- "Use this model" still only PATCHes `chat.model`; selecting a row no longer requires "use" to tune params.
- `slidersDisabled` becomes "no highlighted model" rather than "no active model".

### 4. Reasoning toggle (per-model, on/off)

Add `reasoning?: boolean` to the per-model chat override in every place the override shape is declared:
- `backend/src/routes/user-settings.routes.ts`: the inline Zod override schema (`reasoning: z.boolean().optional()`), the `UserSettings` TS interface, and the default object's `Record<…>` annotation.
- `frontend/src/hooks/useUserSettings.ts`: `UserChatOverride`.

**Resolution / UI:**
- Effective reasoning value = `override.reasoning ?? true` for `supportsReasoning` models. For `!supportsReasoning` models the value is irrelevant (toggle disabled+off).
- UI toggle in the params section: disabled+off when `!model.supportsReasoning`; enabled and defaulting On otherwise; reflects `override.reasoning` when set. Toggling writes `overrides[highlightedId].reasoning`.

**Request wiring:**
- When the resolved reasoning value is `false` **and** the model supports reasoning, add top-level `reasoning: { enabled: false }` to the chat-completion request (per Venice docs this is a top-level param, not inside `venice_parameters`). When on/unset, send nothing — Venice's default is to reason.
- **Resolver decision (pinned):** the reasoning decision is computed **at the request-assembly site**, NOT inside the resolvers. `resolveTextGenParams` / `resolveChatParams` stay the focused 3-param (temperature / top_p / max_tokens) contract with their existing mirror + test suite untouched. The assembly site already has `settings` + `modelInfo` in hand, so it computes `reasoningEnabled = !(model.supportsReasoning && settings.chat.overrides[model.id]?.reasoning === false)` and writes `reasoning: { enabled: false }` only when that's false. The frontend toggle likewise reads `override.reasoning ?? true` inline in `SettingsModelsTab` — it does not go through `resolveChatParams`.
- **Thread through all three reasoning-capable completion paths** — they all build a completion with `buildVeniceParams({ supportsReasoning })` today and must gain the new top-level `reasoning` field:
  - `/api/ai/complete` (`ai.routes.ts`)
  - the chat route (`chat.routes.ts`)
  - chapter summarise (`chapters.routes.ts` `/:chapterId/summarise`, ~line 317/356)
  This is consistent with how the per-model override already behaves: summarise already honours `overrides[modelId]` for temperature/topP/maxTokens via `resolveTextGenParams`, so reasoning — the new per-model override field — applies there too. ("This model's reasoning setting" applies wherever the model is used.)
- Existing `strip_thinking_response: true` for reasoning models is unchanged (independent axis: whether thinking is shown, vs whether the model reasons at all).

No `reasoning_effort` and no forced-on detection (YAGNI).

## Testing

- **Resolvers (both):** temp default is 1.0 when no override and no Venice default; maxTokens default is `min(cap, CEILING)`; override-capped behavior intact.
- **Drift tests:** text-gen-defaults and the new ceiling constant stay in sync; update asserted values.
- **`SettingsModelsTab`:** slider `max` reflects the highlighted model's `maxCompletionTokens` (capped at CEILING); params section follows the highlighted model and writes that model's overrides; reasoning toggle is disabled+off for non-reasoning models, enabled+on-by-default for reasoning models, and toggling writes `overrides[id].reasoning`.
- **`ModelPickerInline`:** controlled-highlight — `onHighlightChange` fires on row click; detail pane follows `highlightedId`. Plus the parent recovery effect: `SettingsModelsTab` lands on a non-null highlight after async `models`/`activeId` load (sliders not stuck disabled).
- **Backend request assembly (all three paths):** `reasoning: { enabled: false }` is sent only when the override is `false` AND the model supports reasoning; omitted otherwise. Cover `ai.routes.ts`, `chat.routes.ts`, and `chapters.routes.ts` `/summarise` — the third path is the easy one to miss.

## Risks

- **App-wide default output-budget increase (task 2).** Changing the no-override default from `min(800, cap)` to `min(cap, CEILING)` raises the default `max_tokens` for *every* generation lacking a user override — chat, continue-writing, **and chapter summarisation** (`chapters.routes.ts` passes `resolved.max_completion_tokens`), not just the Models tab display — e.g. an 8k-cap model now defaults to 8000 output tokens. Higher latency and per-call cost. Accepted as a deliberate product choice.
- **Reasoning param coupling.** `reasoning: { enabled: false }` is a top-level field; must not be merged into `venice_parameters`. The wiring is best-effort for models Venice documents as always-reasoning (Claude Opus, Gemini) — the toggle will appear enabled but those models may keep reasoning. Acceptable given the two-state decision.

## Verify

`npm --prefix backend run typecheck && npm --prefix frontend run typecheck && npm --prefix frontend run test -- SettingsModelsTab ModelPickerInline useUserSettings && (make dev + healthcheck) && npm -w story-editor-backend run test -- user-settings-resolvers text-gen-defaults venice-call ai-defaults chat chapters.summarise`

**The verify line MUST include the three route suites** (`ai-defaults`/`ai.routes`, `chat`, `chapters.summarise`) — task 4's reasoning-disable wiring lives in the route handlers, not in `resolveTextGenParams`/`venice-call`, so a verify line that runs only the resolver/defaults/venice-call suites would green-light the close gate **without ever executing the riskiest new surface** (the "third path" problem). The reasoning passthrough tests are added to those route suites; the verify filter must catch them.

Backend tests require the docker stack up first — `make dev` + healthcheck — per project memory (`bd-verify-line-backend-test-needs-stack`); order any backend-test step after the stack is healthy. Exact filter tokens confirmed against actual test filenames in the plan.
