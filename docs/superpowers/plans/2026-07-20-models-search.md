# Models Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a client-side text search box to the Settings › Models tab that filters the model rail by name/id/description substring.

**Architecture:** The query state, the `filtered` list, and the highlight-reconciliation logic live in `SettingsModelsTab` (they must sit at the same level as the sliders and the highlight cursor). `ModelPickerInline` stays presentational: it renders whatever list it's handed and gains one new empty-state branch. Filtering is a pure in-memory substring match — no backend change, no debounce, no virtualization.

**Tech Stack:** React 19 + TypeScript (strict), TailwindCSS v4 (design tokens), TanStack Query, Vitest + Testing Library (jsdom). Design spec: `docs/superpowers/specs/2026-07-20-models-search-design.md`.

## Global Constraints

- **Frontend only.** No backend route, no new dependency, no Prisma/schema change.
- **No `any` types** — TypeScript strict is on across all workspaces.
- **Design tokens only** in `frontend/src/` (`--ink-*`, `--bg-*`, `line`, `radius`, `bg-sunken`, `bg-elevated`); the `lint:design` CI guard rejects raw colors.
- **Matching fields:** `name`, `id`, `description` only (null-safe on description). Case-insensitive, query trimmed. Empty/whitespace query → full list.
- **`settings.chat.model` (the saved default) is written only by `onUseModel`.** Nothing in this plan may mutate it; filtering and highlighting never touch it.
- **Auto-highlight semantics:** the highlight snaps to `filtered[0]` only when the current highlight *disappears* from the filtered set; a still-visible highlight is kept even if it isn't first.
- **Pinned copy:** empty-state default `No models available.`; query-active message `` `No models match “${query.trim()}”` `` (curly quotes U+201C/U+201D).
- **Commit prefix:** `[<BD_ID>]` where `<BD_ID>` is the bd issue filed for this plan (per CLAUDE.md Task Completion Protocol). Commit after each passing task.
- **Test DB / stack:** not required — every test here is frontend jsdom (Vitest). No `make dev` needed.

---

## File Structure

- `frontend/src/components/ModelPickerInline.tsx` — **modify.** Split the `loading || models.length === 0` branch into `error → loading → empty → normal`; add `emptyMessage?: string` prop; refactor `RailRow` to a `React.memo` component taking a stable `onHighlightChange`.
- `frontend/src/components/SettingsModelsTab.tsx` — **modify.** Add `query` state + search `<Input>` control; add `q` + `filtered` (memoized); rewrite the highlight-reconciliation effect to key off `filtered`; derive `highlightedModel` from `filtered`; pass `filtered` + `emptyMessage` to the picker. **Do not reorder the `useUserSettings()` (line 93) / `useModelsQuery()` (line 95) calls** — settings must be dispatched first so its data lands no later than the models data, or the reconciliation can transiently prefer `filtered[0]` before the saved default arrives (would make test #6 a flake).
- `frontend/src/components/ModelPickerInline.stories.tsx` — **no edit, but note:** the existing `Empty` story (`args: { models: [] }`, line ~107) renders the skeleton today; after Task 1 it renders the new `No models available.` empty state. Expected and arguably more correct — flagged so a reviewer isn't surprised. Not vitest-tested.
- `frontend/tests/components/ModelPickerInline.test.tsx` — **modify.** Add empty-state + loading-vs-empty tests (spec tests #5-partial, #9); the existing row-click test guards the memo refactor (#10).
- `frontend/tests/components/Settings.models.test.tsx` — **modify.** Add filtering / reconciliation / commit tests (spec tests #1–#8) using the existing harness (`buildFetch`, `renderModal`, `makeModel`, `MODEL_M1/M2`, `TWO_MODELS_BODY`).

Task order: **Task 1** (picker empty-state) → **Task 2** (picker memo refactor) → **Task 3** (tab wiring, depends on Task 1's `emptyMessage` prop).

---

### Task 1: `ModelPickerInline` — split loading/empty, add `emptyMessage`

**Files:**
- Modify: `frontend/src/components/ModelPickerInline.tsx:11-19` (props), `:200-217` (branch split)
- Test: `frontend/tests/components/ModelPickerInline.test.tsx:30-59` (extend `ControlledPicker`), new tests appended before the closing `});`

**Interfaces:**
- Produces: `ModelPickerInlineProps` gains `emptyMessage?: string`. New empty-state element carries `data-testid="model-rail-empty"`. When `!loading && models.length === 0`, render the empty state (message = `emptyMessage ?? 'No models available.'`) instead of the skeleton.
- Consumes: nothing new.

- [ ] **Step 1: Extend the test harness `ControlledPicker` to forward `emptyMessage`**

In `frontend/tests/components/ModelPickerInline.test.tsx`, update the `ControlledPickerProps` interface (line 30) and the component (line 39) to accept and pass `emptyMessage`:

```tsx
interface ControlledPickerProps {
  models: Model[];
  activeId: string | null;
  initialHighlightedId?: string | null;
  onUseModel?: (id: string) => void;
  loading?: boolean;
  error?: boolean;
  emptyMessage?: string;
}

function ControlledPicker({
  models,
  activeId,
  initialHighlightedId = activeId,
  onUseModel = () => {},
  loading,
  error,
  emptyMessage,
}: ControlledPickerProps): React.ReactElement {
  const [highlightedId, setHighlightedId] = useState<string | null>(initialHighlightedId);
  return (
    <ModelPickerInline
      models={models}
      activeId={activeId}
      highlightedId={highlightedId}
      onHighlightChange={setHighlightedId}
      onUseModel={onUseModel}
      loading={loading}
      error={error}
      emptyMessage={emptyMessage}
    />
  );
}
```

- [ ] **Step 2: Write the failing tests**

Append these three tests inside the `describe('ModelPickerInline (X33)', …)` block, before its closing `});`:

```tsx
it('renders the provided empty message when the list is empty and not loading', () => {
  render(
    <ControlledPicker
      models={[]}
      activeId={null}
      initialHighlightedId={null}
      emptyMessage={'No models match “xyz”'}
    />,
  );
  expect(screen.queryByTestId('model-rail-skeleton')).toBeNull();
  expect(screen.getByTestId('model-rail-empty')).toHaveTextContent(/No models match/);
  expect(screen.queryByTestId('model-detail-name')).toBeNull();
});

it('renders a default empty message when none is provided', () => {
  render(<ControlledPicker models={[]} activeId={null} initialHighlightedId={null} />);
  expect(screen.getByTestId('model-rail-empty')).toHaveTextContent(/No models available/);
});

it('still shows the skeleton (not the empty state) while loading with an empty list', () => {
  render(<ControlledPicker models={[]} activeId={null} initialHighlightedId={null} loading />);
  expect(screen.getByTestId('model-rail-skeleton')).toBeInTheDocument();
  expect(screen.queryByTestId('model-rail-empty')).toBeNull();
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm --prefix frontend run test -- ModelPickerInline`
Expected: the two empty-state tests FAIL (no `model-rail-empty` element — the current code renders the skeleton for `models.length === 0`). The loading test may pass already.

- [ ] **Step 4: Add the `emptyMessage` prop and split the branch**

In `frontend/src/components/ModelPickerInline.tsx`, add `emptyMessage` to the props interface (after line 18):

```tsx
export interface ModelPickerInlineProps {
  models: Model[];
  activeId: string | null;
  highlightedId: string | null;
  onHighlightChange: (id: string) => void;
  onUseModel: (id: string) => void;
  loading?: boolean;
  error?: boolean;
  emptyMessage?: string;
}
```

Add `emptyMessage` to the destructure in the component signature (line 191-199):

```tsx
export function ModelPickerInline({
  models,
  activeId,
  highlightedId,
  onHighlightChange,
  onUseModel,
  loading = false,
  error = false,
  emptyMessage,
}: ModelPickerInlineProps): JSX.Element {
```

Replace the conflated skeleton branch (current lines 208-217) so loading and empty are distinct:

```tsx
  if (loading) {
    return (
      <div className="grid grid-cols-[240px_1fr] min-h-[360px] rounded-[var(--radius)] border border-line bg-bg-elevated overflow-hidden">
        <div className="border-r border-line bg-bg-sunken/30">
          <SkeletonRail />
        </div>
        <div />
      </div>
    );
  }

  if (models.length === 0) {
    return (
      <div className="grid grid-cols-[240px_1fr] min-h-[360px] rounded-[var(--radius)] border border-line bg-bg-elevated overflow-hidden">
        <div
          data-testid="model-rail-empty"
          className="grid place-items-center p-6 text-center text-[12.5px] text-ink-4 font-sans col-span-2"
        >
          {emptyMessage ?? 'No models available.'}
        </div>
      </div>
    );
  }
```

(The `error` branch above it stays unchanged; the normal rail/detail render below it stays unchanged.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm --prefix frontend run test -- ModelPickerInline`
Expected: PASS (all existing tests + the three new ones). The existing "renders a skeleton rail and no detail pane when loading" test (line 204) still passes because the `loading` branch runs first.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ModelPickerInline.tsx frontend/tests/components/ModelPickerInline.test.tsx
git commit -m "[<BD_ID>] ModelPickerInline: split loading/empty, add emptyMessage prop"
```

---

### Task 2: `ModelPickerInline` — `React.memo` `RailRow` with a stable callback

**Files:**
- Modify: `frontend/src/components/ModelPickerInline.tsx:7` (import), `:31-75` (RailRow), `:230-240` (map site)
- Test: `frontend/tests/components/ModelPickerInline.test.tsx` — no new test; the existing "clicking a rail row updates the detail pane without calling onUseModel" (line 110) is the behavior-preserving guard.

**Interfaces:**
- Produces: `RailRow` is now `React.memo`-wrapped and takes `onHighlightChange: (id: string) => void` + `model` instead of a per-row `onPreview` closure. It calls `onHighlightChange(model.id)` on click internally. External behavior is unchanged.
- Consumes: the `onHighlightChange` prop already passed to `ModelPickerInline` (a stable `useState` setter at the call site).

- [ ] **Step 1: Run the existing picker tests — confirm green before refactor**

Run: `npm --prefix frontend run test -- ModelPickerInline`
Expected: PASS (this is the baseline; the refactor must keep it green — especially the row-click test at line 110).

- [ ] **Step 2: Import `memo`**

In `frontend/src/components/ModelPickerInline.tsx`, add `memo` to the React import (line 7 currently `import type { JSX } from 'react';`):

```tsx
import { memo, type JSX } from 'react';
```

- [ ] **Step 3: Refactor `RailRow` to take a stable callback and wrap in `memo`**

Replace the `RailRowProps` interface and `RailRow` function (current lines 31-75):

```tsx
interface RailRowProps {
  model: Model;
  highlighted: boolean;
  active: boolean;
  onHighlightChange: (id: string) => void;
}

const RailRow = memo(function RailRow({
  model,
  highlighted,
  active,
  onHighlightChange,
}: RailRowProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => {
        onHighlightChange(model.id);
      }}
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
            role="img"
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
});
```

- [ ] **Step 4: Update the map site to pass the stable callback**

Replace the rail `.map` (current lines 230-240) so it passes `onHighlightChange` directly instead of a fresh `onPreview` arrow:

```tsx
        {models.map((m) => (
          <RailRow
            key={m.id}
            model={m}
            highlighted={m.id === highlighted.id}
            active={m.id === activeId}
            onHighlightChange={onHighlightChange}
          />
        ))}
```

- [ ] **Step 5: Run the tests to verify they still pass**

Run: `npm --prefix frontend run test -- ModelPickerInline`
Expected: PASS (unchanged behavior — the row-click test at line 110 still updates the detail pane and does not call `onUseModel`).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ModelPickerInline.tsx
git commit -m "[<BD_ID>] ModelPickerInline: React.memo RailRow with stable onHighlightChange"
```

---

### Task 3: `SettingsModelsTab` — search input, filtering, reconciliation

**Files:**
- Modify: `frontend/src/components/SettingsModelsTab.tsx:19` (import `Input`), `:97-111` (add `query`/`q`/`filtered`, rewrite effect, re-derive `highlightedModel`), `:203-219` (the `<section data-testid="models-section-list">` block, closing `</section>` at line 219 — search control + pass `filtered`/`emptyMessage`)
- Test: `frontend/tests/components/Settings.models.test.tsx` — append tests inside the existing `describe('SettingsModal Models tab (X28)', …)` block.

**Interfaces:**
- Consumes: `ModelPickerInline`'s `emptyMessage` prop (Task 1); `useModelsQuery`, `useUserSettings`, `useUpdateUserSetting` (existing). The `<Input>` primitive from `@/design/primitives`.
- Produces: search control `data-testid="models-search"` (the `<Input>`) and `data-testid="models-search-clear"` (the × button). No new exports.

- [ ] **Step 1: Write the failing tests**

Append these tests inside the `describe('SettingsModal Models tab (X28)', …)` block in `frontend/tests/components/Settings.models.test.tsx` (the harness helpers `buildFetch`, `renderModal`, `makeModel`, `MODEL_M1`, `MODEL_M2`, `TWO_MODELS_BODY`, `onClose` are all in scope):

```tsx
// -------------------------------------------------------------------------
// Search: filtering, matching fields, empty state, reconciliation
// -------------------------------------------------------------------------

it('shows all models with an empty or whitespace query', async () => {
  vi.stubGlobal('fetch', buildFetch({ modelsBody: TWO_MODELS_BODY }));
  const user = userEvent.setup();
  renderModal(<SettingsModal open onClose={onClose} initialTab="models" />);

  expect(await screen.findByTestId('model-rail-m1')).toBeInTheDocument();
  expect(screen.getByTestId('model-rail-m2')).toBeInTheDocument();

  await user.type(screen.getByTestId('models-search'), '   ');
  expect(screen.getByTestId('model-rail-m1')).toBeInTheDocument();
  expect(screen.getByTestId('model-rail-m2')).toBeInTheDocument();
});

it('filters by name substring (case-insensitive)', async () => {
  vi.stubGlobal('fetch', buildFetch({ modelsBody: TWO_MODELS_BODY }));
  const user = userEvent.setup();
  renderModal(<SettingsModal open onClose={onClose} initialTab="models" />);
  await screen.findByTestId('model-rail-m1');

  await user.type(screen.getByTestId('models-search'), 'TWO');
  expect(screen.queryByTestId('model-rail-m1')).toBeNull();
  expect(screen.getByTestId('model-rail-m2')).toBeInTheDocument();
});

it('filters by id substring', async () => {
  vi.stubGlobal('fetch', buildFetch({ modelsBody: TWO_MODELS_BODY }));
  const user = userEvent.setup();
  renderModal(<SettingsModal open onClose={onClose} initialTab="models" />);
  await screen.findByTestId('model-rail-m1');

  await user.type(screen.getByTestId('models-search'), 'm1');
  expect(screen.getByTestId('model-rail-m1')).toBeInTheDocument();
  expect(screen.queryByTestId('model-rail-m2')).toBeNull();
});

it('filters by description substring and does not throw on null descriptions', async () => {
  const noDesc = makeModel({ id: 'nd', name: 'NoDesc', description: null });
  vi.stubGlobal('fetch', buildFetch({ modelsBody: { models: [MODEL_M1, noDesc] } }));
  const user = userEvent.setup();
  renderModal(<SettingsModal open onClose={onClose} initialTab="models" />);
  await screen.findByTestId('model-rail-m1');

  // MODEL_M1.description === 'Test model 1.'
  await user.type(screen.getByTestId('models-search'), 'test model 1');
  expect(screen.getByTestId('model-rail-m1')).toBeInTheDocument();
  expect(screen.queryByTestId('model-rail-nd')).toBeNull();
});

it('shows the zero-match empty state and disables the sliders', async () => {
  vi.stubGlobal('fetch', buildFetch({ modelsBody: TWO_MODELS_BODY }));
  const user = userEvent.setup();
  renderModal(<SettingsModal open onClose={onClose} initialTab="models" />);
  await screen.findByTestId('model-rail-m1');

  await user.type(screen.getByTestId('models-search'), 'zzz');
  const empty = screen.getByTestId('model-rail-empty');
  expect(empty).toHaveTextContent(/No models match/);
  expect(empty).toHaveTextContent(/zzz/);
  expect(screen.queryByTestId('model-rail-m1')).toBeNull();
  expect(screen.getByTestId('param-temperature')).toBeDisabled();
});

it('clearing the query via the × button restores the full list', async () => {
  vi.stubGlobal('fetch', buildFetch({ modelsBody: TWO_MODELS_BODY }));
  const user = userEvent.setup();
  renderModal(<SettingsModal open onClose={onClose} initialTab="models" />);
  await screen.findByTestId('model-rail-m1');

  await user.type(screen.getByTestId('models-search'), 'two');
  expect(screen.queryByTestId('model-rail-m1')).toBeNull();

  await user.click(screen.getByTestId('models-search-clear'));
  expect(screen.getByTestId('model-rail-m1')).toBeInTheDocument();
  expect(screen.getByTestId('model-rail-m2')).toBeInTheDocument();
});

it('auto-highlights the first match over the saved default when a query excludes the current highlight', async () => {
  const A = makeModel({ id: 'alpha', name: 'Alpha match', description: 'a' });
  const B = makeModel({ id: 'bravo', name: 'Bravo match', description: 'b' });
  const C = makeModel({ id: 'charlie', name: 'Charlie', description: 'c' });
  vi.stubGlobal(
    'fetch',
    buildFetch({ modelsBody: { models: [A, B, C] }, initialSettings: { model: 'bravo' } }),
  );
  const user = userEvent.setup();
  renderModal(<SettingsModal open onClose={onClose} initialTab="models" />);

  // Mount highlights the saved default (bravo).
  await waitFor(() => {
    expect(screen.getByTestId('model-detail-name')).toHaveTextContent('Bravo match');
  });

  // Move the highlight off the default to charlie (no commit — just a preview).
  await user.click(screen.getByTestId('model-rail-charlie'));
  expect(screen.getByTestId('model-detail-name')).toHaveTextContent('Charlie');

  // Query matches [alpha, bravo], excludes charlie. First-match (alpha) must win
  // over the saved default (bravo) while a query is active.
  await user.type(screen.getByTestId('models-search'), 'match');
  await waitFor(() => {
    expect(screen.getByTestId('model-detail-name')).toHaveTextContent('Alpha match');
  });
});

it('commits the correct filtered model id via PATCH after filtering', async () => {
  const fetchMock = buildFetch({ modelsBody: TWO_MODELS_BODY, initialSettings: { model: null } });
  vi.stubGlobal('fetch', fetchMock);
  const user = userEvent.setup();
  renderModal(<SettingsModal open onClose={onClose} initialTab="models" />);
  await screen.findByTestId('model-rail-m1');

  await user.type(screen.getByTestId('models-search'), 'two'); // -> [m2] only
  await user.click(await screen.findByTestId('model-detail-cta'));

  await waitFor(() => {
    const patch = fetchMock.mock.calls.find(
      (call): call is [string, RequestInit] =>
        call[0] === '/api/users/me/settings' && call[1] != null && call[1].method === 'PATCH',
    );
    expect(patch).toBeDefined();
    if (!patch) return;
    const body = JSON.parse(String(patch[1].body)) as { chat?: { model?: string } };
    expect(body.chat?.model).toBe('m2');
  });
});

it('keeps the highlight after committing a model while a query is active', async () => {
  vi.stubGlobal('fetch', buildFetch({ modelsBody: TWO_MODELS_BODY, initialSettings: { model: null } }));
  const user = userEvent.setup();
  renderModal(<SettingsModal open onClose={onClose} initialTab="models" />);
  await screen.findByTestId('model-rail-m1');

  await user.type(screen.getByTestId('models-search'), 'model'); // matches both m1, m2
  await user.click(screen.getByTestId('model-rail-m2'));
  expect(screen.getByTestId('model-detail-name')).toHaveTextContent('Model Two');

  await user.click(screen.getByTestId('model-detail-cta')); // commit m2

  // settings.chat.model changing to m2 must NOT yank the highlight back to filtered[0] (m1).
  await waitFor(() => {
    expect(screen.getByTestId('model-detail-name')).toHaveTextContent('Model Two');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix frontend run test -- Settings.models`
Expected: the new tests FAIL — there is no `models-search` element yet (`getByTestId('models-search')` throws), and filtering/empty-state behavior does not exist.

- [ ] **Step 3: Add the `Input` import**

In `frontend/src/components/SettingsModelsTab.tsx`, extend the primitives import (line 19 currently `import { Checkbox } from '@/design/primitives';`):

```tsx
import { Checkbox, Input } from '@/design/primitives';
```

- [ ] **Step 4: Add query state, `q`, and the memoized `filtered` list**

In `frontend/src/components/SettingsModelsTab.tsx`, just below `const models = modelsQuery.data ?? [];` (line 97) and the `highlightedId` state (line 99), add:

```tsx
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      q === ''
        ? models
        : models.filter(
            (m) =>
              m.name.toLowerCase().includes(q) ||
              m.id.toLowerCase().includes(q) ||
              (m.description?.toLowerCase().includes(q) ?? false),
          ),
    [models, q],
  );
```

- [ ] **Step 5: Rewrite the reconciliation effect to key off `filtered`**

Replace the existing effect (current lines 101-108):

```tsx
  useEffect(() => {
    const list = modelsQuery.data ?? [];
    if (list.length === 0) return;
    setHighlightedId((prev) => {
      if (prev != null && list.some((m) => m.id === prev)) return prev;
      return settings.chat.model ?? list[0].id;
    });
  }, [settings.chat.model, modelsQuery.data]);
```

with the gated version:

```tsx
  useEffect(() => {
    if (filtered.length === 0) return; // keep prev; highlightedModel resolves to undefined
    setHighlightedId((prev) => {
      if (prev != null && filtered.some((m) => m.id === prev)) return prev; // keep if visible
      if (q === '') {
        const saved = settings.chat.model;
        if (saved != null && filtered.some((m) => m.id === saved)) return saved;
      }
      return filtered[0].id; // query active (or default absent) → first match
    });
  }, [settings.chat.model, filtered, q]);
```

- [ ] **Step 6: Derive `highlightedModel` from `filtered`**

Replace the `highlightedModel` computation (current lines 110-111):

```tsx
  const highlightedModel: Model | undefined =
    models.find((m) => m.id === highlightedId) ?? models[0];
```

with:

```tsx
  const highlightedModel: Model | undefined =
    filtered.find((m) => m.id === highlightedId) ?? filtered[0];
```

(Do **not** touch the slider `onChange`/`onReset`/reasoning handlers — they must keep keying off `highlightedId`, per the spec.)

- [ ] **Step 7: Add the search control and pass `filtered` + `emptyMessage` to the picker**

Replace the `models-section-list` section body (current lines 203-219, through the closing `</section>`) so the search control sits at the top and the picker receives the filtered list:

```tsx
      <section className="flex flex-col gap-3" data-testid="models-section-list">
        <div className="relative">
          <Input
            data-testid="models-search"
            type="text"
            font="sans"
            placeholder="Search models…"
            aria-label="Search models"
            className="pr-8"
            value={query}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setQuery(e.target.value);
            }}
          />
          {query !== '' ? (
            <button
              type="button"
              data-testid="models-search-clear"
              aria-label="Clear search"
              onClick={() => {
                setQuery('');
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-4 hover:text-ink-2 text-[16px] leading-none"
            >
              ×
            </button>
          ) : null}
        </div>

        <p className="text-[12px] text-ink-4 font-sans">
          Pick the default model used for chat and continuations.
        </p>

        <ModelPickerInline
          models={filtered}
          activeId={settings.chat.model}
          highlightedId={highlightedId}
          onHighlightChange={setHighlightedId}
          loading={modelsQuery.isLoading}
          error={modelsQuery.isError}
          emptyMessage={query.trim() ? `No models match “${query.trim()}”` : undefined}
          onUseModel={(id) => {
            updateSetting.mutate({ chat: { model: id } });
          }}
        />
      </section>
```

(`ChangeEvent` is already imported at line 16.)

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm --prefix frontend run test -- Settings.models`
Expected: PASS (all existing X28 tests + the nine new search tests).

- [ ] **Step 9: Typecheck**

Run: `npm --prefix frontend run typecheck`
Expected: no errors (confirms `Input`'s `font`/`data-testid`/`className` props typecheck and no `any` slipped in).

- [ ] **Step 10: Commit**

```bash
git add frontend/src/components/SettingsModelsTab.tsx frontend/tests/components/Settings.models.test.tsx
git commit -m "[<BD_ID>] SettingsModelsTab: text search over the model rail"
```

---

## Final Verification

- [ ] **Full verify (spec's verify line + design lint):**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend run test -- Settings.models ModelPickerInline && make lint`
Expected: typecheck clean, both test files green, Biome + design-lint clean.

---

## Self-Review Notes (spec → task coverage)

- Search input (`<Input>` + × clear, no autofocus, Escape not hijacked) → Task 3 Step 7. (Escape/autofocus are non-behaviors: nothing wires them, so they need no code — the modal's own Escape handler is untouched.)
- Matching (name/id/description, trimmed, case-insensitive) → Task 3 Steps 4 + tests #1–#4.
- Reconciliation gate (first-match vs saved default) → Task 3 Step 5 + test "auto-highlights the first match over the saved default…".
- `highlightedModel` from `filtered` (zero-match sliders disable) → Task 3 Step 6 + zero-match test.
- Empty-state split + `emptyMessage` → Task 1. Loading-vs-empty (spec test #9) covered at picker level in Task 1 Step 2 (the spec's accepted substitute for the fiddly deferred-fetch tab test).
- `React.memo` + stable callback → Task 2, guarded by the existing row-click test (spec test #10).
- Commit-correct-id-after-filter (spec test #7) and keep-highlight-after-commit (spec test #8) → Task 3 tests.
