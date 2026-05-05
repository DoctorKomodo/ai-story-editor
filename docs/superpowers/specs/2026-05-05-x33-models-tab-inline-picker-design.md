# X33 — Settings → Models tab inline picker

**Status:** spec
**Branch:** TBD (probably `feature/x33-models-tab-inline-picker` off main)
**Date:** 2026-05-05
**Predecessors:** X27 (Settings → Models picker rework — superseded by this task; the modal trigger + ModelCard layer is replaced with an inline master/detail layout in the Settings tab itself). X27's backend mapper, frontend `Model` type mirror, docs, and the typecheck-script chore commit all survive; only the X27 frontend UI is reworked.
**Successors:** none planned. A `mode: 'modal-fast'` quick-swap variant is listed as out-of-scope follow-up.

---

## 1. Motivation

X27 introduced a trigger-button + modal `<ModelPicker />` pattern to replace the inline `<ModelCard>` radiogroup. In practice the modal-on-modal flow proved messy:

- The picker modal opened *behind* the Settings modal on first click (z-index / stacking-context bug).
- Clicking the picker modal to bring it forward dismissed Settings (click-outside semantics on the underlying modal).
- The card body became too dense — three pieces of info on one line, capability labels prefixed to description prose, hard to scan.

X33 rebuilds the Models surface as an **inline master-detail picker living inside the Settings → Models tab**. There is no separate `<ModelPicker />` modal anywhere. The chat-bar's existing model trigger now opens Settings on the Models tab — one source of truth for model selection across the app.

A `<ModelPickerSplit>` and `<SettingsModelsTabSplit>` Storybook mockup landed during the design conversation; this spec is the production shape of those mockups.

---

## 2. Scope

In:

- New presentational component `<ModelPickerInline>` rendering a 240px rail (model list with `name · price · ctx`) and a flex-1 detail pane (capabilities chips, full description, pricing/context dl-grid, "Use this model" CTA).
- `<SettingsModelsTab>` rewritten to embed `<ModelPickerInline>` and keep the existing 3-slider Generation parameters block. No more trigger button.
- `<SettingsModal>` chrome simplification:
  - Drop the existing footer's Cancel/Done buttons.
  - Replace with a hint-only footer: `Changes save automatically · tap outside or press Esc to close`.
  - Add an optional `initialTab?: SettingsTabId` prop so the chat-bar trigger can open Settings directly on Models.
  - Drop the `onOpenModelPicker: () => void` prop.
- `<EditorPage>` chat-bar model trigger reroutes to `setSettingsInitialTab('models'); setSettingsOpen(true)`. The trigger button itself stays; only the click handler changes. Drop the `<ModelPicker />` mount and the `setModelPickerOpen` state.
- `<IconButton>` design primitive gains a `size: 'lg'` variant — 44×44 px hit target with a 20px icon glyph. Meets WCAG 2.5.5 / iOS HIG touch-target requirements.
- `<ModalHeader>` uses the new `'lg'` size for its close button. All modals in the app pick this up automatically.
- New tests: `ModelPickerInline.test.tsx`, rewrite of `Settings.models.test.tsx`, integration update for the chat-bar → Settings flow.
- Deletions: `ModelCard.tsx` + its stories + tests; `ModelPicker.tsx` + its stories + tests; the two design-exploration mockups (`ModelPickerSplit.stories.tsx`, `SettingsModelsTabSplit.stories.tsx`).

Out:

- A `mode: 'modal-fast'` variant of `<ModelPickerInline>` for quick chat-bar swaps (deferred — try the all-Settings flow first; revisit if friction bites).
- Filtering / sorting models in the rail.
- Capability **icons** instead of text labels.
- DEM pricing display (still USD-only).
- Vision capability badge.
- Per-model favourites or pinning.
- Pricing in the chat-bar `model-bar` itself (still picker-only).
- Backend changes (X27's `description` + `pricing` extension is exactly what this needs).

---

## 3. Architecture

```
<EditorPage>
  ├── <ChatPanel>
  │     └── model-bar trigger
  │           onClick: setSettingsInitialTab('models'); setSettingsOpen(true)
  └── <SettingsModal initialTab={settingsInitialTab}>
        └── <SettingsModelsTab>
              ├── <ModelPickerInline>      ← new
              │     ├── Rail (internal)
              │     └── Detail pane (internal); "Use this model" CTA
              └── (existing 3-slider Generation parameters block)
```

### 3.1 `<ModelPickerInline>` — pure presentational component

Path: `frontend/src/components/ModelPickerInline.tsx`.

Props:
- `models: Model[]`
- `activeId: string | null` — the currently-saved model from `settings.chat.model`
- `onUseModel: (id: string) => void` — fires when the user confirms (caller PATCHes settings)
- `loading?: boolean` (optional; renders skeleton rail without a detail pane)
- `error?: boolean` (optional; renders an error frame with a retry slot left to caller)

Internal state:
- `highlightedId: string | null` — defaults to `activeId ?? models[0]?.id ?? null`. Updates on rail-row click. Resets to `activeId ?? models[0]?.id` if `activeId` changes externally (e.g. the user just confirmed in the same session).

Layout: 240px rail + flex-1 detail pane in a card with `border border-line rounded-[var(--radius)] bg-bg-elevated`. Min height 360px. Rail is a vertical scroll region; detail pane is a vertical-scroll pane.

**Rail row**:
- Row 1: optional small ink dot (when `id === activeId`) + `<span>` model name (font-mono 12.5px, text-ink, truncate).
- Row 2: `font-mono 10.5px text-ink-4` left side carrying `"$X.XX · $Y.YY"` (compact, no `in/out` labels), right side carrying ctx label (`128k`, font-mono 10px uppercase tracking-tight).
- Selected row (= highlighted): `bg-bg-sunken border-l-ink` (left border accent).
- Unselected: `border-l-transparent hover:bg-bg-sunken/60`.
- Test ids: `model-rail-${id}` per row.

**Detail pane**:
- Header: `<h3>` (font-serif 20px) with model name + `<code>` (font-mono 11px text-ink-4) with model id; on the same row a top-right CTA `<Button>`:
  - When `highlighted.id === activeId`: `<Button variant="ghost" disabled>Currently in use</Button>`.
  - Otherwise: `<Button variant="primary" onClick={() => onUseModel(highlighted.id)}>Use this model</Button>`.
- Capability chips row: outlined, with tiny dot prefix, `Reasoning` / `Web search` (in that order). Hidden when neither is true.
- Description: full prose, no line-clamp, font-sans 13.5px text-ink-2 leading-relaxed. Empty: italic text-ink-4 placeholder copy `"No description provided by the model host."`.
- Pricing/context dl-grid (2 cols `[max-content_1fr]`): `Context window`, `Input price`, `Output price`. Pricing rows show `—` when `pricing` is null.
- Test ids: `model-detail-name`, `model-detail-cta`, `model-detail-description`, `model-detail-context`, `model-detail-input-price`, `model-detail-output-price`.

### 3.2 `<SettingsModelsTab>` — rewrite

Drops the trigger pattern; embeds the picker. Wires data from existing hooks:

```ts
const settings = useUserSettings();
const updateSetting = useUpdateUserSetting();
const modelsQuery = useModelsQuery();
```

Renders:

```tsx
<ModelPickerInline
  models={modelsQuery.data ?? []}
  activeId={settings.chat.model}
  loading={modelsQuery.isLoading}
  error={modelsQuery.isError}
  onUseModel={(id) => {
    updateSetting.mutate({ chat: { model: id } });
  }}
/>
```

Plus the unchanged 3-slider Generation parameters section below.

Drops the `onOpenModelPicker` prop entirely (no caller passes it any more).

### 3.3 `<SettingsModal>` chrome

- Drop the footer's Cancel/Done buttons. Replace the entire footer with a hint-only row:
  - copy: `Changes save automatically · tap outside or press Esc to close`.
  - centred, `font-mono text-[11px] text-ink-4`, single line, non-interactive.
  - test id: `settings-footer-hint`.
- Add `initialTab?: SettingsTab` prop. The current code resets `activeTab` to `'venice'` on every open (`useEffect(() => { if (open) setActiveTab('venice'); }, [open])` at `Settings.tsx:102-104`). The new prop changes the reset target: if `initialTab` is provided the open-effect uses it; otherwise it falls back to `'venice'` (existing behaviour preserved).
- Drop `onOpenModelPicker: () => void` prop.

`initialTab` semantics:
- Applies only on the *mount transition from closed → open*. Tab changes after that are user-driven and visible until the modal closes.
- Each fresh open consults `initialTab` again. The chat-bar trigger sets it to `'models'`; the settings cog leaves it `undefined` and lands on `'venice'` (today's default).
- No "remember last tab across opens" feature is added — that would be a separate scope decision.

### 3.4 `<EditorPage>` wiring

- Drop `setModelPickerOpen` state (`EditorPage.tsx:154`) and the `<ModelPicker />` mount (`EditorPage.tsx:736-740`).
- Add `settingsInitialTab: SettingsTab | undefined` state (default `undefined`).
- Chat-bar trigger handler at `EditorPage.tsx:681`: replace `setModelPickerOpen(true)` with `setSettingsInitialTab('models'); setSettingsOpen(true);`.
- `<SettingsModal>` mount at `EditorPage.tsx:742-749`: `initialTab={settingsInitialTab}`; drop the `onOpenModelPicker` prop.
- On Settings close: reset `settingsInitialTab` back to `undefined` so the next settings-cog open lands on `'venice'` as today.

### 3.5 `<IconButton>` `lg` size variant

`IconButton` currently has no `size` prop and is hardcoded to `w-7 h-7` (28×28) at `primitives.tsx:325`. Add an opt-in `size?: 'md' | 'lg'` prop, default `'md'` (preserves existing behaviour — every existing call site stays at 28×28 with no API change required):

| size | hit target | icon glyph | class |
|---|---|---|---|
| `md` (default) | 28×28 | 14–16px (caller-controlled) | `w-7 h-7` |
| `lg` | 44×44 | 20px | `w-11 h-11` |

Border-radius unchanged (`var(--radius)`). Hover/active states inherit existing styling. The `lg` variant sets only the hit-target / box size; the SVG glyph child is the caller's responsibility.

`CloseIcon` (`primitives.tsx:494`) currently renders at 14×14. Add a parallel `size?: 'md' | 'lg'` prop, default `'md'` (14×14, preserves existing behaviour), with `'lg'` rendering at 20×20. `ModalHeader` then renders `<IconButton size="lg"><CloseIcon size="lg" /></IconButton>` — both the box and the glyph scale up. No other consumer of `<CloseIcon />` is affected (only `ModalHeader` uses it directly).

### 3.6 `<ModalHeader>` close button

Update `ModalHeader` to render its close `IconButton` with `size="lg"`. No caller change required. The vertical chrome of every modal grows by ~12px to accommodate the larger button — acceptable in this app's modal sizing.

---

## 4. Backend changes

None. `ModelInfo.description` and `ModelInfo.pricing` from X27 are exactly what this needs.

---

## 5. Frontend file changes

**Created**:
- `frontend/src/components/ModelPickerInline.tsx`
- `frontend/src/components/ModelPickerInline.stories.tsx`
- `frontend/tests/components/ModelPickerInline.test.tsx`

**Modified**:
- `frontend/src/components/SettingsModelsTab.tsx` — full rewrite.
- `frontend/src/components/Settings.tsx` — `initialTab` prop; drop `onOpenModelPicker`; replace footer Cancel/Done with hint row.
- `frontend/src/pages/EditorPage.tsx` — drop ModelPicker mount; add `settingsInitialTab` state; reroute chat-bar trigger.
- `frontend/src/design/primitives.tsx` — `IconButton` adds `'lg'` size; `ModalHeader` uses it for its close button.
- `frontend/src/design/IconButton.stories.tsx` — add `Lg` story.
- `frontend/src/design/Modal.stories.tsx` — confirm the larger close-X visually.
- `frontend/src/components/Settings.stories.tsx` — drop `onOpenModelPicker` no-op; update Models tab story to render the inline picker.
- `frontend/tests/components/Settings.models.test.tsx` — rewrite for the inline picker.
- `frontend/tests/components/Settings.{appearance,prompts,writing,shell-venice}.test.tsx` — drop `onOpenModelPicker={() => {}}` no-ops.
- `frontend/tests/pages/editor-shell.integration.test.tsx` — replace the X27 trigger-opens-picker case with: chat-bar trigger opens Settings on Models tab; the inline picker is in the DOM after Settings opens.

**Deleted**:
- `frontend/src/components/ModelCard.tsx`
- `frontend/src/components/ModelCard.stories.tsx`
- `frontend/src/components/ModelPicker.tsx`
- `frontend/src/components/ModelPicker.stories.tsx`
- `frontend/src/components/ModelPickerSplit.stories.tsx` (mockup)
- `frontend/src/components/SettingsModelsTabSplit.stories.tsx` (mockup)
- `frontend/tests/components/ModelCard.test.tsx`
- `frontend/tests/components/ModelPicker.test.tsx`

---

## 6. Stories (Storybook)

- New: `<ModelPickerInline>` — variants `Default` (active mid-list), `ActiveTopOfList`, `BareModelActive` (no description / no pricing), `Loading`, `Error`, `Empty`.
- Updated: Settings stories — Models tab renders the inline picker; existing tabs stories keep their fixtures minus the `onOpenModelPicker` no-op.
- Updated: IconButton stories — `Lg` variant.
- Updated: Modal stories — confirm the larger close-X visually.
- Retired: `ModelCard.stories.tsx`, `ModelPicker.stories.tsx`, `ModelPickerSplit.stories.tsx`, `SettingsModelsTabSplit.stories.tsx`.

---

## 7. Tests

### `<ModelPickerInline>`:
1. Rail renders one `model-rail-${id}` row per model with name, compact `$X · $Y` pricing, ctx label.
2. Bare model (description=null, pricing=null) renders rail row with `"no price"` placeholder.
3. Active model has a dot prefix in the rail row (`activeId` matches).
4. On mount, default `highlighted` = `activeId`; detail pane shows that model.
5. Click a different rail row → highlighted updates → detail pane shows the new model. `onUseModel` is NOT called.
6. CTA reads `"Use this model"` (variant=primary, enabled) when previewing a non-active model. Clicking it calls `onUseModel(id)` exactly once.
7. CTA reads `"Currently in use"` (variant=ghost, disabled) when previewing the active model.
8. Capability chips render only the flags that are true; vision is never rendered (matches X27 rule).
9. Description renders full prose (no truncation). Empty description → italic placeholder copy is in the DOM.
10. `loading=true` → rail shows ~8 skeleton rows; no detail pane content; no crash on `models=[]`.

### `<SettingsModelsTab>`:
1. Renders `<ModelPickerInline>` bound to `useUserSettings().chat.model` and `useModelsQuery().data`.
2. Clicking the detail-pane CTA PATCHes `/users/me/settings { chat: { model } }`.
3. The three sliders still render bound to settings.chat values (ported from existing tests).
4. Dragging temperature still PATCHes settings.chat.temperature (ported).

### `<SettingsModal>` chrome:
1. No `Cancel` / `Done` button is in the document.
2. `settings-footer-hint` is in the document with the expected copy.
3. `initialTab="models"` opens the modal on the Models tab (Models content is visible without clicking the tab strip).
4. Without `initialTab`, the modal opens on the persisted last tab (existing behaviour preserved).
5. The header's `modal-close` IconButton has computed size 44×44 (or assert `data-size="lg"` if the primitive exposes one).

### `<IconButton>`:
1. Existing `sm`/`md` stories still pass.
2. New `lg` story renders a 44×44 button.

### Integration (`editor-shell.integration.test.tsx`):
1. Click the chat-bar model trigger → Settings opens with Models tab active (the Models tab content is visible without an extra click).
2. The inline picker (`ModelPickerInline` test ids) is in the DOM after Settings opens.
3. The X27 case ("trigger opens shared `<ModelPicker />`") is replaced by this test, not added alongside.

### Not tested
- Visual regression on rail/detail layout (Storybook is canonical reference).
- Touch-event simulation (vitest+jsdom can't reliably simulate touch — the 44×44 size assertion is the testable part of the WCAG contract).

---

## 8. Docs

- `docs/api-contract.md`: no changes.
- `docs/venice-integration.md`: no changes.
- `CLAUDE.md`: optional one-line note about the chat-bar trigger destination if the implementer thinks future contributors would benefit. Probably not necessary.

---

## 9. Risks

- **Quick-swap friction**: routing the chat-bar through Settings adds chrome (modal title bar, tab strip) and one extra click (the explicit `Use this model` button). Acceptable per the design discussion. If friction proves real in dogfooding, follow up with an out-of-scope `mode: 'modal-fast'` variant.
- **`initialTab` semantics**: spelled out in §3.3 — applies on mount only, doesn't fight the user's persisted tab on subsequent opens. Implementer must respect this; otherwise users feel like Settings keeps "snapping back" to Models.
- **`IconButton` lg cascade on every modal**: bumping `ModalHeader`'s close button to 44×44 visually shifts every modal header by a few px. Acceptable — modal headers were already comfortable, this just makes them touch-friendly.
- **Storybook fixture bloat**: the X27 + X33 cycle leaves several retired story files. The plan explicitly deletes them rather than letting them rot.

---

## 10. Manual smoke checklist

After Storybook + automated tests pass, before merging:

1. `make dev`, log in. Open chat panel; click the model bar trigger. Settings opens on the Models tab (not Venice or any other).
2. Models tab shows the inline picker with the rail full of models, the right pane showing the currently-active model with `Currently in use` (disabled).
3. Click any other model in the rail. Right pane updates to show that model. CTA flips to `Use this model` (primary).
4. Click `Use this model`. Rail dot moves to the new model. CTA flips back to `Currently in use` (disabled).
5. Reload the page; Models tab shows the new active model on the right pane (PATCH persisted).
6. Click the X close button — Settings closes. Repeat with Esc and tap-outside (backdrop click).
7. Open Settings via the cog. Lands on the persisted last tab (could be Models if you were just there, but a fresh session lands on the user's previous tab — *not* always Models).
8. Verify the X close button feels comfortable on a touch surface (mobile simulator or actual touch screen). 44×44 should land cleanly under thumb.
9. Dark theme: rail's selected-row contrast, chip outlines, and close-button hover state all read.
10. Bare-model fallback (a model with no description/pricing) doesn't crash the detail pane and shows the empty-state copy.

---

## 11. Migration from X27 (PR #65)

X27's commits divide into "survives X33" and "replaced by X33":

**Survives** (kept as-is):
- `8dc9473` `[X27] backend: ModelInfo gains description + pricing nullable fields`
- `686d153` `[X27] frontend: Model type mirrors backend description + pricing`
- `9bb3c45` `[X27] docs + tick: api-contract, venice-integration, TASKS`
- `950a282` `[chore] add typecheck script to backend + frontend; align docs`

**Replaced by X33** (the new task supersedes these — the files they create or modify are deleted/rewritten):
- `503e8e1` failing tests for new ModelCard body (file deleted)
- `ac2fbb8` ModelCard renders price pill + description + capability labels (file deleted)
- `0cac3ec` ModelPicker shows USD-per-1M-tokens price hint (file deleted)
- `cde7e22` rewrite Settings.models.test for trigger pattern (file rewritten)
- `9e25d76` SettingsModelsTab uses trigger; Settings + EditorPage wire onOpenModelPicker (file rewritten)
- `6139fa9` VeniceMark V glyph uses --bg token (file rewritten — the glyph goes away)
- `96e1143` ModelPicker stories (file deleted)
- `ebb5517` ModelCard stories + Settings ModelsTab NoSelection (one file deleted, one updated)
- `c97cdcc` integration test (file rewritten)

**Recommended migration**: cherry-pick the four "Survives" commits onto a fresh branch `feature/x33-models-tab-inline-picker` off main. Close PR #65 unmerged with a comment pointing at the new PR. Open the X33 PR with the cherry-picks plus the X33 implementation commits.

Rationale: cleaner git history, smaller diff to review, no zombie files that exist only to be deleted in the same PR. The X27 spec/plan docs remain in the branch as a historical artifact (don't delete them — they explain why the inline-picker direction was eventually chosen).

If the cherry-pick is awkward in practice (e.g. spec/plan files sit alongside the survived commits), an alternative is **(a) build on top of the X27 branch**: add X33 commits that delete the retired files and add the new ones. Git history then shows files created in X27 then deleted in X33 — noisy but explicit. This is acceptable if cherry-pick proves fiddly.

The plan defaults to (b) cherry-pick.

---

## 12. Out-of-scope follow-ups

- `mode: 'modal-fast'` quick-swap variant of `<ModelPickerInline>` for the chat-bar (commit-on-click in a modal version of the same component).
- Filterable / sortable rail.
- DEM pricing display.
- Capability **icons** instead of text labels.
- Per-model favourites or pinning UX.
- Touch-event automated testing (different test infra than current vitest+jsdom).
