# Settings State Consolidation — Design

**Date:** 2026-05-03
**Branch:** to be cut from `debug/ai-integration` after that branch merges
**Status:** Spec — pending review before plan

---

## Problem

Frontend settings state is split across three independent systems with no canonical owner:

1. **Backend `UserSettings`** (canonical, persisted; behind `useUserSettingsQuery` / `useUpdateUserSettingsMutation`).
2. **Three Zustand stores** — `useTweaksStore` (theme, layout, proseFont), `useParamsStore` (AI generation parameters), `useModelStore` (selected model id).
3. **`useDarkMode`** — a separate localStorage flag that overlaps conceptually with `UserSettings.theme === 'dark'` but doesn't sync with it.

Settings only flow from backend → Zustand when the Settings tab mounts (gated on a `seededRef` so it runs once per tab open). Direct consequences:

- After a page reload, theme / proseFont / AI params revert to hardcoded defaults until the user opens Settings.
- `<ModelPicker>` (the chat-panel quick switcher) writes to `useModelStore` but never PATCHes the backend → multi-device drift.
- `useDarkMode` and `theme` can disagree about whether the UI is dark.
- `useTweaksStore.layout` (`'three-col' | 'nochat' | 'focus'`) is mutated by `useFocusToggle` and `lib/askAi.ts` for ephemeral UI flips, while `theme` and `proseFont` in the same store are persistent preferences. The store has two persistence semantics mixed.
- The next contributor adding a setting has no canonical pattern to follow.

The model bug fixed in commit `d61ff6d` (chat-send `no_model` warn after picking a model) was symptomatic of this class. The diagnostics-first work made it visible; this work eliminates the class.

## Goal

One source of truth per persistence category. Persistent settings live in TanStack Query's cache (server-backed). Ephemeral UI state lives in a small new `useUiStore`. No dual-write paths. No localStorage settings layer.

## Non-Goals

- Schema changes to `UserSettings`. The shape is fine.
- New settings UI. Settings tabs continue to look the same; only their data source changes.
- Generic "settings framework" abstraction beyond `useUserSettings` + `useUpdateUserSetting`. YAGNI.
- Persisting layout / focus mode. Memory-only by design.
- localStorage migration / fallback-read-from-old-store branches. Per CLAUDE.md and the project's pre-deployment status, broken installs are tolerable.
- Re-investigating the AI bug class. Once the model state class is gone, any remaining AI errors will surface via the diagnostics overlay and be addressed separately.

## Approach

**Architecture:** TanStack Query is the single source of truth for persistent settings. A small wrapper hook hides the loading state from consumers so reads always return a definite-shape `UserSettings`. A separate Zustand slice holds ephemeral UI state. Three persistent-state Zustand stores plus the `useDarkMode` hook are deleted entirely.

**Read API.** Consumers get a fully-resolved `UserSettings` from `useUserSettings()`. Defaults are filled in from a single canonical `DEFAULT_SETTINGS` constant. No `?? <fallback>` rituals at consumer sites.

**Write API.** A `useUpdateUserSetting()` wrapper calls `useUpdateUserSettingsMutation` with an `onMutate` optimistic update that pre-populates the Query cache, so UI updates synchronously (matches today's Zustand-write feel — no spinner, no flash). On error, the mutation rolls back to the pre-mutate snapshot and publishes to `useErrorStore` (the diagnostics surface from the previous branch).

**Ephemeral state.** A new `useUiStore` Zustand slice for `layout` and any other genuinely transient UI state. Pure in-memory, defaults reset on every page load.

**DarkMode.** Removed entirely. `<DarkModeToggle>` deleted (it isn't surfaced in the UI today). Theme selection lives in `SettingsAppearanceTab`'s three-button picker.

## Architecture

### New: `useUserSettings()` and `useUpdateUserSetting()`

Both added to `frontend/src/hooks/useUserSettings.ts`. The existing `useUserSettingsQuery` and `useUpdateUserSettingsMutation` exports stay for tests / advanced consumers, but day-to-day reads/writes go through the new wrappers.

```ts
export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'paper',
  prose: { font: 'iowan', size: 18, lineHeight: 1.6 },
  writing: {
    spellcheck: true,
    typewriterMode: false,
    focusMode: false,
    dailyWordGoal: 0,
    smartQuotes: true,
    emDashExpansion: true,
  },
  chat: { model: null, temperature: 0.85, topP: 0.95, maxTokens: 800 },
  ai: { includeVeniceSystemPrompt: true },
};

export function useUserSettings(): UserSettings {
  const { data } = useUserSettingsQuery();
  return data ?? DEFAULT_SETTINGS;
}

export function useUpdateUserSetting(): {
  mutate: (patch: UserSettingsPatch) => void;
  isPending: boolean;
};
```

`useUpdateUserSetting` snapshots the current cache value at `onMutate` time, deep-merges the patch, calls `setQueryData` so the UI updates synchronously, then runs the underlying mutation. On error, it restores the snapshot and pushes a `severity:'error'` entry to `useErrorStore` with `source: 'settings.update'`.

A `mergeSettings(prev, patch)` helper handles the one-level-deep merge for `prose` / `writing` / `chat` / `ai` nested groups plus the top-level `theme`.

The default values must match the backend's defaults. A Step-1 cross-check task locates the backend default and reconciles any drift.

### New: `useUiStore`

`frontend/src/store/ui.ts`:

```ts
export type Layout = 'three-col' | 'nochat' | 'focus';

export interface UiState {
  layout: Layout;
  setLayout: (layout: Layout) => void;
}

export const useUiStore = create<UiState>((set) => ({
  layout: 'three-col',
  setLayout: (layout) => set({ layout }),
}));
```

Pure in-memory. Defaults reset on every reload by design.

### App-root rehydration

Currently `useUserSettingsQuery` is called inside Settings tab components, so the cache is empty until the user opens Settings. After this work, a one-line `useUserSettingsQuery()` call at the top of `AppRouter` (after `useInitAuth()`, gated on `useSessionStore((s) => s.status) === 'authenticated'`) warms the cache as soon as auth resolves. The first render of the editor uses real backend data, not `DEFAULT_SETTINGS`.

### Deletions

- `frontend/src/store/tweaks.ts` (and its test).
- `frontend/src/store/params.ts` (and its test).
- `frontend/src/store/model.ts` (and its test).
- `frontend/src/hooks/useDarkMode.ts` (and its test).
- `frontend/src/components/DarkModeToggle.tsx` (and its story / test). Verified not surfaced in any current UI.

The localStorage keys `inkwell:darkMode` and `inkwell:selectedModelId` are abandoned. Per "no migration branches", we don't write fallback paths.

### Consumer migrations

| Consumer | Old | New |
|---|---|---|
| `SettingsAppearanceTab.tsx` | `useTweaksStore` reads/writes; one-shot seed effect from `useUserSettingsQuery` | `useUserSettings()` for reads; `useUpdateUserSetting()` for writes; seed effect deleted |
| `SettingsModelsTab.tsx` | `useModelStore` + `useParamsStore` reads/writes; seed effect | `useUserSettings()` reads; `useUpdateUserSetting()` writes; seed effect deleted |
| `SettingsWritingTab.tsx` | `useUserSettingsQuery` + `useUpdateUserSettingsMutation` directly | `useUserSettings()` + `useUpdateUserSetting()` for consistency |
| `ChatPanel.tsx` | `useModelStore`, `useParamsStore` | `useUserSettings()` (`chat.model`, `chat.temperature`, etc.) |
| `ChatComposer.tsx` | `useModelStore` | `useUserSettings().chat.model` |
| `ModelPicker.tsx` | `useModelStore` (read+write — multi-device bug source) | `useUserSettings()` for read, `useUpdateUserSetting()` for write |
| `EditorPage.tsx` | `useModelStore((s) => s.modelId)` | `useUserSettings().chat.model` |
| `AppShell.tsx` | `useTweaksStore((s) => s.tweaks.layout)` | `useUiStore((s) => s.layout)` |
| `useFocusToggle.ts` | `useTweaksStore` layout read/write | `useUiStore` layout read/write |
| `lib/askAi.ts` | `useTweaksStore.getState().setTweaks({ layout: 'three-col' })` | `useUiStore.getState().setLayout('three-col')` |

`<DarkModeToggle>` has no replacement — its mount points (if any) are removed.

### Data flow on a write

```
User clicks theme button in SettingsAppearanceTab
  → update.mutate({ theme: 'sepia' })
  → onMutate: snapshot prev = qc.getQueryData(...);
              qc.setQueryData(..., mergeSettings(prev, patch));   // synchronous UI update
  → underlying mutation: PATCH /api/users/me/settings
  → onSuccess: qc.setQueryData(..., serverResponse);              // reconcile to authoritative
  → onError:   qc.setQueryData(..., prev);                        // rollback
              useErrorStore.push({ source: 'settings.update', ... });
```

## Files

**New:**
- `frontend/src/store/ui.ts` (+ test).
- Test for `useUserSettings` / `useUpdateUserSetting` extensions in the existing `frontend/tests/hooks/useUserSettings.test.ts` (or a new sibling if cleaner).

**Modified:**
- `frontend/src/hooks/useUserSettings.ts` (adds `DEFAULT_SETTINGS`, `useUserSettings`, `useUpdateUserSetting`, `mergeSettings`).
- `frontend/src/router.tsx` (app-root `useUserSettingsQuery` call).
- Every consumer in the migration table above.

**Deleted:**
- `frontend/src/store/tweaks.ts`, `params.ts`, `model.ts` (+ tests).
- `frontend/src/hooks/useDarkMode.ts` (+ test).
- `frontend/src/components/DarkModeToggle.tsx` (+ test + story).

**Backend:**
- Zero code changes if defaults already match `DEFAULT_SETTINGS`. Step-1 verification only.

## Build sequence

**Step 1 — Foundations + backend cross-check.**
- Add `DEFAULT_SETTINGS`, `useUserSettings`, `useUpdateUserSetting`, `mergeSettings` to `useUserSettings.ts`. Tests for each.
- Create `useUiStore` + test.
- Add app-root `useUserSettingsQuery()` warm-up in `AppRouter`.
- Backend cross-check: confirm backend `UserSettings` defaults match `DEFAULT_SETTINGS`. Reconcile any drift in the same commit. If drift exceeds a one-line fix, **stop and ask**.

**Step 2 — Migrate consumers.** One sub-step per surface, keeping the app green throughout.
- 2a. `EditorPage`, `ChatPanel`, `ChatComposer`, `ModelPicker` → `useUserSettings` reads; `ModelPicker` writes via `useUpdateUserSetting` (multi-device fix lands here).
- 2b. `SettingsAppearanceTab` → wrapper hooks; seed effect deleted.
- 2c. `SettingsModelsTab` → wrapper hooks; seed effect deleted.
- 2d. `SettingsWritingTab` → wrapper hooks (consistency).
- 2e. `AppShell`, `useFocusToggle`, `lib/askAi.ts` → `useUiStore` for layout.

**Step 3 — Delete dead code.**
- Remove the four files (three stores + dark-mode hook) and their tests.
- Remove `<DarkModeToggle>` and any references.
- Verify `tsc -b --noEmit` catches no missed imports.

**Step 4 — Final verification gate.**
- Frontend full suite + Storybook build + Vite prod build.
- Backend full suite (no changes expected; sanity check).
- Manual smoke: full settings flow per tab, model pick from chat panel, reload-and-confirm (theme/font/model survive reload without opening Settings).
- `lint:design` clean.

## Testing

- **Unit:** `useUserSettings()` returns DEFAULT_SETTINGS while loading and the query data after; `useUpdateUserSetting()` performs optimistic update on `mutate`, rolls back on error, publishes to `useErrorStore` on error; `mergeSettings()` correctly merges each nested group.
- **Component:** existing Settings-tab tests rewired to mock `useUserSettingsQuery` instead of seeding the deleted Zustand stores. `ModelPicker` test asserts the PATCH fires (the multi-device fix is observable).
- **Integration:** existing `EditorPage` + chat-send tests continue to pass after the `useModelStore → useUserSettings` swap. `useFocusToggle` continues to flip layout via the new store.
- **Storybook:** stories that seeded the deleted Zustand stores are updated to provide a `QueryClientProvider` with seeded settings cache, or deleted if decoration-only.

## Risks

| Risk | Mitigation |
|---|---|
| Optimistic update breaks if `mergeSettings` botches a nested patch | Unit test covers each nested group + theme top-level |
| App-root `useUserSettingsQuery` fires 401 for unauthenticated users | Gate on `useSessionStore((s) => s.status) === 'authenticated'` |
| Storybook stories that seeded the deleted Zustand stores break | Identify upfront in plan; either rewire to a seeded Query cache or delete decoration-only stories |
| Backend default drift discovered in Step 1 | Reconcile in same commit; if non-trivial, stop and ask |
| Optimistic-update race on rapid concurrent mutations | Each `onMutate` snapshots its own pre-state; backend PATCHes serialise. Acceptable; minor JSDoc note |
| `useFocusToggle` consumers expect persistence | Confirmed memory-only is intended UX. Commit message documents this so future-me doesn't reintroduce persistence |

## PR shape

**One PR.** The architectural change is atomic — partial states are awkward to deploy and harder to review than the full diff. Step 1 → 4 land together on a single branch (`refactor/settings-state-consolidation` or similar) cut from `main` after the current `debug/ai-integration` branch merges.

## Out of scope (re-stated)

- Schema changes to `UserSettings`.
- New settings UI surfaces.
- localStorage compatibility shims.
- `<DarkModeToggle>` revival in any form.
- Restructuring ephemeral stores (`useActiveChapterStore`, `useSessionStore`, etc.) — they are correctly scoped and not part of the broken pattern.
