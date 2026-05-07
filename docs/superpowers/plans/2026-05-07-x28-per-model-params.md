# X28 Per-Model Generation Parameters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `temperature` / `top_p` through to Venice (today they're stored but never sent), reshape `settings.chat` to per-model overrides keyed by `modelId`, source per-model defaults from Venice's `model_spec.constraints`, and add a section-level Reset button on the Models tab. Add a non-prod debug log at the Venice call site so the resolver's source classification is observable.

**Architecture:** Pure resolver function (`resolveTextGenParams`) on the backend computes effective params from the chain `override → venice-default → global-default`, with `max_completion_tokens` clamped to `modelInfo.maxCompletionTokens`. AI routes call the resolver and pass the resulting `temperature` / `top_p` / `max_completion_tokens` to `client.chat.completions.create()`. Frontend mirrors the resolver to drive slider display + Reset button enablement. Settings JSON shape changes from flat `chat.{temperature,topP,maxTokens}` to `chat.overrides[modelId].{temperature?,topP?,maxTokens?}`; no migration code per CLAUDE.md "Don't write data-migration branches".

**Tech Stack:** Backend: Node + Express + TypeScript + Prisma + Zod + Vitest, OpenAI SDK targeting Venice's compatible endpoint. Frontend: React 19 + TipTap + Zustand + TanStack Query + Vite + Vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-05-07-x28-per-model-params-design.md`

---

## File Structure

**Backend creates:**
- `backend/src/lib/text-gen-defaults.ts` — `GLOBAL_TEXT_GEN_DEFAULTS` constants.
- `backend/tests/lib/text-gen-defaults.test.ts` — parity test (asserts both sides match hardcoded values).
- `backend/tests/services/user-settings-resolvers.test.ts` — resolver chain tests (file may already exist; add cases).

**Backend modifies:**
- `backend/src/services/venice.models.service.ts` — parse `model_spec.constraints.{temperature,top_p}.default`, expose `defaultTemperature` / `defaultTopP` on `ModelInfo`.
- `backend/tests/services/venice.models.service.test.ts` — assert parsing.
- `backend/src/services/user-settings-resolvers.ts` — add `resolveTextGenParams`.
- `backend/src/routes/user-settings.routes.ts` — replace flat fields with `chat.overrides` map; update `DEFAULT_SETTINGS`.
- `backend/tests/routes/user-settings.test.ts` — update PATCH tests to new shape, add reject-old-shape cases.
- `backend/src/routes/ai.routes.ts` — call resolver, log, pass `temperature` + `top_p` + (resolved) `max_completion_tokens`.
- `backend/src/routes/chat.routes.ts` — same as ai.routes.
- `backend/tests/routes/ai.test.ts` (or equivalent) — assert payload includes resolved fields.
- `backend/tests/routes/chat.routes.test.ts` (or equivalent) — same.

**Frontend creates:**
- `frontend/src/lib/textGenDefaults.ts` — same constants as backend (parity test in backend/tests/lib catches drift).
- `frontend/tests/hooks/useUserSettings.test.tsx` — frontend resolver chain tests (file may already exist; add cases).

**Frontend modifies:**
- `frontend/src/hooks/useUserSettings.ts` — `UserSettings.chat` shape change; `DEFAULT_SETTINGS` update; add `resolveChatParams` helper.
- `frontend/src/components/SettingsModelsTab.tsx` — sliders read resolved values, write `chat.overrides[activeModelId].field`; add Reset button + disabled-when-no-model state.
- `frontend/tests/components/Settings.models.test.tsx` — substantial rewrite for new shape + Reset behaviour.
- `frontend/src/components/ChatPanel.tsx` — header line uses resolver.
- `frontend/src/components/Settings.stories.tsx` — fixture data uses new shape.
- `frontend/tests/components/Settings.shell-venice.test.tsx` — fixture data uses new shape (only if it asserts on it).

---

### Task 1: Default constants module (backend + frontend) + parity test

**Files:**
- Create: `backend/src/lib/text-gen-defaults.ts`
- Create: `frontend/src/lib/textGenDefaults.ts`
- Create: `backend/tests/lib/text-gen-defaults.test.ts`

- [ ] **Step 1: Write the failing parity test**

Create `backend/tests/lib/text-gen-defaults.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { GLOBAL_TEXT_GEN_DEFAULTS } from '@/lib/text-gen-defaults';

describe('GLOBAL_TEXT_GEN_DEFAULTS', () => {
  it('is the canonical text-generation defaults shape', () => {
    expect(GLOBAL_TEXT_GEN_DEFAULTS).toEqual({
      temperature: 0.85,
      topP: 0.95,
      maxTokens: 800,
    });
  });

  it('frontend/src/lib/textGenDefaults.ts hardcodes the same values', async () => {
    // Read the frontend file as text and grep the constants. Cross-package
    // imports between backend and frontend tsconfigs aren't wired up, so
    // this read+regex is the simplest parity check that catches drift.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const here = path.dirname(new URL(import.meta.url).pathname);
    const frontendFile = path.resolve(here, '../../../frontend/src/lib/textGenDefaults.ts');
    const text = await fs.readFile(frontendFile, 'utf8');
    expect(text).toMatch(/temperature:\s*0\.85/);
    expect(text).toMatch(/topP:\s*0\.95/);
    expect(text).toMatch(/maxTokens:\s*800/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/lib/text-gen-defaults.test.ts`
Expected: FAIL with "Cannot find module '@/lib/text-gen-defaults'".

- [ ] **Step 3: Create backend constants**

Create `backend/src/lib/text-gen-defaults.ts`:

```ts
// X28 — single source of truth (backend side) for the global fallback used
// when neither the user's per-model override nor Venice's per-model
// `model_spec.constraints` provides a value. Mirrored in
// `frontend/src/lib/textGenDefaults.ts`; backend/tests/lib/text-gen-defaults.test.ts
// catches drift between the two.
export interface GlobalTextGenDefaults {
  temperature: number;
  topP: number;
  maxTokens: number;
}

export const GLOBAL_TEXT_GEN_DEFAULTS: Readonly<GlobalTextGenDefaults> = Object.freeze({
  temperature: 0.85,
  topP: 0.95,
  maxTokens: 800,
});
```

- [ ] **Step 4: Create frontend constants**

Create `frontend/src/lib/textGenDefaults.ts`:

```ts
// X28 — frontend mirror of backend/src/lib/text-gen-defaults.ts. Drift
// caught by backend/tests/lib/text-gen-defaults.test.ts.
export interface GlobalTextGenDefaults {
  temperature: number;
  topP: number;
  maxTokens: number;
}

export const GLOBAL_TEXT_GEN_DEFAULTS: Readonly<GlobalTextGenDefaults> = Object.freeze({
  temperature: 0.85,
  topP: 0.95,
  maxTokens: 800,
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/lib/text-gen-defaults.test.ts`
Expected: PASS, 2/2 tests green.

- [ ] **Step 6: Commit**

```bash
git add backend/src/lib/text-gen-defaults.ts frontend/src/lib/textGenDefaults.ts backend/tests/lib/text-gen-defaults.test.ts
git commit -m "[story-editor-tdc] add GLOBAL_TEXT_GEN_DEFAULTS (backend + frontend)"
```

---

### Task 2: Venice models parser — extract per-model temperature/top_p defaults

**Files:**
- Modify: `backend/src/services/venice.models.service.ts`
- Modify: `backend/tests/services/venice.models.service.test.ts`

- [ ] **Step 1: Inspect the existing parser test file structure**

Run: `grep -n "describe\|it(" backend/tests/services/venice.models.service.test.ts | head -20`
Note the existing `mapModel` / fixture pattern — the new tests should follow it. If the file doesn't exist, create it as part of Step 2.

- [ ] **Step 2: Write the failing test cases**

Add to `backend/tests/services/venice.models.service.test.ts` inside the existing `describe('mapModel', ...)` block (or create one if absent):

```ts
it('extracts defaultTemperature and defaultTopP from model_spec.constraints', () => {
  const raw = {
    id: 'qwen-3-6-plus',
    type: 'text',
    model_spec: {
      name: 'Qwen 3.6 Plus',
      availableContextTokens: 1_000_000,
      maxCompletionTokens: 65_536,
      constraints: {
        temperature: { default: 0.7 },
        top_p: { default: 0.8 },
      },
    },
  };
  const info = mapModel(raw);
  expect(info.defaultTemperature).toBe(0.7);
  expect(info.defaultTopP).toBe(0.8);
});

it('returns null defaults when constraints block is absent', () => {
  const raw = {
    id: 'minimal-model',
    type: 'text',
    model_spec: {
      name: 'Minimal',
      availableContextTokens: 8_000,
      maxCompletionTokens: 2_000,
    },
  };
  const info = mapModel(raw);
  expect(info.defaultTemperature).toBeNull();
  expect(info.defaultTopP).toBeNull();
});

it('returns null for missing default keys inside constraints', () => {
  const raw = {
    id: 'partial-constraints',
    type: 'text',
    model_spec: {
      name: 'Partial',
      availableContextTokens: 8_000,
      maxCompletionTokens: 2_000,
      constraints: {
        temperature: { min: 0, max: 2 }, // no `default`
        // top_p key entirely absent
      },
    },
  };
  const info = mapModel(raw);
  expect(info.defaultTemperature).toBeNull();
  expect(info.defaultTopP).toBeNull();
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && npx vitest run tests/services/venice.models.service.test.ts`
Expected: FAIL — `defaultTemperature` / `defaultTopP` are not on `ModelInfo`.

- [ ] **Step 4: Extend the parser**

Edit `backend/src/services/venice.models.service.ts`:

In the `ModelInfo` interface, add:
```ts
  defaultTemperature: number | null;
  defaultTopP: number | null;
```

In the `VeniceRawModelSpec` interface, add:
```ts
  constraints?: {
    temperature?: { default?: number };
    top_p?: { default?: number };
  };
```

In `mapModel`, after the existing `pricing` block and before the return statement:
```ts
  const constraints = spec.constraints ?? {};
  const dt = constraints.temperature?.default;
  const dp = constraints.top_p?.default;
  const defaultTemperature = typeof dt === 'number' ? dt : null;
  const defaultTopP = typeof dp === 'number' ? dp : null;
```

In the `return { ... }` literal, add the two new fields alongside the others:
```ts
    defaultTemperature,
    defaultTopP,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx vitest run tests/services/venice.models.service.test.ts`
Expected: PASS, all cases green (existing tests still pass).

- [ ] **Step 6: Run typecheck**

Run: `cd backend && npm run typecheck`
Expected: clean (no callers depend on the old `ModelInfo` shape — `defaultTemperature` / `defaultTopP` are additive).

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/venice.models.service.ts backend/tests/services/venice.models.service.test.ts
git commit -m "[story-editor-tdc] venice.models: parse model_spec.constraints defaults"
```

---

### Task 3: Backend resolver `resolveTextGenParams`

**Files:**
- Modify: `backend/src/services/user-settings-resolvers.ts`
- Create: `backend/tests/services/user-settings-resolvers.test.ts` (or extend if it exists)
- Modify: `backend/src/routes/user-settings.routes.ts` (just the `UserSettings` type — see note below)

> **Note on shape:** The new `UserSettings.chat` shape is declared in this task because the resolver consumes it. The settings PATCH route (Task 4) and AI routes (Task 5) reuse the same type. Wire the type definition into `backend/src/routes/user-settings.routes.ts` first because that's where `UserSettings` is currently exported.

- [ ] **Step 1: Update the `UserSettings.chat` type in `user-settings.routes.ts`**

Find the exported `UserSettings` type (or its `chat` field) in `backend/src/routes/user-settings.routes.ts`. Replace the `chat` shape from the flat form to:

```ts
chat: {
  model: string | null;
  overrides: {
    [modelId: string]: {
      temperature?: number;
      topP?: number;
      maxTokens?: number;
    };
  };
};
```

Also update the `DEFAULT_SETTINGS.chat` literal at the same site. Find:
```ts
chat: { model: null as string | null, temperature: 0.85, topP: 0.95, maxTokens: 800 },
```
Replace with:
```ts
chat: { model: null as string | null, overrides: {} as Record<string, { temperature?: number; topP?: number; maxTokens?: number }> },
```

> The Zod schema at this site is updated separately in Task 4 (with its own tests). For now the schema may not match the type — that's fine; the type is what the resolver and route plumbing consume.

- [ ] **Step 2: Write the failing resolver tests**

Create `backend/tests/services/user-settings-resolvers.test.ts` (or add a new `describe` block if the file exists):

```ts
import { describe, expect, it } from 'vitest';
import { GLOBAL_TEXT_GEN_DEFAULTS } from '@/lib/text-gen-defaults';
import type { ModelInfo } from '@/services/venice.models.service';
import { resolveTextGenParams } from '@/services/user-settings-resolvers';
import type { UserSettings } from '@/routes/user-settings.routes';

const MODEL_WITH_DEFAULTS: ModelInfo = {
  id: 'qwen-3-6-plus',
  name: 'Qwen 3.6 Plus',
  contextLength: 1_000_000,
  maxCompletionTokens: 65_536,
  supportsReasoning: true,
  supportsVision: true,
  supportsWebSearch: true,
  description: null,
  pricing: null,
  defaultTemperature: 0.7,
  defaultTopP: 0.8,
};

const MODEL_BARE: ModelInfo = {
  ...MODEL_WITH_DEFAULTS,
  id: 'bare-model',
  defaultTemperature: null,
  defaultTopP: null,
};

const SMALL_MODEL: ModelInfo = {
  ...MODEL_WITH_DEFAULTS,
  id: 'small-model',
  maxCompletionTokens: 500,
};

function settingsWith(overrides: UserSettings['chat']['overrides']): UserSettings {
  return {
    chat: { model: null, overrides },
  } as UserSettings;
}

describe('resolveTextGenParams', () => {
  it('uses Venice defaults when no override and Venice exposes them', () => {
    const result = resolveTextGenParams(settingsWith({}), MODEL_WITH_DEFAULTS);
    expect(result.temperature).toBe(0.7);
    expect(result.top_p).toBe(0.8);
    expect(result.source.temperature).toBe('venice-default');
    expect(result.source.top_p).toBe('venice-default');
  });

  it('falls back to global defaults when Venice exposes nothing', () => {
    const result = resolveTextGenParams(settingsWith({}), MODEL_BARE);
    expect(result.temperature).toBe(GLOBAL_TEXT_GEN_DEFAULTS.temperature);
    expect(result.top_p).toBe(GLOBAL_TEXT_GEN_DEFAULTS.topP);
    expect(result.source.temperature).toBe('global-default');
    expect(result.source.top_p).toBe('global-default');
  });

  it('user override wins over Venice default', () => {
    const result = resolveTextGenParams(
      settingsWith({ 'qwen-3-6-plus': { temperature: 1.2 } }),
      MODEL_WITH_DEFAULTS,
    );
    expect(result.temperature).toBe(1.2);
    expect(result.source.temperature).toBe('override');
    // top_p untouched — falls back to Venice
    expect(result.top_p).toBe(0.8);
    expect(result.source.top_p).toBe('venice-default');
  });

  it('partial overrides per model — only set fields override', () => {
    const result = resolveTextGenParams(
      settingsWith({ 'bare-model': { topP: 0.5 } }),
      MODEL_BARE,
    );
    expect(result.top_p).toBe(0.5);
    expect(result.source.top_p).toBe('override');
    expect(result.temperature).toBe(GLOBAL_TEXT_GEN_DEFAULTS.temperature);
    expect(result.source.temperature).toBe('global-default');
  });

  it('overrides are scoped per modelId — other models unaffected', () => {
    const result = resolveTextGenParams(
      settingsWith({ 'other-model': { temperature: 1.5 } }),
      MODEL_WITH_DEFAULTS,
    );
    expect(result.temperature).toBe(0.7);
    expect(result.source.temperature).toBe('venice-default');
  });

  it('maxTokens override caps at modelInfo.maxCompletionTokens with override-capped source', () => {
    const result = resolveTextGenParams(
      settingsWith({ 'small-model': { maxTokens: 9_999 } }),
      SMALL_MODEL,
    );
    expect(result.max_completion_tokens).toBe(500);
    expect(result.source.max_completion_tokens).toBe('override-capped');
  });

  it('maxTokens override under cap is reported as override (not capped)', () => {
    const result = resolveTextGenParams(
      settingsWith({ 'small-model': { maxTokens: 200 } }),
      SMALL_MODEL,
    );
    expect(result.max_completion_tokens).toBe(200);
    expect(result.source.max_completion_tokens).toBe('override');
  });

  it('maxTokens with no override falls to global default capped by model max', () => {
    const result = resolveTextGenParams(settingsWith({}), SMALL_MODEL);
    // global default 800 > model cap 500 → cap wins, source is venice-default
    // (the cap came from the model itself, not from a user override)
    expect(result.max_completion_tokens).toBe(500);
    expect(result.source.max_completion_tokens).toBe('venice-default');
  });

  it('treats overrides[modelId] === {} identically to absent key', () => {
    const result = resolveTextGenParams(
      settingsWith({ 'qwen-3-6-plus': {} }),
      MODEL_WITH_DEFAULTS,
    );
    expect(result.source.temperature).toBe('venice-default');
    expect(result.source.top_p).toBe('venice-default');
    expect(result.source.max_completion_tokens).toBe('venice-default');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && npx vitest run tests/services/user-settings-resolvers.test.ts`
Expected: FAIL — `resolveTextGenParams` not exported.

- [ ] **Step 4: Implement the resolver**

Edit `backend/src/services/user-settings-resolvers.ts`. Add the import and the resolver:

```ts
import { GLOBAL_TEXT_GEN_DEFAULTS } from '@/lib/text-gen-defaults';
import type { ModelInfo } from '@/services/venice.models.service';
import type { UserSettings } from '@/routes/user-settings.routes';

export type ParamSource =
  | 'override'
  | 'override-capped'
  | 'venice-default'
  | 'global-default';

export interface ResolvedTextGenParams {
  temperature: number;
  top_p: number;
  max_completion_tokens: number;
  source: {
    temperature: ParamSource;
    top_p: ParamSource;
    max_completion_tokens: ParamSource;
  };
}

export function resolveTextGenParams(
  settings: UserSettings,
  modelInfo: ModelInfo,
): ResolvedTextGenParams {
  const override = settings.chat.overrides?.[modelInfo.id] ?? {};

  // temperature
  let temperature: number;
  let temperatureSource: ParamSource;
  if (typeof override.temperature === 'number') {
    temperature = override.temperature;
    temperatureSource = 'override';
  } else if (typeof modelInfo.defaultTemperature === 'number') {
    temperature = modelInfo.defaultTemperature;
    temperatureSource = 'venice-default';
  } else {
    temperature = GLOBAL_TEXT_GEN_DEFAULTS.temperature;
    temperatureSource = 'global-default';
  }

  // top_p
  let top_p: number;
  let topPSource: ParamSource;
  if (typeof override.topP === 'number') {
    top_p = override.topP;
    topPSource = 'override';
  } else if (typeof modelInfo.defaultTopP === 'number') {
    top_p = modelInfo.defaultTopP;
    topPSource = 'venice-default';
  } else {
    top_p = GLOBAL_TEXT_GEN_DEFAULTS.topP;
    topPSource = 'global-default';
  }

  // max_completion_tokens — capped at modelInfo.maxCompletionTokens
  const cap = modelInfo.maxCompletionTokens;
  let max_completion_tokens: number;
  let maxSource: ParamSource;
  if (typeof override.maxTokens === 'number') {
    if (override.maxTokens > cap) {
      max_completion_tokens = cap;
      maxSource = 'override-capped';
    } else {
      max_completion_tokens = override.maxTokens;
      maxSource = 'override';
    }
  } else {
    // No user override. Apply global default but cap to model max — when
    // capped, the cap came from Venice's published model max, so source is
    // 'venice-default' (not 'override-capped', which is reserved for a
    // user override that exceeded the cap).
    max_completion_tokens = Math.min(GLOBAL_TEXT_GEN_DEFAULTS.maxTokens, cap);
    maxSource = max_completion_tokens === cap && GLOBAL_TEXT_GEN_DEFAULTS.maxTokens > cap
      ? 'venice-default'
      : 'global-default';
  }

  return {
    temperature,
    top_p,
    max_completion_tokens,
    source: {
      temperature: temperatureSource,
      top_p: topPSource,
      max_completion_tokens: maxSource,
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx vitest run tests/services/user-settings-resolvers.test.ts`
Expected: PASS, all 8 resolver cases green.

- [ ] **Step 6: Run typecheck**

Run: `cd backend && npm run typecheck`
Expected: clean. (Existing AI/chat routes already destructure `settings.chat.maxTokens`; that line will fail to typecheck. **Leave this for Task 5** — the AI routes aren't called by the resolver test, and Task 5 is the dedicated step that updates them. If typecheck fails on those route files now, note it in the commit message but proceed; Task 5 fixes it.)

> **Important:** if typecheck DOES fail in this task because of the `UserSettings.chat` shape change cascading into `prompt.service.ts` (which reads `settings.chat.maxTokens`), update only the read path in `prompt.service.ts` to use `settings.chat.overrides?.[modelId]?.maxTokens ?? GLOBAL_TEXT_GEN_DEFAULTS.maxTokens` capped at `modelInfo.maxCompletionTokens` — i.e. inline the same chain — and add a `// TODO X28: replace with resolveTextGenParams` comment for Task 5 to clean up.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/user-settings-resolvers.ts backend/tests/services/user-settings-resolvers.test.ts backend/src/routes/user-settings.routes.ts
# include prompt.service.ts only if Step 6's note applied
git add backend/src/services/prompt.service.ts 2>/dev/null || true
git commit -m "[story-editor-tdc] add resolveTextGenParams + chat.overrides shape"
```

---

### Task 4: Settings PATCH route schema — accept new shape, reject old shape

**Files:**
- Modify: `backend/src/routes/user-settings.routes.ts`
- Modify: `backend/tests/routes/user-settings.test.ts`

- [ ] **Step 1: Inspect existing PATCH tests**

Run: `grep -n "chat" backend/tests/routes/user-settings.test.ts | head -20`
Note any test that PATCHes the old shape (e.g. `{ chat: { temperature: 0.5 } }`). Those need updating to the new shape.

- [ ] **Step 2: Write the failing schema tests**

Add to `backend/tests/routes/user-settings.test.ts` (after the existing PATCH cases):

```ts
describe('PATCH /api/users/me/settings — chat.overrides shape (X28)', () => {
  it('accepts a chat.overrides patch with one model', async () => {
    const res = await authedRequest()
      .patch('/api/users/me/settings')
      .send({ chat: { overrides: { 'qwen-3-6-plus': { temperature: 0.4 } } } });
    expect(res.status).toBe(200);
    expect(res.body.settings.chat.overrides['qwen-3-6-plus']).toEqual({ temperature: 0.4 });
  });

  it('accepts partial overrides — only set fields are persisted', async () => {
    const res = await authedRequest()
      .patch('/api/users/me/settings')
      .send({ chat: { overrides: { 'm1': { topP: 0.6 } } } });
    expect(res.status).toBe(200);
    expect(res.body.settings.chat.overrides['m1']).toEqual({ topP: 0.6 });
  });

  it('rejects unknown fields inside an override', async () => {
    const res = await authedRequest()
      .patch('/api/users/me/settings')
      .send({ chat: { overrides: { 'm1': { topK: 40 } } } });
    expect(res.status).toBe(400);
  });

  it('rejects the legacy flat chat.temperature field', async () => {
    const res = await authedRequest()
      .patch('/api/users/me/settings')
      .send({ chat: { temperature: 0.5 } });
    expect(res.status).toBe(400);
  });

  it('rejects out-of-range override values', async () => {
    const res = await authedRequest()
      .patch('/api/users/me/settings')
      .send({ chat: { overrides: { 'm1': { temperature: 5 } } } });
    expect(res.status).toBe(400);
  });
});
```

Update any pre-existing PATCH test that sent `{ chat: { temperature: ... } }` to use the new shape: `{ chat: { overrides: { '<modelId>': { temperature: ... } } } }`.

- [ ] **Step 3: Run tests to verify the new ones fail**

Run: `cd backend && npx vitest run tests/routes/user-settings.test.ts`
Expected: FAIL on the new cases (schema still accepts old shape).

- [ ] **Step 4: Update the Zod schema**

Edit `backend/src/routes/user-settings.routes.ts`. Find the existing PATCH body schema (the one with `chat: z.object({ ..., topP: z.number().min(0).max(1).optional(), ... })`). Replace its `chat` block with:

```ts
chat: z
  .object({
    model: z.string().nullable().optional(),
    overrides: z
      .record(
        z.string(),
        z
          .object({
            temperature: z.number().min(0).max(2).optional(),
            topP: z.number().min(0).max(1).optional(),
            maxTokens: z.number().int().positive().optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict()
  .optional(),
```

- [ ] **Step 5: Confirm the read-side tolerates legacy shape**

In the same file, find the JSON column read site (where stored settings deserialise into `UserSettings`). Confirm it uses `.strip()` or similar (the project default for Zod is to strip unknown keys). If the read path uses a strict schema, change it to `.strip()` for the chat block so legacy dev-DB rows with stale flat fields don't error on read — the unknown `temperature` / `topP` / `maxTokens` keys at the top level of `chat` are silently dropped, leaving `{ model, overrides: {} }`.

If you can't tell whether `.strip()` is in effect, add a single test:

```ts
it('read tolerates legacy flat chat fields (silently strips them)', async () => {
  // Simulate a row with the legacy shape directly via Prisma update.
  // (Path-specific to the project; if the user-settings row is JSON-typed,
  // a $queryRaw or direct prisma.user.update sets this up.)
  // Then GET /api/users/me/settings and expect chat to deserialise to
  // { model: null, overrides: {} }, status 200.
});
```

- [ ] **Step 6: Run all `user-settings.test.ts` cases**

Run: `cd backend && npx vitest run tests/routes/user-settings.test.ts`
Expected: PASS, all cases green (existing + new).

- [ ] **Step 7: Run backend full test suite**

Run: `cd backend && npm test`
Expected: PASS. If anything else breaks, it's a route or service that still reads the flat `chat.temperature` / `chat.topP` / `chat.maxTokens`. The next task fixes the AI routes; if anything else surfaces, fix inline (likely `prompt.service.ts` if not already adjusted in Task 3 Step 6).

- [ ] **Step 8: Commit**

```bash
git add backend/src/routes/user-settings.routes.ts backend/tests/routes/user-settings.test.ts
git commit -m "[story-editor-tdc] settings PATCH: chat.overrides schema, reject legacy shape"
```

---

### Task 5: AI route plumbing — call resolver, add debug log, send temperature/top_p

**Files:**
- Modify: `backend/src/routes/ai.routes.ts`
- Modify: `backend/src/routes/chat.routes.ts`
- Modify: `backend/src/services/prompt.service.ts` (only if Task 3 Step 6 didn't already adjust the maxTokens read path)
- Modify: existing AI/chat route tests to assert payload contains the resolved fields.

- [ ] **Step 1: Locate the existing AI route test that asserts the Venice payload**

Run: `grep -rn "client\.chat\.completions\|max_completion_tokens" backend/tests/routes/ | head -10`
Identify the test file(s) that mock `client.chat.completions.create` and capture its argument. The new tests assert `temperature` and `top_p` are present on that captured argument. If no such mock-capture exists today, add one in the AI route test file using the same mock pattern that captures `max_completion_tokens` (search the file for `max_completion_tokens` to find the existing assertion — duplicate that pattern for `temperature` and `top_p`).

- [ ] **Step 2: Write the failing AI-route assertion**

Add (or extend) a test in the AI routes test file:

```ts
it('passes resolved temperature and top_p to Venice (X28)', async () => {
  // Pre-seed user settings with a per-model override.
  await setUserSettings(userId, {
    chat: { model: null, overrides: { 'test-model': { temperature: 0.4, topP: 0.6 } } },
  });

  // Stub the model catalogue so Venice defaults are deterministic.
  vi.mocked(veniceModelsService.findModel).mockReturnValue({
    id: 'test-model',
    name: 'Test',
    contextLength: 8000,
    maxCompletionTokens: 2000,
    supportsReasoning: false,
    supportsVision: false,
    supportsWebSearch: false,
    description: null,
    pricing: null,
    defaultTemperature: 0.7,  // would lose to override 0.4
    defaultTopP: 0.8,          // would lose to override 0.6
  });

  const captured: { temperature?: number; top_p?: number; max_completion_tokens?: number } = {};
  vi.mocked(client.chat.completions.create).mockImplementationOnce((args) => {
    captured.temperature = args.temperature;
    captured.top_p = args.top_p;
    captured.max_completion_tokens = args.max_completion_tokens;
    return mockStreamWithResponse([]);
  });

  await postAiComplete({ modelId: 'test-model', /* ...other required fields... */ });

  expect(captured.temperature).toBe(0.4);
  expect(captured.top_p).toBe(0.6);
  expect(captured.max_completion_tokens).toBeLessThanOrEqual(2000);
});
```

> The exact test scaffolding (`setUserSettings`, `postAiComplete`, mock setup) follows the conventions already in the AI route test file. Reuse them.

Add the symmetric test to the chat route test file.

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && npx vitest run tests/routes/ai.test.ts tests/routes/chat.routes.test.ts`
Expected: FAIL — `temperature` and `top_p` are absent from the captured Venice payload.

- [ ] **Step 4: Wire `resolveTextGenParams` into ai.routes.ts**

Edit `backend/src/routes/ai.routes.ts`. Just before the `client.chat.completions.create({...})` call (around line 213), add:

```ts
import { resolveTextGenParams } from '@/services/user-settings-resolvers';

// ...inside the route handler, after modelInfo + userSettings are in scope:
const resolvedParams = resolveTextGenParams(userSettings, modelInfo);

if (process.env.NODE_ENV !== 'production') {
  console.log(
    '[venice.params]',
    JSON.stringify({
      route: 'ai-complete',
      userId,
      modelId: body.modelId,
      temperature: { value: resolvedParams.temperature, source: resolvedParams.source.temperature },
      top_p: { value: resolvedParams.top_p, source: resolvedParams.source.top_p },
      max_completion_tokens: {
        value: resolvedParams.max_completion_tokens,
        source: resolvedParams.source.max_completion_tokens,
      },
    }),
  );
}
```

In the `client.chat.completions.create({...})` argument object, add the three resolved fields and **replace** the existing `max_completion_tokens` with `resolvedParams.max_completion_tokens`:

```ts
.create({
  model: body.modelId,
  messages,
  stream: true as const,
  temperature: resolvedParams.temperature,
  top_p: resolvedParams.top_p,
  max_completion_tokens: resolvedParams.max_completion_tokens,
  prompt_cache_key: promptCacheKey(body.storyId, body.modelId),
  venice_parameters,
} as unknown as Parameters<typeof client.chat.completions.create>[0])
```

- [ ] **Step 5: Wire `resolveTextGenParams` into chat.routes.ts**

Repeat the same change in `backend/src/routes/chat.routes.ts` (the call site is around line 364). Use `route: 'chat'` in the debug log payload instead of `'ai-complete'`.

- [ ] **Step 6: Clean up `prompt.service.ts` if it has the temporary inline chain**

If Task 3 Step 6 added an inline maxTokens chain in `prompt.service.ts` with a `TODO X28` comment, replace it with a call to `resolveTextGenParams` (or simpler: have the route compute `max_completion_tokens` via the resolver and pass it into `buildPrompt`). The cleanest end-state is that `prompt.service.ts` does not read `settings.chat.*` directly at all — the route resolves and passes the budget in.

- [ ] **Step 7: Run AI/chat route tests**

Run: `cd backend && npx vitest run tests/routes/ai.test.ts tests/routes/chat.routes.test.ts`
Expected: PASS. The new assertions confirm `temperature` and `top_p` reach Venice.

- [ ] **Step 8: Run backend full test suite + typecheck**

Run: `cd backend && npm test && npm run typecheck`
Expected: all green.

- [ ] **Step 9: Manually verify the debug log**

Bring up the dev stack: `make dev` (from repo root).
Trigger an AI completion through the UI (any selection-bubble action or chat send).
In a separate terminal: `make logs | grep venice.params`
Expected: a single JSON line per call, with `temperature` / `top_p` / `max_completion_tokens` and a `source` map. Confirm values match what the user has set (or fall back to Venice / global as expected).

- [ ] **Step 10: Commit**

```bash
git add backend/src/routes/ai.routes.ts backend/src/routes/chat.routes.ts backend/src/services/prompt.service.ts backend/tests/routes/
git commit -m "[story-editor-tdc] AI routes: pass resolved temperature/top_p to Venice + debug log"
```

---

### Task 6: Frontend `useUserSettings` — type change + `resolveChatParams` helper

**Files:**
- Modify: `frontend/src/hooks/useUserSettings.ts`
- Modify (or create): `frontend/tests/hooks/useUserSettings.test.tsx`

- [ ] **Step 1: Update the `UserSettings.chat` type**

Edit `frontend/src/hooks/useUserSettings.ts`. Find the `UserSettings` type's `chat` field and replace with:

```ts
chat: {
  model: string | null;
  overrides: Record<
    string,
    {
      temperature?: number;
      topP?: number;
      maxTokens?: number;
    }
  >;
};
```

Update `DEFAULT_SETTINGS.chat` in the same file:
```ts
chat: { model: null, overrides: {} },
```

- [ ] **Step 2: Write the failing resolver tests**

Add to `frontend/tests/hooks/useUserSettings.test.tsx` (or create the file):

```tsx
import { describe, expect, it } from 'vitest';
import { resolveChatParams } from '@/hooks/useUserSettings';
import { GLOBAL_TEXT_GEN_DEFAULTS } from '@/lib/textGenDefaults';
import type { ModelInfo } from '@/hooks/useModels';  // adjust import to wherever the frontend ModelInfo type lives

const MODEL_WITH_DEFAULTS: ModelInfo = {
  id: 'qwen-3-6-plus',
  name: 'Qwen 3.6 Plus',
  contextLength: 1_000_000,
  maxCompletionTokens: 65_536,
  supportsReasoning: true,
  supportsVision: true,
  supportsWebSearch: true,
  description: null,
  pricing: null,
  defaultTemperature: 0.7,
  defaultTopP: 0.8,
};

const MODEL_BARE: ModelInfo = { ...MODEL_WITH_DEFAULTS, id: 'bare', defaultTemperature: null, defaultTopP: null };

describe('resolveChatParams (frontend)', () => {
  it('uses Venice default when no override and Venice exposes one', () => {
    const r = resolveChatParams(
      { chat: { model: null, overrides: {} } } as never,
      MODEL_WITH_DEFAULTS,
    );
    expect(r.temperature).toBe(0.7);
    expect(r.source.temperature).toBe('venice-default');
  });

  it('falls back to global default when Venice exposes neither', () => {
    const r = resolveChatParams(
      { chat: { model: null, overrides: {} } } as never,
      MODEL_BARE,
    );
    expect(r.temperature).toBe(GLOBAL_TEXT_GEN_DEFAULTS.temperature);
    expect(r.source.temperature).toBe('global-default');
  });

  it('user override wins', () => {
    const r = resolveChatParams(
      { chat: { model: null, overrides: { 'qwen-3-6-plus': { temperature: 1.2 } } } } as never,
      MODEL_WITH_DEFAULTS,
    );
    expect(r.temperature).toBe(1.2);
    expect(r.source.temperature).toBe('override');
  });

  it('reports overridden flags for Reset-button enablement', () => {
    const r = resolveChatParams(
      { chat: { model: null, overrides: { 'qwen-3-6-plus': { topP: 0.5 } } } } as never,
      MODEL_WITH_DEFAULTS,
    );
    expect(r.overridden).toEqual({ temperature: false, topP: true, maxTokens: false });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/hooks/useUserSettings.test.tsx`
Expected: FAIL — `resolveChatParams` not exported.

- [ ] **Step 4: Implement `resolveChatParams`**

In `frontend/src/hooks/useUserSettings.ts`, add:

```ts
import { GLOBAL_TEXT_GEN_DEFAULTS } from '@/lib/textGenDefaults';

export type ChatParamSource =
  | 'override'
  | 'override-capped'
  | 'venice-default'
  | 'global-default';

export interface ResolvedChatParams {
  temperature: number;
  topP: number;
  maxTokens: number;
  source: {
    temperature: ChatParamSource;
    topP: ChatParamSource;
    maxTokens: ChatParamSource;
  };
  overridden: {
    temperature: boolean;
    topP: boolean;
    maxTokens: boolean;
  };
}

export function resolveChatParams(
  settings: UserSettings,
  modelInfo: ModelInfo,
): ResolvedChatParams {
  const override = settings.chat.overrides?.[modelInfo.id] ?? {};

  const tempOverride = typeof override.temperature === 'number';
  const topPOverride = typeof override.topP === 'number';
  const maxOverride = typeof override.maxTokens === 'number';

  const temperature = tempOverride
    ? override.temperature!
    : (modelInfo.defaultTemperature ?? GLOBAL_TEXT_GEN_DEFAULTS.temperature);
  const tempSource: ChatParamSource = tempOverride
    ? 'override'
    : modelInfo.defaultTemperature !== null
      ? 'venice-default'
      : 'global-default';

  const topP = topPOverride
    ? override.topP!
    : (modelInfo.defaultTopP ?? GLOBAL_TEXT_GEN_DEFAULTS.topP);
  const topPSource: ChatParamSource = topPOverride
    ? 'override'
    : modelInfo.defaultTopP !== null
      ? 'venice-default'
      : 'global-default';

  const cap = modelInfo.maxCompletionTokens;
  let maxTokens: number;
  let maxSource: ChatParamSource;
  if (maxOverride) {
    if (override.maxTokens! > cap) {
      maxTokens = cap;
      maxSource = 'override-capped';
    } else {
      maxTokens = override.maxTokens!;
      maxSource = 'override';
    }
  } else {
    maxTokens = Math.min(GLOBAL_TEXT_GEN_DEFAULTS.maxTokens, cap);
    maxSource = maxTokens === cap && GLOBAL_TEXT_GEN_DEFAULTS.maxTokens > cap
      ? 'venice-default'
      : 'global-default';
  }

  return {
    temperature,
    topP,
    maxTokens,
    source: { temperature: tempSource, topP: topPSource, maxTokens: maxSource },
    overridden: { temperature: tempOverride, topP: topPOverride, maxTokens: maxOverride },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/hooks/useUserSettings.test.tsx`
Expected: PASS, all 4 frontend resolver cases green.

- [ ] **Step 6: Run frontend typecheck**

Run: `cd frontend && npm run typecheck`
Expected: FAIL on call sites that read the old `chat.{temperature,topP,maxTokens}` flat fields:
- `SettingsModelsTab.tsx`
- `ChatPanel.tsx`
- `Settings.stories.tsx`

These are fixed in Task 7 + Task 8 + Task 9. **Don't fix them yet** — keep the typecheck failure pinned to those three files for now.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/hooks/useUserSettings.ts frontend/tests/hooks/useUserSettings.test.tsx
git commit -m "[story-editor-tdc] frontend: resolveChatParams + chat.overrides shape"
```

---

### Task 7: Settings → Models tab — sliders bind to active model + Reset button

**Files:**
- Modify: `frontend/src/components/SettingsModelsTab.tsx`
- Modify: `frontend/tests/components/Settings.models.test.tsx`

- [ ] **Step 1: Read the current Models test file end-to-end**

Run: `cat frontend/tests/components/Settings.models.test.tsx | wc -l` then read the whole file.
The test currently asserts the OLD flat-shape behavior (slider values reflect `settings.chat.{temperature, topP, maxTokens}`). It will rewrite extensively. Plan the rewrite around these scenarios:

1. Sliders show the active model's resolved values (Venice default if no override).
2. Switching the active model in the picker updates the slider readouts.
3. Slider tick PATCHes `chat.overrides[activeModelId].field`.
4. Other models' overrides are untouched by edits to the active model.
5. Reset button is disabled when the active model has no overrides.
6. Clicking Reset PATCHes `chat.overrides[activeModelId] = {}` and leaves other models' overrides intact.
7. When `chat.model === null`, sliders are disabled with a tooltip.
8. Tooltip text on Reset reflects the resolved fallback (Venice vs general).

- [ ] **Step 2: Write the failing rewrites**

Replace the body of `frontend/tests/components/Settings.models.test.tsx` with the new scenarios. Keep the existing `renderTab` / `setSettings` helpers (or whatever the file uses for harnessing the QueryClient and seeding data) — only the assertions change. Sketch:

```tsx
it('sliders show resolved values for the active model (Venice default when no override)', async () => {
  setModels([{ id: 'm1', defaultTemperature: 0.7, defaultTopP: 0.8, maxCompletionTokens: 65_536, /* ... */ }]);
  setSettings({ chat: { model: 'm1', overrides: {} } });
  await renderTab();
  expect(await screen.findByTestId('param-temperature')).toHaveValue('0.7');
  expect(screen.getByTestId('param-top-p')).toHaveValue('0.8');
});

it('switching the active model in the picker updates slider readouts', async () => {
  setModels([
    { id: 'm1', defaultTemperature: 0.7, defaultTopP: 0.8, /* ... */ },
    { id: 'm2', defaultTemperature: 1.2, defaultTopP: 0.95, /* ... */ },
  ]);
  setSettings({ chat: { model: 'm1', overrides: {} } });
  const { user } = await renderTab();
  await user.click(screen.getByRole('button', { name: /use this model.*m2/i }));
  await waitFor(() => {
    expect(screen.getByTestId('param-temperature')).toHaveValue('1.2');
  });
});

it('dragging temperature PATCHes chat.overrides[activeModelId].temperature', async () => {
  setModels([{ id: 'm1', defaultTemperature: 0.7, /* ... */ }]);
  setSettings({ chat: { model: 'm1', overrides: {} } });
  const { user, captureBody } = await renderTab();
  // ...drive slider to 1.25...
  await waitFor(() => {
    const body = captureBody();
    expect(body).toEqual({ chat: { overrides: { m1: { temperature: 1.25 } } } });
  });
});

it('Reset button is disabled when no overrides set for active model', async () => {
  setModels([{ id: 'm1', defaultTemperature: 0.7, /* ... */ }]);
  setSettings({ chat: { model: 'm1', overrides: {} } });
  await renderTab();
  expect(screen.getByRole('button', { name: /reset to defaults/i })).toBeDisabled();
});

it('Reset button clears overrides for the active model only', async () => {
  setModels([{ id: 'm1', /* ... */ }, { id: 'm2', /* ... */ }]);
  setSettings({
    chat: {
      model: 'm1',
      overrides: { m1: { temperature: 1.5 }, m2: { topP: 0.5 } },
    },
  });
  const { user, captureBody } = await renderTab();
  const reset = screen.getByRole('button', { name: /reset to defaults/i });
  expect(reset).not.toBeDisabled();
  await user.click(reset);
  await waitFor(() => {
    const body = captureBody();
    expect(body).toEqual({ chat: { overrides: { m1: {} } } });
  });
});

it('sliders are disabled when chat.model is null', async () => {
  setModels([{ id: 'm1', /* ... */ }]);
  setSettings({ chat: { model: null, overrides: {} } });
  await renderTab();
  expect(screen.getByTestId('param-temperature')).toBeDisabled();
  expect(screen.getByTestId('param-top-p')).toBeDisabled();
  expect(screen.getByTestId('param-max-tokens')).toBeDisabled();
});

it('Reset tooltip mentions Venice defaults when both are exposed', async () => {
  setModels([{ id: 'm1', defaultTemperature: 0.7, defaultTopP: 0.8, /* ... */ }]);
  setSettings({ chat: { model: 'm1', overrides: { m1: { temperature: 1.5 } } } });
  await renderTab();
  const reset = screen.getByRole('button', { name: /reset to defaults/i });
  // The tooltip text is on a `title` attribute or aria-describedby element.
  // Match the substring "Venice" + the specific values.
  expect(reset.getAttribute('title') ?? '').toMatch(/venice/i);
  expect(reset.getAttribute('title') ?? '').toMatch(/0\.7/);
});

it('Reset tooltip says "general defaults" when Venice exposes neither', async () => {
  setModels([{ id: 'm1', defaultTemperature: null, defaultTopP: null, /* ... */ }]);
  setSettings({ chat: { model: 'm1', overrides: { m1: { temperature: 1.5 } } } });
  await renderTab();
  const reset = screen.getByRole('button', { name: /reset to defaults/i });
  expect(reset.getAttribute('title') ?? '').toMatch(/general/i);
});
```

> Existing `setSettings` / `setModels` helpers in the file dictate the exact harness shape. If `setModels` doesn't exist (i.e. the test wasn't seeding model info before), add it as part of this rewrite — it pre-seeds the `useModelsQuery` cache via `qc.setQueryData`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/components/Settings.models.test.tsx`
Expected: FAIL across the board.

- [ ] **Step 4: Rewrite `SettingsModelsTab.tsx`**

Replace the body of `frontend/src/components/SettingsModelsTab.tsx` (keep the file-level imports and any helper components like `SliderRow` that aren't shape-dependent):

```tsx
import { useId, useMemo } from 'react';
import type { JSX } from 'react';
import { useModelsQuery } from '@/hooks/useModels';
import { resolveChatParams, useUpdateUserSetting, useUserSettings } from '@/hooks/useUserSettings';

// ...keep SliderRow definition unchanged...

export function SettingsModelsTab(): JSX.Element {
  const tempId = useId();
  const topPId = useId();
  const maxTokensId = useId();

  const settings = useUserSettings();
  const updateSetting = useUpdateUserSetting();
  const modelsQuery = useModelsQuery();
  const activeModelId = settings.chat.model;
  const activeModel = useMemo(
    () => (modelsQuery.data ?? []).find((m) => m.id === activeModelId) ?? null,
    [modelsQuery.data, activeModelId],
  );

  const resolved = activeModel ? resolveChatParams(settings, activeModel) : null;
  const slidersDisabled = activeModel === null;

  const onField = (field: 'temperature' | 'topP' | 'maxTokens') => (value: number): void => {
    if (activeModelId === null) return;
    const next = field === 'maxTokens' ? Math.round(value) : value;
    updateSetting.mutate({
      chat: {
        overrides: {
          [activeModelId]: {
            ...(settings.chat.overrides?.[activeModelId] ?? {}),
            [field]: next,
          },
        },
      },
    });
  };

  const hasAnyOverride = !!resolved && (
    resolved.overridden.temperature ||
    resolved.overridden.topP ||
    resolved.overridden.maxTokens
  );

  const onReset = (): void => {
    if (activeModelId === null) return;
    updateSetting.mutate({ chat: { overrides: { [activeModelId]: {} } } });
  };

  const resetTooltip = useMemo(() => {
    if (!resolved || !activeModel) return undefined;
    const venice = resolved.source.temperature === 'venice-default' || resolved.source.topP === 'venice-default';
    if (venice) {
      const t = activeModel.defaultTemperature !== null ? `temp ${activeModel.defaultTemperature}` : null;
      const p = activeModel.defaultTopP !== null ? `topP ${activeModel.defaultTopP}` : null;
      const parts = [t, p].filter(Boolean).join(', ');
      return `Reverts to ${activeModel.name} defaults from Venice (${parts})`;
    }
    return 'Reverts to general defaults';
  }, [resolved, activeModel]);

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3" data-testid="models-section-list">
        <p className="text-[12px] text-ink-4 font-sans">
          Pick the default model used for chat and continuations.
        </p>
        <ModelPickerInline
          models={modelsQuery.data ?? []}
          activeId={activeModelId}
          loading={modelsQuery.isLoading}
          error={modelsQuery.isError}
          onUseModel={(id) => updateSetting.mutate({ chat: { model: id } })}
        />
      </section>

      <section className="flex flex-col gap-3" data-testid="models-section-params">
        <header className="flex items-center justify-between">
          <div>
            <h3 className="m-0 font-serif text-[14px] font-medium text-ink">Generation parameters</h3>
            <p className="mt-[2px] text-[12px] text-ink-4 font-sans">
              {slidersDisabled
                ? 'Pick a model above to tune its parameters.'
                : 'Live tuning for the chat composer and continue-writing.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onReset}
            disabled={slidersDisabled || !hasAnyOverride}
            title={resetTooltip}
            className="text-[12px] font-sans text-ink-3 disabled:opacity-50 hover:text-ink"
            data-testid="param-reset"
          >
            Reset to defaults
          </button>
        </header>

        <SliderRow
          id={tempId}
          label="Temperature"
          hint="Creativity vs. focus"
          min={0}
          max={2}
          step={0.05}
          value={resolved?.temperature ?? 0}
          decimals={2}
          testId="param-temperature"
          onChange={onField('temperature')}
          disabled={slidersDisabled}
        />
        <SliderRow
          id={topPId}
          label="Top P"
          hint="Nucleus sampling"
          min={0}
          max={1}
          step={0.05}
          value={resolved?.topP ?? 0}
          decimals={2}
          testId="param-top-p"
          onChange={onField('topP')}
          disabled={slidersDisabled}
        />
        <SliderRow
          id={maxTokensId}
          label="Max tokens"
          hint="Response length cap"
          min={1}
          max={32_000}
          step={64}
          value={resolved?.maxTokens ?? 0}
          decimals={0}
          testId="param-max-tokens"
          onChange={onField('maxTokens')}
          disabled={slidersDisabled}
        />
      </section>
    </div>
  );
}
```

If `SliderRow` doesn't currently accept a `disabled` prop, add one and propagate it to the underlying `<input type="range">` and `<label>` styling.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/components/Settings.models.test.tsx`
Expected: PASS, all rewrites green. Iterate on small selector/wording mismatches if any.

- [ ] **Step 6: Run typecheck**

Run: `cd frontend && npm run typecheck`
Expected: still failing on `ChatPanel.tsx` and `Settings.stories.tsx`. Those are Task 8 + Task 9.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/SettingsModelsTab.tsx frontend/tests/components/Settings.models.test.tsx
git commit -m "[story-editor-tdc] SettingsModelsTab: bind sliders to active model + reset"
```

---

### Task 8: ChatPanel header — read resolved params via `resolveChatParams`

**Files:**
- Modify: `frontend/src/components/ChatPanel.tsx`

- [ ] **Step 1: Locate the header line**

The current line is at `frontend/src/components/ChatPanel.tsx:261`:
```tsx
{`temp ${params.temperature}  top_p ${params.topP}  max ${params.maxTokens}`}
```
`params` was previously `settings.chat`. After Task 6, `settings.chat` no longer has flat fields.

- [ ] **Step 2: Wire the resolver**

Replace the `params` source. Find `const params = settings.chat;` (or equivalent) earlier in the file and remove it. Add:

```tsx
import { resolveChatParams } from '@/hooks/useUserSettings';
import { useModelsQuery } from '@/hooks/useModels';

// ...inside component...
const settings = useUserSettings();
const modelsQuery = useModelsQuery();
const activeModel = (modelsQuery.data ?? []).find((m) => m.id === settings.chat.model) ?? null;
const params = activeModel ? resolveChatParams(settings, activeModel) : null;
```

Replace the header line:
```tsx
{params
  ? `temp ${params.temperature.toFixed(2)}  top_p ${params.topP.toFixed(2)}  max ${params.maxTokens}`
  : '— pick a model in Settings'}
```

- [ ] **Step 3: Run typecheck**

Run: `cd frontend && npm run typecheck`
Expected: clean except for `Settings.stories.tsx` which is the next task.

- [ ] **Step 4: Run any existing ChatPanel tests**

Run: `cd frontend && npx vitest run tests/components/ChatPanel.test.tsx`
Expected: PASS or only fail on the param-display assertion. If a test asserts the literal `temp 0.85 ...` line, update its setup to seed the models query with a model that produces those values.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ChatPanel.tsx frontend/tests/components/ChatPanel.test.tsx 2>/dev/null
git commit -m "[story-editor-tdc] ChatPanel: read resolved params via resolveChatParams"
```

---

### Task 9: Storybook fixture + final integration check

**Files:**
- Modify: `frontend/src/components/Settings.stories.tsx`
- Modify: `frontend/tests/components/Settings.shell-venice.test.tsx` (only if it asserts on the chat shape)
- Update: bd `story-editor-tdc` notes

- [ ] **Step 1: Update the Storybook fixture**

Find the line in `frontend/src/components/Settings.stories.tsx` (around line 31):
```ts
chat: { model: 'llama-3.3-70b', temperature: 0.7, topP: 1, maxTokens: 2048 },
```
Replace with:
```ts
chat: { model: 'llama-3.3-70b', overrides: { 'llama-3.3-70b': { temperature: 0.7, topP: 1, maxTokens: 2048 } } },
```

- [ ] **Step 2: Audit `Settings.shell-venice.test.tsx`**

Run: `grep -n "temperature\|topP\|maxTokens" frontend/tests/components/Settings.shell-venice.test.tsx`
If any line references the flat shape in fixture data or assertions, update to the new shape. If only types/imports are affected, no change needed.

- [ ] **Step 3: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: all green.

- [ ] **Step 4: Run frontend typecheck + lint:design**

Run: `cd frontend && npm run typecheck && npm run lint:design`
Expected: both clean.

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && npm test`
Expected: all green.

- [ ] **Step 6: Final integration smoke (manual)**

`make dev`. In the browser:
1. Open Settings → Models. Pick a model that exposes Venice defaults (per the qwen-3-6-plus sample). Verify sliders show `0.7 / 0.8` and the Reset button is disabled.
2. Drag temperature to 1.2. Verify the slider updates, the PATCH fires (network tab), and the Reset button enables.
3. Switch to a different model. Verify sliders snap to that model's defaults; the previous model's override is preserved (switch back to confirm 1.2 is still there).
4. Click Reset on a model that has overrides. Verify sliders snap back to that model's defaults; Reset disables.
5. Trigger an AI completion (selection bubble + "rewrite", or chat send). In `make logs`, grep `venice.params` and confirm the resolved values match what the UI showed.

- [ ] **Step 7: Update bd `story-editor-tdc` verify line**

Run:
```bash
bd update story-editor-tdc --notes "$(printf 'plan: docs/superpowers/plans/2026-05-07-x28-per-model-params.md\nverify: cd backend && npx vitest run tests/services/user-settings-resolvers.test.ts tests/services/venice.models.service.test.ts tests/lib/text-gen-defaults.test.ts tests/routes/user-settings.test.ts && cd ../frontend && npx vitest run tests/components/Settings.models.test.tsx tests/hooks/useUserSettings.test.tsx\nref: TASKS.md [X28] (now scoped + planned)')"
```

- [ ] **Step 8: Run the verify line via `/task-verify` to confirm it passes**

Run: `bash .claude/skills/task-verify/run.sh story-editor-tdc`
Expected: exit 0, all enumerated tests green.

- [ ] **Step 9: Commit + push + open PR**

```bash
git add frontend/src/components/Settings.stories.tsx frontend/tests/components/Settings.shell-venice.test.tsx 2>/dev/null
git add .beads/issues.jsonl
git commit -m "[story-editor-tdc] Storybook fixture + final wire-through"
git push -u origin feature/x28-per-model-params
bd dolt push
gh pr create --title "[tdc] X28 per-model generation parameters" --body "..."
```

PR body summarises the four shipped pieces (wiring fix, settings reshape, Venice-default extraction, Reset button, debug log) and links the spec.

---

## Self-review checklist

- [x] **Spec coverage:** every spec section has a task — defaults chain (Tasks 2 + 3), settings shape (Task 4), AI route plumbing + debug log (Task 5), frontend resolver (Task 6), UI rewrite + Reset (Task 7), ChatPanel header (Task 8), Storybook (Task 9). Bug fix (`temperature` / `top_p` reach Venice) is in Task 5.
- [x] **No placeholders:** every step has either runnable code, a runnable command, or a concrete instruction. The two `// ...other required fields...` comments in Task 5 Step 2 are intentional — the test scaffold is local to the project's existing AI route test conventions; the runner must duplicate the existing pattern (search for `max_completion_tokens`).
- [x] **Type consistency:** `resolveTextGenParams` (backend) returns OpenAI-API-style snake_case (`top_p`, `max_completion_tokens`); `resolveChatParams` (frontend) returns UI-shape camelCase (`topP`, `maxTokens`). The boundary is intentional — backend hands directly to the OpenAI SDK call, frontend feeds React UI.
- [x] **No data-migration code** — confirmed in Tasks 1, 4, 6 (relies on Zod `.strip()` for legacy DB rows).
