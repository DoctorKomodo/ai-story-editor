# X27 — Settings → Models picker rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse Settings → Models inline list to a single trigger that opens the existing `<ModelPicker />`, and surface description + USD-per-1M-token pricing on each card.

**Architecture:** Backend `ModelInfo` gains two nullable fields (`description`, `pricing`) mapped from Venice's `/v1/models` `model_spec`. Frontend `Model` type mirrors the change. `<ModelCard>` learns to render a price pill (peer of ctx-chip on row 1) and a prose description row with optional capability labels. `<SettingsModelsTab>` replaces its inline `<ModelCard>` `radiogroup` with a single trigger that reuses the chat-panel `model-bar` chrome and calls a new `onOpenModelPicker` prop, which `<EditorPage>` wires into the existing F55 `<ModelPicker />` mount.

**Tech Stack:** TypeScript strict, React 19, Vite, TanStack Query, Vitest + React Testing Library, Storybook 9, Express + Prisma backend.

**Spec:** `docs/superpowers/specs/2026-05-04-x27-models-picker-rework-design.md` (committed `131a869` on this branch).

**Branch:** `chore/tick-x32-and-x27-spec` — already cut, X32 tick + X27 spec committed. All X27 work lands in this branch / PR.

---

## File map

**Backend (1 source file + 1 test file):**
- Modify: `backend/src/services/venice.models.service.ts` — extend `ModelInfo`, `VeniceRawModelSpec`, `mapModel`.
- Modify: `backend/tests/services/venice.models.service.test.ts` — extend LLAMA fixture, add three new mapping cases.

**Frontend (5 source files + 1 hook + 4 test files + 3 story files):**
- Modify: `frontend/src/hooks/useModels.ts` — extend `Model`, add `ModelPricing`.
- Modify: `frontend/src/components/ModelCard.tsx` — rewrite body for price pill + description + capability labels.
- Modify: `frontend/src/components/SettingsModelsTab.tsx` — replace inline list with trigger, accept `onOpenModelPicker` prop.
- Modify: `frontend/src/components/Settings.tsx` — accept `onOpenModelPicker` prop, thread through.
- Modify: `frontend/src/components/ModelPicker.tsx` — add price-units hint.
- Modify: `frontend/src/components/ChatPanel.tsx` — export `formatCtxLabel` (already exported), no behavioural change. The Settings trigger imports it.
- Modify: `frontend/src/pages/EditorPage.tsx` — pass `onOpenModelPicker={() => setModelPickerOpen(true)}` to `<SettingsModal />`.
- Create: `frontend/tests/components/ModelCard.test.tsx` — full coverage for the new card body.
- Modify: `frontend/tests/components/Settings.models.test.tsx` — rewrite list assertions for the trigger; keep slider tests.
- Modify: `frontend/tests/components/ModelPicker.test.tsx` — add price-hint test, add `description`/`pricing` to one fixture for sanity.
- Modify: `frontend/src/components/ModelPicker.stories.tsx` — populate description + pricing on existing fixtures, add bare/web-search variants.
- Modify: `frontend/src/components/Settings.stories.tsx` — add `ModelsTab/NoSelection` variant.
- Create: `frontend/src/components/ModelCard.stories.tsx` — four variants.

**Docs (2 files):**
- Modify: `docs/api-contract.md` — extend `GET /api/ai/models` response example.
- Modify: `docs/venice-integration.md` — note new mapping + half-pricing-becomes-null rule.

**Task tracking:**
- Modify: `TASKS.md` — tick `[X27]` and trim "Backlog (next)" / "Proposed" lists in the same commit as the docs.

---

## Build sequence

Backend first (Tasks 1–3) so the live `/api/ai/models` payload carries the new fields before any frontend consumer assumes they exist. Then the shared frontend type (Task 4), then `<ModelCard>` (Task 5) which all UI surfaces use, then the Settings rework (Tasks 6–8), then `<ModelPicker />` polish (Task 9), then stories (Tasks 10–11), then docs + tick (Task 12).

Each numbered task ends in a commit so an interrupted session can resume on a clean tree.

---

## Task 1: Extend backend `ModelInfo` type + mapper

**Files:**
- Modify: `backend/src/services/venice.models.service.ts:13-62`
- Test: `backend/tests/services/venice.models.service.test.ts:35-77, 91-153`

- [ ] **Step 1: Write the failing test — extend the LLAMA fixture and assert mapped fields**

Replace the LLAMA fixture in `backend/tests/services/venice.models.service.test.ts:35-44` and the corresponding assertion in the `'filters to text-type models and maps the Venice model_spec into the public shape'` test at `:91-126`.

Updated fixture:

```ts
const LLAMA: VeniceRawModel = {
  id: 'llama-3.3-70b',
  object: 'model',
  type: 'text',
  model_spec: {
    name: 'Llama 3.3 70B',
    description: 'A general-purpose 70B model tuned for instruction-following.',
    availableContextTokens: 65536,
    capabilities: { supportsReasoning: false, supportsVision: false },
    pricing: {
      input: { usd: 0.6, diem: 0.6 },
      output: { usd: 2.4, diem: 2.4 },
    },
  },
};
```

Also extend the local `VeniceRawModel` type at `:12-25` so the fixture compiles:

```ts
type VeniceRawModel = {
  id: string;
  object: 'model';
  type: 'text' | 'image' | 'embedding' | string;
  model_spec?: {
    name?: string;
    availableContextTokens?: number;
    capabilities?: {
      supportsReasoning?: boolean;
      supportsVision?: boolean;
      supportsWebSearch?: boolean;
    };
    description?: string;
    pricing?: {
      input?: { usd?: number; diem?: number };
      output?: { usd?: number; diem?: number };
    };
  };
};
```

Update the matching `expect(...).toEqual([...])` assertion (currently lines `:100-125`) so each mapped entry now includes `description` and `pricing`. LLAMA gets the populated values; QWEN_REASONING / VISION get `description: null, pricing: null`:

```ts
expect(models).toEqual([
  {
    id: 'llama-3.3-70b',
    name: 'Llama 3.3 70B',
    contextLength: 65536,
    supportsReasoning: false,
    supportsVision: false,
    supportsWebSearch: false,
    description: 'A general-purpose 70B model tuned for instruction-following.',
    pricing: { inputUsdPerMTok: 0.6, outputUsdPerMTok: 2.4 },
  },
  {
    id: 'qwen-qwq-32b',
    name: 'Qwen QwQ 32B',
    contextLength: 32768,
    supportsReasoning: true,
    supportsVision: false,
    supportsWebSearch: false,
    description: null,
    pricing: null,
  },
  {
    id: 'mistral-vision',
    name: 'Mistral Vision',
    contextLength: 131072,
    supportsReasoning: false,
    supportsVision: true,
    supportsWebSearch: false,
    description: null,
    pricing: null,
  },
]);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix backend run test -- venice.models.service.test.ts`
Expected: FAIL — `Object literal may only specify known properties, and 'description' does not exist in type '{ id: string; name: string; ... }'` (TypeScript) or runtime `expected ... to deeply equal ...` showing missing `description` / `pricing`.

- [ ] **Step 3: Extend `ModelInfo` and `VeniceRawModelSpec`**

Edit `backend/src/services/venice.models.service.ts`. Replace `ModelInfo` (`:13-20`):

```ts
export interface ModelPricing {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
}

export interface ModelInfo {
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

Replace `VeniceRawModelSpec` (`:38-42`):

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

Replace `mapModel` (`:50-62`):

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

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix backend run test -- venice.models.service.test.ts`
Expected: PASS for the extended-mapping case.

- [ ] **Step 5: Add a "half pricing is dropped" test case**

Add this test inside the `describe('fetchModels', ...)` block in `venice.models.service.test.ts`, after the existing tests:

```ts
it('omits pricing when only the input side is present', async () => {
  const halfPriced: VeniceRawModel = {
    id: 'half-priced',
    object: 'model',
    type: 'text',
    model_spec: {
      name: 'Half Priced',
      pricing: { input: { usd: 0.15 } },
    },
  };
  const { client } = makeListStub([halfPriced]);
  const svc = createVeniceModelsService({ getClient: async () => client });

  const [only] = await svc.fetchModels('user-1');
  expect(only.pricing).toBeNull();
});

it('omits pricing when output.usd is non-numeric', async () => {
  const bad: VeniceRawModel = {
    id: 'bad-priced',
    object: 'model',
    type: 'text',
    model_spec: {
      name: 'Bad Priced',
      pricing: {
        input: { usd: 0.15 },
        // @ts-expect-error — intentional non-numeric to mirror upstream noise
        output: { usd: 'free' },
      },
    },
  };
  const { client } = makeListStub([bad]);
  const svc = createVeniceModelsService({ getClient: async () => client });

  const [only] = await svc.fetchModels('user-1');
  expect(only.pricing).toBeNull();
});

it('normalises blank description to null', async () => {
  const blank: VeniceRawModel = {
    id: 'blank-desc',
    object: 'model',
    type: 'text',
    model_spec: { name: 'Blank Desc', description: '   ' },
  };
  const { client } = makeListStub([blank]);
  const svc = createVeniceModelsService({ getClient: async () => client });

  const [only] = await svc.fetchModels('user-1');
  expect(only.description).toBeNull();
});
```

- [ ] **Step 6: Extend the bare-fields test**

In `venice.models.service.test.ts:137-153` (`'falls back sensibly when Venice omits model_spec fields'`), add two assertions at the end:

```ts
expect(only.description).toBeNull();
expect(only.pricing).toBeNull();
```

- [ ] **Step 7: Run all venice.models tests**

Run: `npm --prefix backend run test -- venice.models.service.test.ts`
Expected: PASS all cases including the three new ones.

- [ ] **Step 8: Run the full backend suite to catch call-site fallout**

Run: `npm --prefix backend run test`
Expected: PASS. The new fields are nullable additions; existing tests under `backend/tests/ai/*.test.ts` build their own raw fixtures and assert on completion behaviour, not on the full mapped shape, so no fallout is expected. If a test does fail because it hardcodes an `expect(...).toEqual(...)` on the model shape, extend that assertion with `description: null, pricing: null` rather than rewriting it.

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/venice.models.service.ts backend/tests/services/venice.models.service.test.ts
git commit -m "[X27] backend: ModelInfo gains description + pricing nullable fields"
```

---

## Task 2: Mirror the type on the frontend hook

**Files:**
- Modify: `frontend/src/hooks/useModels.ts:15-22`

This is a pure type extension; no test is added because the hook has no behavioural change and existing tests of consumers will start failing in Tasks 5–8 if the shape is wrong. We let TypeScript be the test here.

- [ ] **Step 1: Extend `Model`**

Replace the `Model` interface declaration:

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

- [ ] **Step 2: Run typecheck**

Run: `npm --prefix frontend run typecheck`
Expected: PASS. `<ModelCard>` and consumers don't read these fields yet, so adding nullable fields is forward-compatible.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useModels.ts
git commit -m "[X27] frontend: Model type mirrors backend description + pricing"
```

---

## Task 3: Tests for the new `<ModelCard>` shape

**Files:**
- Create: `frontend/tests/components/ModelCard.test.tsx`

We TDD the new card body before touching the component itself. There is no existing `ModelCard.test.tsx` (verified — only `Settings.models.test.tsx` and `ModelPicker.test.tsx` cover it indirectly).

- [ ] **Step 1: Create the failing test file**

Create `frontend/tests/components/ModelCard.test.tsx`:

```tsx
// [X27] ModelCard rendering — covers price pill, description row, and the
// reasoning / web-search capability labels. Vision is intentionally not
// rendered because the app has no vision-capable surface.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ModelCard } from '@/components/ModelCard';
import type { Model } from '@/hooks/useModels';

function baseModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'llama-3.3-70b',
    name: 'Llama 3.3 70B',
    contextLength: 65_536,
    supportsReasoning: false,
    supportsVision: false,
    supportsWebSearch: false,
    description: null,
    pricing: null,
    ...overrides,
  };
}

describe('ModelCard (X27)', () => {
  it('renders name + ctx and omits row 2 when description / capabilities / pricing are absent', () => {
    render(<ModelCard model={baseModel()} selected={false} onSelect={() => {}} />);
    expect(screen.getByTestId('model-card-llama-3.3-70b')).toBeInTheDocument();
    expect(screen.getByTestId('model-card-llama-3.3-70b-ctx')).toHaveTextContent(/66k|65k/);
    expect(screen.queryByTestId('model-card-llama-3.3-70b-price')).toBeNull();
    expect(screen.queryByTestId('model-card-llama-3.3-70b-desc')).toBeNull();
  });

  it('renders the price pill with "$0.15 in · $0.60 out" when pricing is present', () => {
    const model = baseModel({
      pricing: { inputUsdPerMTok: 0.15, outputUsdPerMTok: 0.6 },
    });
    render(<ModelCard model={model} selected={false} onSelect={() => {}} />);
    const pill = screen.getByTestId('model-card-llama-3.3-70b-price');
    expect(pill).toHaveTextContent('$0.15 in · $0.60 out');
    expect(pill).toHaveAttribute(
      'title',
      '$0.15 USD per 1M input tokens · $0.60 USD per 1M output tokens',
    );
  });

  it('does not render the price pill when pricing is null', () => {
    render(<ModelCard model={baseModel({ pricing: null })} selected={false} onSelect={() => {}} />);
    expect(screen.queryByTestId('model-card-llama-3.3-70b-price')).toBeNull();
  });

  it('renders the description on row 2 when present', () => {
    const model = baseModel({ description: 'A general-purpose 70B model.' });
    render(<ModelCard model={model} selected={false} onSelect={() => {}} />);
    const desc = screen.getByTestId('model-card-llama-3.3-70b-desc');
    expect(desc).toHaveTextContent('A general-purpose 70B model.');
  });

  it('renders the "Reasoning" capability label when supportsReasoning is true', () => {
    const model = baseModel({ supportsReasoning: true, description: 'Tuned for chains-of-thought.' });
    render(<ModelCard model={model} selected={false} onSelect={() => {}} />);
    expect(screen.getByTestId('model-card-llama-3.3-70b-desc')).toHaveTextContent(
      /Reasoning · Tuned for chains-of-thought\./,
    );
  });

  it('renders the "Web search" capability label when supportsWebSearch is true', () => {
    const model = baseModel({ supportsWebSearch: true, description: 'Hits the live web.' });
    render(<ModelCard model={model} selected={false} onSelect={() => {}} />);
    expect(screen.getByTestId('model-card-llama-3.3-70b-desc')).toHaveTextContent(
      /Web search · Hits the live web\./,
    );
  });

  it('joins both capability labels and the description with " · "', () => {
    const model = baseModel({
      supportsReasoning: true,
      supportsWebSearch: true,
      description: 'Both capabilities.',
    });
    render(<ModelCard model={model} selected={false} onSelect={() => {}} />);
    expect(screen.getByTestId('model-card-llama-3.3-70b-desc')).toHaveTextContent(
      'Reasoning · Web search · Both capabilities.',
    );
  });

  it('does not render any vision label even when supportsVision is true', () => {
    const model = baseModel({ supportsVision: true, description: 'Multimodal.' });
    render(<ModelCard model={model} selected={false} onSelect={() => {}} />);
    const card = screen.getByTestId('model-card-llama-3.3-70b');
    expect(card.textContent ?? '').not.toMatch(/vision/i);
  });

  it('omits row 2 when only supportsVision is true (no consumer in app)', () => {
    const model = baseModel({ supportsVision: true });
    render(<ModelCard model={model} selected={false} onSelect={() => {}} />);
    expect(screen.queryByTestId('model-card-llama-3.3-70b-desc')).toBeNull();
  });

  it('fires onSelect with the model id and reflects selection on aria-checked', async () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <ModelCard model={baseModel()} selected={false} onSelect={onSelect} />,
    );
    const card = screen.getByTestId('model-card-llama-3.3-70b');
    expect(card).toHaveAttribute('aria-checked', 'false');

    await userEvent.setup().click(card);
    expect(onSelect).toHaveBeenCalledWith('llama-3.3-70b');

    rerender(<ModelCard model={baseModel()} selected onSelect={onSelect} />);
    expect(screen.getByTestId('model-card-llama-3.3-70b')).toHaveAttribute('aria-checked', 'true');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix frontend run test -- ModelCard.test.tsx`
Expected: FAIL — most assertions fail because the current `<ModelCard>` doesn't render `-price` or `-desc` test IDs and doesn't show capability labels.

- [ ] **Step 3: Commit the failing test (TDD checkpoint)**

```bash
git add frontend/tests/components/ModelCard.test.tsx
git commit -m "[X27] frontend: failing tests for new ModelCard body"
```

---

## Task 4: Rewrite `<ModelCard>` body

**Files:**
- Modify: `frontend/src/components/ModelCard.tsx` (full rewrite of the body, keep the `<button>` shell + props)

- [ ] **Step 1: Replace the file contents**

Replace `frontend/src/components/ModelCard.tsx` in full:

```tsx
import type { JSX } from 'react';
/**
 * [F42] Reusable radio-card for model picking.
 *
 * Used by:
 *   - [F42] ModelPicker modal — opened from the chat panel model bar ([F38])
 *     and from the [X27] Settings → Models trigger.
 *
 * The card is rendered as a single `<button role="radio">` so the
 * surrounding container can mark itself with `role="radiogroup"`. Selection
 * state lives on `aria-checked`, with the visual treatment being the
 * `border-ink` ring (vs `border-line` when unchecked).
 *
 * [X27] Row 1 carries the display name, an optional price pill (USD per
 * 1M tokens), and a context-length chip. Row 2 — when at least one of
 * reasoning / web-search / description is present — carries the capability
 * labels and the model description as prose. supportsVision is deliberately
 * not surfaced; the app has no vision-capable surface.
 */
import type { Model } from '@/hooks/useModels';

export interface ModelCardProps {
  model: Model;
  selected: boolean;
  onSelect: (id: string) => void;
}

function formatContextLabel(n: number): string {
  if (n <= 0) return '';
  if (n >= 1000) {
    const k = Math.round(n / 1000);
    return `${String(k)}k`;
  }
  return String(n);
}

function formatPriceShort(usdPerM: number): string {
  return `$${usdPerM.toFixed(2)}`;
}

function formatPriceLong(usdPerM: number, side: 'input' | 'output'): string {
  return `$${usdPerM.toFixed(2)} USD per 1M ${side} tokens`;
}

export function ModelCard({ model, selected, onSelect }: ModelCardProps): JSX.Element {
  const ctxLabel = formatContextLabel(model.contextLength);
  const display = model.id ?? model.name;

  const capabilityLabels: string[] = [];
  if (model.supportsReasoning) capabilityLabels.push('Reasoning');
  if (model.supportsWebSearch) capabilityLabels.push('Web search');

  const hasDescription = model.description != null && model.description.length > 0;
  const hasCapabilities = capabilityLabels.length > 0;
  const hasRow2 = hasCapabilities || hasDescription;

  const row2Parts: string[] = [];
  if (hasCapabilities) row2Parts.push(capabilityLabels.join(' · '));
  if (hasDescription) row2Parts.push(model.description as string);
  const row2Text = row2Parts.join(' · ');

  const className = [
    'flex flex-col items-stretch w-full text-left p-3 rounded-[var(--radius)] border',
    selected ? 'border-ink' : 'border-line',
    'hover:border-line-2 cursor-pointer bg-bg-elevated transition-colors',
  ].join(' ');

  return (
    // biome-ignore lint/a11y/useSemanticElements: radio-card pattern — the card is an interactive multi-line composition, not a single <input type="radio">. ARIA-radio-on-button is the recognised composite-widget pattern.
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-testid={`model-card-${model.id}`}
      data-selected={selected ? 'true' : 'false'}
      onClick={() => {
        onSelect(model.id);
      }}
      className={className}
    >
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[13px] text-ink">{display}</span>
        {model.pricing != null ? (
          <span
            data-testid={`model-card-${model.id}-price`}
            title={`${formatPriceLong(model.pricing.inputUsdPerMTok, 'input')} · ${formatPriceLong(model.pricing.outputUsdPerMTok, 'output')}`}
            className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg border border-line text-ink-3 ml-auto"
          >
            {`${formatPriceShort(model.pricing.inputUsdPerMTok)} in · ${formatPriceShort(model.pricing.outputUsdPerMTok)} out`}
          </span>
        ) : null}
        {ctxLabel.length > 0 ? (
          <span
            data-testid={`model-card-${model.id}-ctx`}
            className={[
              'text-[10px] uppercase tracking-[.08em] font-mono px-1.5 py-0.5 rounded bg-bg border border-line text-ink-3',
              model.pricing != null ? '' : 'ml-auto',
            ].join(' ')}
          >
            {ctxLabel}
          </span>
        ) : null}
      </div>
      {hasRow2 ? (
        <div
          data-testid={`model-card-${model.id}-desc`}
          className="mt-1 font-sans text-[11.5px] text-ink-3 line-clamp-2"
        >
          {row2Text}
        </div>
      ) : null}
    </button>
  );
}
```

- [ ] **Step 2: Run the ModelCard tests**

Run: `npm --prefix frontend run test -- ModelCard.test.tsx`
Expected: PASS all cases.

- [ ] **Step 3: Run the typecheck**

Run: `npm --prefix frontend run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ModelCard.tsx
git commit -m "[X27] frontend: ModelCard renders price pill + description + capability labels"
```

---

## Task 5: Add price hint to `<ModelPicker />`

**Files:**
- Modify: `frontend/src/components/ModelPicker.tsx:55-74`
- Modify: `frontend/tests/components/ModelPicker.test.tsx`

- [ ] **Step 1: Add a failing test for the price hint**

Append this test inside the `describe('ModelPicker (F42)', ...)` block in `frontend/tests/components/ModelPicker.test.tsx`:

```ts
it('[X27] renders the price-units hint when open', async () => {
  fetchMock.mockResolvedValue(jsonResponse(200, { models: [] }));
  renderPicker(<ModelPicker open onClose={onClose} />);
  expect(
    await screen.findByTestId('model-picker-price-hint'),
  ).toHaveTextContent(/prices are usd per 1m tokens/i);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix frontend run test -- ModelPicker.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="model-picker-price-hint"]`.

- [ ] **Step 3: Add the hint to `<ModelPicker />`**

Edit `frontend/src/components/ModelPicker.tsx`. Insert the hint as the first child of `<ModalBody>`, before the loading / error / list branches (before the `{isLoading ? (...)` ternary at `:56`):

```tsx
<ModalBody
  role="radiogroup"
  aria-label="Model"
  data-testid="model-picker-body"
  className="flex-1 overflow-y-auto p-3 flex flex-col gap-2"
>
  <p
    data-testid="model-picker-price-hint"
    className="text-[11px] text-ink-4 font-mono px-1 pb-1"
  >
    Prices are USD per 1M tokens.
  </p>
  {isLoading ? (
    /* ...existing branches unchanged... */
  ) : /* ... */ }
</ModalBody>
```

- [ ] **Step 4: Run the ModelPicker tests**

Run: `npm --prefix frontend run test -- ModelPicker.test.tsx`
Expected: PASS all cases including the new hint test.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ModelPicker.tsx frontend/tests/components/ModelPicker.test.tsx
git commit -m "[X27] frontend: ModelPicker shows USD-per-1M-tokens price hint"
```

---

## Task 6: Rewrite Settings.models.test.tsx for the trigger pattern

**Files:**
- Modify: `frontend/tests/components/Settings.models.test.tsx`

We rewrite the list-related tests first so the new `<SettingsModelsTab>` (Task 7) is built against red tests. Slider tests stay as-is.

- [ ] **Step 1: Replace the test file**

Replace `frontend/tests/components/Settings.models.test.tsx` in full. Keep the existing imports + `buildFetch` helper + `beforeEach` / `afterEach`. The list-related `it(...)` blocks are replaced; slider blocks stay verbatim.

```tsx
// [F44 / X27] Settings → Models tab.
//
// Covers (post-X27):
//   - The Models tab renders a single trigger button (not an inline radiogroup)
//     showing the currently-selected model name + ctx chip.
//   - Clicking the trigger fires the onOpenModelPicker prop exactly once.
//   - When chat.model is null the trigger reads "Pick a model" with no ctx chip.
//   - Sliders still render bound to settings.chat values and dragging PATCHes.
//
// The "selecting a model PATCHes settings.chat.model" scenario lives in
// tests/components/ModelPicker.test.tsx (where the actual selection happens).
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsModal } from '@/components/Settings';
import { resetApiClientForTests, setAccessToken, setUnauthorizedHandler } from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';
import { useSessionStore } from '@/store/session';

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface SettingsState {
  theme: 'paper' | 'sepia' | 'dark';
  prose: { font: string; size: number; lineHeight: number };
  writing: {
    spellcheck: boolean;
    typewriterMode: boolean;
    focusMode: boolean;
    dailyWordGoal: number;
  };
  chat: { model: string | null; temperature: number; topP: number; maxTokens: number };
  ai: { includeVeniceSystemPrompt: boolean };
}

interface DefaultSettingsOptions {
  model?: string | null;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
}

function makeSettings(opts: DefaultSettingsOptions = {}): SettingsState {
  return {
    theme: 'paper',
    prose: { font: 'iowan', size: 18, lineHeight: 1.7 },
    writing: {
      spellcheck: true,
      typewriterMode: false,
      focusMode: false,
      dailyWordGoal: 500,
    },
    chat: {
      model: opts.model ?? null,
      temperature: opts.temperature ?? 0.85,
      topP: opts.topP ?? 0.95,
      maxTokens: opts.maxTokens ?? 800,
    },
    ai: { includeVeniceSystemPrompt: true },
  };
}

const TWO_MODELS = {
  models: [
    {
      id: 'venice-uncensored',
      name: 'Venice Uncensored',
      contextLength: 32768,
      supportsReasoning: false,
      supportsVision: false,
      supportsWebSearch: false,
      description: null,
      pricing: null,
    },
    {
      id: 'llama-3.3-70b',
      name: 'Llama 3.3 70B',
      contextLength: 128000,
      supportsReasoning: false,
      supportsVision: false,
      supportsWebSearch: false,
      description: null,
      pricing: null,
    },
  ],
};

function veniceKeyStatus(): unknown {
  return { hasKey: false, lastFour: null, endpoint: null };
}

interface RouteOptions {
  modelsBody?: unknown;
  initialSettings?: DefaultSettingsOptions;
}

function buildFetch(opts: RouteOptions = {}): FetchMock {
  const modelsBody = opts.modelsBody ?? TWO_MODELS;
  let settings = makeSettings(opts.initialSettings ?? {});
  return vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/users/me/settings') {
      if (method === 'PATCH' && typeof init?.body === 'string') {
        const patch = JSON.parse(init.body) as Partial<SettingsState>;
        settings = {
          ...settings,
          ...patch,
          prose: { ...settings.prose, ...(patch.prose ?? {}) },
          writing: { ...settings.writing, ...(patch.writing ?? {}) },
          chat: { ...settings.chat, ...(patch.chat ?? {}) },
          ai: { ...settings.ai, ...(patch.ai ?? {}) },
        } as SettingsState;
      }
      return Promise.resolve(jsonResponse(200, { settings }));
    }
    if (url === '/api/users/me/venice-key' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, veniceKeyStatus()));
    }
    if (url === '/api/ai/models' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, modelsBody));
    }
    if (url === '/api/stories' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    }
    return Promise.resolve(jsonResponse(200, {}));
  });
}

function renderModal(ui: ReactElement): ReturnType<typeof render> {
  const client = createQueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

async function openModelsTab(): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByTestId('settings-tab-models'));
}

describe('SettingsModal Models tab (F44 / X27)', () => {
  let onClose: ReturnType<typeof vi.fn>;
  let onOpenModelPicker: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetApiClientForTests();
    setAccessToken('tok-1');
    setUnauthorizedHandler(() => {
      useSessionStore.getState().clearSession();
    });
    useSessionStore.setState({
      user: { id: 'u1', username: 'alice' },
      status: 'authenticated',
    });
    onClose = vi.fn();
    onOpenModelPicker = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
  });

  it('renders a trigger showing the selected model name + ctx chip', async () => {
    vi.stubGlobal('fetch', buildFetch({ initialSettings: { model: 'llama-3.3-70b' } }));
    renderModal(
      <SettingsModal open onClose={onClose} onOpenModelPicker={onOpenModelPicker} />,
    );
    await openModelsTab();

    const trigger = await screen.findByTestId('settings-model-trigger');
    expect(trigger).toHaveTextContent('Llama 3.3 70B');
    expect(await screen.findByTestId('settings-model-trigger-ctx')).toHaveTextContent(/128k/i);
  });

  it('renders "Pick a model" with no ctx chip when chat.model is null', async () => {
    vi.stubGlobal('fetch', buildFetch({ initialSettings: { model: null } }));
    renderModal(
      <SettingsModal open onClose={onClose} onOpenModelPicker={onOpenModelPicker} />,
    );
    await openModelsTab();

    const trigger = await screen.findByTestId('settings-model-trigger');
    expect(trigger).toHaveTextContent(/pick a model/i);
    expect(screen.queryByTestId('settings-model-trigger-ctx')).toBeNull();
  });

  it('clicking the trigger fires onOpenModelPicker exactly once', async () => {
    vi.stubGlobal('fetch', buildFetch({ initialSettings: { model: 'llama-3.3-70b' } }));
    const user = userEvent.setup();
    renderModal(
      <SettingsModal open onClose={onClose} onOpenModelPicker={onOpenModelPicker} />,
    );
    await openModelsTab();

    await user.click(await screen.findByTestId('settings-model-trigger'));
    expect(onOpenModelPicker).toHaveBeenCalledTimes(1);
  });

  it('does not render the inline radiogroup any more', async () => {
    vi.stubGlobal('fetch', buildFetch());
    renderModal(
      <SettingsModal open onClose={onClose} onOpenModelPicker={onOpenModelPicker} />,
    );
    await openModelsTab();

    await screen.findByTestId('settings-model-trigger');
    expect(screen.queryByTestId('models-radiogroup')).toBeNull();
  });

  it('renders the three sliders bound to settings.chat values', async () => {
    vi.stubGlobal('fetch', buildFetch());
    renderModal(
      <SettingsModal open onClose={onClose} onOpenModelPicker={onOpenModelPicker} />,
    );
    await openModelsTab();

    const temp = await screen.findByTestId('param-temperature');
    const topP = await screen.findByTestId('param-top-p');
    const maxTokens = await screen.findByTestId('param-max-tokens');

    await waitFor(() => {
      expect(temp).toHaveValue('0.85');
      expect(topP).toHaveValue('0.95');
      expect(maxTokens).toHaveValue('800');
    });

    expect(screen.getByTestId('param-temperature-value').textContent).toBe('0.85');
    expect(screen.getByTestId('param-top-p-value').textContent).toBe('0.95');
    expect(screen.getByTestId('param-max-tokens-value').textContent).toBe('800');
  });

  it('dragging temperature PATCHes settings.chat.temperature', async () => {
    const fetchMock = buildFetch();
    vi.stubGlobal('fetch', fetchMock);

    renderModal(
      <SettingsModal open onClose={onClose} onOpenModelPicker={onOpenModelPicker} />,
    );
    await openModelsTab();

    const temp = await screen.findByTestId('param-temperature');
    fireEvent.change(temp, { target: { value: '1.25' } });

    await waitFor(
      () => {
        const patch = fetchMock.mock.calls.find(
          ([url, init]: [string, RequestInit | undefined]) =>
            url === '/api/users/me/settings' && init?.method === 'PATCH',
        );
        expect(patch).toBeDefined();
        const init = (patch as [string, RequestInit])[1];
        const body = JSON.parse(String(init.body)) as { chat?: Record<string, unknown> };
        expect(body.chat).toBeDefined();
        expect((body.chat as { temperature: number }).temperature).toBeCloseTo(1.25, 5);
      },
      { timeout: 1000 },
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix frontend run test -- Settings.models.test.tsx`
Expected: FAIL — most assertions fail because `<SettingsModelsTab>` still renders the inline `models-radiogroup`, `<SettingsModal>` doesn't accept `onOpenModelPicker`, and `settings-model-trigger` doesn't exist.

- [ ] **Step 3: Commit the failing test**

```bash
git add frontend/tests/components/Settings.models.test.tsx
git commit -m "[X27] frontend: rewrite Settings.models.test for trigger pattern"
```

---

## Task 7: Rewrite `<SettingsModelsTab>` to use a trigger

**Files:**
- Modify: `frontend/src/components/SettingsModelsTab.tsx`

- [ ] **Step 1: Replace the file**

Replace `frontend/src/components/SettingsModelsTab.tsx` in full:

```tsx
// [F44 / X27] Settings → Models tab.
//
// Composition (top → bottom):
//   1. Model trigger — a single button showing the currently-selected model
//      (Venice mark · name · ctx chip · chevron). Clicking fires
//      `onOpenModelPicker`, which the parent (SettingsModal → EditorPage)
//      wires into the same <ModelPicker /> the chat-panel model bar opens.
//   2. Generation parameters — three sliders (temperature, topP, maxTokens)
//      bound to `settings.chat`. Each tick PATCHes; the optimistic update
//      keeps the slider responsive.
//
// [X27] The previous inline <ModelCard> radiogroup was retired so this tab
// stays compact as the Venice model list grows. Selection now happens inside
// the picker modal.
import type { ChangeEvent, JSX } from 'react';
import { useId } from 'react';
import { formatCtxLabel } from '@/components/ChatPanel';
import { type Model, useModelsQuery } from '@/hooks/useModels';
import { useUpdateUserSetting, useUserSettings } from '@/hooks/useUserSettings';

interface SliderRowProps {
  id: string;
  label: string;
  hint?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  decimals: number;
  testId: string;
  onChange: (next: number) => void;
}

function SliderRow({
  id,
  label,
  hint,
  min,
  max,
  step,
  value,
  decimals,
  testId,
  onChange,
}: SliderRowProps): JSX.Element {
  return (
    <div className="flex flex-col gap-1" data-testid={`${testId}-row`}>
      <label htmlFor={id} className="flex items-baseline justify-between text-[12px]">
        <span className="font-medium text-ink-2">{label}</span>
        {hint != null ? <span className="text-ink-4 font-sans">{hint}</span> : null}
      </label>
      <div className="flex items-center gap-3">
        <input
          id={id}
          data-testid={testId}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            const parsed = Number.parseFloat(e.target.value);
            if (!Number.isNaN(parsed)) onChange(parsed);
          }}
          className="flex-1"
        />
        <span
          data-testid={`${testId}-value`}
          className="font-mono text-[12px] text-ink-3 tabular-nums w-[64px] text-right"
        >
          {value.toFixed(decimals)}
        </span>
      </div>
    </div>
  );
}

function VeniceMark(): JSX.Element {
  return (
    <svg
      data-testid="settings-model-trigger-mark"
      width="14"
      height="14"
      viewBox="0 0 18 18"
      aria-hidden="true"
    >
      <rect x="0" y="0" width="18" height="18" fill="currentColor" />
      <text
        x="9"
        y="14"
        textAnchor="middle"
        fontFamily="var(--serif), Georgia, serif"
        fontSize="13"
        fill="white"
      >
        V
      </text>
    </svg>
  );
}

function ChevronDownIcon(): JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-ink-4"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export interface SettingsModelsTabProps {
  onOpenModelPicker: () => void;
}

export function SettingsModelsTab({ onOpenModelPicker }: SettingsModelsTabProps): JSX.Element {
  const tempId = useId();
  const topPId = useId();
  const maxTokensId = useId();

  const settings = useUserSettings();
  const updateSetting = useUpdateUserSetting();
  const modelsQuery = useModelsQuery();

  // --- Model trigger ----------------------------------------------------

  const modelId = settings.chat.model;
  const selectedModel: Model | undefined = modelsQuery.data?.find((m) => m.id === modelId);
  const triggerLabel = selectedModel?.name ?? selectedModel?.id ?? 'Pick a model';
  const ctxLabel = selectedModel ? formatCtxLabel(selectedModel.contextLength) : '';

  // --- Generation parameters -------------------------------------------

  const params = settings.chat;
  const onTemperature = (v: number): void => {
    updateSetting.mutate({ chat: { temperature: v } });
  };
  const onTopP = (v: number): void => {
    updateSetting.mutate({ chat: { topP: v } });
  };
  const onMaxTokens = (v: number): void => {
    updateSetting.mutate({ chat: { maxTokens: Math.round(v) } });
  };

  // --- Render -----------------------------------------------------------

  return (
    <div className="flex flex-col gap-6">
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
          className="flex items-center gap-1.5 hover:bg-[var(--surface-hover)] px-2 py-1 rounded-[var(--radius)] bg-[var(--bg-sunken)] border border-line"
        >
          <VeniceMark />
          <span className="font-mono text-[12px] text-ink truncate flex-1 min-w-0 text-left">
            {triggerLabel}
          </span>
          {selectedModel && ctxLabel.length > 0 && ctxLabel !== '—' ? (
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

      <section className="flex flex-col gap-3" data-testid="models-section-params">
        <header>
          <h3 className="m-0 font-serif text-[14px] font-medium text-ink">Generation parameters</h3>
          <p className="mt-[2px] text-[12px] text-ink-4 font-sans">
            Live tuning for the chat composer and continue-writing.
          </p>
        </header>

        <SliderRow
          id={tempId}
          label="Temperature"
          hint="Creativity vs. focus"
          min={0}
          max={2}
          step={0.05}
          value={params.temperature}
          decimals={2}
          testId="param-temperature"
          onChange={onTemperature}
        />
        <SliderRow
          id={topPId}
          label="Top P"
          hint="Nucleus sampling"
          min={0}
          max={1}
          step={0.05}
          value={params.topP}
          decimals={2}
          testId="param-top-p"
          onChange={onTopP}
        />
        <SliderRow
          id={maxTokensId}
          label="Max tokens"
          hint="Response length cap"
          min={1}
          max={8000}
          step={64}
          value={params.maxTokens}
          decimals={0}
          testId="param-max-tokens"
          onChange={onMaxTokens}
        />
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck — expect SettingsModal to fail**

Run: `npm --prefix frontend run typecheck`
Expected: FAIL — `Property 'onOpenModelPicker' is missing in type '{}' but required in type 'SettingsModelsTabProps'` at `Settings.tsx`. That gets fixed in Task 8.

---

## Task 8: Thread `onOpenModelPicker` through `<SettingsModal>` and `<EditorPage>`

**Files:**
- Modify: `frontend/src/components/Settings.tsx`
- Modify: `frontend/src/pages/EditorPage.tsx`

- [ ] **Step 1: Add prop to `SettingsModalProps` and forward it**

Edit `frontend/src/components/Settings.tsx`. Locate the `SettingsModalProps` interface (search for `interface SettingsModalProps`) and add a required `onOpenModelPicker` prop:

```ts
export interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  onOpenModelPicker: () => void;
}
```

In the function body, locate the `<SettingsModelsTab />` render (search for `SettingsModelsTab`) and pass the prop through:

```tsx
{activeTab === 'models' ? (
  <SettingsModelsTab onOpenModelPicker={onOpenModelPicker} />
) : null}
```

(The exact JSX surrounding pattern depends on how the active tab is dispatched in `Settings.tsx`. If it uses an object map / switch, adapt the same single-line change.)

Update the destructure in the `SettingsModal` function signature:

```ts
export function SettingsModal({
  open,
  onClose,
  onOpenModelPicker,
}: SettingsModalProps): JSX.Element | null {
```

- [ ] **Step 2: Wire the EditorPage call site**

Edit `frontend/src/pages/EditorPage.tsx`. Locate the `<SettingsModal />` mount (search for `<SettingsModal`) and add the `onOpenModelPicker` prop pointing at the existing `setModelPickerOpen(true)` setter:

```tsx
<SettingsModal
  open={settingsOpen}
  onClose={() => setSettingsOpen(false)}
  onOpenModelPicker={() => setModelPickerOpen(true)}
/>
```

- [ ] **Step 3: Run the typecheck**

Run: `npm --prefix frontend run typecheck`
Expected: PASS.

- [ ] **Step 4: Run Settings.models.test.tsx**

Run: `npm --prefix frontend run test -- Settings.models.test.tsx`
Expected: PASS all six cases.

- [ ] **Step 5: Run the broader settings + picker tests to catch fallout**

Run: `npm --prefix frontend run test -- Settings ModelPicker ModelCard`
Expected: PASS. `Settings.shell-venice.test.tsx`, `Settings.prompts.test.tsx`, and the writing/appearance tabs do not import `<SettingsModal>` with explicit prop lists that would conflict — verify and adjust if any do (search for `SettingsModal open` in `frontend/tests/`):

```bash
grep -rn "SettingsModal open" frontend/tests/
```

For each match that does not already pass `onOpenModelPicker`, add `onOpenModelPicker={() => {}}` so the call sites compile. The functional behaviour under test in those files isn't affected by the new prop.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/SettingsModelsTab.tsx frontend/src/components/Settings.tsx frontend/src/pages/EditorPage.tsx frontend/tests/components/
git commit -m "[X27] frontend: SettingsModelsTab uses trigger; Settings + EditorPage wire onOpenModelPicker"
```

---

## Task 9: Update `<ModelPicker>` Storybook fixtures

**Files:**
- Modify: `frontend/src/components/ModelPicker.stories.tsx`

- [ ] **Step 1: Extend SAMPLE_MODELS with description + pricing, add new variants**

Replace the `SAMPLE_MODELS` constant in `frontend/src/components/ModelPicker.stories.tsx`:

```ts
const SAMPLE_MODELS: Model[] = [
  {
    id: 'venice-uncensored',
    name: 'Venice Uncensored',
    contextLength: 32_768,
    supportsReasoning: false,
    supportsVision: false,
    supportsWebSearch: false,
    description: 'Uncensored Venice-tuned model for creative writing.',
    pricing: { inputUsdPerMTok: 0.5, outputUsdPerMTok: 2.0 },
  },
  {
    id: 'llama-3.3-70b',
    name: 'Llama 3.3 70B',
    contextLength: 128_000,
    supportsReasoning: false,
    supportsVision: false,
    supportsWebSearch: true,
    description: 'General-purpose 70B model tuned for instruction-following.',
    pricing: { inputUsdPerMTok: 0.6, outputUsdPerMTok: 2.4 },
  },
  {
    id: 'deepseek-r1',
    name: 'DeepSeek R1',
    contextLength: 64_000,
    supportsReasoning: true,
    supportsVision: false,
    supportsWebSearch: false,
    description: 'Reasoning-tuned model optimised for chain-of-thought.',
    pricing: { inputUsdPerMTok: 0.5, outputUsdPerMTok: 1.5 },
  },
];
```

Add a new fixture and story variant after `SAMPLE_MODELS`:

```ts
const BARE_MODEL: Model = {
  id: 'bare-text',
  name: 'Bare Text',
  contextLength: 16_000,
  supportsReasoning: false,
  supportsVision: false,
  supportsWebSearch: false,
  description: null,
  pricing: null,
};
```

Add at the bottom of the file, after `Empty`:

```ts
export const Mixed: Story = {
  args: { models: [...SAMPLE_MODELS, BARE_MODEL], selectedId: 'llama-3.3-70b' },
};
```

- [ ] **Step 2: Build Storybook to confirm**

Run: `npm --prefix frontend run build-storybook`
Expected: PASS, no compilation errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ModelPicker.stories.tsx
git commit -m "[X27] frontend: ModelPicker stories show new pricing + description fields"
```

---

## Task 10: Add `<ModelCard>` Storybook + Settings NoSelection variant

**Files:**
- Create: `frontend/src/components/ModelCard.stories.tsx`
- Modify: `frontend/src/components/Settings.stories.tsx`

- [ ] **Step 1: Create the ModelCard story file**

Create `frontend/src/components/ModelCard.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Model } from '@/hooks/useModels';
import { ModelCard } from './ModelCard';

const baseModel: Model = {
  id: 'llama-3.3-70b',
  name: 'Llama 3.3 70B',
  contextLength: 65_536,
  supportsReasoning: false,
  supportsVision: false,
  supportsWebSearch: false,
  description: null,
  pricing: null,
};

interface DemoProps {
  model: Model;
  selected?: boolean;
}

function Demo({ model, selected = false }: DemoProps) {
  return (
    <div role="radiogroup" aria-label="Model" style={{ width: 360 }}>
      <ModelCard model={model} selected={selected} onSelect={() => {}} />
    </div>
  );
}

const meta = {
  title: 'Components/ModelCard',
  component: Demo,
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FullyPopulated: Story = {
  args: {
    model: {
      ...baseModel,
      description: 'A general-purpose 70B model tuned for instruction-following.',
      pricing: { inputUsdPerMTok: 0.6, outputUsdPerMTok: 2.4 },
      supportsReasoning: true,
      supportsWebSearch: true,
    },
    selected: true,
  },
};

export const PriceOnly: Story = {
  args: {
    model: {
      ...baseModel,
      pricing: { inputUsdPerMTok: 0.15, outputUsdPerMTok: 0.6 },
    },
  },
};

export const DescriptionOnly: Story = {
  args: {
    model: {
      ...baseModel,
      description: 'A small-but-mighty model for quick interactive completions.',
    },
  },
};

export const Bare: Story = {
  args: { model: baseModel },
};
```

- [ ] **Step 2: Add NoSelection variant to Settings.stories.tsx**

Edit `frontend/src/components/Settings.stories.tsx`. Find the existing Models-tab story export (search for `Models` story in the file). Update the `SAMPLE_MODELS` constant in this file to also include the new `description` + `pricing` fields (mirror the values used in `ModelPicker.stories.tsx`). Add a new export at the bottom of the file:

```ts
export const ModelsTabNoSelection: Story = {
  // Same args as the existing Models-tab story, but with chat.model = null.
  // The rendering convention in this file passes `selectedModelId` into a
  // helper that seeds userSettingsQueryKey; pass null instead.
};
```

The exact body depends on the local helper pattern in `Settings.stories.tsx`. If `ModelsTab` uses `selectedModelId: 'llama-3.3-70b'` (or similar), `ModelsTabNoSelection` uses `selectedModelId: null`. Open the file and adapt — keep the change scoped to this single new export plus the `description`/`pricing` fixture extension.

- [ ] **Step 3: Build Storybook**

Run: `npm --prefix frontend run build-storybook`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ModelCard.stories.tsx frontend/src/components/Settings.stories.tsx
git commit -m "[X27] frontend: ModelCard stories + Settings ModelsTab NoSelection variant"
```

---

## Task 11: Integration test — Settings opens the same picker

**Files:**
- Modify: `frontend/tests/pages/editor-shell.integration.test.tsx`

The aim is one focused integration assertion: opening Settings → Models → clicking the trigger shows the same `<ModelPicker />` mount, and selecting a model updates the Settings trigger label without closing Settings.

- [ ] **Step 1: Inspect the existing integration test to find the right test surface**

Run: `grep -n "describe\|it(" frontend/tests/pages/editor-shell.integration.test.tsx`
Read enough of the file to understand its setup (`beforeEach`, fetch mock, render helper). The new test should reuse the existing test infrastructure rather than build its own.

- [ ] **Step 2: Append the integration test**

Add this test inside the existing `describe(...)` block that exercises EditorPage shell behaviour:

```tsx
it('[X27] Settings → Models trigger opens the same ModelPicker the chat-bar opens', async () => {
  // The fetch mock used by this file already responds to /api/ai/models
  // with at least one model and to /api/users/me/settings with a chat.model
  // value. If not, extend the local fixture so 'llama-3.3-70b' is present.

  const user = userEvent.setup();
  // … render(<EditorPage />) — reuse the existing render helper.

  // Open Settings via the chat-panel settings icon (existing pattern in
  // this file). The test name and selectors below match the existing
  // chat-panel test IDs.
  await user.click(screen.getByRole('button', { name: /settings/i }));
  await user.click(await screen.findByTestId('settings-tab-models'));

  // Click the new trigger.
  await user.click(await screen.findByTestId('settings-model-trigger'));

  // The ModelPicker dialog should now be on screen — same mount that the
  // chat-bar opens (data-testid="model-picker" comes from <Modal testId="...">).
  expect(await screen.findByTestId('model-picker')).toBeInTheDocument();

  // Settings should still be visible underneath (its tab list is still in DOM).
  expect(screen.getByTestId('settings-tab-models')).toBeInTheDocument();
});
```

If the existing render helper or fetch fixtures do not currently respond to `/api/ai/models`, extend the helper to return one fixture model. Keep the change small — one extra route in the existing route table.

- [ ] **Step 3: Run the integration test**

Run: `npm --prefix frontend run test -- editor-shell.integration.test.tsx`
Expected: PASS the new case + existing cases.

- [ ] **Step 4: Commit**

```bash
git add frontend/tests/pages/editor-shell.integration.test.tsx
git commit -m "[X27] frontend: integration — Settings trigger opens the shared ModelPicker"
```

---

## Task 12: Docs + tick X27

**Files:**
- Modify: `docs/api-contract.md`
- Modify: `docs/venice-integration.md`
- Modify: `TASKS.md`

- [ ] **Step 1: Update `docs/api-contract.md`**

Locate the `GET /api/ai/models` section in `docs/api-contract.md` (search for `/api/ai/models`). Update the response example to include the new fields, and add a brief note below it:

```jsonc
{
  "models": [
    {
      "id": "llama-3.3-70b",
      "name": "Llama 3.3 70B",
      "contextLength": 65536,
      "supportsReasoning": false,
      "supportsVision": false,
      "supportsWebSearch": false,
      "description": "A general-purpose 70B model tuned for instruction-following.",
      "pricing": { "inputUsdPerMTok": 0.6, "outputUsdPerMTok": 2.4 }
    }
  ]
}
```

> `description` is `string | null`. `pricing` is atomic — either both `inputUsdPerMTok` and `outputUsdPerMTok` are present (numbers, USD per 1M tokens) or the whole `pricing` object is `null`. We never expose a partial price.

- [ ] **Step 2: Update `docs/venice-integration.md`**

Find the section that documents the `/v1/models` mapping (search for `model_spec` or `ModelInfo`). Append:

> **[X27] Description and pricing.** `model_spec.description` (string) is mapped to `ModelInfo.description`, with empty / whitespace-only strings normalised to `null`. `model_spec.pricing.input.usd` and `model_spec.pricing.output.usd` (USD per 1M tokens) are mapped to `ModelInfo.pricing.{inputUsdPerMTok, outputUsdPerMTok}`. If either side is missing or non-numeric, the whole `pricing` object becomes `null` — we never render half-pricing. The DEM column from Venice (`pricing.{input,output}.diem`) is intentionally not consumed.

- [ ] **Step 3: Tick X27 in TASKS.md**

Edit `TASKS.md`. Find the `[X27]` line (currently `- [ ] **[X27]** Settings → Models picker rework. …`) and flip the checkbox to `[x]`. Add a `plan:` line directly below referencing this plan file:

```markdown
- [x] **[X27]** Settings → Models picker rework. The current dialog dumps the full model list inline and gets unwieldy. Mirror the chat-window pattern: the Settings panel shows only the currently selected model; clicking it opens a dedicated picker modal containing the full list. In the picker, surface the per-model description from Venice's `/models` endpoint and the per-token price alongside the model name.
  - spec: [docs/superpowers/specs/2026-05-04-x27-models-picker-rework-design.md](docs/superpowers/specs/2026-05-04-x27-models-picker-rework-design.md)
  - plan: [docs/superpowers/plans/2026-05-04-x27-models-picker-rework.md](docs/superpowers/plans/2026-05-04-x27-models-picker-rework.md)
  - verify: `npm --prefix backend run test -- venice.models.service.test.ts && npm --prefix frontend run test -- ModelCard ModelPicker Settings.models editor-shell.integration && npm --prefix frontend run typecheck && npm --prefix frontend run build-storybook`
```

Also remove `X27` from the **Backlog (next)** line at the top of the file (currently `- **Backlog (next):** M1–M3 maintenance, X27, X28, X30 testing-found UI/settings polish.`) and from the **Proposed (no plan yet)** list (line 24). Final form of those lines:

```markdown
- **Backlog (next):** M1–M3 maintenance, X28, X30 testing-found UI/settings polish.
- **Proposed (no plan yet):** X1, X2, X3, X4, X5, X6, X7, X8, X9, X11, X17, X18, X28, X30, DS-* (none yet).
```

- [ ] **Step 4: Run the verify command end-to-end**

Run: `bash .claude/skills/task-verify/run.sh X27`
Expected: exit 0. The pipeline runs the four commands in sequence and surfaces the true exit code.

- [ ] **Step 5: Commit**

```bash
git add TASKS.md docs/api-contract.md docs/venice-integration.md
git commit -m "[X27] docs + tick: api-contract, venice-integration, TASKS"
```

---

## Self-review notes

Spec coverage walk-through (against `docs/superpowers/specs/2026-05-04-x27-models-picker-rework-design.md`):

- §2 In-scope items: backend extend (Task 1), `<ModelCard>` rewrite (Tasks 3–4), `<SettingsModelsTab>` rewrite (Tasks 6–8), `<SettingsModal>` / `EditorPage` thread-through (Task 8), `<ModelPicker>` price hint (Task 5). All present.
- §3 Venice schema reference: encoded into Task 1's `mapModel` and into the Storybook fixtures. The DEM column is intentionally absent from `VeniceRawModelSpec` and from `ModelInfo` (matches §2 out-of-scope).
- §4 Backend changes: Task 1.
- §5 Frontend changes: §5.1 → Task 2; §5.2 → Tasks 3–4; §5.3 → Task 7; §5.4 → Task 8; §5.5 → Task 8; §5.6 → Task 5.
- §6 Storybook: §6.1 → Task 9; §6.2 → Task 10; §6.3 → Task 10.
- §7 Tests: §7.1 backend → Task 1; §7.2 frontend `ModelCard.test.tsx` → Task 3; `Settings.models.test.tsx` rewrite → Task 6; `ModelPicker.test.tsx` price-hint → Task 5; integration → Task 11. The "moved test" (multi-device PATCH from Settings) is **already** in `ModelPicker.test.tsx` (verified — it's the `'clicking a card PATCHes /users/me/settings and calls onClose'` case at lines 136–173). No move needed; just remove the redundant Settings-side test, which Task 6's rewrite does implicitly by replacing the file.
- §8 Docs: Task 12.
- §10 Manual smoke checklist: not encoded as plan tasks (it's the post-merge gate). The verify command in Task 12 covers automated coverage; the smoke check stays as the human gate.

Type-consistency check: `ModelInfo` (backend) and `Model` (frontend) both expose `description: string | null` and `pricing: { inputUsdPerMTok: number; outputUsdPerMTok: number } | null`. The new `ModelPricing` interface is named the same on both sides for symmetry. `SettingsModelsTabProps` exposes `onOpenModelPicker: () => void`; `SettingsModalProps` exposes the same. Test IDs are consistent: `model-card-${id}-price`, `model-card-${id}-desc`, `settings-model-trigger`, `settings-model-trigger-ctx`, `model-picker-price-hint`.

Placeholder scan: no "TBD" / "implement later" / "similar to Task N" / "handle edge cases" without code. Every step lists either a command, a code block, or a concrete edit target.
