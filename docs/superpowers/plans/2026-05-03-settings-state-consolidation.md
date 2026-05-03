# Settings State Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace three Zustand stores (`useTweaksStore`, `useParamsStore`, `useModelStore`) and the `useDarkMode` localStorage hook with a single TanStack-Query-backed source of truth for persistent settings, plus a small `useUiStore` for ephemeral UI state.

**Architecture:** A new `useUserSettings()` wrapper hook returns a definite-shape `UserSettings` (defaults filled in from one canonical `DEFAULT_SETTINGS`); a new `useUpdateUserSetting()` wrapper does optimistic update + rollback on error (publishing failures to `useErrorStore`). Persistent settings live only in TanStack Query. Ephemeral UI state (`layout`) lives in a small new `useUiStore`. App-root rehydration warms the cache as soon as auth resolves so first-render uses backend data, not defaults.

**Tech Stack:** React 18, TypeScript strict, Vite, Vitest, TanStack Query (already in use), Zustand (smaller surface than today).

**Spec:** [docs/superpowers/specs/2026-05-03-settings-state-consolidation-design.md](../specs/2026-05-03-settings-state-consolidation-design.md)

**Branch:** to be cut from `main` AFTER `debug/ai-integration` lands. Suggested name: `refactor/settings-consolidation`.

**Prerequisite:** `useErrorStore` (introduced on `debug/ai-integration` at `b97da52`) must be available on the base branch — the optimistic-rollback path publishes failures there.

---

## File Structure

**New (frontend):**
- `frontend/src/store/ui.ts` — `useUiStore` Zustand slice. Owns ephemeral UI state. Initial scope: `layout` only.
- `frontend/tests/store/ui.test.ts` — store tests.
- `frontend/tests/hooks/useUserSettings.test.ts` — tests for the new wrapper hooks (`useUserSettings`, `useUpdateUserSetting`, `mergeSettings` helper).

**Modified (frontend):**
- `frontend/src/hooks/useUserSettings.ts` — add `DEFAULT_SETTINGS`, `mergeSettings`, `useUserSettings`, `useUpdateUserSetting`. Existing `useUserSettingsQuery` and `useUpdateUserSettingsMutation` exports kept (advanced use, tests).
- `frontend/src/router.tsx` — app-root cache warm-up call after auth resolves.
- `frontend/src/pages/EditorPage.tsx` — read `model` via `useUserSettings()`.
- `frontend/src/components/ChatPanel.tsx` — read model + params via `useUserSettings()`.
- `frontend/src/components/ChatComposer.tsx` — read model via `useUserSettings()`.
- `frontend/src/components/ModelPicker.tsx` — read via `useUserSettings()`, write via `useUpdateUserSetting()` (multi-device fix).
- `frontend/src/components/SettingsAppearanceTab.tsx` — drop `useTweaksStore` + seed effect; route through wrapper hooks.
- `frontend/src/components/SettingsModelsTab.tsx` — drop `useModelStore`/`useParamsStore`; route through wrapper hooks; debounced PATCH unchanged.
- `frontend/src/components/SettingsWritingTab.tsx` — switch from raw query/mutation hooks to wrapper hooks for consistency.
- `frontend/src/components/AppShell.tsx` — read `layout` from `useUiStore`.
- `frontend/src/hooks/useFocusToggle.ts` — read/write `layout` via `useUiStore`.
- `frontend/src/lib/askAi.ts` — write `layout` via `useUiStore`.

**Deleted (frontend):**
- `frontend/src/store/tweaks.ts` (and `frontend/tests/store/tweaks.test.ts` if present).
- `frontend/src/store/params.ts` (and `frontend/tests/store/params.test.ts` if present).
- `frontend/src/store/model.ts` and `frontend/tests/store/model.test.ts`.
- `frontend/src/hooks/useDarkMode.ts` and `frontend/tests/components/DarkMode.test.tsx`.
- `frontend/src/components/DarkModeToggle.tsx`, `frontend/src/components/DarkModeToggle.stories.tsx`, `frontend/tests/components/DarkModeToggle.test.tsx`.

**Modified (frontend tests — store consumers):**
- `frontend/tests/components/AppShell.test.tsx` — switch `useTweaksStore` setup/teardown to `useUiStore`.
- `frontend/tests/components/ChatComposer.test.tsx` — switch `useModelStore` mock to seeded TanStack Query cache.
- `frontend/tests/components/ChatPanel.test.tsx` — same.
- `frontend/tests/components/ModelPicker.test.tsx` — same; assert PATCH fires on selection.
- `frontend/tests/components/Settings.appearance.test.tsx` — drop `useTweaksStore` mocks; rely on Query cache.
- `frontend/tests/components/Settings.models.test.tsx` — drop `useModelStore`/`useParamsStore` mocks; rely on Query cache.
- Any other tests that import from the deleted stores — locate and update.

**Modified (frontend stories):**
- Stories that seed deleted Zustand stores need rewiring. Locate via `grep -rl "useTweaksStore\|useParamsStore\|useModelStore" frontend/src/**/*.stories.tsx`. Update each to wrap in a `<QueryClientProvider>` with seeded `userSettingsQueryKey` data. Delete decoration-only stories that don't add value.

**Backend:**
- `backend/src/routes/user-settings.routes.ts` — Step-1 reconciliation. Backend `DEFAULT_SETTINGS` already drifts from spec defaults; resolve in Step 1.

---

## Conventions to follow

- **Test files** under `frontend/tests/` mirroring source paths (project pattern).
- **TypeScript strict** — no `any`.
- **Commit messages**: `[refactor] <short description>` (this is a refactor branch; a simple consistent prefix mirrors the previous branch's `[debug]` convention).
- **Don't run `make test` per task.** Use targeted `npx vitest run <path>` per change. Full-suite runs once at each Step boundary.
- **Don't introduce new dependencies.** All scope is internal.
- **No backwards-compat branches** — per CLAUDE.md and the spec's "no migration" decision. Localstorage reads from old keys (`inkwell:darkMode`, `inkwell:selectedModelId`) are simply not added.

---

## Step 1 — Foundations + backend cross-check

### Task 1.1: Backend default reconciliation (DECISION GATE)

**Important:** Backend defaults at [backend/src/routes/user-settings.routes.ts:74-87](backend/src/routes/user-settings.routes.ts#L74-L87) drift from the spec's intended `DEFAULT_SETTINGS`. The drift table:

| Field | Backend (current) | Spec (intended) |
|---|---|---|
| `prose.font` | `'Lora'` | `'iowan'` |
| `writing.smartQuotes` | `false` | `true` |
| `writing.emDashExpansion` | `false` | `true` |
| `chat.temperature` | `0.8` | `0.85` |
| `chat.topP` | `1` | `0.95` |
| `chat.maxTokens` | `2048` | `800` |

This is more than a one-line fix and the spec says "stop and ask" in that case.

**Files:**
- Modify: `backend/src/routes/user-settings.routes.ts:74-87` after the user picks a side.

- [ ] **Step 1: Stop and ask the user**

Surface the drift table verbatim and ask which side is canonical. Possible outcomes:
- (a) Backend wins — frontend's `DEFAULT_SETTINGS` mirrors the existing backend values; the rest of the plan uses `'Lora'`, `0.8`, `1`, `2048`, etc.
- (b) Spec wins — backend `DEFAULT_SETTINGS` is updated to match the spec values (`'iowan'`, `0.85`, `0.95`, `800`, `smartQuotes: true`, `emDashExpansion: true`).
- (c) Mixed — pick per field.

Until the user decides, do NOT proceed past this task. Document the decision in this task's body before continuing so subsequent tasks reference the agreed values.

- [ ] **Step 2: Apply the chosen reconciliation**

If (a): no backend change. Update the spec's planned `DEFAULT_SETTINGS` table in this plan inline and continue.

If (b) or (c): edit `backend/src/routes/user-settings.routes.ts:74-87` to the agreed values.

```ts
const DEFAULT_SETTINGS = {
  theme: 'paper' as const,
  prose: { font: '<agreed>', size: 18, lineHeight: 1.6 },
  writing: {
    spellcheck: true,
    typewriterMode: false,
    focusMode: false,
    dailyWordGoal: 0,
    smartQuotes: <agreed>,
    emDashExpansion: <agreed>,
  },
  chat: { model: null as string | null, temperature: <agreed>, topP: <agreed>, maxTokens: <agreed> },
  ai: { includeVeniceSystemPrompt: true },
};
```

- [ ] **Step 3: Verify backend tests still pass**

Run: `cd backend && npm test`
Expected: pass. If a test asserted specific old defaults, update the assertion to the new defaults.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/user-settings.routes.ts <test files if any>
git commit -m "[refactor] reconcile UserSettings defaults"
```

(Skip the commit if outcome was (a) — no backend change.)

### Task 1.2: Add `DEFAULT_SETTINGS`, `mergeSettings`, `useUserSettings`, `useUpdateUserSetting`

**Files:**
- Modify: `frontend/src/hooks/useUserSettings.ts` — append new exports
- Create: `frontend/tests/hooks/useUserSettings.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/hooks/useUserSettings.test.ts`:

```ts
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  type UserSettings,
  mergeSettings,
  useUpdateUserSetting,
  useUserSettings,
  userSettingsQueryKey,
} from '@/hooks/useUserSettings';
import { resetApiClientForTests, setAccessToken } from '@/lib/api';
import { useErrorStore } from '@/store/errors';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeWrapper(qc: QueryClient): (props: { children: ReactNode }) => JSX.Element {
  return function Wrapper({ children }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('mergeSettings', () => {
  it('returns prev unchanged when patch is empty', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {});
    expect(merged).toEqual(DEFAULT_SETTINGS);
  });

  it('overrides top-level theme', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { theme: 'dark' });
    expect(merged.theme).toBe('dark');
    expect(merged.prose).toEqual(DEFAULT_SETTINGS.prose);
  });

  it('one-level-merges nested groups (prose.font without losing prose.size)', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { prose: { font: 'palatino' } });
    expect(merged.prose.font).toBe('palatino');
    expect(merged.prose.size).toBe(DEFAULT_SETTINGS.prose.size);
    expect(merged.prose.lineHeight).toBe(DEFAULT_SETTINGS.prose.lineHeight);
  });

  it('one-level-merges chat (model only without losing temperature/topP/maxTokens)', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { chat: { model: 'venice-uncensored' } });
    expect(merged.chat.model).toBe('venice-uncensored');
    expect(merged.chat.temperature).toBe(DEFAULT_SETTINGS.chat.temperature);
    expect(merged.chat.topP).toBe(DEFAULT_SETTINGS.chat.topP);
    expect(merged.chat.maxTokens).toBe(DEFAULT_SETTINGS.chat.maxTokens);
  });

  it('one-level-merges writing (spellcheck without losing other writing flags)', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { writing: { spellcheck: false } });
    expect(merged.writing.spellcheck).toBe(false);
    expect(merged.writing.smartQuotes).toBe(DEFAULT_SETTINGS.writing.smartQuotes);
  });

  it('one-level-merges ai', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { ai: { includeVeniceSystemPrompt: false } });
    expect(merged.ai.includeVeniceSystemPrompt).toBe(false);
  });
});

describe('useUserSettings', () => {
  it('returns DEFAULT_SETTINGS while loading', () => {
    const qc = new QueryClient();
    const { result } = renderHook(() => useUserSettings(), { wrapper: makeWrapper(qc) });
    expect(result.current).toEqual(DEFAULT_SETTINGS);
  });

  it('returns the cached settings once the query resolves', async () => {
    const fakeSettings: UserSettings = {
      ...DEFAULT_SETTINGS,
      theme: 'sepia',
      chat: { ...DEFAULT_SETTINGS.chat, model: 'venice-uncensored' },
    };
    const qc = new QueryClient();
    qc.setQueryData(userSettingsQueryKey, fakeSettings);
    const { result } = renderHook(() => useUserSettings(), { wrapper: makeWrapper(qc) });
    expect(result.current.theme).toBe('sepia');
    expect(result.current.chat.model).toBe('venice-uncensored');
  });
});

describe('useUpdateUserSetting', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetApiClientForTests();
    setAccessToken('tok');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    act(() => {
      useErrorStore.getState().clear();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientForTests();
    act(() => {
      useErrorStore.getState().clear();
    });
  });

  it('optimistically updates the cache before the PATCH resolves', async () => {
    const qc = new QueryClient();
    qc.setQueryData(userSettingsQueryKey, DEFAULT_SETTINGS);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { settings: { ...DEFAULT_SETTINGS, theme: 'dark' } }),
    );
    const { result } = renderHook(() => useUpdateUserSetting(), { wrapper: makeWrapper(qc) });
    act(() => {
      result.current.mutate({ theme: 'dark' });
    });
    // Synchronous: cache is already updated before await.
    expect(qc.getQueryData<UserSettings>(userSettingsQueryKey)?.theme).toBe('dark');
  });

  it('rolls back the cache + publishes to useErrorStore on PATCH failure', async () => {
    const qc = new QueryClient();
    qc.setQueryData(userSettingsQueryKey, DEFAULT_SETTINGS);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(500, { error: { message: 'boom', code: 'internal_error' } }),
    );
    const { result } = renderHook(() => useUpdateUserSetting(), { wrapper: makeWrapper(qc) });
    act(() => {
      result.current.mutate({ theme: 'dark' });
    });
    await waitFor(() => {
      expect(useErrorStore.getState().errors).toHaveLength(1);
    });
    expect(qc.getQueryData<UserSettings>(userSettingsQueryKey)?.theme).toBe('paper');
    expect(useErrorStore.getState().errors[0].source).toBe('settings.update');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/hooks/useUserSettings.test.ts`
Expected: FAIL — `DEFAULT_SETTINGS`, `mergeSettings`, `useUserSettings`, `useUpdateUserSetting` not exported yet.

- [ ] **Step 3: Add the new exports to `useUserSettings.ts`**

Append to `frontend/src/hooks/useUserSettings.ts` (after the existing `useUpdateUserSettingsMutation` definition):

```ts
import { useMemo } from 'react';
import { useErrorStore } from '@/store/errors';

/**
 * Single canonical default settings for the whole app. Backend defaults at
 * `backend/src/routes/user-settings.routes.ts` MUST stay in sync with this
 * constant (Task 1.1 reconciliation). Tests assert specific values, so any
 * drift is caught at CI time.
 */
export const DEFAULT_SETTINGS: UserSettings = {
  theme: '<agreed-theme>',
  prose: { font: '<agreed-font>', size: 18, lineHeight: 1.6 },
  writing: {
    spellcheck: true,
    typewriterMode: false,
    focusMode: false,
    dailyWordGoal: 0,
    smartQuotes: <agreed>,
    emDashExpansion: <agreed>,
  },
  chat: { model: null, temperature: <agreed>, topP: <agreed>, maxTokens: <agreed> },
  ai: { includeVeniceSystemPrompt: true },
};

/**
 * One-level-deep merge: top-level `theme` is overridden whole; nested groups
 * (`prose`, `writing`, `chat`, `ai`) are merged field-by-field so a partial
 * patch like `{ prose: { font: 'palatino' } }` doesn't clobber `prose.size`.
 *
 * Concurrent mutations: each `useUpdateUserSetting().mutate(...)` snapshots
 * its own pre-state in `onMutate`, so a failed mutation rolls back to its
 * own snapshot, not the latest cache value. Acceptable for the rapid-clicks
 * case (each rollback is the user-intended undo of that specific click).
 */
export function mergeSettings(
  prev: UserSettings,
  patch: UserSettingsPatch,
): UserSettings {
  return {
    theme: patch.theme ?? prev.theme,
    prose: { ...prev.prose, ...(patch.prose ?? {}) },
    writing: { ...prev.writing, ...(patch.writing ?? {}) },
    chat: { ...prev.chat, ...(patch.chat ?? {}) },
    ai: { ...prev.ai, ...(patch.ai ?? {}) },
  };
}

/**
 * Read API for settings. Always returns a definite-shape `UserSettings` —
 * defaults are filled in from `DEFAULT_SETTINGS` while the query is loading
 * or has errored. Consumers don't need to handle the loading state.
 */
export function useUserSettings(): UserSettings {
  const { data } = useUserSettingsQuery();
  return data ?? DEFAULT_SETTINGS;
}

/**
 * Write API for settings. Optimistic: snapshots the cache, applies the
 * merged patch synchronously, then PATCHes. On error, restores the
 * snapshot and pushes a `severity:'error'` entry to `useErrorStore` with
 * `source: 'settings.update'` so the dev overlay surfaces the failure.
 */
export interface UseUpdateUserSettingResult {
  mutate: (patch: UserSettingsPatch) => void;
  isPending: boolean;
}

export function useUpdateUserSetting(): UseUpdateUserSettingResult {
  const qc = useQueryClient();
  const mutation = useUpdateUserSettingsMutation();
  return useMemo(
    () => ({
      mutate: (patch: UserSettingsPatch): void => {
        const prev = qc.getQueryData<UserSettings>(userSettingsQueryKey) ?? DEFAULT_SETTINGS;
        qc.setQueryData<UserSettings>(userSettingsQueryKey, mergeSettings(prev, patch));
        mutation.mutate(patch, {
          onError: (err) => {
            qc.setQueryData<UserSettings>(userSettingsQueryKey, prev);
            useErrorStore.getState().push({
              severity: 'error',
              source: 'settings.update',
              code: null,
              message: err instanceof Error ? err.message : 'Failed to save setting.',
              detail: err,
            });
          },
        });
      },
      isPending: mutation.isPending,
    }),
    [mutation, qc],
  );
}
```

The `<agreed-...>` placeholders MUST be replaced with the values agreed in Task 1.1. If outcome was (a) backend-wins, use the backend's existing values; if (b) spec-wins, use the spec's values.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/hooks/useUserSettings.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useUserSettings.ts frontend/tests/hooks/useUserSettings.test.ts
git commit -m "[refactor] add useUserSettings + useUpdateUserSetting wrappers"
```

### Task 1.3: Add `useUiStore`

**Files:**
- Create: `frontend/src/store/ui.ts`
- Create: `frontend/tests/store/ui.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/store/ui.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useUiStore } from '@/store/ui';

afterEach(() => {
  act(() => {
    useUiStore.getState().setLayout('three-col');
  });
});

describe('useUiStore', () => {
  it('defaults layout to three-col', () => {
    const { result } = renderHook(() => useUiStore());
    expect(result.current.layout).toBe('three-col');
  });

  it('setLayout updates layout', () => {
    const { result } = renderHook(() => useUiStore());
    act(() => {
      result.current.setLayout('focus');
    });
    expect(result.current.layout).toBe('focus');
  });

  it('layout accepts the three documented values', () => {
    const { result } = renderHook(() => useUiStore());
    act(() => {
      result.current.setLayout('nochat');
    });
    expect(result.current.layout).toBe('nochat');
    act(() => {
      result.current.setLayout('three-col');
    });
    expect(result.current.layout).toBe('three-col');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/store/ui.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `useUiStore`**

Create `frontend/src/store/ui.ts`:

```ts
import { create } from 'zustand';

/**
 * Ephemeral UI state. Pure in-memory — defaults reset on every page load
 * by design (layout / focus mode are session affordances, not persistent
 * preferences).
 *
 * Persistent settings (theme, proseFont, AI params, model) live in the
 * TanStack Query cache via `useUserSettings`/`useUpdateUserSetting`, NOT
 * here. If you find yourself adding a field that should survive reloads,
 * it belongs in `UserSettings` instead.
 */

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

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/store/ui.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/ui.ts frontend/tests/store/ui.test.ts
git commit -m "[refactor] add useUiStore for ephemeral UI state (layout)"
```

### Task 1.4: App-root settings cache warm-up

**Files:**
- Modify: `frontend/src/router.tsx` — add a `useUserSettingsQuery()` call inside `AppRouter` after `useInitAuth()`, gated on authenticated session.

- [ ] **Step 1: Read the current `router.tsx`**

Open `/home/asg/projects/story-editor/frontend/src/router.tsx`. Locate the `AppRouter` function. The body currently calls `useInitAuth()` at the top and then renders the `<QueryClientProvider>`/`<Routes>` tree.

- [ ] **Step 2: Add the warm-up call**

The query has to live INSIDE the `<QueryClientProvider>` because hooks need the provider's context. Wrap the warm-up in a small inner component so the order is correct:

Add this small helper at the top of `router.tsx` (before `AppRouter`):

```tsx
function SettingsWarmup(): null {
  const status = useSessionStore((s) => s.status);
  // Trigger the user-settings query as soon as the user is authenticated so
  // the first render of editor / settings surfaces uses backend data, not
  // DEFAULT_SETTINGS. Discarding the return value is intentional — this hook
  // exists only for its side-effect of populating the Query cache.
  useUserSettingsQuery({ enabled: status === 'authenticated' });
  return null;
}
```

Add the import at the top of the file:

```ts
import { useUserSettingsQuery } from '@/hooks/useUserSettings';
```

`useSessionStore` is already imported. Then inside `AppRouter`, mount `<SettingsWarmup />` as a sibling of `<Routes>`:

```tsx
return (
  <QueryClientProvider client={client}>
    <SettingsWarmup />
    <Routes>
      ...
    </Routes>
    {ReactQueryDevtoolsLazy && isDebugMode() ? (...) : null}
  </QueryClientProvider>
);
```

If `useUserSettingsQuery` doesn't accept an `enabled` option today, pass `{ enabled: status === 'authenticated' }` to `useQuery` inside the hook. Inspect the existing definition first:

```ts
// frontend/src/hooks/useUserSettings.ts (current shape — do not duplicate; modify if needed)
export function useUserSettingsQuery(): UseQueryResult<UserSettings, Error> { ... }
```

The current signature has no options. To support the gate without changing every other call site, change the signature to:

```ts
export function useUserSettingsQuery(
  options: { enabled?: boolean } = {},
): UseQueryResult<UserSettings, Error> {
  return useQuery({
    queryKey: userSettingsQueryKey,
    queryFn: async (): Promise<UserSettings> => {
      const res = await api<SettingsEnvelope>('/users/me/settings');
      return res.settings;
    },
    enabled: options.enabled,
  });
}
```

Note: `enabled: undefined` is treated by TanStack Query as `true`, so existing call sites that pass no argument keep their current behaviour.

- [ ] **Step 3: Run typecheck and the existing settings + router tests**

Run: `cd frontend && npx tsc -b --noEmit && npx vitest run tests/components/Settings.appearance.test.tsx tests/components/Settings.models.test.tsx tests/hooks/useUserSettings.test.ts tests/routing.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/router.tsx frontend/src/hooks/useUserSettings.ts
git commit -m "[refactor] warm settings cache at app root once authenticated"
```

### Task 1.5: Step 1 verification gate

- [ ] **Run the full frontend suite**

Run: `cd frontend && npm test`
Expected: PASS, no regressions. (Existing Settings tab seed effect still works because we haven't migrated those tabs yet.)

- [ ] **Run the full backend suite**

Run: `cd backend && npm test`
Expected: PASS.

---

## Step 2 — Migrate consumers

### Task 2.1: Migrate `EditorPage`, `ChatPanel`, `ChatComposer`

These are read-only consumers of `useModelStore`/`useParamsStore`. Switch them to read from `useUserSettings()`. Note: `EditorPage` was just changed in commit `d61ff6d` (the AI branch's model bug fix); the new code reads `useModelStore((s) => s.modelId)` — replace with `useUserSettings().chat.model`.

**Files:**
- Modify: `frontend/src/pages/EditorPage.tsx`
- Modify: `frontend/src/components/ChatPanel.tsx`
- Modify: `frontend/src/components/ChatComposer.tsx`

- [ ] **Step 1: Update `EditorPage.tsx`**

Replace the import:
```ts
// Before
import { useModelStore } from '@/store/model';
// After
import { useUserSettings } from '@/hooks/useUserSettings';
```

Replace the read line (currently `const selectedModelId = useModelStore((s) => s.modelId);` near line 158):
```ts
const selectedModelId = useUserSettings().chat.model;
```

The deps array of `handleChatSend` (currently includes `selectedModelId`) is unchanged because `selectedModelId` is still a string.

- [ ] **Step 2: Update `ChatPanel.tsx`**

Find the imports:
```ts
import { useModelStore } from '@/store/model';
import { useParamsStore } from '@/store/params';
```

Replace with:
```ts
import { useUserSettings } from '@/hooks/useUserSettings';
```

Find the body reads (currently around lines 164-167):
```ts
const modelId = useModelStore((s) => s.modelId);
const { data: models } = useModelsQuery();
const params = useParamsStore((s) => s.params);
```

Replace with:
```ts
const settings = useUserSettings();
const modelId = settings.chat.model;
const { data: models } = useModelsQuery();
const params = settings.chat;  // ChatPanel reads params.temperature/topP/maxTokens
```

Wait — verify the `params` shape. The display row uses `params.temperature` / `params.topP` / `params.maxTokens` (per the existing `data-testid="model-params"` template). `settings.chat` includes `model` which `params` doesn't, but the template only reads the three numeric fields. Acceptable — no UI change.

If TS complains about `params: { temperature, topP, maxTokens }` no longer matching the old `ParamsValue` (which had `frequencyPenalty`), inline-destructure instead:
```ts
const { temperature, topP, maxTokens } = settings.chat;
```
And update the template accordingly:
```tsx
{`temp ${temperature}  top_p ${topP}  max ${maxTokens}`}
```

- [ ] **Step 3: Update `ChatComposer.tsx`**

Find the import:
```ts
import { useModelStore } from '@/store/model';
```

Replace with:
```ts
import { useUserSettings } from '@/hooks/useUserSettings';
```

Find the read line (currently `const modelId = useModelStore((s) => s.modelId);` around line 133):
```ts
const modelId = useUserSettings().chat.model;
```

- [ ] **Step 4: Run the affected tests (they will FAIL until Task 2.6 updates them)**

Run: `cd frontend && npx vitest run tests/components/ChatPanel.test.tsx tests/components/ChatComposer.test.tsx`
Expected: TESTS LIKELY FAIL because they seed `useModelStore.setState({...})` which is irrelevant after this change. The fix lives in Task 2.6 (test migration). For now, confirm the code compiles:
Run: `cd frontend && npx tsc -b --noEmit`
Expected: clean.

If the implementer prefers to keep the test suite green at every step, fold the matching parts of Task 2.6 into this commit. Either path is acceptable; the cleaner branch history results from doing all consumer edits first then test edits, but the implementer can choose.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/EditorPage.tsx \
        frontend/src/components/ChatPanel.tsx \
        frontend/src/components/ChatComposer.tsx
git commit -m "[refactor] EditorPage/ChatPanel/ChatComposer read settings via useUserSettings"
```

### Task 2.2: Migrate `ModelPicker` (reads + WRITES — multi-device fix lands here)

**Files:**
- Modify: `frontend/src/components/ModelPicker.tsx`

- [ ] **Step 1: Update `ModelPicker.tsx`**

Replace the import:
```ts
// Before
import { useModelStore } from '@/store/model';
// After
import { useUpdateUserSetting, useUserSettings } from '@/hooks/useUserSettings';
```

Replace the body reads + write (currently lines 28-35):
```tsx
const modelId = useModelStore((s) => s.modelId);
const setModelId = useModelStore((s) => s.setModelId);

const { data: models, isLoading, isError, error } = useModelsQuery();

const handleSelect = (id: string): void => {
  setModelId(id);
  onClose();
};
```

With:
```tsx
const modelId = useUserSettings().chat.model;
const updateSetting = useUpdateUserSetting();

const { data: models, isLoading, isError, error } = useModelsQuery();

const handleSelect = (id: string): void => {
  updateSetting.mutate({ chat: { model: id } });
  onClose();
};
```

That's the multi-device-sync fix: every model pick now PATCHes the backend.

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ModelPicker.tsx
git commit -m "[refactor] ModelPicker writes via useUpdateUserSetting (fixes multi-device drift)"
```

### Task 2.3: Migrate `SettingsAppearanceTab`

This tab currently does dual-write (`useTweaksStore.setTweaks` + `useUpdateUserSettingsMutation.mutate`) and has a one-shot seed effect from the backend. After migration: only `useUpdateUserSetting().mutate` writes, the cache update is the source of truth, the seed effect deletes.

**Files:**
- Modify: `frontend/src/components/SettingsAppearanceTab.tsx`

- [ ] **Step 1: Read the file end-to-end**

Open `/home/asg/projects/story-editor/frontend/src/components/SettingsAppearanceTab.tsx`. Note all `useTweaksStore` calls and the `useEffect` that mirrors backend → tweaks store (currently around lines 211-232).

- [ ] **Step 2: Replace imports**

```ts
// Before
import { useUpdateUserSettingsMutation, useUserSettingsQuery } from '@/hooks/useUserSettings';
import { type ProseFont, type Theme, useTweaksStore } from '@/store/tweaks';
// After
import { useUpdateUserSetting, useUserSettings } from '@/hooks/useUserSettings';
```

The `Theme` and `ProseFont` types previously lived in `@/store/tweaks`. After deletion (Task 3) those types live elsewhere. Define them inline in this file (since they're only used here and in `SettingsModelsTab` — Task 2.4 will re-import them from here, or they can also be inlined there):

At the top of the file, after the imports:
```ts
export type Theme = 'paper' | 'sepia' | 'dark';
export type ProseFont = 'iowan' | 'palatino' | 'garamond' | 'plex-serif';
```

Verify these are the only consumers via:
`grep -rn "from '@/store/tweaks'" frontend/src/`
If any other file uses `Theme` or `ProseFont` (likely none after Task 2.5 migrates `AppShell`/`useFocusToggle`/`askAi`), update those imports to point at `'@/components/SettingsAppearanceTab'`.

- [ ] **Step 3: Replace the body**

Find the section (around lines 199-202):
```ts
const settingsQuery = useUserSettingsQuery();
const updateSettings = useUpdateUserSettingsMutation();
const tweaks = useTweaksStore((s) => s.tweaks);
const setTweaks = useTweaksStore((s) => s.setTweaks);

const settings = settingsQuery.data;
const settingsLoading = settings == null;
```

Replace with:
```ts
const settings = useUserSettings();
const updateSetting = useUpdateUserSetting();
const settingsLoading = false;  // useUserSettings returns DEFAULT_SETTINGS while loading
```

If `settingsLoading` was used to gate UI (e.g. disable controls), confirm whether the fallback-to-defaults behaviour is acceptable. If it is (the user's edits during the brief loading window will optimistically update the cache), simply remove the `settingsLoading` gate. If it isn't, expose a separate `isLoading` from `useUserSettings`:

```ts
// Optional alternative: read isLoading separately from the underlying query.
const { isLoading: settingsLoading } = useUserSettingsQuery();
const settings = useUserSettings();
```

The cleanest is to drop `settingsLoading` entirely. Confirm UI behaviour by inspecting any references. Apply whichever path keeps existing UX.

Delete the `seededThemeRef` + the entire seed `useEffect` block (currently around lines 211-232) — no longer needed because `useUserSettings()` already returns the merged-with-defaults value, and the optimistic-update wrapper keeps the cache in sync without the manual mirror.

- [ ] **Step 4: Replace the writers**

Find handlers like:
```ts
const handleThemeSelect = (theme: Theme): void => {
  setTweaks({ theme });
  applyTheme(theme);
  updateSettings.mutate({ theme });
};

const handleFontChange = (e: ChangeEvent<HTMLSelectElement>): void => {
  const next = e.target.value as ProseFont;
  setTweaks({ proseFont: next });
  applyProseFont(fontStackFor(next));
  updateSettings.mutate({ prose: { font: next } });
};
```

Replace with single-write versions:
```ts
const handleThemeSelect = (theme: Theme): void => {
  applyTheme(theme);
  updateSetting.mutate({ theme });
};

const handleFontChange = (e: ChangeEvent<HTMLSelectElement>): void => {
  const next = e.target.value as ProseFont;
  applyProseFont(fontStackFor(next));
  updateSetting.mutate({ prose: { font: next } });
};
```

Apply the same simplification to the prose-size and prose-line-height slider handlers. The DOM-side-effect helpers (`applyTheme`, `applyProseFont`, `applyProseSize`, `applyProseLineHeight`) remain.

- [ ] **Step 5: Read-side updates**

Anywhere the file reads `tweaks.theme` or `tweaks.proseFont`, replace with `settings.theme` and `fontIdFromStored(settings.prose.font)` respectively. Check via:
`grep -n "tweaks\." frontend/src/components/SettingsAppearanceTab.tsx`
After the change, the grep should return no matches.

- [ ] **Step 6: Verify it compiles**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/SettingsAppearanceTab.tsx
git commit -m "[refactor] SettingsAppearanceTab uses useUserSettings + useUpdateUserSetting"
```

### Task 2.4: Migrate `SettingsModelsTab`

**Files:**
- Modify: `frontend/src/components/SettingsModelsTab.tsx`

- [ ] **Step 1: Replace imports**

```ts
// Before
import { useUpdateUserSettingsMutation, useUserSettingsQuery } from '@/hooks/useUserSettings';
import { useModelStore } from '@/store/model';
import { useParamsStore } from '@/store/params';
// After
import { useUpdateUserSetting, useUserSettings } from '@/hooks/useUserSettings';
```

- [ ] **Step 2: Replace the model-list body**

Find:
```tsx
const modelId = useModelStore((s) => s.modelId);
const setModelId = useModelStore((s) => s.setModelId);

const modelsQuery = useModelsQuery();
const settingsQuery = useUserSettingsQuery();
const updateSettings = useUpdateUserSettingsMutation();

const handleSelectModel = (id: string): void => {
  setModelId(id);
  updateSettings.mutate({ chat: { model: id } });
};
```

Replace with:
```tsx
const settings = useUserSettings();
const modelId = settings.chat.model;
const modelsQuery = useModelsQuery();
const updateSetting = useUpdateUserSetting();

const handleSelectModel = (id: string): void => {
  updateSetting.mutate({ chat: { model: id } });
};
```

- [ ] **Step 3: Replace the params section**

Find the section around lines 139-178 (params body + slider handlers):

```tsx
const params = useParamsStore((s) => s.params);
const setParams = useParamsStore((s) => s.setParams);

// debounced PATCH ... reads paramsRef.current
const paramsRef = useRef(params);
useEffect(() => { paramsRef.current = params; }, [params]);

const flushParams = useDebouncedCallback((): void => {
  const p = paramsRef.current;
  updateSettings.mutate({ chat: { temperature: p.temperature, topP: p.topP, maxTokens: p.maxTokens } });
}, 200);

const onTemperature = (v: number): void => { setParams({ temperature: v }); flushParams(); };
const onTopP = (v: number): void => { setParams({ topP: v }); flushParams(); };
const onMaxTokens = (v: number): void => { setParams({ maxTokens: Math.round(v) }); flushParams(); };
const onFrequencyPenalty = (v: number): void => { setParams({ frequencyPenalty: v }); };
```

Replace with:
```tsx
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
const onFrequencyPenalty = (_v: number): void => {
  // [B11] backend `chat` settings shape doesn't carry frequencyPenalty.
  // Intentionally a no-op — the slider stays in the UI but doesn't persist.
  // When the schema lands, swap to `updateSetting.mutate({ chat: { frequencyPenalty: _v } })`.
};
```

The optimistic update means each slider change updates the cache synchronously and the underlying mutation handles the PATCH. We've LOST the 200ms debounce — every slider tick fires a PATCH. **Decision required:**
- (i) Acceptable — accept 30+ PATCHes per drag; trivial bandwidth, the backend serialises them.
- (ii) Reintroduce debounce — wrap `updateSetting.mutate` calls in the existing `useDebouncedCallback` for the three slider handlers (temperature, topP, maxTokens). Optimistic update still happens synchronously inside `useUpdateUserSetting`, so the UI feels instant; only the network PATCH is debounced.

Recommended: (ii). Keep the debounced PATCH. Rewrite to:
```tsx
const flushTemperature = useDebouncedCallback((v: number) => {
  updateSetting.mutate({ chat: { temperature: v } });
}, 200);
const onTemperature = (v: number): void => {
  flushTemperature(v);
};
// Same pattern for topP and maxTokens.
```

But this loses the optimistic UI update because we've moved the cache write inside the debounce. To keep both: optimistic immediate + debounced PATCH:
```tsx
const handleSliderChange = (patch: UserSettingsPatch): void => {
  // Optimistic cache update — synchronous, slider re-renders immediately.
  qc.setQueryData<UserSettings>(
    userSettingsQueryKey,
    mergeSettings(qc.getQueryData<UserSettings>(userSettingsQueryKey) ?? DEFAULT_SETTINGS, patch),
  );
  // Debounced PATCH (network).
  flushPatch(patch);
};
```

This duplicates the optimistic logic from `useUpdateUserSetting`. Cleanest fix: extend `useUpdateUserSetting` with a `mutateDebounced(patch, delayMs)` variant. **Out of scope for this task** — pick option (i) for now (every slider tick PATCHes), document the trade-off in a comment, and file a follow-up if PATCH frequency becomes a problem.

Apply option (i): each slider handler calls `updateSetting.mutate({ chat: {<field>: v}})` directly, no debounce. Add this comment above the handlers:
```ts
// Each slider tick PATCHes synchronously. Acceptable for the local-server
// dev case; if PATCH frequency becomes an issue in production, add a
// `mutateDebounced` variant to `useUpdateUserSetting` and wrap these calls.
```

Drop the now-unused `paramsRef`, the `useEffect` that mirrors it, and the `flushParams` helper. The `useDebouncedCallback` helper itself can stay (still used by the prose sliders in `SettingsAppearanceTab`? — verify; if not, can be deleted as part of this task).

- [ ] **Step 4: Verify it compiles**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/SettingsModelsTab.tsx
git commit -m "[refactor] SettingsModelsTab uses useUserSettings + useUpdateUserSetting"
```

### Task 2.5: Migrate `AppShell`, `useFocusToggle`, `lib/askAi.ts` to `useUiStore`

These three reach for `useTweaksStore.layout`. Switch them to `useUiStore`.

**Files:**
- Modify: `frontend/src/components/AppShell.tsx`
- Modify: `frontend/src/hooks/useFocusToggle.ts`
- Modify: `frontend/src/lib/askAi.ts`

- [ ] **Step 1: Update `AppShell.tsx`**

Replace:
```ts
import { useTweaksStore } from '@/store/tweaks';
// ...
const layout = useTweaksStore((s) => s.tweaks.layout);
```

With:
```ts
import { useUiStore } from '@/store/ui';
// ...
const layout = useUiStore((s) => s.layout);
```

- [ ] **Step 2: Update `useFocusToggle.ts`**

Read the file first to identify the exact pattern. The hook reads `tweaks.layout` and writes via `setTweaks({ layout: ... })`. Replace:
```ts
import { useTweaksStore } from '@/store/tweaks';
// ...
const layout = useTweaksStore((s) => s.tweaks.layout);
const setTweaks = useTweaksStore((s) => s.setTweaks);
// ...
setTweaks({ layout: 'focus' });
```

With:
```ts
import { useUiStore } from '@/store/ui';
// ...
const layout = useUiStore((s) => s.layout);
const setLayout = useUiStore((s) => s.setLayout);
// ...
setLayout('focus');
```

- [ ] **Step 3: Update `lib/askAi.ts`**

Replace lines 4 and 46-49:
```ts
// Before
import { useTweaksStore } from '@/store/tweaks';
// ...
const { tweaks, setTweaks } = useTweaksStore.getState();
if (tweaks.layout !== 'three-col') {
  setTweaks({ layout: 'three-col' });
}
```

With:
```ts
import { useUiStore } from '@/store/ui';
// ...
const ui = useUiStore.getState();
if (ui.layout !== 'three-col') {
  ui.setLayout('three-col');
}
```

- [ ] **Step 4: Verify it compiles**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AppShell.tsx \
        frontend/src/hooks/useFocusToggle.ts \
        frontend/src/lib/askAi.ts
git commit -m "[refactor] route layout reads/writes through useUiStore"
```

### Task 2.6: Update tests that reference deleted stores

The tests that mock `useTweaksStore`/`useParamsStore`/`useModelStore` directly need updating BEFORE Step 3 deletes those modules, otherwise the test files will fail to import. Identify and update each.

**Files (locate and edit each):**
- `frontend/tests/components/AppShell.test.tsx` — switch `useTweaksStore` setup to `useUiStore`.
- `frontend/tests/components/ChatComposer.test.tsx` — drop `useModelStore` import; mock backend settings via Query cache.
- `frontend/tests/components/ChatPanel.test.tsx` — same.
- `frontend/tests/components/ModelPicker.test.tsx` — same; add an assertion that the PATCH fires on selection.
- `frontend/tests/components/Settings.appearance.test.tsx` — drop `useTweaksStore` mocks; rely on Query cache.
- `frontend/tests/components/Settings.models.test.tsx` — same for `useModelStore`/`useParamsStore`.
- `frontend/tests/store/model.test.ts` — DELETE in Task 3.1 (don't update; whole file goes).
- `frontend/tests/store/tweaks.test.ts` (if present) — DELETE in Task 3.1.
- `frontend/tests/store/params.test.ts` (if present) — DELETE in Task 3.1.

- [ ] **Step 1: Locate every consumer of the deleted stores in test files**

Run:
```bash
grep -rln "useTweaksStore\|useParamsStore\|useModelStore" frontend/tests/
```

Cross-reference against the file list above. Add any test file that grep finds but the list misses; remove any list entry the grep doesn't find.

- [ ] **Step 2: Update `AppShell.test.tsx`**

Replace `useTweaksStore` references. The existing setup likely does:
```ts
import { useTweaksStore } from '@/store/tweaks';
// In beforeEach or setUp:
useTweaksStore.setState({
  tweaks: { theme: 'paper', layout: 'three-col', proseFont: 'iowan' },
  setTweaks: useTweaksStore.getState().setTweaks,
});
// In test bodies:
useTweaksStore.getState().setTweaks({ layout: 'nochat' });
expect(useTweaksStore.getState().tweaks.layout).toBe('focus');
```

Replace with:
```ts
import { useUiStore } from '@/store/ui';
// In beforeEach or setUp:
useUiStore.setState({ layout: 'three-col', setLayout: useUiStore.getState().setLayout });
// In test bodies:
useUiStore.getState().setLayout('nochat');
expect(useUiStore.getState().layout).toBe('focus');
```

(Theme/proseFont don't apply to `AppShell` — only `layout` does.)

- [ ] **Step 3: Update `ChatComposer.test.tsx`, `ChatPanel.test.tsx`, `ModelPicker.test.tsx`**

These tests mock `useModelStore` to seed a model id. Replace with seeding the TanStack Query cache:

```ts
// Before
import { useModelStore } from '@/store/model';
// In beforeEach:
useModelStore.setState({ modelId: 'venice-uncensored-1.5' });

// After
import { DEFAULT_SETTINGS, userSettingsQueryKey } from '@/hooks/useUserSettings';
// In beforeEach (after the QueryClient is created):
queryClient.setQueryData(userSettingsQueryKey, {
  ...DEFAULT_SETTINGS,
  chat: { ...DEFAULT_SETTINGS.chat, model: 'venice-uncensored-1.5' },
});
```

The `renderWithProviders` helper in those test files already supports passing a custom `QueryClient` (per the existing pattern). If a test creates the client inline, hoist creation to access the seeding API.

For `ModelPicker.test.tsx`: add a new test asserting that selecting a model fires the PATCH. The file already uses `vi.stubGlobal('fetch', fetchMock)` — extend the mock to expect a PATCH:

```tsx
it('PATCHes /users/me/settings on model selection (multi-device fix)', async () => {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (url.endsWith('/ai/models')) {
      return Promise.resolve(jsonResponse(200, SAMPLE_MODELS));
    }
    if (url.endsWith('/users/me/settings') && init?.method === 'PATCH') {
      return Promise.resolve(jsonResponse(200, { settings: { ...DEFAULT_SETTINGS, chat: { ...DEFAULT_SETTINGS.chat, model: 'venice-uncensored-1.5' } } }));
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });
  renderWithProviders(<ModelPicker open={true} onClose={() => {}} />);
  await userEvent.click(await screen.findByText(/Venice Uncensored/));
  await waitFor(() => {
    expect(fetchMock.mock.calls.some(([url, init]) =>
      String(url).endsWith('/users/me/settings') && (init as RequestInit | undefined)?.method === 'PATCH'
    )).toBe(true);
  });
});
```

- [ ] **Step 4: Update `Settings.appearance.test.tsx` + `Settings.models.test.tsx`**

These tests mock `useTweaksStore`/`useModelStore`/`useParamsStore` and seed `useUserSettingsQuery` to verify the seed effect runs. After this refactor, the seed effect is gone — there's nothing to verify on that front. Update each test:

- Drop the `useTweaksStore`/`useModelStore`/`useParamsStore` setup/teardown.
- Seed the Query cache directly with a `UserSettings` value.
- Assertions about "store value matches backend after settings open" become "rendered UI matches the seeded backend value".
- Tests that asserted PATCHes still pass (the wrapper still PATCHes via the underlying mutation).

The full rewrite varies per test. Read each file end-to-end and update with the patterns above.

- [ ] **Step 5: Run full test suite**

Run: `cd frontend && npm test`
Expected: PASS. Existing tests for the migrated consumers + the new ModelPicker PATCH test should all pass. The store tests for `useTweaksStore`/`useParamsStore`/`useModelStore` continue to pass (they don't depend on consumers; they'll be deleted in Task 3.1).

- [ ] **Step 6: Commit**

```bash
git add frontend/tests/components/
git commit -m "[refactor] migrate consumer tests off deleted stores"
```

### Task 2.7: Update Storybook stories that seed deleted stores

**Files (locate via grep):**

- [ ] **Step 1: Locate**

Run:
```bash
grep -rl "useTweaksStore\|useParamsStore\|useModelStore" frontend/src/components/*.stories.tsx
```

For each match, decide:
- **Decoration-only** (story exists purely to render variants, no live store dependency): delete the affected story or simplify to a static prop-driven render.
- **Functional** (story actually exercises store-driven behaviour): rewire to seed a TanStack Query cache via a wrapper.

A wrapper for the latter case:
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_SETTINGS, userSettingsQueryKey } from '@/hooks/useUserSettings';

function withSeededSettings(partial?: Partial<UserSettings>) {
  return (Story: () => React.ReactElement): React.ReactElement => {
    const qc = new QueryClient();
    qc.setQueryData(userSettingsQueryKey, { ...DEFAULT_SETTINGS, ...partial });
    return <QueryClientProvider client={qc}><Story /></QueryClientProvider>;
  };
}
```

- [ ] **Step 2: Verify Storybook builds**

Run: `cd frontend && npm run build-storybook -- --quiet`
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/*.stories.tsx
git commit -m "[refactor] migrate stories off deleted stores"
```

(Skip the commit if no story files matched.)

### Task 2.8: Step 2 verification gate

- [ ] **Run the full frontend suite + Storybook build + Vite prod build**

Run:
```bash
cd frontend && npm test && npm run build-storybook -- --quiet && npm run build
```
Expected: PASS, clean.

---

## Step 3 — Delete dead code

### Task 3.1: Delete the four obsolete modules and their tests

**Files (delete):**

- [ ] **Step 1: Delete the source files**

```bash
git rm frontend/src/store/tweaks.ts \
       frontend/src/store/params.ts \
       frontend/src/store/model.ts \
       frontend/src/hooks/useDarkMode.ts
```

If a test file exists at any of:
- `frontend/tests/store/tweaks.test.ts`
- `frontend/tests/store/params.test.ts`
- `frontend/tests/store/model.test.ts`
- `frontend/tests/components/DarkMode.test.tsx`

Delete each:
```bash
git rm frontend/tests/store/tweaks.test.ts 2>/dev/null
git rm frontend/tests/store/params.test.ts 2>/dev/null
git rm frontend/tests/store/model.test.ts 2>/dev/null
git rm frontend/tests/components/DarkMode.test.tsx 2>/dev/null
```

(`git rm` may fail if the file doesn't exist — that's fine, just skip.)

- [ ] **Step 2: Delete `<DarkModeToggle>` and its assets**

```bash
git rm frontend/src/components/DarkModeToggle.tsx \
       frontend/src/components/DarkModeToggle.stories.tsx \
       frontend/tests/components/DarkModeToggle.test.tsx
```

Search for any remaining references in source (e.g. an unused import, or a mount you missed):
```bash
grep -rn "DarkModeToggle\|useDarkMode" frontend/src/
```

If any matches: trace each, remove the import or replace with the equivalent `useUserSettings().theme === 'dark'` read. Common case: a parent that imports `<DarkModeToggle>` but never renders it — delete the import.

- [ ] **Step 3: Verify TypeScript catches no broken imports**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: clean. If it fails, the error pinpoints the missed reference; fix and re-run.

- [ ] **Step 4: Verify Storybook + tests + build**

Run:
```bash
cd frontend && npm test && npm run build-storybook -- --quiet && npm run build
```
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "[refactor] delete useTweaksStore, useParamsStore, useModelStore, useDarkMode, DarkModeToggle"
```

---

## Step 4 — Final verification

### Task 4.1: Full-suite gates + manual smoke

- [ ] **Backend full suite (sanity check — no changes expected unless Task 1.1 reconciliation touched files)**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Frontend full suite + Storybook + prod build**

Run:
```bash
cd frontend && npm test && npm run build-storybook -- --quiet && npm run build
```
Expected: PASS, clean.

- [ ] **`lint:design` clean**

Run: `cd frontend && npm run lint:design`
Expected: clean.

- [ ] **Manual smoke**

Stand up the dev stack: `make rebuild-frontend && make dev` (rebuild covers any package.json drift; if no deps changed, plain `make dev` is fine).

Walk through:
1. **Theme persistence:** sign in, open Settings → Appearance, pick `dark`. Reload the page. The UI should be dark BEFORE opening Settings.
2. **Model persistence multi-device-style:** sign in, click the model bar in the chat panel (not Settings), pick a model from the modal. Reload. The chat panel should show the same model.
3. **Inline AI errors still surface:** if AI was misconfigured, the dev overlay (introduced on the previous branch) still shows errors. (Sanity check that the error-store wiring survived the migration.)
4. **Layout focus toggle is memory-only:** open the editor, toggle focus mode (keyboard shortcut), reload. Layout should reset to `three-col` (matches design intent — confirmed during brainstorming).

If any smoke item fails, do NOT mark this task done; investigate and surface to the user.

- [ ] **Bundle-size sanity check**

Run: `cd frontend && du -sh dist/assets/`
Compare against the previous size (capture before this branch lands, e.g. by checking out main and running the same command). Acceptable: bundle should be slightly SMALLER (~5-10KB) because we deleted four modules and a component. If it grew, investigate.

- [ ] **No commit needed for verification.** This is a gate, not a code change.

---

## Self-review

Spec coverage check:

| Spec section | Implementing task |
|---|---|
| `DEFAULT_SETTINGS` constant | Task 1.2 |
| `mergeSettings` helper | Task 1.2 |
| `useUserSettings()` wrapper | Task 1.2 |
| `useUpdateUserSetting()` wrapper with optimistic + rollback | Task 1.2 |
| `useUiStore` for ephemeral UI state | Task 1.3 |
| App-root cache rehydration | Task 1.4 |
| Backend default reconciliation | Task 1.1 (decision gate) |
| `EditorPage`/`ChatPanel`/`ChatComposer` migration | Task 2.1 |
| `ModelPicker` multi-device fix | Task 2.2 |
| `SettingsAppearanceTab` migration + seed effect deletion | Task 2.3 |
| `SettingsModelsTab` migration | Task 2.4 |
| `SettingsWritingTab` consistency switch | (folded into Task 2.3 / 2.4 work — see note) |
| `AppShell`/`useFocusToggle`/`lib/askAi.ts` to `useUiStore` | Task 2.5 |
| Test rewires | Task 2.6 |
| Story rewires | Task 2.7 |
| Delete dead code | Task 3.1 |
| Final verification gates | Task 4.1 |

**Gap noted:** `SettingsWritingTab` got rolled into the spec but isn't its own task above. It currently uses `useUserSettingsQuery`/`useUpdateUserSettingsMutation` directly. The migration is one-liner (swap to wrapper hooks) — fold into Task 2.3 or add a stub Task 2.3b. Including a small standalone task here is cleaner:

### Task 2.3b: Migrate `SettingsWritingTab` to wrapper hooks (consistency)

**Files:**
- Modify: `frontend/src/components/SettingsWritingTab.tsx`

- [ ] **Step 1: Replace imports**

```ts
// Before
import { useUpdateUserSettingsMutation, useUserSettingsQuery } from '@/hooks/useUserSettings';
// After
import { useUpdateUserSetting, useUserSettings } from '@/hooks/useUserSettings';
```

- [ ] **Step 2: Replace the body reads**

Find:
```ts
const settingsQuery = useUserSettingsQuery();
const updateSettings = useUpdateUserSettingsMutation();
```

Replace with:
```ts
const settings = useUserSettings();
const updateSetting = useUpdateUserSetting();
```

Anywhere `settingsQuery.data?.writing.<field>` is read, replace with `settings.writing.<field>` (no `?` needed; the wrapper returns a definite shape). Anywhere `updateSettings.mutate({...})` is called, replace with `updateSetting.mutate({...})`.

- [ ] **Step 3: Verify**

Run: `cd frontend && npx vitest run tests/components/Settings.writing.test.tsx 2>/dev/null && npx tsc -b --noEmit`
(Test file may not exist; that's fine. The typecheck is the gate.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/SettingsWritingTab.tsx
git commit -m "[refactor] SettingsWritingTab uses useUserSettings + useUpdateUserSetting"
```

(Insert this task between Task 2.3 and Task 2.4 in the execution order.)

**Type / signature consistency check:**

- `UserSettings` shape used throughout matches the existing definition in `useUserSettings.ts` — no changes.
- `UserSettingsPatch` exists today; `mergeSettings` consumes it; `useUpdateUserSetting.mutate` accepts it. Consistent.
- `Layout` type defined in `useUiStore` (Task 1.3) matches the three string literals used by `AppShell`, `useFocusToggle`, `askAi`. No drift.
- `Theme`, `ProseFont` types moved from `@/store/tweaks` to `@/components/SettingsAppearanceTab` (Task 2.3). Any other importer flagged in Task 2.3 Step 2 grep.
- `useErrorStore.push` accepts `Omit<AppError, 'id' | 'at'>`. The `useUpdateUserSetting` rollback path passes `{ severity, source, code, message, detail }` — matches.

**Placeholder scan:** the `<agreed-...>` placeholders in Task 1.2 Step 3 are intentional — they get filled in once Task 1.1 resolves. Documented as such. No other placeholders.

**No `TODO` / `TBD` / "implement later" lines in code blocks.** The `onFrequencyPenalty` no-op in Task 2.4 is documented intentionally and the comment explains the deferral.
