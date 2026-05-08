# [X28 / story-editor-tdc] Per-model generation parameters — design

**Status:** Spec drafted 2026-05-07. Bd issue: `story-editor-tdc`.

## Problem

The Settings → Models tab has sliders for **temperature**, **top P**, and
**max tokens** that are bound to `settings.chat.{temperature, topP,
maxTokens}`. The values persist to the user-settings JSON column and display
back correctly, but they have **no effect on AI output**:

- `settings.chat.maxTokens` IS read by the backend
  (`prompt.service.ts` → `max_completion_tokens` to Venice). ✓
- `settings.chat.temperature` and `settings.chat.topP` are **never read on
  the backend**. Both AI routes (`ai.routes.ts:213` and `chat.routes.ts:364`)
  build the `client.chat.completions.create()` payload without them.

On top of that, today's settings shape applies one tuning set to every model
the user picks. Different models have different sensible defaults (Venice's
`/models` exposes per-model `temperature` and `top_p` defaults under
`model_spec.constraints`), and a user who tunes for one model gets that same
tuning carried over the moment they switch to another — which is rarely what
they want.

## Goals

1. Wire `temperature` and `top_p` through to Venice on both AI surfaces (the
   bug fix).
2. Reshape `settings.chat` so generation parameters are stored per
   `modelId`, with each field independently optional.
3. Source defaults from Venice's `/v1/models` response when present, falling
   back to a single hardcoded global default when Venice doesn't expose
   them.
4. Add a single section-level **Reset to defaults** button under the three
   sliders that clears all overrides for the active model.
5. Add a non-production debug log at the Venice call site so we can confirm
   the resolved values reach the API as expected.

## Non-goals

- No data-migration code for the settings shape change. Per CLAUDE.md
  "Don't write data-migration branches" — pre-deployment, no real users
  exist; dev/test DBs reset on next `npm run db:test:reset`. Zod's default
  `.strip()` mode tolerates legacy shape on read by silently dropping the
  unknown flat fields.
- No per-slider "revert" affordance — single section-level Reset only.
- No second model picker on the Models tab. Sliders always reflect the
  active model picked above (`settings.chat.model`).
- No structured-observability framework for the debug log — that's
  `story-editor-myi` (X34). This spec ships a single `console.log` gated
  on `NODE_ENV !== 'production'`.

## Settings shape

```ts
chat: {
  model: string | null;
  overrides: {
    [modelId: string]: {
      temperature?: number;  // 0..2
      topP?: number;          // 0..1
      maxTokens?: number;     // positive int, capped at modelInfo.maxCompletionTokens
    };
  };
}
```

The old flat fields (`chat.temperature`, `chat.topP`, `chat.maxTokens`) are
**removed**. Each override field is independently optional so a user can
override topP without forcing temperature or maxTokens to a value.

## Defaults chain

For any (modelId, field) tuple, the effective value is resolved in this
order:

1. **`override`** — `settings.chat.overrides[modelId][field]` if set.
2. **`venice-default`** — Venice `/v1/models` per-model default if exposed
   (see "Venice models parser extension" below).
3. **`global-default`** — hardcoded fallback constants:
   - `temperature: 0.85`
   - `topP: 0.95`
   - `maxTokens: 800`

`max_completion_tokens` has an additional cap step: the user override is
clamped to `Math.min(override, modelInfo.maxCompletionTokens)` so a user
override can never exceed the model's hard upper bound from Venice. When
the cap kicks in, the source is reported as `override-capped` (distinct
from `override`) so the debug log and frontend can surface it.

## Components

### Backend

#### Venice models parser extension
`backend/src/services/venice.models.service.ts`

- Add `defaultTemperature: number | null` and `defaultTopP: number | null`
  to `ModelInfo`.
- Parse from `model_spec.constraints.temperature.default` and
  `model_spec.constraints.top_p.default`. Both null when missing.
  Tolerate `constraints` itself being absent.
- Sample `/v1/models` payload (Venice docs / live response,
  2026-05-07):

  ```json
  "constraints": {
    "temperature": { "default": 0.7 },
    "top_p":       { "default": 0.8 }
  }
  ```

  `constraints.temperature` may also carry `min` / `max` / `step` keys
  (not parsed in v1; we only read `default`).

#### Resolver
`backend/src/services/user-settings-resolvers.ts`

```ts
type ParamSource =
  | 'override'
  | 'override-capped'      // only valid for max_completion_tokens
  | 'venice-default'
  | 'global-default';

interface ResolvedTextGenParams {
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
): ResolvedTextGenParams;
```

Pure function. Caller passes already-fetched `modelInfo`. The `source` map
drives both the debug log and the frontend tooltip on the Reset button.

#### AI route plumbing

Both `backend/src/routes/ai.routes.ts` and `backend/src/routes/chat.routes.ts`
already have `userSettings` and `modelInfo` in scope by the time they reach
the Venice call. Diff:

```ts
// before:
.create({
  model: body.modelId,
  messages,
  stream: true as const,
  max_completion_tokens,
  prompt_cache_key: ...,
  venice_parameters,
})

// after:
const resolved = resolveTextGenParams(userSettings, modelInfo);

if (process.env.NODE_ENV !== 'production') {
  console.log('[venice.params]', JSON.stringify({
    route: 'ai-complete',  // or 'chat'
    userId, modelId: body.modelId,
    temperature:           { value: resolved.temperature,           source: resolved.source.temperature },
    top_p:                 { value: resolved.top_p,                 source: resolved.source.top_p },
    max_completion_tokens: { value: resolved.max_completion_tokens, source: resolved.source.max_completion_tokens },
  }));
}

.create({
  model: body.modelId,
  messages,
  stream: true as const,
  temperature: resolved.temperature,
  top_p: resolved.top_p,
  max_completion_tokens: resolved.max_completion_tokens,
  prompt_cache_key: ...,
  venice_parameters,
})
```

The OpenAI SDK accepts `temperature` and `top_p` as top-level fields; they
hit Venice's OpenAI-compatible endpoint at the wire as snake-case `top_p`.

#### Settings PATCH route schema
`backend/src/routes/user-settings.routes.ts`

Replace the flat `chat.temperature` / `chat.topP` / `chat.maxTokens` fields
with:

```ts
chat: z.object({
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
}).strict(),
```

The outer `.strict()` rejects unknown top-level keys under `chat`. The
inner override-record uses `.strict()` to reject unknown fields per
modelId. The default `.strip()` behaviour at the JSON-column read site
silently drops legacy flat fields — no migration code needed.

### Frontend

#### Settings type + resolver
`frontend/src/hooks/useUserSettings.ts`

- Update `UserSettings.chat` to the new shape (`model`, `overrides`).
- Add `resolveChatParams(settings, modelInfo): ResolvedChatParams` mirroring
  the backend resolver. Returns the same `{ value, source }` shape.
- `DEFAULT_SETTINGS.chat` becomes `{ model: null, overrides: {} }`.
- Default constants (`temperature: 0.85`, `topP: 0.95`,
  `maxTokens: 800`) are duplicated in `backend/src/lib/text-gen-defaults.ts`
  and `frontend/src/lib/textGenDefaults.ts` (the project has no `shared/`
  dir; types are conventionally re-declared per-side, see e.g. `Character`).
  A small parity test in `backend/tests/lib/text-gen-defaults.test.ts`
  hardcodes the expected constants and asserts both sides match — this
  catches drift if someone edits one side and not the other.

#### Settings → Models tab
`frontend/src/components/SettingsModelsTab.tsx`

- Sliders read **resolved** values (override → Venice → global) for the
  active model. Use `useModelsQuery` to get `modelInfo` for the resolver.
- Slider tick PATCHes `chat.overrides[activeModelId].field`. The other
  models' overrides remain untouched.
- When `chat.model` is `null` (no model picked), sliders render disabled
  with a tooltip: *"Pick a model above to tune its parameters"*.
- Single **Reset to defaults** button below the three sliders:
  - Disabled when no overrides set for the active model
    (`!source.temperature === 'override' && ...`).
  - On click: PATCH `chat.overrides[activeModelId] = {}` (empty object,
    not key removal — the resolver treats `overrides[modelId] === {}` and
    `overrides[modelId] === undefined` identically as "no overrides", so
    this is simpler than dispatching a remove-key mutation through the
    PATCH-merge path). Other models' overrides untouched.
  - Tooltip text reflects which fallback applies, derived from the
    `source` map after a hypothetical reset:
    - "Reverts to *Qwen 3.6 Plus* defaults from Venice (temp 0.7, topP 0.8)"
      when both Venice defaults exist;
    - "Reverts to general defaults" when Venice exposes neither;
    - mixed copy when only one is Venice-supplied.

#### ChatPanel header
`frontend/src/components/ChatPanel.tsx:261`

The `temp X / top_p Y / max Z` line currently reads
`settings.chat.{temperature, topP, maxTokens}`. After the shape change,
those keys don't exist. Replace with `resolveChatParams(...)` driven by the
active model.

## Tests

### Backend

- **`backend/tests/services/user-settings-resolvers.test.ts`** —
  cases for the override → Venice → global chain per field:
  - Both Venice defaults present, no override → `venice-default`.
  - Venice default present, user override → `override`.
  - Venice default absent → `global-default`.
  - Partial override (only `topP`) → mixed source map.
  - `maxTokens` override exceeds `modelInfo.maxCompletionTokens` →
    capped, source `override-capped`.

- **`backend/tests/services/venice.models.service.test.ts`** — parser
  extracts `defaultTemperature` / `defaultTopP` when
  `constraints.{temperature,top_p}.default` is present; both null when
  absent; both null when `constraints` is absent.

- **AI route tests** (existing files): assert the Venice payload
  receives the resolver's `temperature`, `top_p`, `max_completion_tokens`.
  This is the bug-fix proof.

- **`backend/tests/routes/user-settings.routes.test.ts`** — PATCH schema
  accepts new shape; rejects unknown fields under override; rejects
  legacy flat `chat.temperature` (now an unknown key under `chat`).

### Frontend

- **`frontend/tests/components/SettingsModelsTab.test.tsx`** —
  - Sliders re-display when `chat.model` changes (other-model overrides
    don't bleed through).
  - Editing a slider PATCHes `chat.overrides[activeModelId]`, leaves
    other models' overrides untouched.
  - Reset button disabled when no overrides set; clicking Reset clears
    only the active model's overrides; tooltip copy reflects fallback.
  - Sliders disabled when `chat.model === null`.

- **`frontend/tests/hooks/useUserSettings.test.tsx`** — frontend resolver
  parity with backend resolver (same chain logic, same `source`
  classifications).

## Migration / rollout

- Single PR bundling backend + frontend + tests, on
  `feature/x28-per-model-params`.
- No data-migration code. Dev/test DBs reset on next
  `npm run db:test:reset`. Zod `.strip()` tolerates legacy shape on read.
- Verify line for `story-editor-tdc`:
  ```
  cd backend && npx vitest run tests/services/user-settings-resolvers.test.ts tests/services/venice.models.service.test.ts tests/lib/text-gen-defaults.test.ts tests/routes/user-settings.routes.test.ts && cd ../frontend && npx vitest run tests/components/SettingsModelsTab.test.tsx tests/hooks/useUserSettings.test.tsx
  ```
  This hits the resolver chain on both sides, the parser extension, the
  defaults parity test, the schema test, and the Models-tab UI test.
  Existing AI-route tests (which assert the Venice payload now contains
  `temperature` / `top_p`) are not enumerated explicitly because they're
  edits to existing files that the broader backend test sweep already
  catches; if the writing-plans pass identifies a specific path worth
  pinning, the verify line should be updated to include it.

## Open questions resolved during design

- *"Where do per-model defaults come from?"* — Venice
  `model_spec.constraints.{temperature,top_p}.default` when exposed,
  hardcoded global fallback otherwise.
- *"How does the UI tie sliders to a model?"* — sliders always reflect
  the active model from the picker above; no separate config picker.
- *"Reset granularity?"* — single section-level button only.
- *"Logging scope?"* — single `console.log` at the Venice call site,
  gated on `NODE_ENV !== 'production'`. Structured observability is
  X34's scope, not this spec's.

## Out of scope / explicitly deferred

- The remaining 52 act() warnings tracked by `story-editor-10m`. This
  spec adds one new test file and edits a couple of existing ones; any
  warnings that surface get the X15 pattern (`await screen.findBy*` /
  `await waitFor`) only if they're trivially fixable, otherwise they
  feed back into 10m's residual scope.
- Per-model presets (e.g. "Creative" / "Precise" / "Balanced" buttons)
  — possible follow-up if users ask.
- Surfacing the resolution source in the slider UI itself (e.g. a "•"
  dot indicating "this is your override"). Consider after v1 ships.
