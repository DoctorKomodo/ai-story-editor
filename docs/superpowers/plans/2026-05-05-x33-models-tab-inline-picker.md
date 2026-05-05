# X33 — Settings → Models tab inline picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace X27's modal `<ModelPicker />` + `<ModelCard>` trigger pattern with an inline master/detail picker that lives inside Settings → Models tab. Reroute the chat-bar trigger to open Settings on Models. Drop Settings' Cancel/Done buttons; bump modal close-X to 44×44 across the whole app.

**Architecture:** A new presentational `<ModelPickerInline>` (240px rail + flex-1 detail pane with "Use this model" CTA) is embedded in `<SettingsModelsTab>`. Chat-bar's existing trigger now calls `setSettingsInitialTab('models'); setSettingsOpen(true)`. `<SettingsModal>` accepts `initialTab` to land on Models from that path. Footer becomes hint-only. `IconButton` and `CloseIcon` get `'lg'` size variants used by every modal header automatically.

**Tech Stack:** TypeScript strict, React 19, TanStack Query, Vitest + React Testing Library, Storybook 9.

**Spec:** `docs/superpowers/specs/2026-05-05-x33-models-tab-inline-picker-design.md`.

**Branch:** `feature/x33-models-tab-inline-picker` off main, with the four "X27 survives" commits cherry-picked first (see Migration in the spec, §11). The implementer of Task 0 sets up the branch.

---

## File map

**Created**
- `frontend/src/components/ModelPickerInline.tsx`
- `frontend/src/components/ModelPickerInline.stories.tsx`
- `frontend/tests/components/ModelPickerInline.test.tsx`

**Modified**
- `frontend/src/design/primitives.tsx` (IconButton + CloseIcon get `'lg'` size; ModalHeader uses it)
- `frontend/src/design/IconButton.stories.tsx` (Lg variant)
- `frontend/src/components/Settings.tsx` (`initialTab` prop, drop `onOpenModelPicker`, drop Cancel/Done, hint footer)
- `frontend/src/components/SettingsModelsTab.tsx` (full rewrite — embed picker, drop trigger)
- `frontend/src/components/Settings.stories.tsx` (drop `onOpenModelPicker` no-ops, update Models story)
- `frontend/src/pages/EditorPage.tsx` (drop `setModelPickerOpen` + `<ModelPicker>` mount; add `settingsInitialTab` state; reroute chat-bar trigger)
- `frontend/tests/components/Settings.models.test.tsx` (rewrite for inline picker)
- `frontend/tests/components/Settings.{appearance,prompts,writing,shell-venice}.test.tsx` (drop no-op props)
- `frontend/tests/pages/editor-shell.integration.test.tsx` (replace X27 case with chat-bar → Settings flow)

**Deleted**
- `frontend/src/components/ModelCard.tsx`
- `frontend/src/components/ModelCard.stories.tsx`
- `frontend/src/components/ModelPicker.tsx`
- `frontend/src/components/ModelPicker.stories.tsx`
- `frontend/src/components/ModelPickerSplit.stories.tsx` (mockup retired)
- `frontend/src/components/SettingsModelsTabSplit.stories.tsx` (mockup retired)
- `frontend/tests/components/ModelCard.test.tsx`
- `frontend/tests/components/ModelPicker.test.tsx`

**TASKS.md**
- Add `[X33]` entry; remove from "Proposed" / "Backlog" lists if/when added there.

---

## Build sequence

Primitive changes first (Tasks 1–2) so every modal in the app picks up the larger close button automatically. Then the new `<ModelPickerInline>` (TDD: tests in Task 3, implementation in Task 4, Storybook in Task 5) so the production component exists before consumers wire it up. Then `<SettingsModelsTab>` (Task 6) embeds it. Then `<SettingsModal>` chrome update + `initialTab` prop (Task 7). Then `<EditorPage>` wiring (Task 8). Then integration test (Task 9). Then deletions + cleanup + tick (Task 10).

Each numbered task ends in a commit so an interrupted session can resume on a clean tree.

---

## Task 0: Branch setup (one-shot)

This isn't a TDD task — it's the migration step from the spec.

- [ ] **Step 1: Create the branch off main and cherry-pick X27's "survives" commits**

```bash
git fetch origin
git checkout -b feature/x33-models-tab-inline-picker origin/main
git cherry-pick 8dc9473 686d153 9bb3c45 950a282
```

Resolve any conflicts as they appear (the four commits should apply cleanly off main since they don't touch each other's surfaces).

Also cherry-pick the X33 spec/plan once they exist on the X27 branch:

```bash
git cherry-pick <X33-spec-commit-sha> <X33-plan-commit-sha>
```

(Or if the spec/plan land on this branch directly via this task, skip the cherry-pick.)

- [ ] **Step 2: Run the verify floor**

```bash
npm --prefix backend run typecheck
npm --prefix frontend run typecheck
npm --prefix backend run test
npm --prefix frontend run test
npm --prefix frontend run build-storybook
```

Expected: PASS. The cherry-picks should leave the tree in a working state because X27's frontend UI commits (which are the ones being dropped) are NOT cherry-picked. There will be TS errors about `<SettingsModal>`'s `onOpenModelPicker` prop in the existing tests, because those test fixtures came from X27's UI commits. Resolve by checking which test files are present on this branch — if `Settings.{models,appearance,prompts,writing,shell-venice}.test.tsx` are present from main, no changes; if they reference `onOpenModelPicker` (because the tests were authored on the X27 branch), drop those props in this task.

- [ ] **Step 3: Push and open a draft PR**

```bash
git push -u origin feature/x33-models-tab-inline-picker
gh pr create --draft --title "[X33] Models tab inline picker (supersedes X27)" --body "Implementation in progress. Spec: docs/superpowers/specs/2026-05-05-x33-models-tab-inline-picker-design.md"
```

- [ ] **Step 4: Close PR #65 with a comment pointing at the new PR**

(Manual; do this after the X33 PR is open.)

---

## Task 1: Add `lg` size to `IconButton` and `CloseIcon`

**Files:**
- Modify: `frontend/src/design/primitives.tsx:308-336` (IconButton)
- Modify: `frontend/src/design/primitives.tsx:494-510` (CloseIcon)
- Modify: `frontend/src/design/IconButton.stories.tsx` (add Lg story)

- [ ] **Step 1: Extend `IconButtonProps` and the body**

Replace `IconButtonProps` and the `IconButton` forwardRef:

```ts
export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  ariaLabel: string;
  active?: boolean;
  testId?: string;
  /**
   * Hit-target size. Default `'md'` = 28×28 (the historical IconButton size).
   * `'lg'` = 44×44, used by ModalHeader's close button to meet WCAG 2.5.5.
   */
  size?: 'md' | 'lg';
}

const ICON_BUTTON_SIZE: Record<NonNullable<IconButtonProps['size']>, string> = {
  md: 'w-7 h-7',
  lg: 'w-11 h-11',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { ariaLabel, active, testId, size = 'md', className, children, ...rest },
  ref,
): JSX.Element {
  return (
    <button
      ref={ref}
      type={rest.type ?? 'button'}
      aria-label={ariaLabel}
      data-testid={testId}
      data-size={size}
      className={cx(
        'grid place-items-center rounded-[var(--radius)] transition-colors',
        ICON_BUTTON_SIZE[size],
        active
          ? 'bg-[var(--accent-soft)] text-ink'
          : 'text-ink-3 hover:bg-[var(--surface-hover)] hover:text-ink',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
```

- [ ] **Step 2: Extend `CloseIcon`**

Replace the `CloseIcon` declaration:

```tsx
export interface CloseIconProps {
  /** `'md'` (default) = 14×14; `'lg'` = 20×20 to pair with `<IconButton size="lg">`. */
  size?: 'md' | 'lg';
}

export function CloseIcon({ size = 'md' }: CloseIconProps = {}): JSX.Element {
  const px = size === 'lg' ? 20 : 14;
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
```

(If the existing `CloseIcon` body uses different SVG path, preserve the path; only add the `size` prop and switch `width`/`height` to the parameterised value.)

- [ ] **Step 3: Update `ModalHeader` to use `lg` for both the button and the glyph**

In `primitives.tsx` around line 207-209, replace:

```tsx
{onClose ? (
  <IconButton
    onClick={onClose}
    disabled={closeDisabled}
    ariaLabel="Close"
    testId={closeTestId ?? 'modal-close'}
  >
    <CloseIcon />
  </IconButton>
) : null}
```

with:

```tsx
{onClose ? (
  <IconButton
    onClick={onClose}
    disabled={closeDisabled}
    ariaLabel="Close"
    testId={closeTestId ?? 'modal-close'}
    size="lg"
  >
    <CloseIcon size="lg" />
  </IconButton>
) : null}
```

- [ ] **Step 4: Add Lg story to `IconButton.stories.tsx`**

Append a new export:

```tsx
export const Lg: Story = {
  args: { size: 'lg', ariaLabel: 'Close', children: <CloseIcon size="lg" /> },
};
```

If the existing `IconButton.stories.tsx` doesn't import `CloseIcon`, add it. Adapt arg-shape to match the existing story exports.

- [ ] **Step 5: Run typecheck + tests + storybook build**

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run test
npm --prefix frontend run build-storybook
```

Expected: PASS. The IconButton API change is additive (new optional prop with default), so no existing call sites should break.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/design/primitives.tsx frontend/src/design/IconButton.stories.tsx
git commit -m "[X33] design: IconButton + CloseIcon gain lg size; ModalHeader uses it"
```

---

## Task 2: Failing tests for `<ModelPickerInline>`

**Files:**
- Create: `frontend/tests/components/ModelPickerInline.test.tsx`

TDD red checkpoint: tests are committed *failing* (the component doesn't exist yet). Task 4 makes them pass.

- [ ] **Step 1: Create the test file**

Create `frontend/tests/components/ModelPickerInline.test.tsx`:

```tsx
// [X33] ModelPickerInline — pure presentational component covering rail
// rendering, preview vs active states, and the "Use this model" CTA flow.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ModelPickerInline } from '@/components/ModelPickerInline';
import type { Model } from '@/hooks/useModels';

function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'llama-3.3-70b',
    name: 'Llama 3.3 70B',
    contextLength: 128_000,
    supportsReasoning: false,
    supportsVision: false,
    supportsWebSearch: false,
    description: null,
    pricing: null,
    ...overrides,
  };
}

const TWO_MODELS: Model[] = [
  makeModel({
    id: 'llama-3.3-70b',
    name: 'Llama 3.3 70B',
    description: 'Meta-tuned 70B general-purpose model.',
    pricing: { inputUsdPerMTok: 0.6, outputUsdPerMTok: 2.4 },
    supportsWebSearch: true,
  }),
  makeModel({
    id: 'qwen-3-6-plus',
    name: 'Qwen 3.6 Plus',
    contextLength: 1_000_000,
    description: 'Reasoning-tuned flagship.',
    pricing: { inputUsdPerMTok: 0.63, outputUsdPerMTok: 3.75 },
    supportsReasoning: true,
    supportsWebSearch: true,
  }),
];

describe('ModelPickerInline (X33)', () => {
  it('renders one rail row per model with name, compact pricing, and ctx label', () => {
    render(<ModelPickerInline models={TWO_MODELS} activeId={null} onUseModel={() => {}} />);
    const llama = screen.getByTestId('model-rail-llama-3.3-70b');
    expect(llama).toHaveTextContent('Llama 3.3 70B');
    expect(llama).toHaveTextContent('$0.60');
    expect(llama).toHaveTextContent('$2.40');
    expect(llama).toHaveTextContent(/128k/i);

    const qwen = screen.getByTestId('model-rail-qwen-3-6-plus');
    expect(qwen).toHaveTextContent(/1M/i);
  });

  it('renders "no price" placeholder for bare models', () => {
    const bare = makeModel({ id: 'bare', name: 'Bare', pricing: null });
    render(<ModelPickerInline models={[bare]} activeId={null} onUseModel={() => {}} />);
    expect(screen.getByTestId('model-rail-bare')).toHaveTextContent(/no price/i);
  });

  it('marks the active model with a dot prefix in the rail', () => {
    render(
      <ModelPickerInline models={TWO_MODELS} activeId="llama-3.3-70b" onUseModel={() => {}} />,
    );
    const row = screen.getByTestId('model-rail-llama-3.3-70b');
    expect(row.querySelector('[aria-label="Currently in use"]')).not.toBeNull();
    const other = screen.getByTestId('model-rail-qwen-3-6-plus');
    expect(other.querySelector('[aria-label="Currently in use"]')).toBeNull();
  });

  it('opens with the active model highlighted in the detail pane', () => {
    render(
      <ModelPickerInline models={TWO_MODELS} activeId="qwen-3-6-plus" onUseModel={() => {}} />,
    );
    expect(screen.getByTestId('model-detail-name')).toHaveTextContent('Qwen 3.6 Plus');
  });

  it('falls back to the first model when activeId is null', () => {
    render(<ModelPickerInline models={TWO_MODELS} activeId={null} onUseModel={() => {}} />);
    expect(screen.getByTestId('model-detail-name')).toHaveTextContent('Llama 3.3 70B');
  });

  it('clicking a rail row updates the detail pane without calling onUseModel', async () => {
    const onUseModel = vi.fn();
    render(
      <ModelPickerInline
        models={TWO_MODELS}
        activeId="llama-3.3-70b"
        onUseModel={onUseModel}
      />,
    );
    await userEvent.setup().click(screen.getByTestId('model-rail-qwen-3-6-plus'));
    expect(screen.getByTestId('model-detail-name')).toHaveTextContent('Qwen 3.6 Plus');
    expect(onUseModel).not.toHaveBeenCalled();
  });

  it('CTA reads "Use this model" when previewing a non-active model and fires onUseModel on click', async () => {
    const onUseModel = vi.fn();
    render(
      <ModelPickerInline
        models={TWO_MODELS}
        activeId="llama-3.3-70b"
        onUseModel={onUseModel}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId('model-rail-qwen-3-6-plus'));
    const cta = screen.getByTestId('model-detail-cta');
    expect(cta).toHaveTextContent(/use this model/i);
    expect(cta).not.toBeDisabled();
    await user.click(cta);
    expect(onUseModel).toHaveBeenCalledTimes(1);
    expect(onUseModel).toHaveBeenCalledWith('qwen-3-6-plus');
  });

  it('CTA reads "Currently in use" disabled when previewing the active model', () => {
    render(
      <ModelPickerInline
        models={TWO_MODELS}
        activeId="llama-3.3-70b"
        onUseModel={() => {}}
      />,
    );
    const cta = screen.getByTestId('model-detail-cta');
    expect(cta).toHaveTextContent(/currently in use/i);
    expect(cta).toBeDisabled();
  });

  it('renders capability chips for reasoning and web search; never renders vision', () => {
    render(
      <ModelPickerInline
        models={[
          makeModel({
            id: 'mm',
            name: 'Multimodal',
            supportsReasoning: true,
            supportsWebSearch: true,
            supportsVision: true,
            description: 'desc',
          }),
        ]}
        activeId="mm"
        onUseModel={() => {}}
      />,
    );
    expect(screen.getByText('Reasoning')).toBeInTheDocument();
    expect(screen.getByText('Web search')).toBeInTheDocument();
    expect(screen.queryByText(/vision/i)).toBeNull();
  });

  it('renders the description as full prose, and an italic empty-state when missing', () => {
    const { rerender } = render(
      <ModelPickerInline
        models={[makeModel({ id: 'with', description: 'Full description here.' })]}
        activeId="with"
        onUseModel={() => {}}
      />,
    );
    expect(screen.getByTestId('model-detail-description')).toHaveTextContent(
      'Full description here.',
    );

    rerender(
      <ModelPickerInline
        models={[makeModel({ id: 'no', description: null })]}
        activeId="no"
        onUseModel={() => {}}
      />,
    );
    expect(screen.getByTestId('model-detail-description')).toHaveTextContent(
      /no description provided by the model host/i,
    );
  });

  it('renders a skeleton rail and no detail pane when loading', () => {
    render(<ModelPickerInline models={[]} activeId={null} loading onUseModel={() => {}} />);
    expect(screen.queryByTestId('model-detail-name')).toBeNull();
    expect(screen.getByTestId('model-rail-skeleton')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test → expect FAIL**

`npm --prefix frontend run test -- ModelPickerInline.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/ModelPickerInline"`.

- [ ] **Step 3: Commit (TDD red)**

```bash
git add frontend/tests/components/ModelPickerInline.test.tsx
git commit -m "[X33] frontend: failing tests for ModelPickerInline"
```

---

## Task 3: Implement `<ModelPickerInline>`

**Files:**
- Create: `frontend/src/components/ModelPickerInline.tsx`

- [ ] **Step 1: Write the file**

Create `frontend/src/components/ModelPickerInline.tsx`:

```tsx
// [X33] Inline master/detail model picker — embedded in the Settings → Models
// tab. Pure presentational; the caller wires `activeId` from settings and
// `onUseModel` to PATCH /users/me/settings.
//
// Layout: 240px rail (scrollable list of models) + flex-1 detail pane
// (capabilities, description, pricing/context grid, "Use this model" CTA).
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { Button } from '@/design/primitives';
import type { Model } from '@/hooks/useModels';

export interface ModelPickerInlineProps {
  models: Model[];
  activeId: string | null;
  onUseModel: (id: string) => void;
  loading?: boolean;
  error?: boolean;
}

function formatCtx(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

function formatUsd(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

interface RailRowProps {
  model: Model;
  highlighted: boolean;
  active: boolean;
  onPreview: () => void;
}

function RailRow({ model, highlighted, active, onPreview }: RailRowProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onPreview}
      data-testid={`model-rail-${model.id}`}
      aria-current={highlighted ? 'true' : undefined}
      className={[
        'w-full text-left px-3 py-2.5 border-l-2 transition-colors',
        highlighted
          ? 'bg-bg-sunken border-l-ink'
          : 'bg-transparent border-l-transparent hover:bg-bg-sunken/60',
      ].join(' ')}
    >
      <div className="flex items-center gap-1.5">
        {active ? (
          <span
            aria-label="Currently in use"
            title="Currently in use"
            className="inline-block size-1.5 rounded-full bg-ink shrink-0"
          />
        ) : null}
        <span className="font-mono text-[12.5px] text-ink truncate">{model.name}</span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <span className="font-mono text-[10.5px] text-ink-4 tabular-nums truncate">
          {model.pricing != null
            ? `${formatUsd(model.pricing.inputUsdPerMTok)} · ${formatUsd(model.pricing.outputUsdPerMTok)}`
            : 'no price'}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[.06em] text-ink-3 shrink-0">
          {formatCtx(model.contextLength)}
        </span>
      </div>
    </button>
  );
}

interface CapabilityChipProps {
  label: string;
}

function CapabilityChip({ label }: CapabilityChipProps): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius)] border border-line text-[11px] text-ink-2 font-sans">
      <span aria-hidden="true" className="size-1 rounded-full bg-ink-3" />
      {label}
    </span>
  );
}

interface DetailPaneProps {
  model: Model;
  isActive: boolean;
  onUseModel: (id: string) => void;
}

function DetailPane({ model, isActive, onUseModel }: DetailPaneProps): JSX.Element {
  const capabilities: string[] = [];
  if (model.supportsReasoning) capabilities.push('Reasoning');
  if (model.supportsWebSearch) capabilities.push('Web search');

  return (
    <div className="flex flex-col gap-5 p-6 overflow-y-auto h-full">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3
            data-testid="model-detail-name"
            className="m-0 font-serif text-[20px] leading-tight text-ink truncate"
          >
            {model.name}
          </h3>
          <code className="font-mono text-[11px] text-ink-4 tracking-tight">{model.id}</code>
        </div>
        <Button
          data-testid="model-detail-cta"
          variant={isActive ? 'ghost' : 'primary'}
          size="sm"
          disabled={isActive}
          onClick={() => {
            onUseModel(model.id);
          }}
        >
          {isActive ? 'Currently in use' : 'Use this model'}
        </Button>
      </header>

      {capabilities.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {capabilities.map((c) => (
            <CapabilityChip key={c} label={c} />
          ))}
        </div>
      ) : null}

      <p
        data-testid="model-detail-description"
        className="m-0 font-sans text-[13.5px] leading-[1.6] text-ink-2"
      >
        {model.description ?? (
          <span className="italic text-ink-4">No description provided by the model host.</span>
        )}
      </p>

      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-[12px]">
        <dt className="font-sans text-ink-4">Context window</dt>
        <dd
          data-testid="model-detail-context"
          className="m-0 font-mono text-ink-2 tabular-nums"
        >
          {formatCtx(model.contextLength)} tokens
        </dd>

        <dt className="font-sans text-ink-4">Input price</dt>
        <dd
          data-testid="model-detail-input-price"
          className="m-0 font-mono text-ink-2 tabular-nums"
        >
          {model.pricing != null
            ? `${formatUsd(model.pricing.inputUsdPerMTok)} / 1M tokens`
            : '—'}
        </dd>

        <dt className="font-sans text-ink-4">Output price</dt>
        <dd
          data-testid="model-detail-output-price"
          className="m-0 font-mono text-ink-2 tabular-nums"
        >
          {model.pricing != null
            ? `${formatUsd(model.pricing.outputUsdPerMTok)} / 1M tokens`
            : '—'}
        </dd>
      </dl>
    </div>
  );
}

function SkeletonRail(): JSX.Element {
  return (
    <div data-testid="model-rail-skeleton" className="flex flex-col gap-1 p-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton rows are positional, never reordered
          key={i}
          className="h-9 rounded-[var(--radius)] bg-bg-sunken animate-pulse"
        />
      ))}
    </div>
  );
}

function ErrorFrame(): JSX.Element {
  return (
    <div className="grid place-items-center p-6 text-center text-[12.5px] text-ink-4 font-sans h-[360px] col-span-2">
      Couldn’t load models. Try reopening Settings.
    </div>
  );
}

export function ModelPickerInline({
  models,
  activeId,
  onUseModel,
  loading = false,
  error = false,
}: ModelPickerInlineProps): JSX.Element {
  const initialHighlight = activeId ?? models[0]?.id ?? null;
  const [highlightedId, setHighlightedId] = useState<string | null>(initialHighlight);

  // Keep `highlighted` in sync if the parent flips activeId externally
  // (e.g. the user just confirmed a different model in the same session).
  useEffect(() => {
    if (highlightedId == null && activeId != null) {
      setHighlightedId(activeId);
    }
  }, [activeId, highlightedId]);

  if (error) {
    return (
      <div className="grid grid-cols-[240px_1fr] min-h-[360px] rounded-[var(--radius)] border border-line bg-bg-elevated overflow-hidden">
        <ErrorFrame />
      </div>
    );
  }

  if (loading || models.length === 0) {
    return (
      <div className="grid grid-cols-[240px_1fr] min-h-[360px] rounded-[var(--radius)] border border-line bg-bg-elevated overflow-hidden">
        <div className="border-r border-line bg-bg-sunken/30">
          <SkeletonRail />
        </div>
        <div />
      </div>
    );
  }

  const highlighted =
    models.find((m) => m.id === highlightedId) ?? models[0] ?? null;
  if (highlighted == null) return <div />;

  return (
    <div className="grid grid-cols-[240px_1fr] min-h-[360px] rounded-[var(--radius)] border border-line bg-bg-elevated overflow-hidden">
      <div
        role="listbox"
        aria-label="Models"
        data-testid="model-rail"
        className="overflow-y-auto border-r border-line bg-bg-sunken/30 max-h-[420px]"
      >
        {models.map((m) => (
          <RailRow
            key={m.id}
            model={m}
            highlighted={m.id === highlighted.id}
            active={m.id === activeId}
            onPreview={() => {
              setHighlightedId(m.id);
            }}
          />
        ))}
      </div>

      <DetailPane
        model={highlighted}
        isActive={highlighted.id === activeId}
        onUseModel={onUseModel}
      />
    </div>
  );
}
```

- [ ] **Step 2: Run the test → expect PASS**

`npm --prefix frontend run test -- ModelPickerInline.test.tsx`
Expected: PASS all 11 cases.

- [ ] **Step 3: Run typecheck**

`npm --prefix frontend run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ModelPickerInline.tsx
git commit -m "[X33] frontend: ModelPickerInline implementation"
```

---

## Task 4: ModelPickerInline Storybook

**Files:**
- Create: `frontend/src/components/ModelPickerInline.stories.tsx`

- [ ] **Step 1: Write the stories file**

Create `frontend/src/components/ModelPickerInline.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { ModelPickerInline } from './ModelPickerInline';
import type { Model } from '@/hooks/useModels';

const SAMPLE_MODELS: Model[] = [
  {
    id: 'zai-org-glm-5-1',
    name: 'GLM 5.1',
    contextLength: 200_000,
    supportsReasoning: true,
    supportsVision: false,
    supportsWebSearch: true,
    description:
      'Next-generation large language model from Zhiyuan AI, featuring significantly enhanced reasoning capabilities, an expanded context window, and stronger performance across creative writing, code, and analysis tasks.',
    pricing: { inputUsdPerMTok: 1.75, outputUsdPerMTok: 5.5 },
  },
  {
    id: 'llama-3.3-70b',
    name: 'Llama 3.3 70B',
    contextLength: 128_000,
    supportsReasoning: false,
    supportsVision: false,
    supportsWebSearch: true,
    description:
      'Meta-tuned 70B general-purpose model. Strong instruction-following and creative-writing performance; reliable default for long-form prose.',
    pricing: { inputUsdPerMTok: 0.6, outputUsdPerMTok: 2.4 },
  },
  {
    id: 'qwen-3-6-plus',
    name: 'Qwen 3.6 Plus',
    contextLength: 1_000_000,
    supportsReasoning: true,
    supportsVision: false,
    supportsWebSearch: true,
    description:
      'Alibaba’s latest flagship reasoning model with exceptional performance across coding, reasoning, and general writing.',
    pricing: { inputUsdPerMTok: 0.63, outputUsdPerMTok: 3.75 },
  },
  {
    id: 'bare-text-mini',
    name: 'Bare Text Mini',
    contextLength: 16_000,
    supportsReasoning: false,
    supportsVision: false,
    supportsWebSearch: false,
    description: null,
    pricing: null,
  },
];

interface DemoArgs {
  activeId: string | null;
  loading?: boolean;
  error?: boolean;
  models?: Model[];
}

function Demo({ activeId, loading, error, models = SAMPLE_MODELS }: DemoArgs): JSX.Element {
  const [active, setActive] = useState(activeId);
  return (
    <div className="p-6" style={{ minWidth: 720 }}>
      <ModelPickerInline
        models={models}
        activeId={active}
        loading={loading}
        error={error}
        onUseModel={(id) => {
          setActive(id);
        }}
      />
    </div>
  );
}

const meta = {
  title: 'Components/ModelPickerInline',
  component: Demo,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { activeId: 'llama-3.3-70b' } };
export const ActiveTopOfList: Story = { args: { activeId: 'zai-org-glm-5-1' } };
export const BareModelActive: Story = { args: { activeId: 'bare-text-mini' } };
export const NoActiveModel: Story = { args: { activeId: null } };
export const Loading: Story = { args: { activeId: null, loading: true, models: [] } };
export const ErrorState: Story = { args: { activeId: null, error: true, models: [] } };
export const Empty: Story = { args: { activeId: null, models: [] } };
```

- [ ] **Step 2: Build storybook**

`npm --prefix frontend run build-storybook`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ModelPickerInline.stories.tsx
git commit -m "[X33] frontend: ModelPickerInline Storybook variants"
```

---

## Task 5: Rewrite `<SettingsModelsTab>` to embed the inline picker

**Files:**
- Modify: `frontend/src/components/SettingsModelsTab.tsx` (full rewrite)

- [ ] **Step 1: Replace the file**

Replace `frontend/src/components/SettingsModelsTab.tsx` in full:

```tsx
// [X33] Settings → Models tab.
//
// Composition (top → bottom):
//   1. Inline master/detail model picker (<ModelPickerInline>) — selects the
//      default model used for chat and continuations. The "Use this model"
//      CTA in the detail pane PATCHes /users/me/settings { chat: { model } }.
//   2. Generation parameters — three sliders (temperature, topP, maxTokens)
//      bound to settings.chat. Each tick PATCHes; the optimistic update
//      keeps the slider responsive.
//
// [X33] Replaces the X27 trigger-button + modal flow with an inline picker
// living inside the tab.
import type { ChangeEvent, JSX } from 'react';
import { useId } from 'react';
import { ModelPickerInline } from '@/components/ModelPickerInline';
import { useModelsQuery } from '@/hooks/useModels';
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

export function SettingsModelsTab(): JSX.Element {
  const tempId = useId();
  const topPId = useId();
  const maxTokensId = useId();

  const settings = useUserSettings();
  const updateSetting = useUpdateUserSetting();
  const modelsQuery = useModelsQuery();

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

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3" data-testid="models-section-list">
        <header>
          <h3 className="m-0 font-serif text-[14px] font-medium text-ink">Model</h3>
          <p className="mt-[2px] text-[12px] text-ink-4 font-sans">
            Pick the default model used for chat and continuations.
          </p>
        </header>

        <ModelPickerInline
          models={modelsQuery.data ?? []}
          activeId={settings.chat.model}
          loading={modelsQuery.isLoading}
          error={modelsQuery.isError}
          onUseModel={(id) => {
            updateSetting.mutate({ chat: { model: id } });
          }}
        />
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

- [ ] **Step 2: Run typecheck — expect FAIL at Settings.tsx**

`npm --prefix frontend run typecheck`
Expected: FAIL — `Settings.tsx` still passes `onOpenModelPicker` to `<SettingsModelsTab />`, which now takes no props. Resolved in Task 6.

If you see other failures (e.g. tests that mounted the old component with `onOpenModelPicker`), they are also expected; Task 6 cleans up.

- [ ] **Step 3: Do NOT commit yet**

Tasks 5 + 6 ship in one commit (Task 6) since they're tightly coupled.

---

## Task 6: `<SettingsModal>` chrome rework + ship the joint commit

**Files:**
- Modify: `frontend/src/components/Settings.tsx`
- Modify: `frontend/src/components/Settings.stories.tsx`
- Modify: `frontend/tests/components/Settings.{appearance,prompts,writing,shell-venice}.test.tsx`

- [ ] **Step 1: Update `SettingsModalProps` and the body**

Edit `frontend/src/components/Settings.tsx`. Replace the `SettingsModalProps` interface (`:36-40`):

```ts
export interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  /** When provided, the modal opens on this tab instead of the default ('venice'). */
  initialTab?: SettingsTab;
}
```

Replace the function signature (`:92-96`):

```ts
export function SettingsModal({
  open,
  onClose,
  initialTab,
}: SettingsModalProps): JSX.Element | null {
```

Replace the active-tab reset effect (`:102-104`):

```ts
useEffect(() => {
  if (open) setActiveTab(initialTab ?? 'venice');
}, [open, initialTab]);
```

Replace the `<SettingsModelsTab>` render (`:164-166`) — drop the prop:

```tsx
) : activeTab === 'models' ? (
  <SettingsModelsTab />
) : activeTab === 'prompts' ? (
```

Replace the `<ModalFooter>` block (`:175-188`) with a hint-only footer:

```tsx
<ModalFooter
  leading={
    <span data-testid="settings-autosave-hint">
      Changes save automatically &middot; tap outside or press Esc to close
    </span>
  }
/>
```

(The `ModalFooter` accepts `children` optionally — passing nothing means the right-aligned button slot is empty. Verify against `ModalFooter`'s implementation; if it requires `children`, replace with `<ModalFooter leading={...}>{}</ModalFooter>` or pass an empty fragment.)

- [ ] **Step 2: Drop `onOpenModelPicker` no-op props from sibling Settings tests**

Find every `<SettingsModal open` call in `frontend/tests/`:

```bash
grep -rn "onOpenModelPicker" frontend/tests/
```

For each match, remove the `onOpenModelPicker={() => {}}` line. The functional behaviour under test is not affected.

Same sweep for `frontend/src/components/Settings.stories.tsx` — drop the no-op prop in any `<SettingsModal>` usage.

- [ ] **Step 3: Update the Models story in Settings.stories.tsx**

The existing `ModelsTab` story may render the trigger pattern via `SAMPLE_MODELS`. Update it to render the new picker by passing the same `SAMPLE_MODELS` (with `description` + `pricing` populated) through the existing `makeClient` helper. The story should pre-seed `chat.model: 'llama-3.3-70b'` (or another id from the sample list) so the detail pane has a model to display.

The plan does not lock the exact diff because the existing helper's shape is local to the file; the requirement is that the story renders, the inline picker is visible, and the `ModelsTabNoSelection` variant (added in X27) still works (`activeId === null` falls through to the first model in the list).

- [ ] **Step 4: Run typecheck + targeted tests + storybook**

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run test -- Settings ModelPickerInline
npm --prefix frontend run build-storybook
```

Expected: PASS.

- [ ] **Step 5: Commit (joint Task 5 + Task 6 commit)**

```bash
git add frontend/src/components/SettingsModelsTab.tsx \
        frontend/src/components/Settings.tsx \
        frontend/src/components/Settings.stories.tsx \
        frontend/tests/components/
git commit -m "[X33] frontend: SettingsModelsTab embeds ModelPickerInline; SettingsModal drops Cancel/Done + adds initialTab"
```

---

## Task 7: Rewire `<EditorPage>` chat-bar trigger

**Files:**
- Modify: `frontend/src/pages/EditorPage.tsx`

- [ ] **Step 1: Drop `setModelPickerOpen` state**

Edit `frontend/src/pages/EditorPage.tsx`. At line 154, delete:

```ts
const [modelPickerOpen, setModelPickerOpen] = useState(false);
```

- [ ] **Step 2: Add `settingsInitialTab` state next to `settingsOpen`**

At line 153 (next to `settingsOpen`):

```ts
const [settingsOpen, setSettingsOpen] = useState(false);
const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab | undefined>(undefined);
```

Import `SettingsTab` from `@/components/Settings` if not already imported.

- [ ] **Step 3: Reroute the chat-bar trigger handler**

At line 681 (the chat-bar model trigger's onClick), replace `setModelPickerOpen(true)` with:

```ts
setSettingsInitialTab('models');
setSettingsOpen(true);
```

- [ ] **Step 4: Drop the `<ModelPicker />` mount and update the `<SettingsModal>` mount**

At lines 736-749, delete the `<ModelPicker>` JSX block:

```tsx
<ModelPicker
  open={modelPickerOpen}
  onClose={() => {
    setModelPickerOpen(false);
  }}
/>
```

Replace the `<SettingsModal>` mount with:

```tsx
<SettingsModal
  open={settingsOpen}
  initialTab={settingsInitialTab}
  onClose={() => {
    setSettingsOpen(false);
    setSettingsInitialTab(undefined);
  }}
/>
```

(Drop the `onOpenModelPicker` prop entirely.)

Drop the `import { ModelPicker } from '@/components/ModelPicker';` line at the top of the file.

- [ ] **Step 5: Run typecheck + tests**

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run test
```

Expected: PASS. Any remaining test failures point at integration tests that need updating in Task 8.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/EditorPage.tsx
git commit -m "[X33] frontend: EditorPage routes chat-bar trigger to Settings → Models"
```

---

## Task 8: Rewrite `Settings.models.test.tsx` for the inline picker

**Files:**
- Modify: `frontend/tests/components/Settings.models.test.tsx`

- [ ] **Step 1: Replace the file in full**

The new test file covers: the picker renders inside the Models tab; the detail pane CTA PATCHes settings; sliders unchanged. Test:

```tsx
// [X33] Settings → Models tab — inline picker.
//
// Covers (post-X33):
//   - The Models tab renders <ModelPickerInline> with the user's active model
//     highlighted in the detail pane.
//   - Clicking "Use this model" on a non-active model PATCHes settings.chat.model.
//   - The three sliders still render bound to settings.chat values and dragging PATCHes.
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
      id: 'llama-3.3-70b',
      name: 'Llama 3.3 70B',
      contextLength: 128000,
      supportsReasoning: false,
      supportsVision: false,
      supportsWebSearch: true,
      description: 'Meta-tuned 70B general-purpose model.',
      pricing: { inputUsdPerMTok: 0.6, outputUsdPerMTok: 2.4 },
    },
    {
      id: 'qwen-3-6-plus',
      name: 'Qwen 3.6 Plus',
      contextLength: 1000000,
      supportsReasoning: true,
      supportsVision: false,
      supportsWebSearch: true,
      description: 'Reasoning flagship.',
      pricing: { inputUsdPerMTok: 0.63, outputUsdPerMTok: 3.75 },
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

describe('SettingsModal Models tab (X33)', () => {
  let onClose: ReturnType<typeof vi.fn>;

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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
  });

  it('renders the inline picker with the active model in the detail pane', async () => {
    vi.stubGlobal('fetch', buildFetch({ initialSettings: { model: 'llama-3.3-70b' } }));
    renderModal(<SettingsModal open onClose={onClose} initialTab="models" />);
    expect(await screen.findByTestId('model-detail-name')).toHaveTextContent('Llama 3.3 70B');
    expect(screen.getByTestId('model-detail-cta')).toHaveTextContent(/currently in use/i);
  });

  it('clicking "Use this model" PATCHes settings.chat.model', async () => {
    const fetchMock = buildFetch({ initialSettings: { model: 'llama-3.3-70b' } });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderModal(<SettingsModal open onClose={onClose} initialTab="models" />);

    await user.click(await screen.findByTestId('model-rail-qwen-3-6-plus'));
    await user.click(screen.getByTestId('model-detail-cta'));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([url, init]: [string, RequestInit | undefined]) =>
          url === '/api/users/me/settings' && init?.method === 'PATCH',
      );
      expect(patch).toBeDefined();
      const init = (patch as [string, RequestInit])[1];
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body).toEqual({ chat: { model: 'qwen-3-6-plus' } });
    });
  });

  it('renders the three sliders bound to settings.chat values', async () => {
    vi.stubGlobal('fetch', buildFetch());
    renderModal(<SettingsModal open onClose={onClose} initialTab="models" />);
    await openModelsTab();

    const temp = await screen.findByTestId('param-temperature');
    const topP = await screen.findByTestId('param-top-p');
    const maxTokens = await screen.findByTestId('param-max-tokens');

    await waitFor(() => {
      expect(temp).toHaveValue('0.85');
      expect(topP).toHaveValue('0.95');
      expect(maxTokens).toHaveValue('800');
    });
  });

  it('dragging temperature PATCHes settings.chat.temperature', async () => {
    const fetchMock = buildFetch();
    vi.stubGlobal('fetch', fetchMock);

    renderModal(<SettingsModal open onClose={onClose} initialTab="models" />);
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
        expect((body.chat as { temperature: number }).temperature).toBeCloseTo(1.25, 5);
      },
      { timeout: 1000 },
    );
  });

  it('initialTab="models" opens the modal directly on the Models tab', async () => {
    vi.stubGlobal('fetch', buildFetch({ initialSettings: { model: 'llama-3.3-70b' } }));
    renderModal(<SettingsModal open onClose={onClose} initialTab="models" />);
    expect(await screen.findByTestId('settings-panel-models')).toBeInTheDocument();
  });

  it('does not render Cancel/Done buttons (auto-save chrome)', async () => {
    vi.stubGlobal('fetch', buildFetch());
    renderModal(<SettingsModal open onClose={onClose} initialTab="models" />);
    expect(screen.queryByTestId('settings-cancel')).toBeNull();
    expect(screen.queryByTestId('settings-done')).toBeNull();
    expect(screen.getByTestId('settings-autosave-hint')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test → expect PASS**

`npm --prefix frontend run test -- Settings.models.test.tsx`
Expected: PASS all 6 cases.

- [ ] **Step 3: Commit**

```bash
git add frontend/tests/components/Settings.models.test.tsx
git commit -m "[X33] frontend: rewrite Settings.models.test for inline picker"
```

---

## Task 9: Update the integration test

**Files:**
- Modify: `frontend/tests/pages/editor-shell.integration.test.tsx`

The X27 case (`'Settings → Models trigger opens the same ModelPicker the chat-bar opens'`) is replaced — the trigger no longer opens a `<ModelPicker />` modal; clicking the chat-bar model bar opens Settings on the Models tab.

- [ ] **Step 1: Find the X27 case and replace it**

Read the existing file. Find the test added by X27 commit `c97cdcc`. Replace it with:

```tsx
it('[X33] Chat-bar model trigger opens Settings on the Models tab', async () => {
  // The fetch fixture should already respond to /api/ai/models with at least
  // one model and to /api/users/me/settings with a chat.model value.
  const user = userEvent.setup();
  // … render(<EditorPage />) — reuse the existing render helper.

  // Click the chat-bar model trigger. The exact selector depends on what the
  // chat-bar uses today; e.g. screen.getByTestId('chat-model-trigger').
  // Adapt to the existing pattern in this file.
  await user.click(screen.getByTestId('chat-model-trigger')); // adapt as needed

  // Settings is now open and on the Models tab — the inline picker should be visible.
  expect(await screen.findByTestId('settings-panel-models')).toBeInTheDocument();
  expect(await screen.findByTestId('model-rail')).toBeInTheDocument();
});
```

If the chat-bar trigger has a different test id in the file's existing tests (e.g. `model-bar-trigger`, or it's identified by a label), use that. The intent: trigger the click, assert Settings opens with `settings-panel-models` rendered and `model-rail` (from `<ModelPickerInline>`) in the DOM.

If the existing fixture doesn't include `description`/`pricing` on the model fixture, extend it minimally — even `description: null, pricing: null` is enough for the picker to render.

- [ ] **Step 2: Run the test**

`npm --prefix frontend run test -- editor-shell.integration.test.tsx`
Expected: PASS new case + existing cases.

- [ ] **Step 3: Commit**

```bash
git add frontend/tests/pages/editor-shell.integration.test.tsx
git commit -m "[X33] frontend: integration — chat-bar trigger opens Settings on Models tab"
```

---

## Task 10: Delete retired files; tick X33

**Files:**
- Delete: `frontend/src/components/ModelCard.tsx`
- Delete: `frontend/src/components/ModelCard.stories.tsx`
- Delete: `frontend/src/components/ModelPicker.tsx`
- Delete: `frontend/src/components/ModelPicker.stories.tsx`
- Delete: `frontend/src/components/ModelPickerSplit.stories.tsx`
- Delete: `frontend/src/components/SettingsModelsTabSplit.stories.tsx`
- Delete: `frontend/tests/components/ModelCard.test.tsx`
- Delete: `frontend/tests/components/ModelPicker.test.tsx`
- Modify: `TASKS.md` — add `[X33]` entry, ticked

- [ ] **Step 1: Delete the retired files**

```bash
git rm frontend/src/components/ModelCard.tsx \
       frontend/src/components/ModelCard.stories.tsx \
       frontend/src/components/ModelPicker.tsx \
       frontend/src/components/ModelPicker.stories.tsx \
       frontend/src/components/ModelPickerSplit.stories.tsx \
       frontend/src/components/SettingsModelsTabSplit.stories.tsx \
       frontend/tests/components/ModelCard.test.tsx \
       frontend/tests/components/ModelPicker.test.tsx
```

- [ ] **Step 2: Confirm nothing imports the deleted modules**

```bash
grep -rn "from '@/components/ModelCard'" frontend/src frontend/tests
grep -rn "from '@/components/ModelPicker'" frontend/src frontend/tests
grep -rn "from './ModelCard'" frontend/src
grep -rn "from './ModelPicker'" frontend/src
```

All four greps should return zero matches. If any do, follow up the import to its consumer and remove it (this should already be done by Tasks 5–9; this step is a final safety check).

- [ ] **Step 3: Run typecheck + full test + storybook**

```bash
npm --prefix frontend run typecheck
npm --prefix backend run test
npm --prefix frontend run test
npm --prefix frontend run build-storybook
```

Expected: PASS.

- [ ] **Step 4: Add `[X33]` to TASKS.md**

Edit `TASKS.md`. After the `[X27]` line (around line 196), add a new `[X33]` entry, ticked:

```markdown
- [x] **[X33]** Settings → Models tab inline picker. Supersedes X27's modal trigger pattern with an inline master/detail picker living inside the Settings → Models tab. Chat-bar model trigger reroutes to Settings → Models. Drops Cancel/Done from Settings (auto-save). Bumps modal close-X to 44×44 across the app.
  - spec: [docs/superpowers/specs/2026-05-05-x33-models-tab-inline-picker-design.md](docs/superpowers/specs/2026-05-05-x33-models-tab-inline-picker-design.md)
  - plan: [docs/superpowers/plans/2026-05-05-x33-models-tab-inline-picker.md](docs/superpowers/plans/2026-05-05-x33-models-tab-inline-picker.md)
  - verify: `npm --prefix backend run test -- venice.models.service.test.ts && npm --prefix frontend run test -- ModelPickerInline Settings.models editor-shell.integration && npm --prefix frontend run typecheck && npm --prefix frontend run build-storybook`
```

(Backend test is included in verify because the backend mapper from X27 is part of the `Model` shape this picker consumes; rerunning catches any backwards-incompatible drift.)

- [ ] **Step 5: Run the verify command end-to-end**

```bash
bash .claude/skills/task-verify/run.sh X33
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "[X33] cleanup: delete retired ModelCard/ModelPicker; tick X33 in TASKS"
```

- [ ] **Step 7: Mark the X33 PR ready for review**

```bash
gh pr ready
```

(The PR was opened as a draft in Task 0; flip to ready now.)

---

## Self-review notes

Spec coverage walk-through:

- §2 In: `<ModelPickerInline>` (Tasks 2–4), `<SettingsModelsTab>` rewrite (Task 5), `<SettingsModal>` chrome + `initialTab` (Task 6), `<EditorPage>` rewire (Task 7), `IconButton`+`CloseIcon` lg (Task 1), tests (Tasks 2, 8, 9), deletions (Task 10).
- §3.1 `<ModelPickerInline>` props/layout/test ids — encoded in Task 3's source verbatim.
- §3.2 `<SettingsModelsTab>` rewrite — Task 5.
- §3.3 `<SettingsModal>` chrome — Task 6.
- §3.4 `<EditorPage>` wiring — Task 7.
- §3.5 IconButton lg — Task 1.
- §3.6 ModalHeader uses lg — Task 1 step 3.
- §7 Tests — Tasks 2, 8, 9 cover every numbered case.
- §11 Migration — Task 0.

Type-consistency check: `Model` shape used in tests/stories matches `frontend/src/hooks/useModels.ts` (already updated in X27). `ModelPickerInlineProps` is consistent across implementation, test imports, and stories. Test ids consistent: `model-rail-${id}`, `model-rail`, `model-rail-skeleton`, `model-detail-name`, `model-detail-cta`, `model-detail-description`, `model-detail-context`, `model-detail-input-price`, `model-detail-output-price`, `settings-panel-models`, `settings-autosave-hint`.

Placeholder scan: every step lists either a concrete code block, an exact command, or a specific edit target. The two "adapt to the existing helper" cases (Settings.stories Models story update; integration test selector) flag where local file shape varies; both are bounded ("the inline picker is visible / `model-rail` is in the DOM" is the test-side requirement).
