# X27 — Settings → Models picker rework

**Status:** spec
**Branch:** `chore/tick-x32-and-x27-spec`
**Date:** 2026-05-04
**Predecessors:** F44 (current Settings → Models tab), F42 (chat-panel `<ModelPicker />`), V2 (`venice.models.service`), X32 (recent Venice rework).
**Successors:** none planned (capability icons / grouping / chat-bar pricing are explicit out-of-scope items below).

---

## 1. Motivation

The Settings → Models tab today renders the full Venice model list inline as `<ModelCard>`s in a `radiogroup`, followed by three sliders. The chat panel takes a different approach: its `model-bar` shows only the currently selected model, and a click opens the dedicated `<ModelPicker />` modal (F42). As Venice's model list grows, the inline list in Settings becomes unwieldy.

X27 collapses the Settings tab onto the chat-window pattern: a single trigger row, click to open the existing `<ModelPicker />`. Two pieces of Venice metadata that the picker hasn't been showing are added at the same time: per-model **description** and **per-token price**. They are most useful when comparing unfamiliar models, so the picker is the right surface for them.

The reuse is intentional. There is exactly one `<ModelPicker />` in the app and exactly one mount point at EditorPage (F55). Settings opens the same modal via a callback.

---

## 2. Scope

In:

- Backend: extend `ModelInfo` with `description: string | null` and `pricing: { inputUsdPerMTok: number; outputUsdPerMTok: number } | null`. No route changes.
- Frontend `<ModelCard>`: add a price pill peer-of-ctx on row 1 and a prose description row 2 with optional capability labels prefixed.
- Frontend `<SettingsModelsTab>`: replace the inline list with a single trigger that opens `<ModelPicker />`. Sliders unchanged.
- Frontend `<SettingsModal>` / `EditorPage`: thread `onOpenModelPicker` from Settings up to the existing `<ModelPicker />` mount.
- Frontend `<ModelPicker>`: small "Prices are USD per 1M tokens." hint below the title; the rest is automatic via `<ModelCard>`.

Out:

- Capability icons (we use text labels).
- Vision capability badge (no consumer in the app).
- Grouping models by family / provider in the picker.
- Pricing in the chat panel `model-bar` (picker only).
- DEM-currency pricing display (USD only; the data carries DEM but we don't render it).
- Caching policy changes (10-min TTL on `useModelsQuery` stays; backend `byUser` cache stays).
- New rate limits (the unified Venice account endpoint X32 already covers the rate-limit story for Venice-key reads).

---

## 3. Venice schema reference

Verified against [`docs.venice.ai/api-reference/endpoint/models/list`](https://docs.venice.ai/api-reference/endpoint/models/list) on 2026-05-04. Sample text-model entry:

```json
{
  "id": "llama-3.2-3b",
  "type": "text",
  "object": "model",
  "owned_by": "venice.ai",
  "model_spec": {
    "name": "Llama 3.2 3B",
    "description": "A general-purpose 3B model …",
    "availableContextTokens": 131072,
    "maxCompletionTokens": 16384,
    "capabilities": {
      "supportsReasoning": false,
      "supportsVision": false,
      "supportsWebSearch": false,
      "optimizedForCode": false,
      "supportsFunctionCalling": false,
      "supportsVideoInput": false,
      "quantization": "fp8"
    },
    "pricing": {
      "input":  { "usd": 0.15, "diem": 0.15 },
      "output": { "usd": 0.60, "diem": 0.60 }
    }
  }
}
```

Fields the spec consumes:

- `model_spec.description` — string. Optional. Empty string treated as missing.
- `model_spec.pricing.input.usd` — number. USD per 1M input tokens.
- `model_spec.pricing.output.usd` — number. USD per 1M output tokens.

`pricing` is treated atomically: if either `input.usd` or `output.usd` is missing or non-numeric, the whole `pricing` object is mapped to `null`. We do not render half-pricing.

---

## 4. Backend changes

### 4.1 `backend/src/services/venice.models.service.ts`

Extend `ModelInfo`:

```ts
export interface ModelInfo {
  id: string;
  name: string;
  contextLength: number;
  supportsReasoning: boolean;
  supportsVision: boolean;
  supportsWebSearch: boolean;
  description: string | null;
  pricing: { inputUsdPerMTok: number; outputUsdPerMTok: number } | null;
}
```

Extend `VeniceRawModelSpec`:

```ts
interface VeniceRawModelSpec {
  name?: string;
  availableContextTokens?: number;
  capabilities?: VeniceRawCapabilities;
  description?: string;
  pricing?: {
    input?: { usd?: number };
    output?: { usd?: number };
  };
}
```

Update `mapModel()`:

```ts
function mapModel(raw: VeniceRawModel): ModelInfo {
  const spec = raw.model_spec ?? {};
  const caps = spec.capabilities ?? {};

  const rawDesc = typeof spec.description === 'string' ? spec.description.trim() : '';
  const description = rawDesc.length > 0 ? rawDesc : null;

  const inUsd = spec.pricing?.input?.usd;
  const outUsd = spec.pricing?.output?.usd;
  const pricing =
    typeof inUsd === 'number' && typeof outUsd === 'number'
      ? { inputUsdPerMTok: inUsd, outputUsdPerMTok: outUsd }
      : null;

  return {
    id: raw.id,
    name: spec.name ?? raw.id,
    contextLength:
      typeof spec.availableContextTokens === 'number' ? spec.availableContextTokens : 0,
    supportsReasoning: Boolean(caps.supportsReasoning),
    supportsVision: Boolean(caps.supportsVision),
    supportsWebSearch: Boolean(caps.supportsWebSearch),
    description,
    pricing,
  };
}
```

No changes to `fetchModels`, `getModelContextLength`, `findModel`, `resetCache`, the per-user cache, or the TTL.

### 4.2 `backend/src/routes/ai.routes.ts`

`GET /api/ai/models` already returns `{ models: ModelInfo[] }` straight from the service. No changes.

### 4.3 Backend tests — `backend/tests/services/venice.models.service.test.ts`

Existing tests stay; one fixture is widened and three new cases land:

1. Extend the LLAMA fixture with `description: 'A general-purpose 70B model …'` and `pricing: { input: { usd: 0.6, diem: 0.6 }, output: { usd: 2.4, diem: 2.4 } }`. Update the matching `expect(...).toEqual([...])` to include the mapped `description` string and `pricing: { inputUsdPerMTok: 0.6, outputUsdPerMTok: 2.4 }`. Other fixtures (Qwen, Vision, Image) keep no `description` / no `pricing` and the assertion expects `description: null, pricing: null` for them.
2. New test: **"omits pricing when only the input side is present"** — fixture with `pricing: { input: { usd: 0.15 } }` (no output) → mapped pricing is `null`.
3. New test: **"omits pricing when output.usd is non-numeric"** — `pricing: { input: { usd: 0.15 }, output: { usd: 'free' as unknown as number } }` → `null`.
4. New test: **"normalises blank description to null"** — `description: '   '` → `null`.

The fall-back-sensibly-when-`model_spec`-omitted test extends to assert `description: null, pricing: null`.

### 4.4 Backend tests — call-site fallout

Tests under `backend/tests/ai/*.test.ts` build their own raw Venice fixtures via `model_spec` and then mostly assert on completion behaviour. The `mapModel` shape-change is additive (two nullable fields), so those fixtures keep working without edits. The verify command (`npm --prefix backend run test`) is the proof.

---

## 5. Frontend changes

### 5.1 `frontend/src/hooks/useModels.ts`

Mirror the backend type:

```ts
export interface ModelPricing {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
}

export interface Model {
  id: string;
  name: string;
  contextLength: number;
  supportsReasoning: boolean;
  supportsVision: boolean;
  supportsWebSearch: boolean;
  description: string | null;
  pricing: ModelPricing | null;
}
```

No behaviour change. `staleTime: 10 * 60 * 1000` stays.

### 5.2 `frontend/src/components/ModelCard.tsx` — rewrite of the body

Two rows. Row 1 always renders. Row 2 renders only when at least one of {reasoning, web-search, description} is present.

```
Row 1:  <display-name>     <price-pill>     <ctx-chip>
Row 2:  Reasoning · Web search · <description text>
```

Concrete rules:

- **Display name** unchanged: `extras.displayName ?? model.id ?? model.name`. Drop the `readExtras` / `ModelExtras` shim — those fields (`displayName`, `params`, `speed`, `notes`) were placeholders that never landed; the description row replaces them. The intent of the shim was forward-compat, but it's dead weight five releases on.
- **Price pill** renders only when `model.pricing != null`. Format: `$0.15 in · $0.60 out`. Two decimals, USD only. The pill carries `title="$0.15 USD per 1M input tokens · $0.60 USD per 1M output tokens"` for hover detail. Test ID: `model-card-${id}-price`. Visual treatment: same chip class as ctx-chip but with `font-mono text-[10px]`.
- **Ctx chip** unchanged.
- **Capability labels** are plain text, no icons:
  - Build a `string[]` from `[supportsReasoning && 'Reasoning', supportsWebSearch && 'Web search']`, joined by ` · `.
  - `supportsVision` is intentionally **not** consulted. The app has no vision-capable surface (no image input in chat composer, no character-image attachment). If it ever does, add the label here.
- **Description** comes after the capability labels with a leading ` · ` separator if either is present. Class: `font-sans text-[11.5px] text-ink-3`. CSS-truncate at 2 lines (`line-clamp-2`).
- **Row 2 omitted entirely** when both capability flags are false and `description == null`. Card collapses to a single line — same density as today's stripped fixture.
- Existing `data-testid="model-card-${id}"` and `-ctx` are preserved. New: `-price` (price pill), `-desc` (row 2 container, present iff row 2 renders).

`<button role="radio" aria-checked={selected}>` shell, selected/unselected border treatment, the `onSelect(model.id)` click handler — all unchanged.

### 5.3 `frontend/src/components/SettingsModelsTab.tsx`

Replace the entire `models-section-list` `radiogroup` (lines ~121–161 today) with a single trigger row. The `models-section-params` slider section is untouched.

New trigger design (mirrors the chat panel `model-bar` chrome but drops the params readout):

```tsx
<section className="flex flex-col gap-3" data-testid="models-section-list">
  <header>
    <h3 className="m-0 font-serif text-[14px] font-medium text-ink">Model</h3>
    <p className="mt-[2px] text-[12px] text-ink-4 font-sans">
      Pick the default model used for chat and continuations.
    </p>
  </header>
  <button
    type="button"
    data-testid="settings-model-trigger"
    onClick={onOpenModelPicker}
    aria-label="Open model picker"
    className="model-picker-btn flex items-center gap-1.5 hover:bg-[var(--surface-hover)] px-2 py-1 rounded-[var(--radius)] bg-[var(--bg-sunken)] border border-line"
  >
    <VeniceMark />
    <span className="font-mono text-[12px] text-ink truncate flex-1 min-w-0 text-left">
      {selectedModel?.name ?? selectedModel?.id ?? 'Pick a model'}
    </span>
    {selectedModel && ctxLabel ? (
      <span
        data-testid="settings-model-trigger-ctx"
        className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-bg border border-line text-ink-3"
      >
        {ctxLabel}
      </span>
    ) : null}
    <ChevronDownIcon />
  </button>
</section>
```

- `selectedModel` is computed the same way `<ChatPanel>` does it: look up `useUserSettings().chat.model` in `useModelsQuery().data`. Reuse `formatCtxLabel` from `ChatPanel.tsx` (export it if not already exported).
- When no model is set, the trigger reads "Pick a model" with no ctx chip.
- New prop: `interface SettingsModelsTabProps { onOpenModelPicker: () => void }`. The `onOpenModelPicker` callback is passed through from `<SettingsModal>`.
- Drop the `useModelsQuery().isLoading` / `isError` / "No models available" branches in this section — the picker shows those states. The trigger itself just shows the cached selection (or "Pick a model" while the cache warms).
- `useUpdateUserSetting` is no longer needed in this section (it's only called from inside `<ModelPicker />` now). Keep the import only if still used by the sliders (it is — `onTemperature` etc. use it).
- Drop the unused `<ModelCard>` import from this file. The slider section is unchanged.

### 5.4 `frontend/src/components/Settings.tsx`

Add a prop:

```ts
export interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  onOpenModelPicker: () => void;
}
```

Thread it into `<SettingsModelsTab onOpenModelPicker={onOpenModelPicker} />`.

### 5.5 `frontend/src/pages/EditorPage.tsx`

Pass the existing `setModelPickerOpen(true)` to `<SettingsModal>`:

```tsx
<SettingsModal
  open={settingsOpen}
  onClose={() => setSettingsOpen(false)}
  onOpenModelPicker={() => setModelPickerOpen(true)}
/>
```

`<ModelPicker />` is already mounted at this level (F55); no other wiring changes. Settings stays open underneath the picker. Selecting a model in the picker closes the picker and Settings reflects the new selection on its trigger via `useUserSettings()`.

### 5.6 `frontend/src/components/ModelPicker.tsx`

Add a one-line price-units hint below the title, inside `<ModalBody>` above the list:

```tsx
<p
  data-testid="model-picker-price-hint"
  className="px-3 pt-2 text-[11px] text-ink-4 font-mono"
>
  Prices are USD per 1M tokens.
</p>
```

The list itself is unchanged — `<ModelCard>` already does the rendering and now picks up `description` + `pricing` automatically.

---

## 6. Stories (Storybook)

### 6.1 `frontend/src/components/ModelPicker.stories.tsx`

Update the existing fixture set to demonstrate the new fields:

- `Llama 3.3 70B` gets `description: 'General-purpose 70B model tuned for instruction-following and creative writing.'` and `pricing: { inputUsdPerMTok: 0.6, outputUsdPerMTok: 2.4 }`.
- `Qwen QwQ 32B` gets `supportsReasoning: true`, `description: 'Reasoning-tuned 32B model.'`, `pricing: { inputUsdPerMTok: 0.5, outputUsdPerMTok: 1.5 }`.
- Add a `BareModel` fixture with `description: null, pricing: null, supportsReasoning: false, supportsWebSearch: false` to demonstrate the row-2 omission.
- Add `WebSearchVariant` story showing a model with `supportsWebSearch: true` and a description (asserts the "Web search · …" composition).

### 6.2 `frontend/src/components/ModelCard.stories.tsx` (new)

Three variants:

- `FullyPopulated` — all fields, both capability labels, price pill, description.
- `PriceOnly` — pricing present, description null, no capabilities.
- `DescriptionOnly` — description present, pricing null, no capabilities.
- `Bare` — id + name + ctx only; row 2 absent.

### 6.3 `frontend/src/components/Settings.stories.tsx`

- Update existing Models-tab story so the model has the new fields populated (only matters once the picker is opened from the story, but keeps fixtures honest).
- Add a `ModelsTab/NoSelection` variant where `chat.model` is `null` and the trigger reads "Pick a model".

---

## 7. Tests

### 7.1 Backend

Already covered in §4.3.

### 7.2 Frontend

**`frontend/tests/components/ModelCard.test.tsx`** (new):

1. Renders display name + ctx chip with no row 2 when description / capabilities / pricing are all absent.
2. Renders price pill with text `$0.15 in · $0.60 out` and `title` carrying the long form when `pricing` is present.
3. Does not render the price pill when `pricing` is null.
4. Renders `Reasoning` capability label when `supportsReasoning: true`.
5. Renders `Web search` capability label when `supportsWebSearch: true`.
6. Does **not** render any vision label when `supportsVision: true` (assert the substring "Vision" is absent from the card).
7. Joins capability labels with description: with both labels and a description, the row 2 text matches `Reasoning · Web search · A general-purpose…`.
8. Click fires `onSelect(model.id)`; selected state flips `aria-checked`.

**`frontend/tests/components/Settings.models.test.tsx`** (rewrite):

- Replaces the existing F44 inline-list assertions. New scope:
  1. The trigger renders with the model name + ctx chip when `chat.model` is set in cached settings.
  2. The trigger renders "Pick a model" with no ctx chip when `chat.model` is null.
  3. Clicking the trigger fires the `onOpenModelPicker` prop exactly once.
  4. The three sliders (temperature / topP / maxTokens) still render bound to settings.chat values — keep the existing slider tests as-is, just remove the radiogroup ones.
- The "selecting a model PATCHes /users/me/settings (multi-device fix)" scenario from this file is **moved** to `tests/components/ModelPicker.test.tsx` (where it actually belongs now).

**`frontend/tests/components/ModelPicker.test.tsx`** (new or extend if present):

1. Renders the price hint "Prices are USD per 1M tokens." when open.
2. Selecting a card PATCHes settings.chat.model (the moved test).
3. Selecting a card calls `onClose`.
4. Renders the loading / error / empty states (these were tested via Settings before — reattribute here).

**`frontend/tests/components/Settings.shell-venice.test.tsx`**: no change — tab strip is unchanged.

**`frontend/tests/pages/editor-shell.integration.test.tsx`** (or a new `editor-settings-picker.integration.test.tsx`):

- Open Settings → Models tab → click the trigger → assert the `<ModelPicker />` is now open (reuses the same picker the chat-panel `model-bar` opens).
- Select a model in the picker → assert the picker closes, Settings remains open, and the trigger label updates to the new model name.

### 7.3 What is **not** tested

- Modal-on-modal z-index. The Modal primitive owns its own positioning; we add a manual smoke test step in §10 instead. Adding an automated assertion would couple the test to internal stacking choices that are likely to change.
- Pricing rendering precision beyond two decimals (Venice currently returns at most two decimal places in `usd`).

---

## 8. Docs

- `docs/api-contract.md` — `GET /api/ai/models`: extend the response example and add `description: string | null` and `pricing: { inputUsdPerMTok: number; outputUsdPerMTok: number } | null`. Note both are nullable and pricing is atomic (never partial).
- `docs/venice-integration.md` — under the existing `/v1/models` mapping section, note the two new fields and where they come from (`model_spec.description`, `model_spec.pricing.{input,output}.usd`). Note the explicit USD-only stance and the half-pricing-becomes-null rule.

---

## 9. Risks

- **Half-pricing from Venice.** Some hosted-eval models may return only `input.usd` and no `output.usd`. Mapper returns `null` for the whole `pricing` object in that case, the picker omits the price pill, and the description still renders. Captured by a test.
- **Modal-on-modal stacking.** Opening `<ModelPicker />` while `<SettingsModal />` is open relies on the Modal primitive's natural DOM-order stacking. Validated by F55's existing pattern and by a manual smoke test in §10. No automated z-index test.
- **Card density.** Two extra conditional rows widen the visual surface of `<ModelCard>`. Mitigated by collapsing row 2 entirely when none of {reasoning, web-search, description} is present, and by `line-clamp-2` on long descriptions.
- **Description quality is upstream.** Venice's description text varies in length and tone; some models have one short sentence, others have a paragraph. We cap at two lines visually and live with it.

---

## 10. Manual smoke checklist

After Storybook + automated tests pass, before merging:

1. Run `make dev`. Log in to a real account with a stored Venice key.
2. Open Settings (cmd-,) → Models. Trigger renders with the currently selected model name + ctx chip. Sliders work.
3. Click the trigger. `<ModelPicker />` opens *on top of* Settings (Settings backdrop visible behind picker backdrop, picker takes input focus).
4. Verify a few cards: at least one shows a price pill (top row, between name and ctx chip). At least one shows a description. At least one shows "Reasoning" or "Web search" labels.
5. Verify no card shows the word "Vision" anywhere.
6. Click a different model. Picker closes. Settings remains open. Trigger updates to the new model name.
7. Press Escape from the picker (without selecting). Picker closes. Settings remains open.
8. Press Escape from Settings. Settings closes.
9. Open the chat panel's model-bar (click the chat-side model row). Same picker opens, same cards, same price/description.

---

## 11. Out-of-scope follow-ups (not in this task)

- Capability **icons** instead of text labels.
- Pricing in the chat panel `model-bar` (only the picker shows it).
- Filtering / sorting models in the picker (e.g. "show reasoning models first", or "sort by input price").
- DEM pricing display.
- Per-model "favourite" / pinning UX.
- Vision-capable surface (then the vision label here becomes meaningful).
