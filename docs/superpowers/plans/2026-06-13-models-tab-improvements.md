# Settings → Models Page Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four Settings → Models changes — default temperature 1.0, max-tokens ceiling+default tied to the model cap, generation params that follow the highlighted (clicked) model, and a per-model reasoning on/off toggle wired to Venice.

**Architecture:** Change the shared text-gen defaults (mirrored backend/frontend, drift-tested) and the two param resolvers; make `ModelPickerInline`'s highlight controlled so `SettingsModelsTab` can bind the params section to the highlighted model; add a `reasoning?: boolean` per-model override and a small assembly-site helper that sends top-level `reasoning: { enabled: false }` on the three completion paths.

**Tech Stack:** React + Vite + TS + Tailwind + TanStack Query (frontend); Express + Zod + Vitest (backend); Venice OpenAI-compatible API.

**Spec:** `docs/superpowers/specs/2026-06-13-models-tab-improvements-design.md`

> **Commit convention:** commit messages below are prefixed with this plan's bd issue id `[story-editor-o45]`, per CLAUDE.md Git Rules (`[TASK_ID] brief description`).

---

## File Structure

- `backend/src/lib/text-gen-defaults.ts` — temp `0.85→1.0`; add `MAX_OUTPUT_TOKENS_CEILING`.
- `frontend/src/lib/textGenDefaults.ts` — mirror (temp + ceiling).
- `backend/tests/lib/text-gen-defaults.test.ts` — drift test updates.
- `backend/src/services/user-settings-resolvers.ts` — maxTokens default/ceiling + source branch (`resolveTextGenParams`).
- `frontend/src/hooks/useUserSettings.ts` — mirror in `resolveChatParams`; add `reasoning?` to `UserChatOverride`.
- `backend/tests/services/user-settings-resolvers.test.ts` — resolver test updates.
- `frontend/src/components/ModelPickerInline.tsx` — controlled highlight.
- `frontend/src/components/SettingsModelsTab.tsx` — bind params to highlighted model; slider ceiling; reasoning toggle.
- `backend/src/routes/user-settings.routes.ts` — `reasoning?: boolean` in Zod override schema + `UserSettings` interface + default object.
- `backend/src/services/venice-call.service.ts` — `resolveReasoningEnabled` helper.
- `backend/src/routes/ai.routes.ts`, `chat.routes.ts`, `chapters.routes.ts` — send `reasoning: { enabled: false }` when off+supported.
- Tests: `backend/tests/ai/reasoning.test.ts`, `backend/tests/routes/chapters.summarise.test.ts`, `backend/tests/services/venice-call.service.test.ts`, `frontend/tests/components/Settings.models.test.tsx`.

---

### Task 1: Default temperature → 1.0

**Files:**
- Modify: `backend/src/lib/text-gen-defaults.ts:13`
- Modify: `frontend/src/lib/textGenDefaults.ts:10`
- Test: `backend/tests/lib/text-gen-defaults.test.ts`

- [ ] **Step 1: Update the drift test (failing first)**

In `backend/tests/lib/text-gen-defaults.test.ts`, change the two assertions that pin `0.85`:

```ts
    expect(GLOBAL_TEXT_GEN_DEFAULTS).toEqual({
      temperature: 1.0,
      topP: 0.95,
      maxTokens: 800,
    });
```
and
```ts
    expect(text).toMatch(/temperature:\s*1(\.0)?\b/);
```
(Leave the `topP` / `maxTokens` regex lines unchanged.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w story-editor-backend run test -- text-gen-defaults`
Expected: FAIL — source still says `0.85`. (Backend tests need the stack up: `make dev` + healthcheck first — see Task 8 note.)

- [ ] **Step 3: Change both constants**

`backend/src/lib/text-gen-defaults.ts` line 13: `temperature: 0.85,` → `temperature: 1.0,`
`frontend/src/lib/textGenDefaults.ts` line 10: `temperature: 0.85,` → `temperature: 1.0,`

- [ ] **Step 4: Run to verify it passes**

Run: `npm -w story-editor-backend run test -- text-gen-defaults`
Expected: PASS.

- [ ] **Step 5: Check for other hardcoded assertions**

Run: `grep -rn "0\.85" backend/tests frontend/tests`
The hits in `backend/tests/models/user-profile.test.ts` and `frontend/tests/components/Settings.prompts.test.tsx` are **stored-settings fixture data** (a `chat: { … temperature: 0.85 … }` blob), not assertions against the default constant — they do not break from this change. Leave them. Do not change any fixture unless a test actually fails.

- [ ] **Step 6: Commit**

```bash
git add backend/src/lib/text-gen-defaults.ts frontend/src/lib/textGenDefaults.ts backend/tests/lib/text-gen-defaults.test.ts
git commit -m "[story-editor-o45] default temperature 0.85 -> 1.0"
```

---

### Task 2: Max-tokens ceiling constant + resolver default/source

**Files:**
- Modify: `backend/src/lib/text-gen-defaults.ts`, `frontend/src/lib/textGenDefaults.ts` (add `MAX_OUTPUT_TOKENS_CEILING`)
- Modify: `backend/tests/lib/text-gen-defaults.test.ts` (drift for the new const)
- Modify: `backend/src/services/user-settings-resolvers.ts:106-114`
- Modify: `frontend/src/hooks/useUserSettings.ts` (`resolveChatParams` no-override branch)
- Test: `backend/tests/services/user-settings-resolvers.test.ts`

- [ ] **Step 1: Add the failing constant + drift assertions**

In `backend/tests/lib/text-gen-defaults.test.ts`, add inside the `describe`:

```ts
  it('exposes MAX_OUTPUT_TOKENS_CEILING and the frontend mirror matches', async () => {
    const { MAX_OUTPUT_TOKENS_CEILING } = await import('@/lib/text-gen-defaults');
    expect(MAX_OUTPUT_TOKENS_CEILING).toBe(32_000);
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const here = path.dirname(new URL(import.meta.url).pathname);
    const frontendFile = path.resolve(here, '../../../frontend/src/lib/textGenDefaults.ts');
    const text = await fs.readFile(frontendFile, 'utf8');
    expect(text).toMatch(/MAX_OUTPUT_TOKENS_CEILING\s*=\s*32_?000\b/);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w story-editor-backend run test -- text-gen-defaults`
Expected: FAIL — `MAX_OUTPUT_TOKENS_CEILING` not exported.

- [ ] **Step 3: Add the constant to both files**

`backend/src/lib/text-gen-defaults.ts` — after the `GLOBAL_TEXT_GEN_DEFAULTS` export:
```ts
/**
 * Upper bound for the Max-tokens slider and for the no-override default.
 * The effective default output budget is `min(model.maxCompletionTokens, this)`.
 */
export const MAX_OUTPUT_TOKENS_CEILING = 32_000;
```

`frontend/src/lib/textGenDefaults.ts` — after the `GLOBAL_TEXT_GEN_DEFAULTS` export:
```ts
/** Mirror of backend MAX_OUTPUT_TOKENS_CEILING; drift-caught by text-gen-defaults.test.ts. */
export const MAX_OUTPUT_TOKENS_CEILING = 32_000;
```

- [ ] **Step 4: Run to verify the drift test passes**

Run: `npm -w story-editor-backend run test -- text-gen-defaults`
Expected: PASS.

- [ ] **Step 5: Write failing resolver tests**

In `backend/tests/services/user-settings-resolvers.test.ts`, **delete** the existing `'maxTokens with no override falls to global default capped by model max'` test (line ~163) entirely and replace it with the two regime tests below — don't leave the old one alongside them (its premise, `min(800, cap)`, no longer holds). The existing `SMALL_MODEL` (cap 500 ≤ ceiling) keeps value 500 + source `'venice-default'`; `MODEL_WITH_DEFAULTS` (cap 65_536 > ceiling) now defaults to 32_000 + source `'global-default'`:

```ts
  it('maxTokens with no override: cap <= ceiling -> model cap, source venice-default', () => {
    const result = resolveTextGenParams(settingsWith({}), SMALL_MODEL);
    expect(result.max_completion_tokens).toBe(500);
    expect(result.source.max_completion_tokens).toBe('venice-default');
  });

  it('maxTokens with no override: cap > ceiling -> ceiling, source global-default', () => {
    const result = resolveTextGenParams(settingsWith({}), MODEL_WITH_DEFAULTS);
    expect(result.max_completion_tokens).toBe(32_000);
    expect(result.source.max_completion_tokens).toBe('global-default');
  });
```

- [ ] **Step 6: Run to verify they fail**

Run: `npm -w story-editor-backend run test -- user-settings-resolvers`
Expected: FAIL on the `cap > ceiling` case — current default is `min(800, cap)=800` with source `'venice-default'`.

- [ ] **Step 7: Change the backend resolver no-override branch**

In `backend/src/services/user-settings-resolvers.ts`, add the import:
```ts
import { GLOBAL_TEXT_GEN_DEFAULTS, MAX_OUTPUT_TOKENS_CEILING } from '../lib/text-gen-defaults';
```
Replace the no-override branch (currently lines 106-114) with:
```ts
  } else {
    // No user override. Default to as much output as the model allows, bounded
    // by our UI ceiling: min(cap, CEILING). Source reflects which bound wins —
    // the model's Venice-published cap when it's the binding value, our ceiling
    // constant otherwise. (Most models expose >= 32K, so 'global-default' is the
    // common outcome.) GLOBAL_TEXT_GEN_DEFAULTS.maxTokens no longer participates.
    max_completion_tokens = Math.min(cap, MAX_OUTPUT_TOKENS_CEILING);
    maxSource = cap <= MAX_OUTPUT_TOKENS_CEILING ? 'venice-default' : 'global-default';
  }
```

- [ ] **Step 8: Run to verify backend resolver tests pass**

Run: `npm -w story-editor-backend run test -- user-settings-resolvers`
Expected: PASS.

- [ ] **Step 9: Mirror the change in the frontend resolver**

In `frontend/src/hooks/useUserSettings.ts`:
- Add `MAX_OUTPUT_TOKENS_CEILING` to the `textGenDefaults` import.
- Replace the `resolveChatParams` no-override branch (`maxTokens = Math.min(GLOBAL_TEXT_GEN_DEFAULTS.maxTokens, cap); maxSource = 'venice-default';`) with:
```ts
    maxTokens = Math.min(cap, MAX_OUTPUT_TOKENS_CEILING);
    maxSource = cap <= MAX_OUTPUT_TOKENS_CEILING ? 'venice-default' : 'global-default';
```
- Update the adjacent doc comment that says the default is `min(GLOBAL_TEXT_GEN_DEFAULTS.maxTokens, cap)` to describe `min(cap, CEILING)` and the branched source. Add a one-line note where `GLOBAL_TEXT_GEN_DEFAULTS.maxTokens` is referenced elsewhere that it is now a UI-fallback-only value (the no-model-selected object in `SettingsModelsTab`), retained for the drift test.

- [ ] **Step 10: Typecheck frontend**

Run: `npm --prefix frontend run typecheck`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add backend/src/lib/text-gen-defaults.ts frontend/src/lib/textGenDefaults.ts backend/tests/lib/text-gen-defaults.test.ts backend/src/services/user-settings-resolvers.ts backend/tests/services/user-settings-resolvers.test.ts frontend/src/hooks/useUserSettings.ts
git commit -m "[story-editor-o45] max tokens default + ceiling = min(model cap, 32k); branch source label"
```

---

### Task 3: ModelPickerInline controlled highlight + params follow highlighted model

**Files:**
- Modify: `frontend/src/components/ModelPickerInline.tsx`
- Modify: `frontend/src/components/SettingsModelsTab.tsx`
- Test: `frontend/tests/components/Settings.models.test.tsx`

- [ ] **Step 1: Write failing tests**

In `frontend/tests/components/Settings.models.test.tsx`, add a test asserting that clicking a non-active model row updates the params section to that model's values. (Use the file's existing render harness + model fixtures; the params temperature value reflects the highlighted model's `defaultTemperature`.) Example shape:

```tsx
  it('params section follows the highlighted (clicked) model, not just the active one', async () => {
    renderModelsTab(); // existing harness in this file
    const user = userEvent.setup();
    await screen.findByTestId('model-rail');

    // Click a model that is NOT the active one.
    await user.click(screen.getByTestId('model-rail-other-model'));

    // Temperature slider now shows the clicked model's resolved temperature.
    expect(screen.getByTestId('param-temperature')).toHaveValue('0.5');
  });
```
Match the exact model ids/values to the fixtures already defined in this test file (read them first; if no second model exists, add one with a distinct `defaultTemperature`).

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix frontend run test -- Settings.models`
Expected: FAIL — params still bind to the active model.

- [ ] **Step 3: Make `ModelPickerInline` highlight controlled**

In `frontend/src/components/ModelPickerInline.tsx`:
- Remove the `useEffect`/`useState` import usage for highlight and delete the internal state + sync effect (lines 197-206).
- Update the props interface:
```tsx
export interface ModelPickerInlineProps {
  models: Model[];
  activeId: string | null;
  highlightedId: string | null;
  onHighlightChange: (id: string) => void;
  onUseModel: (id: string) => void;
  loading?: boolean;
  error?: boolean;
}
```
- Destructure `highlightedId` / `onHighlightChange` in the component signature; remove `useState`/`useEffect` imports if now unused.
- Replace `const highlighted = models.find((m) => m.id === highlightedId) ?? models[0] ?? null;` (keep this line — `highlightedId` is now the prop).
- In the rail map, change `onPreview={() => { setHighlightedId(m.id); }}` to `onPreview={() => { onHighlightChange(m.id); }}`.

- [ ] **Step 4: Own highlight + recovery effect in `SettingsModelsTab`**

In `frontend/src/components/SettingsModelsTab.tsx`:
- Add `useEffect`, `useState` to the React import.
- Add state + recovery effect (the removed component effect must live here, since `models`/`activeId` arrive async). **Depend on `modelsQuery.data` (stable reference between fetches), NOT the freshly-allocated `models` array** — `models = modelsQuery.data ?? []` is a new array each render and would make the effect run every render (and trip exhaustive-deps lint). **Also re-seed when the current highlight stops matching a loaded model** (list changed mid-session), not only when it's null — this preserves the current component's never-blank behavior:
```tsx
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const models = modelsQuery.data ?? [];
  useEffect(() => {
    const list = modelsQuery.data ?? [];
    if (list.length === 0) return;
    if (highlightedId != null && list.some((m) => m.id === highlightedId)) return;
    setHighlightedId(settings.chat.model ?? list[0].id);
  }, [highlightedId, settings.chat.model, modelsQuery.data]);
```
- Bind the params section to the highlighted model. **Keep a `?? models[0]` fallback** so the params section is never blank during the one render before the recovery effect re-seeds (matches the current component's `models.find(...) ?? models[0]` guarantee):
```tsx
  const highlightedModel: Model | undefined =
    models.find((m) => m.id === highlightedId) ?? models[0];
```
- Replace every `activeModel` use in the params section (resolve, `slidersDisabled`, `resetTooltip`, the three slider handlers' `activeModelId` writes) with the **highlighted** model and `highlightedId`. Specifically:
  - `const slidersDisabled = highlightedModel == null;`
  - `const resolvedParams = highlightedModel ? resolveChatParams(settings, highlightedModel) : { …global fallback unchanged… };`
  - `onReset`, `onTemperature`, `onTopP`, `onMaxTokens`: guard on and write `overrides[highlightedId]` (rename the local `activeModelId` references to `highlightedId`).
  - `resetTooltip`: use `highlightedModel` in the body **and update the `useMemo` dep array** from `[settings, activeModel]` to `[settings, highlightedModel]` (else exhaustive-deps lint warns and the tooltip goes stale).
- Pass the controlled props to the picker:
```tsx
        <ModelPickerInline
          models={models}
          activeId={settings.chat.model}
          highlightedId={highlightedId}
          onHighlightChange={setHighlightedId}
          loading={modelsQuery.isLoading}
          error={modelsQuery.isError}
          onUseModel={(id) => {
            updateSetting.mutate({ chat: { model: id } });
          }}
        />
```
("Use this model" still PATCHes `chat.model` only — unchanged.)

- [ ] **Step 5: Run to verify it passes**

Run: `npm --prefix frontend run test -- Settings.models ModelPickerInline`
Expected: PASS (new test + existing). If `ModelPickerInline.stories.tsx` or other tests construct `ModelPickerInline` without the new required props, update those call sites to pass `highlightedId`/`onHighlightChange` (grep: `grep -rn "ModelPickerInline" frontend/src frontend/tests`).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ModelPickerInline.tsx frontend/src/components/SettingsModelsTab.tsx frontend/tests/components/Settings.models.test.tsx frontend/src/components/ModelPickerInline.stories.tsx
git commit -m "[story-editor-o45] Models tab: params follow highlighted model; controlled picker highlight"
```

---

### Task 4: Max-tokens slider ceiling tied to model cap

**Files:**
- Modify: `frontend/src/components/SettingsModelsTab.tsx:245` (the max-tokens `SliderRow`)
- Test: `frontend/tests/components/Settings.models.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `frontend/tests/components/Settings.models.test.tsx` (use a fixture model whose `maxCompletionTokens` is below the ceiling, e.g. 4096, highlighted):

```tsx
  it('max-tokens slider ceiling reflects the highlighted model cap (min with 32k)', async () => {
    renderModelsTab();
    const user = userEvent.setup();
    await screen.findByTestId('model-rail');
    await user.click(screen.getByTestId('model-rail-small-cap-model')); // cap 4096
    expect(screen.getByTestId('param-max-tokens')).toHaveAttribute('max', '4096');
  });
```
(Add a `small-cap-model` fixture with `maxCompletionTokens: 4096` if one isn't present.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix frontend run test -- Settings.models`
Expected: FAIL — slider `max` is hardcoded `32000`.

- [ ] **Step 3: Wire the slider ceiling**

In `frontend/src/components/SettingsModelsTab.tsx`:
- Add `MAX_OUTPUT_TOKENS_CEILING` to the `textGenDefaults` import.
- Change the max-tokens `SliderRow`'s `max` prop from `max={32_000}` to:
```tsx
          max={
            highlightedModel
              ? Math.min(highlightedModel.maxCompletionTokens, MAX_OUTPUT_TOKENS_CEILING)
              : MAX_OUTPUT_TOKENS_CEILING
          }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --prefix frontend run test -- Settings.models`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/SettingsModelsTab.tsx frontend/tests/components/Settings.models.test.tsx
git commit -m "[story-editor-o45] Models tab: max-tokens slider ceiling = min(model cap, 32k)"
```

---

### Task 5: Add `reasoning?: boolean` to the per-model override schema

**Files:**
- Modify: `backend/src/routes/user-settings.routes.ts` (Zod override schema ~line 61-66; `UserSettings` interface ~114-119; default object ~151)
- Modify: `frontend/src/hooks/useUserSettings.ts` (`UserChatOverride`)
- Test: `backend/tests/routes/` settings test (or add a focused PATCH test — see Step 1)

- [ ] **Step 1: Write a failing schema test**

Find the existing user-settings route test (`grep -rln "users/me/settings" backend/tests`). Add a test that PATCHing `{ chat: { overrides: { "m": { reasoning: false } } } }` returns 200 and round-trips the field. If no settings route test file exists, add `backend/tests/routes/user-settings.reasoning.test.ts` mirroring `ai-defaults.test.ts`'s register/login harness:

```ts
  it('accepts and round-trips a per-model reasoning override', async () => {
    const token = await registerAndLogin();
    const patch = await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ chat: { overrides: { 'qwen-qwq-32b': { reasoning: false } } } });
    expect(patch.status).toBe(200);
    expect(patch.body.settings.chat.overrides['qwen-qwq-32b'].reasoning).toBe(false);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w story-editor-backend run test -- user-settings`
Expected: FAIL — the strict Zod override schema rejects the unknown `reasoning` key (400).

- [ ] **Step 3: Add the field in all three backend spots**

In `backend/src/routes/user-settings.routes.ts`:
- Zod override schema (inside `.object({ temperature…, topP…, maxTokens… })`): add `reasoning: z.boolean().optional(),`
- `UserSettings` interface override shape (`{ temperature?: number; topP?: number; maxTokens?: number }`): add `reasoning?: boolean;`
- Default object `Record<string, { temperature?: number; topP?: number; maxTokens?: number }>`: add `reasoning?: boolean` to the inline record type.

- [ ] **Step 4: Add the field to the frontend type**

In `frontend/src/hooks/useUserSettings.ts`, `UserChatOverride`:
```ts
export interface UserChatOverride {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  reasoning?: boolean;
}
```

- [ ] **Step 5: Run to verify it passes + typecheck**

Run: `npm -w story-editor-backend run test -- user-settings && npm --prefix frontend run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/user-settings.routes.ts frontend/src/hooks/useUserSettings.ts backend/tests/routes/
git commit -m "[story-editor-o45] settings: add per-model reasoning override field"
```

---

### Task 6: Reasoning request wiring (helper + three completion paths)

**Files:**
- Modify: `backend/src/services/venice-call.service.ts` (add `resolveReasoningEnabled`)
- Modify: `backend/src/routes/ai.routes.ts`, `chat.routes.ts`, `chapters.routes.ts`
- Test: `backend/tests/services/venice-call.service.test.ts`, `backend/tests/ai/reasoning.test.ts`, `backend/tests/routes/chapters.summarise.test.ts`

- [ ] **Step 1: Write the failing helper unit test**

In `backend/tests/services/venice-call.service.test.ts`, add (use an existing `ModelInfo` fixture or build minimal ones with `supportsReasoning` true/false):

```ts
describe('resolveReasoningEnabled', () => {
  const reasoning = { id: 'r', supportsReasoning: true } as unknown as ModelInfo;
  const plain = { id: 'p', supportsReasoning: false } as unknown as ModelInfo;
  const s = (ov: Record<string, { reasoning?: boolean }>) =>
    ({ chat: { model: null, overrides: ov } }) as unknown as UserSettings;

  it('defaults to enabled (true) for a reasoning model with no override', () => {
    expect(resolveReasoningEnabled(s({}), reasoning)).toBe(true);
  });
  it('returns false only when a reasoning model is explicitly overridden off', () => {
    expect(resolveReasoningEnabled(s({ r: { reasoning: false } }), reasoning)).toBe(false);
  });
  it('returns true for a non-reasoning model even if overridden off', () => {
    expect(resolveReasoningEnabled(s({ p: { reasoning: false } }), plain)).toBe(true);
  });
  it('returns true for null modelInfo', () => {
    expect(resolveReasoningEnabled(s({}), null)).toBe(true);
  });
});
```
Add `resolveReasoningEnabled` to the import from `../../src/services/venice-call.service` (and `ModelInfo`/`UserSettings` types as the file already imports them — check the file's existing imports).

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w story-editor-backend run test -- venice-call`
Expected: FAIL — `resolveReasoningEnabled` is not exported.

- [ ] **Step 3: Add the helper**

In `backend/src/services/venice-call.service.ts` (after `buildVeniceParams`):
```ts
/**
 * Whether reasoning should be left enabled (Venice's default) for this call.
 * Only a reasoning-capable model whose per-model override is explicitly `false`
 * disables it; everything else stays on. Computed at the assembly site so the
 * 3-param resolveTextGenParams contract stays focused.
 */
export function resolveReasoningEnabled(
  settings: UserSettings,
  modelInfo: ModelInfo | null | undefined,
): boolean {
  if (modelInfo == null || modelInfo.supportsReasoning !== true) return true;
  return settings.chat.overrides?.[modelInfo.id]?.reasoning !== false;
}
```

- [ ] **Step 4: Run to verify the unit test passes**

Run: `npm -w story-editor-backend run test -- venice-call`
Expected: PASS.

- [ ] **Step 5: Write failing route tests (AI + summarise)**

In `backend/tests/ai/reasoning.test.ts`, add tests using the existing `callComplete` harness plus a settings PATCH to set the override. Add a helper next to `storeKey`:
```ts
async function setReasoningOff(accessToken: string, modelId: string): Promise<void> {
  const res = await request(app)
    .patch('/api/users/me/settings')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ chat: { overrides: { [modelId]: { reasoning: false } } } });
  expect(res.status).toBe(200);
}
```
Then:
```ts
  it('sends reasoning:{enabled:false} when a reasoning model is toggled off', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { storyId, chapterId } = await setupTestData(req);
    await setReasoningOff(accessToken, REASONING_MODEL_ID);

    const body = await callComplete(accessToken, storyId, chapterId, REASONING_MODEL_ID, fetchSpy);
    expect(body.reasoning).toEqual({ enabled: false });
  });

  it('omits reasoning when on (default) and for non-reasoning models', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { storyId, chapterId } = await setupTestData(req);

    const onBody = await callComplete(accessToken, storyId, chapterId, REASONING_MODEL_ID, fetchSpy);
    expect(onBody.reasoning).toBeUndefined();

    const plainBody = await callComplete(accessToken, storyId, chapterId, PLAIN_MODEL_ID, fetchSpy);
    expect(plainBody.reasoning).toBeUndefined();
  });
```
In `backend/tests/routes/chapters.summarise.test.ts`, add one test mirroring its existing `strip_thinking_response` test that PATCHes `overrides[MODEL_ID].reasoning=false` and asserts `sentBody.reasoning` equals `{ enabled: false }`.

- [ ] **Step 6: Run to verify they fail**

Run: `npm -w story-editor-backend run test -- reasoning chapters.summarise`
Expected: FAIL — routes don't send `reasoning` yet.

- [ ] **Step 7: Wire the three routes (+ surface reasoning in the dev log)**

First, extend the dev log so "is reasoning disabled?" is answerable from `[venice.params]` (this feature directly invites that question). In `backend/src/services/venice-call.service.ts`:
- Add `reasoningEnabled: boolean;` to `LogVeniceParamsInput`.
- In `logVeniceParams`, add `reasoning_enabled: input.reasoningEnabled,` to the logged JSON object.

Then in each route, after `const modelInfo = …` (or where `modelInfo` is in scope) compute the flag, pass it to `logVeniceParams`, and add the top-level field to the `create({...})` object.

In all three routes: `const reasoningEnabled = resolveReasoningEnabled(settings, modelInfo);` near the `buildVeniceParams(...)` call, add `reasoningEnabled,` to the `logVeniceParams({ … })` call, and add `...(reasoningEnabled ? {} : { reasoning: { enabled: false } }),` to the `.create({ … })` body (after the `venice_parameters,` line).

`backend/src/routes/ai.routes.ts` — import `resolveReasoningEnabled` from `../services/venice-call.service`. Compute after line 154 (`venice_parameters = buildVeniceParams(...)`); `logVeniceParams` is the call at line 159; `.create` body `venice_parameters,` is line 209.

`backend/src/routes/chat.routes.ts` — same import; compute after line 401; `logVeniceParams` at line 406; `.create` body `venice_parameters,` at line 450.

`backend/src/routes/chapters.routes.ts` — same import; compute after line 321; `logVeniceParams` at line 329; `.create` body `venice_parameters,` at line 374.

- [ ] **Step 8: Run to verify all reasoning tests pass**

Run: `npm -w story-editor-backend run test -- reasoning chapters.summarise venice-call`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/venice-call.service.ts backend/src/routes/ai.routes.ts backend/src/routes/chat.routes.ts backend/src/routes/chapters.routes.ts backend/tests/services/venice-call.service.test.ts backend/tests/ai/reasoning.test.ts backend/tests/routes/chapters.summarise.test.ts
git commit -m "[story-editor-o45] reasoning: send reasoning:{enabled:false} when toggled off on supporting models (all 3 paths)"
```

---

### Task 7: Reasoning toggle UI in the Models tab

**Files:**
- Modify: `frontend/src/components/SettingsModelsTab.tsx`
- Test: `frontend/tests/components/Settings.models.test.tsx`

- [ ] **Step 1: Write failing tests**

In `frontend/tests/components/Settings.models.test.tsx`, with one reasoning model (`supportsReasoning: true`) and one plain model (`supportsReasoning: false`) in the fixtures:

```tsx
  it('reasoning toggle is disabled and off for a non-reasoning model', async () => {
    renderModelsTab();
    const user = userEvent.setup();
    await screen.findByTestId('model-rail');
    await user.click(screen.getByTestId('model-rail-plain-model')); // supportsReasoning:false
    const toggle = screen.getByTestId('param-reasoning');
    expect(toggle).toBeDisabled();
    expect(toggle).not.toBeChecked();
  });

  it('reasoning toggle is enabled and on by default for a reasoning model, and writes the override', async () => {
    const patchSpy = vi.fn(); // wire to the existing mutation/fetch mock in this file
    renderModelsTab();
    const user = userEvent.setup();
    await screen.findByTestId('model-rail');
    await user.click(screen.getByTestId('model-rail-reasoning-model')); // supportsReasoning:true
    const toggle = screen.getByTestId('param-reasoning');
    expect(toggle).toBeEnabled();
    expect(toggle).toBeChecked();
    await user.click(toggle);
    // asserts a PATCH writing overrides[reasoning-model].reasoning === false
    // (match the file's existing assertion style for updateSetting/PATCH bodies)
  });
```
Match the PATCH-assertion mechanics to how other tests in this file verify `updateSetting.mutate` / fetch bodies (read the file first).

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix frontend run test -- Settings.models`
Expected: FAIL — no `param-reasoning` control.

- [ ] **Step 3: Add the toggle to the params section**

In `frontend/src/components/SettingsModelsTab.tsx`, in the `models-section-params` block (after the three sliders), add a reasoning row using the same checkbox pattern as `SettingsWritingTab`'s `ToggleRow` (a `<label>` wrapping `<input type="checkbox">` with `data-testid="param-reasoning"`). Compute:
```tsx
  const reasoningSupported = highlightedModel?.supportsReasoning === true;
  const reasoningOn =
    reasoningSupported && (settings.chat.overrides[highlightedId ?? '']?.reasoning ?? true);
  const onReasoning = (next: boolean): void => {
    if (!highlightedId) return;
    const prev = settings.chat.overrides[highlightedId] ?? {};
    updateSetting.mutate({
      chat: {
        overrides: { ...settings.chat.overrides, [highlightedId]: { ...prev, reasoning: next } },
      },
    });
  };
```
Render:
```tsx
        <label
          htmlFor={reasoningId}
          className={`flex items-center gap-2 text-[12px] ${!reasoningSupported ? 'opacity-50' : ''}`}
        >
          <input
            id={reasoningId}
            data-testid="param-reasoning"
            type="checkbox"
            checked={reasoningOn}
            disabled={slidersDisabled || !reasoningSupported}
            onChange={(e) => onReasoning(e.target.checked)}
            className="accent-accent w-4 h-4"
          />
          <span className="font-medium text-ink-2">Reasoning</span>
          {!reasoningSupported ? (
            <span className="text-ink-4 font-sans">Not supported by this model</span>
          ) : null}
        </label>
```
Add `const reasoningId = useId();` with the other `useId()` calls.

- [ ] **Step 4: Run to verify it passes**

Run: `npm --prefix frontend run test -- Settings.models`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/SettingsModelsTab.tsx frontend/tests/components/Settings.models.test.tsx
git commit -m "[story-editor-o45] Models tab: per-model reasoning toggle (disabled+off when unsupported)"
```

---

### Task 8: Full verify

- [ ] **Step 1: Frontend typecheck + suites**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend run test -- SettingsModelsTab ModelPickerInline useUserSettings Settings.models`
Expected: PASS.

- [ ] **Step 2: Bring the stack up for backend tests**

Run: `make dev` then wait for the backend healthcheck to pass (backend vitest `globalSetup` runs `db-test-reset.sh` against the compose Postgres — the suite fails fast without the stack; see project memory `bd-verify-line-backend-test-needs-stack`).

- [ ] **Step 3: Backend typecheck + suites**

Run: `npm --prefix backend run typecheck && npm -w story-editor-backend run test -- text-gen-defaults user-settings-resolvers venice-call reasoning chat chapters.summarise user-settings`
Expected: PASS. These filters cover the resolver/default changes **and** all three reasoning completion paths (`reasoning` → `backend/tests/ai/reasoning.test.ts` for /ai/complete; `chat` → chat route; `chapters.summarise` → summarise route).

- [ ] **Step 4: Design lint**

Run: `node frontend/scripts/lint-design.mjs`
Expected: PASS — the reasoning toggle uses `accent-accent` + token classes (same as the existing `includePreviousChaptersInPrompt` checkbox), no color literals.

---

## Self-Review

**Spec coverage:**
- Task 1 default temp 1.0 (global fallback only). ✓
- Task 2 ceiling const + default `min(cap, CEILING)` + branched source, both resolvers + drift. ✓
- Task 3 controlled-highlight picker + params follow highlighted model + async recovery effect. ✓
- Task 4 slider ceiling `min(model cap, CEILING)`. ✓
- Task 5 `reasoning?` override in backend Zod + interface + default + frontend type. ✓
- Task 6 `resolveReasoningEnabled` at assembly site (resolvers untouched) + all three completion paths + tests. ✓
- Task 7 reasoning toggle UI: disabled+off for non-reasoning, enabled+on-default otherwise, writes override. ✓
- Stale comment + source relabel (branch) — Task 2 Step 7/9. ✓ Vestigial 800 note — Task 2 Step 9. ✓ Temp-in-range — no slider change, confirmed. ✓
- Verify line runs all three route suites. ✓ (Task 8 Step 3)

**Placeholder scan:** Steps reference reading the test file's existing fixtures/assertion style for the frontend Settings.models tests (the file's harness — `renderModelsTab`, model fixtures, PATCH-assertion mechanics — is pre-existing and must be matched, not invented); every code change shows the actual code. No TBD/TODO.

**Type consistency:** `MAX_OUTPUT_TOKENS_CEILING` (both files), `resolveReasoningEnabled(settings, modelInfo)` (helper + 4 call sites incl. test), `highlightedId`/`onHighlightChange` (picker props + parent), `reasoning?: boolean` (4 declaration sites), `param-reasoning` testId (UI + tests) all consistent across tasks.
