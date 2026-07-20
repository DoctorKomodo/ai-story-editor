# Design: Search on Settings › Models

Date: 2026-07-20
Status: Approved (design), pending implementation plan
Scope: Frontend only. No backend change, no new dependency.

## Problem

The Settings › Models tab renders every text model Venice returns for the
user's BYOK key as a single scrollable rail (`ModelPickerInline`). The catalog
runs to dozens of models (~20–60), with no way to narrow it — the user scrolls
the whole list to find a model by name, family, or version string. Add a text
search that filters the rail in place.

## Non-goals

- Capability filters / chips (Reasoning, Vision, Web search). Text only.
- Sorting controls.
- Server-side search (no `?q=` param on `/ai/models`). Filtering is client-side
  over the already-fetched in-memory list.
- Debounce, virtualization. The list is dozens of cheap rows; see Performance.

## Existing surface inventory

Concrete files/lines this design touches or depends on:

- `frontend/src/components/SettingsModelsTab.tsx`
  - `models = modelsQuery.data ?? []` (line 97) — the source list.
  - `highlightedId` state (line 99) — the detail-pane/slider cursor. **Not** the
    saved default.
  - Highlight-reconciliation effect (lines 101–108) — keyed on
    `[settings.chat.model, modelsQuery.data]`; keeps `highlightedId` if still in
    the list, else falls back to `settings.chat.model ?? list[0].id`.
  - `highlightedModel` (lines 110–111) drives the Generation-parameters sliders;
    when `undefined`, `slidersDisabled` (line 113) disables that section.
  - `<ModelPickerInline models={models} …>` render site (lines 208–218), inside
    `<section data-testid="models-section-list">` (line 203).
  - Saved default committed only via `onUseModel` → `updateSetting.mutate({ chat:
    { model: id } })` (lines 215–217).
- `frontend/src/components/ModelPickerInline.tsx`
  - Presentational; props `ModelPickerInlineProps` (lines 11–19).
  - `RailRow` (lines 38–75); inline `onPreview={() => onHighlightChange(m.id)}`
    closure at the map site (lines 236–238).
  - **`loading || models.length === 0` → skeleton** (line 208). This conflates
    "loading" and "zero models"; the empty-match state must split these.
  - Rail container `role="listbox"` `data-testid="model-rail"`, `max-h-[420px]`
    (lines 224–228).
- `frontend/src/design/primitives.tsx` — `<Input>` (lines 413–435, `font` prop
  defaults to `mono`); no `SearchInput` primitive exists.
- `frontend/src/hooks/useModels.ts` — `Model` shape (lines 20–34): fields used
  for matching are `name`, `id`, `description: string | null`.
- `frontend/tests/components/Settings.models.test.tsx` — **existing** test file
  that renders `SettingsModelsTab` via `SettingsModal` (`initialTab="models"`).
  Harness to reuse: `makeSettings({ model, overrides })`, the `/api/ai/models` +
  `/api/users/me/settings` fetch mock with PATCH-body capture, `renderModal()`,
  and `makeModel` fixtures from `frontend/tests/fixtures/model`. New tab tests
  extend this file (not a new one).
- `frontend/tests/components/ModelPickerInline.test.tsx` — **existing** picker
  tests, incl. "clicking a rail row updates the detail pane without calling
  onUseModel" (the regression guard for the `React.memo` refactor).

No shared `useDebounce` hook exists (two local `useDebouncedCallback` copies in
`SettingsWritingTab.tsx` / `SettingsAppearanceTab.tsx` serve network autosave,
not this). We add none.

## Design

### Ownership: filter lives in the tab, not the picker

`highlightedId` and the sliders live in `SettingsModelsTab`, and "auto-highlight
the first match" requires the highlight logic to know the **visible** set.
Therefore the query state and filtering live in the tab; `ModelPickerInline`
stays presentational and simply renders whatever list it is handed. Burying the
filter inside the picker would desync the tab's highlight from the visible rows.

### Search input

- The control is a relatively-positioned wrapper `<div>` containing an `<Input>`
  and an absolutely-positioned × button — `Input` is a bare `<input>` with no
  built-in clear affordance, so the × is a sibling, not part of the primitive.
  Placed at the top of the `models-section-list` section, above the existing
  helper `<p>` / `<ModelPickerInline>`.
- `<Input>` carries `data-testid="models-search"` (the stable target the
  filtering tests type into), placeholder `Search models…`, `font="sans"` for
  legibility, and `pr-8` to leave room for the × button.
- Controlled by new tab state `const [query, setQuery] = useState('')`.
- The × button carries `data-testid="models-search-clear"`, is rendered only when
  `query` is non-empty, and resets `query` to `''`.
- **No autofocus** — the tab has other content and grabbing focus on open is
  surprising. User clicks in.
- **Escape is not hijacked.** Inside `SettingsModal`, Escape closes the modal per
  the keyboard-shortcuts contract; the × button is the reset path.
- Search box renders regardless of loading/error/empty so the control is stable
  (it does not depend on `modelsQuery` state).

### Matching

```
const q = query.trim().toLowerCase();
const filtered = useMemo(
  () => (q === '' ? models : models.filter((m) =>
    m.name.toLowerCase().includes(q) ||
    m.id.toLowerCase().includes(q) ||
    (m.description?.toLowerCase().includes(q) ?? false)
  )),
  [models, q],
);
```

- Case-insensitive substring, trimmed. Fields: `name`, `id`, `description`
  (null-safe). Empty/whitespace query → full list (identity, no copy).
- `filtered` is passed to `<ModelPickerInline models={filtered} …>`.

### Highlight reconciliation against the filtered list

Replace the current effect's dependency on the full list with the **filtered**
list, so `highlightedId` always resolves to a visible row. The one subtlety:
`settings.chat.model` may only be preferred **when no query is active** — once a
query has narrowed the list, first-match must win (the locked "auto-highlight
first match" decision), even if the saved default happens to be a later match.
The rule, exactly:

```
useEffect(() => {
  if (filtered.length === 0) return;              // keep prev; highlightedModel → undefined
  setHighlightedId((prev) => {
    if (prev != null && filtered.some((m) => m.id === prev)) return prev;   // keep if visible
    if (q === '') {                               // no query: restore saved default if present
      const saved = settings.chat.model;
      if (saved != null && filtered.some((m) => m.id === saved)) return saved;
    }
    return filtered[0].id;                         // query active (or default absent) → first match
  });
}, [settings.chat.model, filtered, q]);
```

- `filtered` empty → early return; `highlightedId` is left as-is, but
  `highlightedModel` (see below) resolves to `undefined`, so the existing
  `slidersDisabled` path disables Generation parameters. No write.
- The `settings.chat.model` fallback is gated on `q === ''`. With a query active
  the effect goes straight to `filtered[0]`, so a saved default that is a *later*
  match never overrides first-match. (When `q === ''`, `filtered === models`, so
  "saved in `filtered`" is the same "saved in the full list" test the original
  effect intended.)
- `q` is the trimmed, lowercased query (same value the `filtered` memo uses); it
  is in the dep array so the closure never reads a stale query.

**Intended semantics of "auto-highlight first match":** the highlight snaps to
`filtered[0]` only when the current highlight *disappears* from the filtered set.
A highlight that remains visible is kept even if it isn't `filtered[0]` (e.g. the
saved default sits at index 5 and the query still matches indices 3/5/7 — index 5
stays highlighted, not 3). This is the deliberate reading: don't yank the user's
current selection out from under them just because a query also matched something
above it. "First match" governs the *replacement* case, not every keystroke.

This never mutates `settings.chat.model`. "Use this model" remains the only
commit path, so filtering can never change the user's saved default.

**`highlightedModel` must also derive from `filtered`.** Today (lines 110–111):

```
const highlightedModel = models.find((m) => m.id === highlightedId) ?? models[0];
```

reads the **full** `models` list. Leaving it as-is breaks two things this design
promises:

- Zero-match: the effect early-returns (empty `filtered`), so `highlightedId`
  keeps its last real id, `models.find(...)` still resolves a real model, and
  `slidersDisabled` stays `false` — the Generation-parameters section would *not*
  disable.
- Active query excluding the old highlight: the detail pane (fed `filtered`)
  shows `filtered[0]` while the sliders (fed `highlightedModel` from the full
  list) still show the now-hidden model's params.

Change it to derive from `filtered`:

```
const highlightedModel = filtered.find((m) => m.id === highlightedId) ?? filtered[0];
```

so it is `undefined` exactly when `filtered` is empty, and the existing
`slidersDisabled` path (line 113) fires correctly.

**Do not rewire the slider handlers to read `highlightedModel.id`.** For exactly
one render after a filtering keystroke that excludes the old highlight,
`highlightedId` still holds the excluded id while `highlightedModel` already
points at `filtered[0]`; the effect commits `filtered[0].id` on the next tick,
closing the gap before paint. The slider `onChange`/`onReset`/reasoning handlers
must keep keying off `highlightedId` (they already guard `if (!highlightedId)`),
so a stray write during that single render targets a real, still-selectable id —
not `filtered[0]`. This transient divergence is expected, not a bug to "fix."

**Note — deliberate behavior change:** the reconciliation now includes an
`in filtered` membership check before falling back to `settings.chat.model`,
which the original effect (line 106, `settings.chat.model ?? list[0].id`) lacked.
The original could set `highlightedId` to a saved-default id not present in the
list (a "ghost" highlight silently masked by the `?? models[0]` fallback). The
new logic never produces a ghost highlight. This is an intentional improvement,
not incidental.

### Zero-match empty state in `ModelPickerInline`

Split the conflated skeleton condition (line 208). New behavior:

- `error` → existing `ErrorFrame` (unchanged).
- `loading` → `SkeletonRail` (unchanged), regardless of list length.
- `!loading && models.length === 0` → **empty state** (new): render the rail
  frame with a centered message and an empty detail pane. Message text comes
  from a new optional prop `emptyMessage?: string`. Exact strings (pinned so the
  test #5 assertion is stable):
  - picker default when `emptyMessage` is undefined (genuine zero-model catalog):
    `No models available.`
  - tab passes, when a query is active:
    `` emptyMessage={query.trim() ? `No models match “${query.trim()}”` : undefined} ``
    → renders e.g. `No models match “llama”` (curly quotes).
- Otherwise render the rail + detail as today.

New prop on `ModelPickerInlineProps`: `emptyMessage?: string`. The empty state
keeps the `grid grid-cols-[240px_1fr]` frame for layout stability.

### Performance

List is dozens of cheap rows; the meaningful lever is not re-filtering on
unrelated re-renders:

- `filtered` is memoized (`useMemo` above).
- `RailRow` wrapped in `React.memo`. For the memo to actually skip rows, the row
  must receive a **stable** callback rather than a fresh inline closure. Change
  the map site to pass `model` + the stable `onHighlightChange` and have
  `RailRow` call `onHighlightChange(model.id)` internally (drop the per-row
  `onPreview` arrow). `model` refs are stable across renders (same query cache),
  so only rows whose `highlighted`/`active` boolean flips re-render.
- **No debounce, no virtualization.** Debounce would only defer per-keystroke
  render cost behind latency; at this row count and cost there is nothing to
  defer. Virtualization is unwarranted below the hundreds.

**Loading-render note (not a bug):** `models = modelsQuery.data ?? []` (line 97)
allocates a fresh `[]` every render while `data === undefined`, so `filtered`
gets a new identity each loading render and the reconciliation effect fires every
render *during loading*. It early-returns on empty `filtered`, so there is no
loop and no state write. Once data loads, `modelsQuery.data` is a stable cache
reference and `filtered` stabilizes, so the effect quiesces. No action needed;
noted so the memoization claim isn't mistaken for zero effect runs.

## Testing (frontend vitest / jsdom)

Tests #1–#9 exercise query state, filtering, and the highlight effect, which all
live in **`SettingsModelsTab`**. **Extend the existing
`frontend/tests/components/Settings.models.test.tsx`** — it already renders the
Models tab through `SettingsModal` (`initialTab="models"`) and carries the full
harness these tests need: `makeSettings({ model, overrides })`, the
`/api/ai/models` + `/api/users/me/settings` fetch mock (with PATCH capture), the
`renderModal()` helper, and `makeModel` fixtures from `../fixtures/model`. Do
**not** create a new `SettingsModelsTab.test.tsx` — that would duplicate ~150–200
lines of harness (the "Reuse before build" rule). Test #10 lives with the
existing picker tests in `frontend/tests/components/ModelPickerInline.test.tsx`.

1. Empty query renders all models. **Whitespace-only query** also renders the
   full list (identity path — `q === ''` after trim).
2. Query matches on `name` substring (case-insensitive).
3. Query matches on `id` substring (e.g. a family/version fragment).
4. Query matches on `description` substring; null description does not throw.
5. Zero-match renders the empty state; detail pane is absent and the
   Generation-parameters sliders are disabled (guards the
   `highlightedModel`-from-`filtered` fix above). Assert the message with a
   substring matcher — `/No models match/` plus the query fragment — **not** a
   hand-typed full string: the rendered copy uses curly quotes (U+201C/U+201D),
   so a straight-quote literal would silently fail to match.
6. **First-match-vs-saved-default (guards the reconciliation gate).** Set
   `settings.chat.model = B` where `B` is *not* first in the filtered result;
   click a non-default row so `highlightedId != B`, then type a query whose
   filtered list is `[A, B, …]` (A first, B a later match) and that excludes the
   clicked highlight. Assert the highlight lands on **A (`filtered[0]`), not B** —
   i.e. first-match wins over the saved default while a query is active. (A test
   where `highlighted == saved` can't distinguish the two fallback branches; this
   setup must.)
7. After filtering, clicking "Use this model" commits the **correct** filtered
   model id via the captured PATCH (guards against an index/highlight mismatch).
8. "Use this model" on the visible highlighted row **while a query is active**
   keeps the highlight (the committed default is always ∈ `filtered`, so the
   effect keeps `prev` — it must not jump).
9. Loading still shows the skeleton (not the empty state) even though the list
   is momentarily length-0. **Harness note:** `buildFetch` resolves
   `/api/ai/models` synchronously, so `isLoading` is never observably true
   through the tab — this test needs a deferred/pending models response (extend
   `buildFetch` with a controllable promise). Since
   `ModelPickerInline.test.tsx` already covers the skeleton via the `loading`
   prop directly, this case is partly redundant; if the deferred-fetch extension
   proves fiddly, asserting the split at the picker level (empty vs. loading
   props) is an acceptable substitute — the behavior under test is the
   `loading || models.length === 0` → `error → loading → empty → normal` split.
10. **Regression:** clicking a rail row still updates the detail pane after the
    `React.memo` + stable-callback refactor (the existing
    `ModelPickerInline.test.tsx` "clicking a rail row updates the detail pane
    without calling onUseModel" case must be kept and still pass — the refactor
    drops the per-row `onPreview` arrow for an internal `onHighlightChange(model.id)`
    call).

## Verify

`npm --prefix frontend run typecheck && npm --prefix frontend run test -- Settings.models ModelPickerInline`,
and `make lint`.
