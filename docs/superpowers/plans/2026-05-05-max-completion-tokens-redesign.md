# max_completion_tokens correctness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop sending Venice an oversized `max_completion_tokens`, plumb the per-model cap from `/v1/models` end-to-end, honour `settings.chat.maxTokens`, surface Venice's actual error text in the dev overlay, and fix the bundled bubble-action mapping so *Describe* triggers `describe` (not `summarise`).

**Architecture:** Three numbers feed one wire field. The Venice models cache exposes the per-model cap (`getModelMaxCompletionTokens`); routes look it up alongside the user's `settings.chat.maxTokens`; the pure builder takes both as required parameters and writes `max_completion_tokens = min(model_cap, user_setting)`. Prompt budget is derived as `contextLength − responseTokens − 512`. A new shared resolver module lifts the four duplicated `settingsJson` helpers out of both AI route files.

**Tech Stack:** Node 20 / Express / Prisma / Zod (backend); Vitest for unit + route tests on backend; Vitest + jsdom + Testing Library on frontend; React 19 + TanStack Query + Zustand on frontend; OpenAI SDK v6 to talk to Venice.

**Branch:** `fix/max-completion-tokens` (already cut from `origin/main`, spec committed at `03beb47`).

**Spec:** [`docs/superpowers/specs/2026-05-05-max-completion-tokens-redesign-design.md`](../specs/2026-05-05-max-completion-tokens-redesign-design.md).

---

## File Structure

| File | Role | Action |
|---|---|---|
| `backend/src/services/venice.models.service.ts` | Venice models cache; mapping + per-user cache; lookup helpers | Modify (extend `ModelInfo`, mapping fallback, `getModelMaxCompletionTokens`) |
| `backend/src/services/prompt.service.ts` | Pure prompt builder; the 0.2/0.8 heuristic dies here | Modify (new required params, derived prompt budget, `SAFETY_MARGIN_TOKENS`) |
| `backend/src/services/user-settings-resolvers.ts` | Shared `settingsJson` helpers | **Create** |
| `backend/src/routes/ai.routes.ts` | POST `/api/ai/complete` — inline AI streaming | Modify (use shared resolvers; new lookups; pass new fields to `buildPrompt`) |
| `backend/src/routes/chat.routes.ts` | POST `/api/chats/:id/messages` — chat streaming | Modify (same as above) |
| `backend/src/routes/user-settings.routes.ts` | Settings PATCH/GET; Zod schema | Modify (`max(32_768)` → `max(1_000_000)`) |
| `backend/src/lib/venice-errors.ts` | Maps `APIError` → user-facing JSON / SSE | Modify (forward 400/404/422; add `details.veniceMessage`; sanitise) |
| `backend/tests/services/venice.models.service.test.ts` | Cache mapping unit tests | Modify (existing fixtures + new cap tests) |
| `backend/tests/services/prompt.service.test.ts` | Builder unit tests | Modify (drop 0.2 tests; add table-driven; update budget assertions) |
| `backend/tests/services/prompt.actions.test.ts` | Per-action unit tests | Modify (update `baseInput()` defaults) |
| `backend/tests/services/prompt.user-prompts.test.ts` | User-prompt-override unit tests | Modify (update `baseInput()` defaults) |
| `backend/tests/services/prompt.mockup-actions.test.ts` | Mockup-action unit tests | Modify (update `baseInput()` defaults) |
| `backend/tests/services/prompt.venice-params.test.ts` | venice_parameters unit tests | Modify (update `baseInput()` defaults) |
| `backend/tests/ai/complete.test.ts` | Inline AI route integration test | Modify (model fixtures get `maxCompletionTokens`; new assertions) |
| `backend/tests/ai/chat-persistence.test.ts` | Chat route integration test | Modify (model fixtures get `maxCompletionTokens`; new assertion) |
| `backend/tests/ai/models.test.ts` | Models route output | Modify (expect new field on response) |
| `backend/tests/ai/error-handling.test.ts` | AI error mapping integration | Modify (update for forwarded 400/404/422 statuses if asserted) |
| `backend/tests/lib/venice-errors.test.ts` | Mapping unit tests | Modify (forwarding + `details.veniceMessage` cases) |
| `backend/tests/services/user-settings-resolvers.test.ts` | Resolver unit tests | **Create** |
| `frontend/src/hooks/useChat.ts` | Chat send mutation | Modify (forward `ApiError.code` in three catches) |
| `frontend/tests/hooks/useChat.test.tsx` | Chat hook unit tests | Modify (assert forwarded code) |
| `frontend/src/components/SettingsModelsTab.tsx` | Settings → Models slider | Modify (`max={8000}` → `max={32_000}`) |
| `frontend/src/pages/EditorPage.tsx` | Inline-bubble action dispatcher | Modify (`ACTION_MAP` 1:1) |
| `frontend/src/hooks/useAICompletion.ts` | Inline AI run hook + `RunArgs` type | Modify (widen `action` union) |
| `frontend/tests/pages/editor-ai.integration.test.tsx` | Inline AI integration | Modify (assert mapped action ids) |

---

## Task Sequencing

1. Cache extension (Venice → `ModelInfo`) — no callers yet, safe first step.
2. Shared resolvers module — mechanical refactor; both routes still work after.
3. Pure builder rewrite — TDD-shaped; updates downstream test files in same task to keep typecheck clean.
4. Routes wire-through — depends on (1) and (3).
5. Settings schema cleanup — independent; small.
6. Venice error fidelity — independent of token plumbing.
7. Frontend chat code forwarding — independent of backend changes.
8. Frontend slider literal — trivial.
9. Frontend `ACTION_MAP` fix — last, isolated.
10. Open PR.

Each task is self-contained, ends with a green typecheck, and a single commit. No "broken in commit N, fixed in N+1" sequences.

---

## Task 1: Extend `ModelInfo` with `maxCompletionTokens`

**Files:**
- Modify: `backend/src/services/venice.models.service.ts`
- Modify: `backend/tests/services/venice.models.service.test.ts`

- [ ] **Step 1: Write the failing tests**

Append at the bottom of `backend/tests/services/venice.models.service.test.ts`, just inside the closing brace of the outermost `describe('venice.models.service [V2]', ...)` block (before `});` on the last line):

```ts
  describe('maxCompletionTokens mapping', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('maps spec.maxCompletionTokens onto ModelInfo when present', async () => {
      const m: VeniceRawModel = {
        id: 'has-cap',
        object: 'model',
        type: 'text',
        model_spec: {
          name: 'Has Cap',
          availableContextTokens: 65536,
          // @ts-expect-error — field is absent from the test's local raw type
          maxCompletionTokens: 8192,
        },
      };
      const { client } = makeListStub([m]);
      const svc = createVeniceModelsService({ getClient: async () => client });
      const [only] = await svc.fetchModels('user-1');
      expect(only.maxCompletionTokens).toBe(8192);
    });

    it('falls back to 4096 and warns once when maxCompletionTokens is missing', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const m: VeniceRawModel = {
        id: 'no-cap',
        object: 'model',
        type: 'text',
        model_spec: {
          name: 'No Cap',
          availableContextTokens: 65536,
        },
      };
      const { client } = makeListStub([m]);
      const svc = createVeniceModelsService({ getClient: async () => client });
      const [only] = await svc.fetchModels('user-1');
      expect(only.maxCompletionTokens).toBe(4096);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toContain('no-cap');
    });

    it('falls back to 4096 and warns when maxCompletionTokens is zero or negative', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const zero: VeniceRawModel = {
        id: 'zero-cap',
        object: 'model',
        type: 'text',
        model_spec: {
          name: 'Zero',
          availableContextTokens: 65536,
          // @ts-expect-error — local type omits field
          maxCompletionTokens: 0,
        },
      };
      const neg: VeniceRawModel = {
        id: 'neg-cap',
        object: 'model',
        type: 'text',
        model_spec: {
          name: 'Neg',
          availableContextTokens: 65536,
          // @ts-expect-error — local type omits field
          maxCompletionTokens: -10,
        },
      };
      const { client } = makeListStub([zero, neg]);
      const svc = createVeniceModelsService({ getClient: async () => client });
      const models = await svc.fetchModels('user-1');
      expect(models[0]?.maxCompletionTokens).toBe(4096);
      expect(models[1]?.maxCompletionTokens).toBe(4096);
      expect(warnSpy).toHaveBeenCalledTimes(2);
    });

    it('getModelMaxCompletionTokens returns the cap and throws UnknownModelError on miss', async () => {
      const m: VeniceRawModel = {
        id: 'has-cap-2',
        object: 'model',
        type: 'text',
        model_spec: {
          name: 'Has Cap 2',
          availableContextTokens: 65536,
          // @ts-expect-error — local type omits field
          maxCompletionTokens: 16384,
        },
      };
      const { client } = makeListStub([m]);
      const svc = createVeniceModelsService({ getClient: async () => client });
      await svc.fetchModels('user-1');
      expect(svc.getModelMaxCompletionTokens('has-cap-2')).toBe(16384);
      expect(() => svc.getModelMaxCompletionTokens('nope')).toThrow(UnknownModelError);
    });
  });
```

The first three tests will fail (`maxCompletionTokens` doesn't exist on `ModelInfo` yet → TS error → vitest reports "test file failed to compile"); the fourth test additionally calls a method that doesn't exist.

Update the existing `'filters to text-type models...'` test's expected output (lines ~110–141 of the file) — every object literal in that `toEqual([...])` needs `maxCompletionTokens: 4096` added. Concretely, find each:

```ts
        {
          id: 'llama-3.3-70b',
          name: 'Llama 3.3 70B',
          contextLength: 65536,
          supportsReasoning: false,
          ...
```

…and insert after `contextLength` line:

```ts
          maxCompletionTokens: 4096,
```

Same for the `qwen-qwq-32b` and `mistral-vision` entries. After this edit, that test would otherwise fail in the implementation step because the mapper now returns the new field (and `toEqual` is strict about extra keys).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix backend run test -- venice.models.service`

Expected: TypeScript compile error referencing `maxCompletionTokens` on `ModelInfo` and `getModelMaxCompletionTokens` not on the service. Or: tests run and fail because `console.warn` was never called and the field is `undefined`.

- [ ] **Step 3: Implement the change**

Edit `backend/src/services/venice.models.service.ts`:

1. Extend `ModelInfo`:

```ts
export interface ModelInfo {
  id: string;
  name: string;
  contextLength: number;
  maxCompletionTokens: number;
  supportsReasoning: boolean;
  supportsVision: boolean;
  supportsWebSearch: boolean;
  description: string | null;
  pricing: ModelPricing | null;
}
```

2. Extend `VeniceRawModelSpec`:

```ts
interface VeniceRawModelSpec {
  name?: string;
  availableContextTokens?: number;
  maxCompletionTokens?: number;
  capabilities?: VeniceRawCapabilities;
  description?: string;
  pricing?: {
    input?: { usd?: number };
    output?: { usd?: number };
  };
}
```

3. Add the fallback constant near the top of the file (under the `TTL_MS` line):

```ts
// Cap used when Venice's /v1/models omits or zeroes maxCompletionTokens.
// 4096 is below every observed Venice cap (lowest in the catalogue today is
// 4096 itself), so a request built against it will never trip the upstream
// "max_tokens > maximum allowed" 400.
const FALLBACK_MAX_COMPLETION_TOKENS = 4096;
```

4. Update `mapModel()` to read + fall back + warn:

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

  const rawCap = spec.maxCompletionTokens;
  let maxCompletionTokens: number;
  if (typeof rawCap === 'number' && rawCap > 0) {
    maxCompletionTokens = rawCap;
  } else {
    maxCompletionTokens = FALLBACK_MAX_COMPLETION_TOKENS;
    console.warn(
      `[venice.models] model "${raw.id}" exposes no positive maxCompletionTokens; defaulting to ${FALLBACK_MAX_COMPLETION_TOKENS}`,
    );
  }

  return {
    id: raw.id,
    name: spec.name ?? raw.id,
    contextLength:
      typeof spec.availableContextTokens === 'number' ? spec.availableContextTokens : 0,
    maxCompletionTokens,
    supportsReasoning: Boolean(caps.supportsReasoning),
    supportsVision: Boolean(caps.supportsVision),
    supportsWebSearch: Boolean(caps.supportsWebSearch),
    description,
    pricing,
  };
}
```

5. Add `getModelMaxCompletionTokens` inside `createVeniceModelsService`, mirroring `getModelContextLength`:

```ts
  function getModelMaxCompletionTokens(modelId: string): number {
    for (const entry of byUser.values()) {
      for (const m of entry.models) {
        if (m.id === modelId) return m.maxCompletionTokens;
      }
    }
    throw new UnknownModelError(modelId);
  }
```

6. Add it to the returned object:

```ts
  return { fetchModels, getModelContextLength, getModelMaxCompletionTokens, findModel, resetCache };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix backend run test -- venice.models.service`

Expected: all green (existing + 4 new tests).

- [ ] **Step 5: Run typecheck**

Run: `npm --prefix backend run typecheck`

Expected: clean (no TS errors anywhere — `ModelInfo` is exported and consumed by `findModel`'s return type but no caller reads `maxCompletionTokens` yet so widening is safe).

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/venice.models.service.ts \
        backend/tests/services/venice.models.service.test.ts
git commit -m "[fix-max-tokens] surface per-model maxCompletionTokens on ModelInfo

Read model_spec.maxCompletionTokens off Venice's /v1/models response,
fall back to 4096 with a one-time console.warn when it's missing or
non-positive. New cache method getModelMaxCompletionTokens mirrors the
existing getModelContextLength accessor.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Create shared user-settings resolvers module

**Files:**
- Create: `backend/src/services/user-settings-resolvers.ts`
- Create: `backend/tests/services/user-settings-resolvers.test.ts`
- Modify: `backend/src/routes/ai.routes.ts` (delete inline copies, import from new module)
- Modify: `backend/src/routes/chat.routes.ts` (same)

This task is a pure refactor — no behaviour change. It exists to (a) DRY up the four helpers duplicated across both route files, (b) give us a clean home for `resolveUserMaxCompletionTokens` in Task 4, and (c) gain a unit-test surface for the resolvers without spinning up the full route machinery.

- [ ] **Step 1: Create the new module**

Create `backend/src/services/user-settings-resolvers.ts`:

```ts
// Pure resolvers for User.settingsJson — the JSON blob is opaque from the
// Prisma side, so each AI/chat route had been re-deriving the same defensive
// reads from `unknown`. Lifted here so additions (chat.maxTokens in this PR,
// future temperature/topP plumbing) live alongside the existing ones.
//
// Each resolver returns a sane default for unset / non-object / wrong-shape
// inputs so callers can always pass the resolved value into buildPrompt
// without further branching.

export interface PromptsSettings {
  system?: string | null;
  continue?: string | null;
  rewrite?: string | null;
  expand?: string | null;
  summarise?: string | null;
  describe?: string | null;
}

interface UserSettingsShape {
  ai?: { includeVeniceSystemPrompt?: boolean };
  chat?: { maxTokens?: number };
  prompts?: PromptsSettings;
}

function asSettingsObject(raw: unknown): UserSettingsShape | null {
  if (!raw || typeof raw !== 'object') return null;
  return raw as UserSettingsShape;
}

export function resolveIncludeVeniceSystemPrompt(raw: unknown): boolean {
  const settings = asSettingsObject(raw);
  if (!settings) return true;
  const flag = settings.ai?.includeVeniceSystemPrompt;
  if (typeof flag === 'boolean') return flag;
  return true;
}

export function resolveUserPrompts(raw: unknown): PromptsSettings {
  const settings = asSettingsObject(raw);
  if (!settings) return {};
  return settings.prompts ?? {};
}
```

(`resolveUserMaxCompletionTokens` is intentionally NOT in this commit — it lands in Task 4 alongside the routes wiring it up. Leaving it out now keeps this commit a pure refactor.)

- [ ] **Step 2: Write resolver unit tests**

Create `backend/tests/services/user-settings-resolvers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  resolveIncludeVeniceSystemPrompt,
  resolveUserPrompts,
} from '../../src/services/user-settings-resolvers';

describe('resolveIncludeVeniceSystemPrompt', () => {
  it('defaults to true when raw is null', () => {
    expect(resolveIncludeVeniceSystemPrompt(null)).toBe(true);
  });
  it('defaults to true when raw is not an object', () => {
    expect(resolveIncludeVeniceSystemPrompt('nope')).toBe(true);
    expect(resolveIncludeVeniceSystemPrompt(42)).toBe(true);
  });
  it('defaults to true when ai.includeVeniceSystemPrompt is absent', () => {
    expect(resolveIncludeVeniceSystemPrompt({})).toBe(true);
    expect(resolveIncludeVeniceSystemPrompt({ ai: {} })).toBe(true);
  });
  it('returns the explicit value when set', () => {
    expect(resolveIncludeVeniceSystemPrompt({ ai: { includeVeniceSystemPrompt: false } })).toBe(
      false,
    );
    expect(resolveIncludeVeniceSystemPrompt({ ai: { includeVeniceSystemPrompt: true } })).toBe(
      true,
    );
  });
  it('ignores non-boolean values and falls back to true', () => {
    expect(
      resolveIncludeVeniceSystemPrompt({ ai: { includeVeniceSystemPrompt: 'yes' as unknown as boolean } }),
    ).toBe(true);
  });
});

describe('resolveUserPrompts', () => {
  it('returns {} when raw is null / not-an-object', () => {
    expect(resolveUserPrompts(null)).toEqual({});
    expect(resolveUserPrompts('nope')).toEqual({});
  });
  it('returns {} when prompts is absent', () => {
    expect(resolveUserPrompts({})).toEqual({});
  });
  it('returns the prompts slice when present', () => {
    expect(
      resolveUserPrompts({ prompts: { system: 'Hi', continue: null } }),
    ).toEqual({ system: 'Hi', continue: null });
  });
});
```

- [ ] **Step 3: Run the resolver tests to verify they pass**

Run: `npm --prefix backend run test -- user-settings-resolvers`

Expected: 8 / 8 green.

- [ ] **Step 4: Replace inline copies in `ai.routes.ts`**

In `backend/src/routes/ai.routes.ts`:

Delete the inline `interface AiSettings`, `interface PromptsSettings`, `interface UserSettings`, `function resolveIncludeVeniceSystemPrompt`, `function resolveUserPrompts` definitions (currently around lines 56–88).

Add an import near the existing service imports:

```ts
import {
  resolveIncludeVeniceSystemPrompt,
  resolveUserPrompts,
} from '../services/user-settings-resolvers';
```

Existing call sites continue to work unchanged.

- [ ] **Step 5: Replace inline copies in `chat.routes.ts`**

In `backend/src/routes/chat.routes.ts`: same pattern. Delete the local `interface AiSettings`, `interface PromptsSettings`, `interface UserSettings`, `function resolveIncludeVeniceSystemPrompt`, `function resolveUserPrompts` (currently ~lines 71–102). Add the same import.

- [ ] **Step 6: Run typecheck and the route tests**

Run: `npm --prefix backend run typecheck`

Expected: clean.

Run: `npm --prefix backend run test -- "ai/complete|chat-persistence|ai-defaults"`

Expected: existing tests still pass — pure refactor.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/user-settings-resolvers.ts \
        backend/tests/services/user-settings-resolvers.test.ts \
        backend/src/routes/ai.routes.ts \
        backend/src/routes/chat.routes.ts
git commit -m "[fix-max-tokens] lift user-settings resolvers into a shared module

The four defensive helpers around User.settingsJson were duplicated in
ai.routes.ts and chat.routes.ts after X29. Moves them to
src/services/user-settings-resolvers.ts so the new
resolveUserMaxCompletionTokens (next commit) lands in one place.

Pure refactor: no behaviour change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Rewrite the response/prompt budget in `buildPrompt`

**Files:**
- Modify: `backend/src/services/prompt.service.ts`
- Modify: `backend/tests/services/prompt.service.test.ts`
- Modify: `backend/tests/services/prompt.actions.test.ts`
- Modify: `backend/tests/services/prompt.user-prompts.test.ts`
- Modify: `backend/tests/services/prompt.mockup-actions.test.ts`
- Modify: `backend/tests/services/prompt.venice-params.test.ts`

`buildPrompt` becomes typecheck-incompatible the moment we add two required fields to `BuildPromptInput`. Five test files build `BuildPromptInput` literals via `baseInput()` helpers. We update them in the same commit so the tree is typecheck-clean.

- [ ] **Step 1: Write the failing tests**

Replace lines 72–88 of `backend/tests/services/prompt.service.test.ts` (the `describe('buildPrompt — max_completion_tokens', ...)` block) with the following table-driven block:

```ts
// ─── max_completion_tokens budget ─────────────────────────────────────────────

describe('buildPrompt — max_completion_tokens', () => {
  it('user_setting < model_cap → user_setting wins', () => {
    const r = buildPrompt(
      baseInput({
        modelContextLength: 128_000,
        modelMaxCompletionTokens: 32_000,
        userMaxCompletionTokens: 800,
      }),
    );
    expect(r.max_completion_tokens).toBe(800);
  });

  it('model_cap < user_setting → model_cap wins', () => {
    const r = buildPrompt(
      baseInput({
        modelContextLength: 128_000,
        modelMaxCompletionTokens: 4096,
        userMaxCompletionTokens: 16_000,
      }),
    );
    expect(r.max_completion_tokens).toBe(4096);
  });

  it('user_setting === model_cap → that value', () => {
    const r = buildPrompt(
      baseInput({
        modelContextLength: 128_000,
        modelMaxCompletionTokens: 8192,
        userMaxCompletionTokens: 8192,
      }),
    );
    expect(r.max_completion_tokens).toBe(8192);
  });

  it('user_setting === Number.POSITIVE_INFINITY (unset) → model_cap wins', () => {
    const r = buildPrompt(
      baseInput({
        modelContextLength: 128_000,
        modelMaxCompletionTokens: 16_384,
        userMaxCompletionTokens: Number.POSITIVE_INFINITY,
      }),
    );
    expect(r.max_completion_tokens).toBe(16_384);
  });

  it('does NOT apply the legacy 0.2 × context heuristic any more', () => {
    // For a 256k-context model, the old code would have produced 51200.
    // Under the new rule, the model_cap dominates.
    const r = buildPrompt(
      baseInput({
        modelContextLength: 256_000,
        modelMaxCompletionTokens: 32_768,
        userMaxCompletionTokens: Number.POSITIVE_INFINITY,
      }),
    );
    expect(r.max_completion_tokens).toBe(32_768);
    expect(r.max_completion_tokens).not.toBe(Math.floor(256_000 * 0.2));
  });

  it('response cap is NOT shrunk by prompt-budget pressure (response > context-safety)', () => {
    // Pathological: response cap wider than the model's context. The builder
    // must still honour the response contract; chapter content just falls out.
    const r = buildPrompt(
      baseInput({
        modelContextLength: 4096,
        modelMaxCompletionTokens: 8192,
        userMaxCompletionTokens: Number.POSITIVE_INFINITY,
        chapterContent: 'x'.repeat(40_000),
      }),
    );
    expect(r.max_completion_tokens).toBe(8192);
    // Chapter is dropped because promptBudget = 4096 - 8192 - 512 < 0.
    const userMsg = r.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userMsg).not.toContain('xxxx'); // no chapter content survives
  });
});
```

Update the existing chapter-truncation test (`'truncates chapterContent from the top when over budget'`, ~line 174) so its prompt-budget assertion uses the derived formula. Replace the assertion block:

```ts
    // The overall token count of the user message must be ≤ promptBudget
    const promptBudget = Math.floor(4096 * 0.8);
    const sysTokens = estimateTokens(result.messages[0]?.content ?? '');
    const userTokens = estimateTokens(userContent);
    expect(sysTokens + userTokens).toBeLessThanOrEqual(promptBudget + 10); // small rounding slack
```

…with:

```ts
    // The overall token count of the user message must be ≤ derived prompt
    // budget = contextLength - responseTokens - SAFETY_MARGIN_TOKENS.
    const responseTokens = Math.min(4096, Number.POSITIVE_INFINITY); // model cap = 4096, user unset
    const promptBudget = 4096 - responseTokens - 512;
    const userTokens = estimateTokens(userContent);
    expect(userTokens).toBeLessThanOrEqual(Math.max(0, promptBudget) + 10);
```

…and also update the local `baseInput()` helper (lines 32–42) to include defaults for the two new required fields:

```ts
function baseInput(overrides: Partial<BuildPromptInput> = {}): BuildPromptInput {
  return {
    action: 'continue',
    selectedText: 'She turned and ran.',
    chapterContent: 'It was a dark and stormy night.',
    characters: [],
    worldNotes: null,
    modelContextLength: 4096,
    modelMaxCompletionTokens: 4096,
    userMaxCompletionTokens: Number.POSITIVE_INFINITY,
    ...overrides,
  };
}
```

Apply the same `baseInput()` defaults update to:
- `backend/tests/services/prompt.actions.test.ts` (its local `baseInput`)
- `backend/tests/services/prompt.user-prompts.test.ts` (its local `baseInput`)
- `backend/tests/services/prompt.mockup-actions.test.ts` (its local `baseInput`)
- `backend/tests/services/prompt.venice-params.test.ts` (its local `baseInput`)

Each one needs the two new lines (`modelMaxCompletionTokens: 4096,` and `userMaxCompletionTokens: Number.POSITIVE_INFINITY,`) inserted right after the `modelContextLength: 4096,` line. No other changes to those files — they don't assert on response budget.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix backend run test -- "services/prompt"`

Expected: TS errors — `BuildPromptInput` is missing required properties. Or, after the test edits compile, the new `max_completion_tokens` cases fail (current code returns `Math.floor(256_000 * 0.2) = 51200`, not 32768).

- [ ] **Step 3: Implement the change**

Edit `backend/src/services/prompt.service.ts`:

1. Add the safety-margin constant near the top, after the `DEFAULT_PROMPTS` block (around line 80):

```ts
// Reserved tokens between the response budget and the prompt budget. Covers
// SSE/tokenizer drift and Venice-side overhead so a request sized at exactly
// (context - response) doesn't fail the upstream "prompt + completion >
// max_tokens" check intermittently.
export const SAFETY_MARGIN_TOKENS = 512;
```

2. Extend `BuildPromptInput` (in the existing interface declaration) — add two required fields next to `modelContextLength`:

```ts
export interface BuildPromptInput {
  action: PromptAction;
  selectedText: string;
  chapterContent: string;
  characters: CharacterContext[];
  worldNotes: string | null;
  modelContextLength: number;
  /** Per-model output cap from Venice's /v1/models. Required. */
  modelMaxCompletionTokens: number;
  /**
   * User's settings.chat.maxTokens. Required. Pass Number.POSITIVE_INFINITY
   * when the user hasn't expressed a preference; the resolver in
   * user-settings-resolvers.ts does this.
   */
  userMaxCompletionTokens: number;
  /** [V4] — default true when omitted */
  includeVeniceSystemPrompt?: boolean;
  /** [X29] User-level prompt overrides. Per key: non-empty trimmed string wins; null / undefined / whitespace falls back to DEFAULT_PROMPTS[key]. */
  userPrompts?: UserPrompts;
  /** Required when action === 'freeform' or 'ask'; optional otherwise */
  freeformInstruction?: string;
}
```

3. Replace the budget computation inside `buildPrompt`. Currently lines 143–148 are:

```ts
export function buildPrompt(input: BuildPromptInput): BuiltPrompt {
  const { modelContextLength } = input;

  const responseBudgetTokens = Math.floor(modelContextLength * 0.2);
  const promptBudgetTokens = Math.floor(modelContextLength * 0.8);
```

Replace with:

```ts
export function buildPrompt(input: BuildPromptInput): BuiltPrompt {
  const responseTokens = Math.min(
    input.modelMaxCompletionTokens,
    input.userMaxCompletionTokens,
  );
  const promptBudgetTokens = Math.max(
    0,
    input.modelContextLength - responseTokens - SAFETY_MARGIN_TOKENS,
  );
```

4. Replace the closing return's `max_completion_tokens` field (currently `responseBudgetTokens`):

```ts
    max_completion_tokens: responseTokens,
```

(`responseBudgetTokens` is no longer a defined name — `responseTokens` replaces it.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix backend run test -- "services/prompt"`

Expected: all green — five `prompt.*.test.ts` files, ~70+ tests collectively.

- [ ] **Step 5: Run typecheck**

Run: `npm --prefix backend run typecheck`

Expected: TS errors in `ai.routes.ts` and `chat.routes.ts` because they call `buildPrompt(...)` without the new required fields. **This is expected** — Task 4 wires them up. Document this here so the worker doesn't panic.

To keep this commit typecheck-clean, **temporarily** add the two fields with placeholder values to both route call sites of `buildPrompt`. The placeholder is removed in Task 4. Add right where `modelContextLength` is already passed:

In `backend/src/routes/ai.routes.ts`, in the `buildPrompt({...})` call (around line 195):

```ts
      const {
        messages,
        venice_parameters: baseVeniceParams,
        max_completion_tokens,
      } = buildPrompt({
        action: body.action,
        selectedText: body.selectedText,
        chapterContent,
        characters,
        worldNotes,
        modelContextLength,
        modelMaxCompletionTokens: modelContextLength, // TEMP: replaced in next commit
        userMaxCompletionTokens: Number.POSITIVE_INFINITY, // TEMP: replaced in next commit
        includeVeniceSystemPrompt,
        userPrompts,
        freeformInstruction: body.freeformInstruction,
      });
```

In `backend/src/routes/chat.routes.ts`, in the `buildPrompt({...})` call (around line 294):

```ts
      const {
        messages: baseMessages,
        venice_parameters: baseVeniceParams,
        max_completion_tokens,
      } = buildPrompt({
        action: 'ask',
        selectedText: body.attachment?.selectionText ?? '',
        chapterContent,
        characters,
        worldNotes,
        modelContextLength,
        modelMaxCompletionTokens: modelContextLength, // TEMP: replaced in next commit
        userMaxCompletionTokens: Number.POSITIVE_INFINITY, // TEMP: replaced in next commit
        includeVeniceSystemPrompt,
        userPrompts,
        freeformInstruction: body.content,
      });
```

The `modelContextLength` placeholder is *intentionally* worse than the real cap — it preserves today's behaviour (max_completion_tokens never below 0.2×ctx ⊆ ≤ ctx) for the duration of one commit. Task 4 replaces both lines.

Re-run typecheck: clean.

- [ ] **Step 6: Run the full backend test suite**

Run: `npm --prefix backend run test`

Expected: all green. Some `ai/*` and `chat-*` route tests may show different assert values for `max_completion_tokens` if any of them check the literal value — those tests should currently assert only "is a number", which they do (verified in `complete.test.ts:429`). No assertion changes needed yet.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/prompt.service.ts \
        backend/tests/services/prompt.service.test.ts \
        backend/tests/services/prompt.actions.test.ts \
        backend/tests/services/prompt.user-prompts.test.ts \
        backend/tests/services/prompt.mockup-actions.test.ts \
        backend/tests/services/prompt.venice-params.test.ts \
        backend/src/routes/ai.routes.ts \
        backend/src/routes/chat.routes.ts
git commit -m "[fix-max-tokens] derive response + prompt budget from real caps

buildPrompt now takes modelMaxCompletionTokens + userMaxCompletionTokens
as required inputs and writes max_completion_tokens = min(model, user).
Prompt budget for chapter truncation derives as
  promptBudget = contextLength - responseTokens - SAFETY_MARGIN_TOKENS
so honouring the user's slider on a high-context model leaves more
prompt-side room for chapter content, and the 0.2/0.8 literals die
entirely. Routes pass placeholder values that match the old behaviour;
the real lookups land in the next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Wire real caps through both AI routes

**Files:**
- Modify: `backend/src/services/user-settings-resolvers.ts` (add `resolveUserMaxCompletionTokens`)
- Modify: `backend/tests/services/user-settings-resolvers.test.ts` (test for new resolver)
- Modify: `backend/src/routes/ai.routes.ts` (real lookup)
- Modify: `backend/src/routes/chat.routes.ts` (real lookup)
- Modify: `backend/tests/ai/complete.test.ts` (model fixtures + new assertion)
- Modify: `backend/tests/ai/chat-persistence.test.ts` (model fixtures + new assertion)
- Modify: `backend/tests/ai/models.test.ts` (model fixtures + maxCompletionTokens in expected response)
- Modify: any other route test using `MODEL_LIST_BODY` fixtures (see Step 5)

- [ ] **Step 1: Write the resolver test**

Append to `backend/tests/services/user-settings-resolvers.test.ts`:

```ts
import { resolveUserMaxCompletionTokens } from '../../src/services/user-settings-resolvers';

describe('resolveUserMaxCompletionTokens', () => {
  it('returns POSITIVE_INFINITY when raw is null', () => {
    expect(resolveUserMaxCompletionTokens(null)).toBe(Number.POSITIVE_INFINITY);
  });
  it('returns POSITIVE_INFINITY when raw is not an object', () => {
    expect(resolveUserMaxCompletionTokens('nope')).toBe(Number.POSITIVE_INFINITY);
    expect(resolveUserMaxCompletionTokens(42)).toBe(Number.POSITIVE_INFINITY);
  });
  it('returns POSITIVE_INFINITY when chat.maxTokens is absent', () => {
    expect(resolveUserMaxCompletionTokens({})).toBe(Number.POSITIVE_INFINITY);
    expect(resolveUserMaxCompletionTokens({ chat: {} })).toBe(Number.POSITIVE_INFINITY);
  });
  it('returns POSITIVE_INFINITY when chat.maxTokens is non-numeric or non-positive', () => {
    expect(resolveUserMaxCompletionTokens({ chat: { maxTokens: 'lots' as unknown as number } })).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(resolveUserMaxCompletionTokens({ chat: { maxTokens: 0 } })).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(resolveUserMaxCompletionTokens({ chat: { maxTokens: -100 } })).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
  it('returns the explicit positive value when set', () => {
    expect(resolveUserMaxCompletionTokens({ chat: { maxTokens: 800 } })).toBe(800);
    expect(resolveUserMaxCompletionTokens({ chat: { maxTokens: 32_768 } })).toBe(32_768);
  });
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run: `npm --prefix backend run test -- user-settings-resolvers`

Expected: TS error — `resolveUserMaxCompletionTokens` not exported.

- [ ] **Step 3: Add the resolver**

Append to `backend/src/services/user-settings-resolvers.ts`:

```ts
/**
 * Resolves settings.chat.maxTokens to a number suitable for `Math.min` against
 * the model's per-model cap. Unset / non-numeric / non-positive values
 * collapse to Number.POSITIVE_INFINITY so the model cap wins by default.
 */
export function resolveUserMaxCompletionTokens(raw: unknown): number {
  const settings = asSettingsObject(raw);
  if (!settings) return Number.POSITIVE_INFINITY;
  const v = settings.chat?.maxTokens;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return v;
}
```

- [ ] **Step 4: Verify resolver tests pass**

Run: `npm --prefix backend run test -- user-settings-resolvers`

Expected: 13 / 13 green.

- [ ] **Step 5: Update Venice model fixtures across the route tests**

The existing `MODEL_LIST_BODY` constants in two AI test files lack `maxCompletionTokens`. The cache mapper now warns when the field is missing, which we don't want in the per-test logs. Edit:

In `backend/tests/ai/complete.test.ts` around lines 35–59:

```ts
const MODEL_LIST_BODY = {
  object: 'list',
  data: [
    {
      id: BASE_MODEL_ID,
      object: 'model',
      type: 'text',
      model_spec: {
        name: 'Llama 3.3 70B',
        availableContextTokens: BASE_CONTEXT_LENGTH,
        maxCompletionTokens: 4096,
        capabilities: { supportsReasoning: false, supportsVision: false },
      },
    },
    {
      id: 'qwen-qwq-32b',
      object: 'model',
      type: 'text',
      model_spec: {
        name: 'Qwen QwQ 32B',
        availableContextTokens: 32768,
        maxCompletionTokens: 16384,
        capabilities: { supportsReasoning: true, supportsVision: false },
      },
    },
  ],
};
```

In `backend/tests/ai/chat-persistence.test.ts` around lines 49–55:

```ts
      model_spec: {
        name: 'Llama 3.3 70B',
        availableContextTokens: BASE_CONTEXT_LENGTH,
        maxCompletionTokens: 4096,
        capabilities: { supportsReasoning: false, supportsVision: false },
      },
```

In `backend/tests/ai/models.test.ts` — also needs `maxCompletionTokens` added to its model fixtures, and any `expect.toEqual` on the API response shape needs `maxCompletionTokens: <value>` added to the matched objects. Locate every `model_spec: { ... availableContextTokens: ... }` and add `maxCompletionTokens: 4096` (or whatever is sensible) to the `model_spec`. Add `maxCompletionTokens: 4096` (matching) to any expected `ModelInfo`-shaped output in the assertions.

Run a quick scan for any other fixture that needs updating:

```bash
grep -rln "availableContextTokens" backend/tests/
```

Expected output: `backend/tests/ai/complete.test.ts`, `backend/tests/ai/chat-persistence.test.ts`, `backend/tests/ai/models.test.ts`, and `backend/tests/services/venice.models.service.test.ts` (already updated in Task 1). For any others surfaced by the grep, add `maxCompletionTokens: 4096` to each `model_spec` block.

- [ ] **Step 6: Add the new max_completion_tokens assertions to route tests**

In `backend/tests/ai/complete.test.ts`, append a new test at the end of the same outer `describe` block as the existing `'Venice request carries the prompt builder messages and max_completion_tokens'` test. Insert directly after line 431 (the closing `});` of that test):

```ts
  it('max_completion_tokens = min(model_cap, user_setting) — model cap wins', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { storyId, chapterId } = await setupStoryAndChapter(req);

    // User wants 16k; model caps at 4k → expect 4k.
    const decoded = jwt.decode(accessToken) as AccessTokenPayload;
    await prisma.user.update({
      where: { id: decoded.sub },
      data: { settingsJson: { chat: { maxTokens: 16_000 } } },
    });

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(sseStreamResponse([makeChunk('OK', 'stop')]));

    await request(app)
      .post('/api/ai/complete')
      .set('Authorization', `Bearer ${accessToken}`)
      .buffer(true)
      .parse((response, callback) => {
        let data = '';
        response.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        response.on('end', () => callback(null, data));
      })
      .send({ action: 'continue', selectedText: '', chapterId, storyId, modelId: BASE_MODEL_ID });

    const completionCall = fetchSpy.mock.calls.find(([url]) =>
      String(url).includes('/chat/completions'),
    );
    const [, init] = completionCall!;
    const requestBody = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
    expect(requestBody.max_completion_tokens).toBe(4096); // model wins (BASE_MODEL_ID has cap 4096)
  });

  it('max_completion_tokens = min(model_cap, user_setting) — user setting wins', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken, fetchSpy);
    const req = makeFakeReq(accessToken);
    const { storyId, chapterId } = await setupStoryAndChapter(req);

    // User wants 800; qwen model caps at 16k → expect 800.
    const decoded = jwt.decode(accessToken) as AccessTokenPayload;
    await prisma.user.update({
      where: { id: decoded.sub },
      data: { settingsJson: { chat: { maxTokens: 800 } } },
    });

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(sseStreamResponse([makeChunk('OK', 'stop')]));

    await request(app)
      .post('/api/ai/complete')
      .set('Authorization', `Bearer ${accessToken}`)
      .buffer(true)
      .parse((response, callback) => {
        let data = '';
        response.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        response.on('end', () => callback(null, data));
      })
      .send({ action: 'continue', selectedText: '', chapterId, storyId, modelId: 'qwen-qwq-32b' });

    const completionCall = fetchSpy.mock.calls.find(([url]) =>
      String(url).includes('/chat/completions'),
    );
    const [, init] = completionCall!;
    const requestBody = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
    expect(requestBody.max_completion_tokens).toBe(800); // user wins
  });
```

In `backend/tests/ai/chat-persistence.test.ts`, append a similar two-case test in the same shape after the last `it(...)` of the file's main `describe`. The shape:

```ts
  it('max_completion_tokens = min(model_cap, user_setting) — user setting wins', async () => {
    const { accessToken, chatId } = await setupChat(); // adapt to whatever helper exists in this file
    const decoded = jwt.decode(accessToken) as AccessTokenPayload;
    await prisma.user.update({
      where: { id: decoded.sub },
      data: { settingsJson: { chat: { maxTokens: 1234 } } },
    });

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(sseStreamResponse([makeChunk('hi', 'stop')]));

    await request(app)
      .post(`/api/chats/${chatId}/messages`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ content: 'ping', modelId: BASE_MODEL_ID });

    const completionCall = fetchSpy.mock.calls.find(([url]) =>
      String(url).includes('/chat/completions'),
    );
    const [, init] = completionCall!;
    const requestBody = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
    expect(requestBody.max_completion_tokens).toBe(1234);
  });
```

If the existing `chat-persistence.test.ts` setup helpers are differently named, adapt the call but keep the assertion identical. The agent should read the file head to discover the helper names before pasting.

- [ ] **Step 7: Wire real lookups in the routes**

In `backend/src/routes/ai.routes.ts`:

Add to the imports near the top:

```ts
import {
  resolveIncludeVeniceSystemPrompt,
  resolveUserMaxCompletionTokens,
  resolveUserPrompts,
} from '../services/user-settings-resolvers';
```

In the `/complete` handler, after the existing `resolveUserPrompts` line, add the user resolver and the model lookup:

```ts
      const userPrompts = resolveUserPrompts(userRow?.settingsJson ?? null);
      const userMaxCompletionTokens = resolveUserMaxCompletionTokens(
        userRow?.settingsJson ?? null,
      );
      const modelMaxCompletionTokens = veniceModelsService.getModelMaxCompletionTokens(
        body.modelId,
      );
```

(Both lookups happen before `buildPrompt` is called — `getModelMaxCompletionTokens` is safe because `fetchModels` was awaited earlier in the handler, populating the cache.)

Replace the two TEMP lines from Task 3 in the `buildPrompt({...})` call:

```ts
        modelContextLength,
        modelMaxCompletionTokens,
        userMaxCompletionTokens,
```

In `backend/src/routes/chat.routes.ts`: same pattern. Add `resolveUserMaxCompletionTokens` to the import. Add the two lookups after the existing `resolveUserPrompts` call. Replace the two TEMP lines in the `buildPrompt({...})` call.

- [ ] **Step 8: Run all backend tests**

Run: `npm --prefix backend run test`

Expected: all green. The two new `complete.test.ts` cases assert specific values; the new `chat-persistence.test.ts` case asserts a specific value.

- [ ] **Step 9: Run typecheck**

Run: `npm --prefix backend run typecheck`

Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add backend/src/services/user-settings-resolvers.ts \
        backend/tests/services/user-settings-resolvers.test.ts \
        backend/src/routes/ai.routes.ts \
        backend/src/routes/chat.routes.ts \
        backend/tests/ai/complete.test.ts \
        backend/tests/ai/chat-persistence.test.ts \
        backend/tests/ai/models.test.ts
git commit -m "[fix-max-tokens] wire per-model cap + user setting through both AI routes

ai.routes.ts and chat.routes.ts now resolve modelMaxCompletionTokens via
veniceModelsService.getModelMaxCompletionTokens(modelId) and
userMaxCompletionTokens via the new resolveUserMaxCompletionTokens helper
(returns POSITIVE_INFINITY when unset). buildPrompt receives both as
required inputs; max_completion_tokens reaching Venice is min(cap, user).
Existing model fixtures get maxCompletionTokens to silence the new
fallback warn during tests.

Two integration tests per route assert the value reaching the mocked
Venice client matches the spec (model wins; user wins).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Drop Zod artificial cap on `chat.maxTokens`

**Files:**
- Modify: `backend/src/routes/user-settings.routes.ts`
- Modify: `backend/tests/routes/user-settings.test.ts`

- [ ] **Step 1: Write the failing test**

Append to the relevant `describe('PATCH /api/users/me/settings', ...)` block (or equivalent) in `backend/tests/routes/user-settings.test.ts`:

```ts
  it('accepts chat.maxTokens above the previous 32_768 ceiling (up to 1_000_000)', async () => {
    const accessToken = await registerAndLogin();
    const res = await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ chat: { maxTokens: 65_536 } });
    expect(res.status).toBe(200);
    expect(res.body.settings.chat.maxTokens).toBe(65_536);
  });

  it('rejects chat.maxTokens above the 1_000_000 sanity ceiling', async () => {
    const accessToken = await registerAndLogin();
    const res = await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ chat: { maxTokens: 2_000_000 } });
    expect(res.status).toBe(400);
  });
```

(Use whatever `registerAndLogin` helper this file already has — read its top before pasting. If it uses a different helper name, adapt the call, keep the assertion identical.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix backend run test -- routes/user-settings`

Expected: the first new test fails with 400 (current Zod max is 32_768).

- [ ] **Step 3: Implement the change**

Edit `backend/src/routes/user-settings.routes.ts` line 59:

```ts
        maxTokens: z.number().int().min(1).max(1_000_000).optional(),
```

(Replace `.max(32_768)` with `.max(1_000_000)`.)

- [ ] **Step 4: Run tests + typecheck**

Run: `npm --prefix backend run test -- routes/user-settings`

Expected: all green (both new tests + existing pass).

Run: `npm --prefix backend run typecheck`

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/user-settings.routes.ts \
        backend/tests/routes/user-settings.test.ts
git commit -m "[fix-max-tokens] raise chat.maxTokens schema ceiling to 1M

The 32_768 cap was a stale guess at Venice's per-model output limit.
Real caps come from /v1/models (per Task 1) and any value above the
model's cap is shrunk via Math.min in buildPrompt. The schema cap
becomes a sanity guard against absurd payloads (1M tokens), not a
protocol constraint. The frontend slider literal stays its old value
this commit; the slider rework is a separate task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Venice error fidelity — forward 400/404/422 + `details.veniceMessage`

**Files:**
- Modify: `backend/src/lib/venice-errors.ts`
- Modify: `backend/tests/lib/venice-errors.test.ts`

- [ ] **Step 1: Write the failing tests**

Append a new top-level `describe` to `backend/tests/lib/venice-errors.test.ts`:

```ts
describe('mapVeniceError — status forwarding + details.veniceMessage', () => {
  function makeResStub() {
    const state: { statusCode?: number; body?: unknown } = {};
    const res = {
      status(code: number) {
        state.statusCode = code;
        return this;
      },
      json(body: unknown) {
        state.body = body;
        return this;
      },
    } as unknown as Response;
    return { res, state };
  }

  function fakeApiError(status: number, message: string): APIError {
    return new APIError(
      status,
      { error: { message } },
      message,
      new Headers(),
    );
  }

  it('forwards Venice 400 as HTTP 400, code=venice_error, with details.veniceMessage', () => {
    const { res, state } = makeResStub();
    const err = fakeApiError(
      400,
      'Requested max_tokens or max_completion_tokens of 51200, but the maximum allowed is 32768',
    );
    expect(mapVeniceError(err, res, 'user-1')).toBe(true);
    expect(state.statusCode).toBe(400);
    const body = state.body as {
      error: { code: string; message: string; details?: { veniceMessage?: string } };
    };
    expect(body.error.code).toBe('venice_error');
    expect(body.error.details?.veniceMessage).toContain('maximum allowed is 32768');
  });

  it('forwards Venice 404 as HTTP 404 with details.veniceMessage', () => {
    const { res, state } = makeResStub();
    const err = fakeApiError(404, 'Model not found: bogus-model');
    expect(mapVeniceError(err, res, 'user-1')).toBe(true);
    expect(state.statusCode).toBe(404);
    const body = state.body as { error: { details?: { veniceMessage?: string } } };
    expect(body.error.details?.veniceMessage).toContain('bogus-model');
  });

  it('forwards Venice 422 as HTTP 422 with details.veniceMessage', () => {
    const { res, state } = makeResStub();
    const err = fakeApiError(422, 'Invalid value for parameter "temperature"');
    expect(mapVeniceError(err, res, 'user-1')).toBe(true);
    expect(state.statusCode).toBe(422);
    const body = state.body as { error: { details?: { veniceMessage?: string } } };
    expect(body.error.details?.veniceMessage).toContain('temperature');
  });

  it('keeps unmapped non-2xx (e.g. 418) at HTTP 502 but still adds details.veniceMessage', () => {
    const { res, state } = makeResStub();
    const err = fakeApiError(418, 'I am a teapot');
    expect(mapVeniceError(err, res, 'user-1')).toBe(true);
    expect(state.statusCode).toBe(502);
    const body = state.body as { error: { details?: { veniceMessage?: string } } };
    expect(body.error.details?.veniceMessage).toBe('I am a teapot');
  });

  it('sanitises sk-prefixed key fragments out of details.veniceMessage', () => {
    const { res, state } = makeResStub();
    const err = fakeApiError(
      400,
      'Bad request from key sk-veniceLEAKYABCDEF1234567890; please retry',
    );
    mapVeniceError(err, res, 'user-1');
    const body = state.body as { error: { details?: { veniceMessage?: string } } };
    expect(body.error.details?.veniceMessage).not.toContain('sk-veniceLEAKY');
    expect(body.error.details?.veniceMessage).toContain('[redacted]');
  });

  it('SSE path emits details.veniceMessage on the error frame', () => {
    const frames: string[] = [];
    const err = fakeApiError(
      400,
      'Requested max_tokens of 51200, but the maximum allowed is 32768',
    );
    expect(mapVeniceErrorToSse(err, (s) => frames.push(s), 'user-1')).toBe(true);
    expect(frames).toHaveLength(2);
    const payload = JSON.parse(frames[0].slice('data: '.length).trimEnd()) as {
      code: string;
      message: string;
      details?: { veniceMessage?: string };
    };
    expect(payload.code).toBe('venice_error');
    expect(payload.details?.veniceMessage).toContain('32768');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix backend run test -- venice-errors`

Expected: existing 402 / parseRetryAfter tests still pass; the six new tests fail (`details` doesn't exist; status is 502 instead of 400/404/422; key sanitisation isn't applied).

- [ ] **Step 3: Implement the change**

Edit `backend/src/lib/venice-errors.ts`.

1. Add the sanitisation helper near the top (after `parseRetryAfter`):

```ts
// [V11+] Scrub any sk-prefixed token (defensive — Venice doesn't intentionally
// echo keys but error formatting upstream can include the bearer fragment).
// 16+ char alphanumeric body matches all current Venice + OpenAI key shapes.
const SK_KEY_RE = /sk-[A-Za-z0-9_-]{16,}/g;

function sanitiseVeniceMessage(raw: string): string {
  return raw.replace(SK_KEY_RE, '[redacted]');
}
```

2. Update `VeniceErrorBody`:

```ts
export interface VeniceErrorBody {
  error: {
    code: string;
    message: string;
    retryAfterSeconds?: number | null;
    details?: { veniceMessage?: string };
  };
}
```

3. Modify `mapVeniceError`'s "any other non-2xx" tail. Currently:

```ts
  // Any other non-2xx from Venice
  console.error(
    '[V11] Venice returned unexpected status',
    err.status,
    'for user',
    userId ?? '(unknown)',
  );
  res.status(502).json({
    error: {
      code: 'venice_error',
      message: 'Venice returned an unexpected error.',
    },
  } satisfies VeniceErrorBody);
  return true;
```

Replace with:

```ts
  // 400 / 404 / 422 — request-shape errors that the client could in principle
  // correct. Forward Venice's status verbatim and surface the raw message in
  // details.veniceMessage so the dev overlay can render it.
  const veniceMessage =
    typeof err.message === 'string' ? sanitiseVeniceMessage(err.message) : undefined;

  if (err.status === 400 || err.status === 404 || err.status === 422) {
    console.error(
      '[V11] Venice forwarded status',
      err.status,
      'for user',
      userId ?? '(unknown)',
    );
    res.status(err.status).json({
      error: {
        code: 'venice_error',
        message: 'Venice rejected the request.',
        ...(veniceMessage ? { details: { veniceMessage } } : {}),
      },
    } satisfies VeniceErrorBody);
    return true;
  }

  // Any other non-2xx — preserve the existing 502 fallback but include the
  // sanitised raw message so the dev overlay isn't blind.
  console.error(
    '[V11] Venice returned unexpected status',
    err.status,
    'for user',
    userId ?? '(unknown)',
  );
  res.status(502).json({
    error: {
      code: 'venice_error',
      message: 'Venice returned an unexpected error.',
      ...(veniceMessage ? { details: { veniceMessage } } : {}),
    },
  } satisfies VeniceErrorBody);
  return true;
```

4. Modify `mapVeniceErrorToSse`'s tail (the `else` branch where `code = 'venice_error'`). Currently the function builds `payload` and writes it; we add `details` when applicable:

Right after the existing `} else {` branch sets `code` and `message`, and before the `payload` construction at the bottom, insert:

```ts
  const veniceMessage =
    code === 'venice_error' && typeof err.message === 'string'
      ? sanitiseVeniceMessage(err.message)
      : undefined;
```

Then update the `payload` construction (currently `const payload: Record<string, unknown> = { error: message, code, message };`):

```ts
  const payload: Record<string, unknown> = { error: message, code, message };
  if (retryAfterSeconds !== undefined) payload.retryAfterSeconds = retryAfterSeconds;
  if (veniceMessage) payload.details = { veniceMessage };
  write(`data: ${JSON.stringify(payload)}\n\n`);
  write('data: [DONE]\n\n');
  return true;
```

- [ ] **Step 4: Run the test file to verify it passes**

Run: `npm --prefix backend run test -- venice-errors`

Expected: all green (existing + 6 new tests).

- [ ] **Step 5: Run the AI integration tests**

Run: `npm --prefix backend run test -- "ai/error-handling|ai/complete"`

Expected: all green. If `ai/error-handling.test.ts` asserts the *body* of an unmapped-status response and expects no `details` field, the new `details.veniceMessage` will fail it. If so, update the assertion in that file to allow (or expect) `details.veniceMessage`. The agent should read `error-handling.test.ts` to confirm.

- [ ] **Step 6: Run typecheck**

Run: `npm --prefix backend run typecheck`

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add backend/src/lib/venice-errors.ts \
        backend/tests/lib/venice-errors.test.ts
git commit -m "[fix-max-tokens] surface Venice error text + forward 400/404/422

mapVeniceError + mapVeniceErrorToSse now include details.veniceMessage
on the unmapped-status branches, carrying Venice's raw error text after
sanitisation against sk-prefixed key fragments. Statuses 400, 404, and
422 forward verbatim instead of being collapsed to 502 — these are
request-shape errors the client can react to (showing the user 'no such
model' on a 404 is more actionable than a generic 502).

5xx and 401/402/429 keep their existing semantics.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Forward `ApiError.code` from chat hook catches

**Files:**
- Modify: `frontend/src/hooks/useChat.ts`
- Modify: `frontend/tests/hooks/useChat.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `frontend/tests/hooks/useChat.test.tsx`'s main `describe('useSendChatMessageMutation', ...)` block:

```ts
  it('forwards ApiError.code into the draft on pre-stream HTTP error', async () => {
    // Mock apiStream to throw an ApiError with a real venice_error code,
    // simulating a backend 502 response.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: 'venice_error', message: 'Venice rejected the request.' } }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useSendChatMessageMutation(), { wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({
          chatId: 'c1',
          content: 'hi',
          modelId: 'm1',
        }),
      ).rejects.toBeDefined();
    });

    const draft = useChatDraftStore.getState().draft;
    expect(draft?.status).toBe('error');
    expect(draft?.error?.code).toBe('venice_error');
  });
```

(Reuse whatever `wrapper` and imports the existing tests have. The shape above matches the existing pattern — read `frontend/tests/hooks/useChat.test.tsx` head to confirm `wrapper`, `act`, and `renderHook` are imported, plus that `vi.stubGlobal` is used.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix frontend run test -- useChat`

Expected: test fails — `draft.error.code` is `null`, not `'venice_error'`.

- [ ] **Step 3: Implement the change**

Edit `frontend/src/hooks/useChat.ts`.

Add `ApiError` to the existing import line:

```ts
import { ApiError, api, apiStream } from '@/lib/api';
```

Update the three `markError({ code: null, message })` sites to forward `ApiError.code`. Around lines 197–200:

```ts
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Chat send failed';
        const code = err instanceof ApiError ? (err.code ?? null) : null;
        useChatDraftStore.getState().markError({ code, message });
        throw err;
      }
```

Around lines 203–207 (empty body branch):

```ts
      if (!res.body) {
        const message = 'Empty response body';
        useChatDraftStore.getState().markError({ code: null, message });
        throw new Error(message);
      }
```

(This branch's failure isn't an `ApiError` — `apiStream` returned a Response with a missing body. `null` is correct here. Leave as-is.)

Around lines 234–239 (stream-iteration catch):

```ts
      } catch (err) {
        if (useChatDraftStore.getState().draft?.status !== 'error') {
          const message = err instanceof Error ? err.message : 'Chat stream failed';
          const code = err instanceof ApiError ? (err.code ?? null) : null;
          useChatDraftStore.getState().markError({ code, message });
        }
        throw err;
      }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --prefix frontend run test -- useChat`

Expected: all green (existing tests + 1 new).

- [ ] **Step 5: Run typecheck**

Run: `npm --prefix frontend run typecheck`

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useChat.ts \
        frontend/tests/hooks/useChat.test.tsx
git commit -m "[fix-max-tokens] forward ApiError.code from chat hook catches

The pre-stream and stream-iteration catches were hardcoding code:null on
markError, discarding venice_error / venice_key_invalid / venice_rate_limited
codes the backend sets. The dev overlay and chat error UI rely on the
code being present to render the right CTA, so the user was seeing
{ code: null } whenever the backend returned a non-success.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Bump frontend slider literal

**Files:**
- Modify: `frontend/src/components/SettingsModelsTab.tsx`

No new test — the value is a literal; Storybook covers it visually and there's no behavioural assertion to gain.

- [ ] **Step 1: Make the change**

Edit `frontend/src/components/SettingsModelsTab.tsx` line ~152 (the `<SliderRow>` for max tokens):

```tsx
        <SliderRow
          id={maxTokensId}
          label="Max tokens"
          hint="Response length cap"
          min={1}
          max={32_000}
          step={64}
          value={params.maxTokens}
          decimals={0}
          testId="param-max-tokens"
          onChange={onMaxTokens}
        />
```

(Was `max={8000}` → now `max={32_000}`.)

- [ ] **Step 2: Run typecheck and the Settings test**

Run: `npm --prefix frontend run typecheck`

Expected: clean.

Run: `npm --prefix frontend run test -- "Settings.models"`

Expected: all green. The existing slider tests don't pin the literal max — they just drag the slider to a value and assert the PATCH happens. If a test asserts the slider's `max` attribute on the input element, update it to `'32000'`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/SettingsModelsTab.tsx
git commit -m "[fix-max-tokens] raise Settings → Models slider to 32000

The 8000 literal was tied to a stale assumption about Venice's per-model
cap. Backend now derives the real cap; the slider becomes a user
preference within that range. Slider precision is admittedly poor at
this width (step=64 → 500 stops); the slider is being reworked
separately.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Fix `ACTION_MAP` to dispatch the real backend actions

**Files:**
- Modify: `frontend/src/hooks/useAICompletion.ts`
- Modify: `frontend/src/pages/EditorPage.tsx`
- Modify: `frontend/tests/pages/editor-ai.integration.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `frontend/tests/pages/editor-ai.integration.test.tsx`'s main `describe('EditorPage AI surfaces (F53)', ...)` block:

```ts
  it('Describe bubble button dispatches action="describe" to /api/ai/complete', async () => {
    const completeSpy = vi.fn(async () => sseStreamResponse([])); // helper from this file
    setupFetchMocksWithCompleteSpy(completeSpy); // adapt to the file's helper names

    const { user } = renderEditor(); // adapt
    await user.click(screen.getByTestId('selection-bubble-describe'));

    expect(completeSpy).toHaveBeenCalledOnce();
    const requestBody = JSON.parse(completeSpy.mock.calls[0]?.[1]?.body as string);
    expect(requestBody.action).toBe('describe');
  });

  it('Rewrite bubble button dispatches action="rewrite" to /api/ai/complete', async () => {
    const completeSpy = vi.fn(async () => sseStreamResponse([]));
    setupFetchMocksWithCompleteSpy(completeSpy);
    const { user } = renderEditor();
    await user.click(screen.getByTestId('selection-bubble-rewrite'));

    expect(completeSpy).toHaveBeenCalledOnce();
    const requestBody = JSON.parse(completeSpy.mock.calls[0]?.[1]?.body as string);
    expect(requestBody.action).toBe('rewrite');
  });
```

The agent must read the head of this test file to discover the actual helper names — `sseStreamResponse`, `setupFetchMocksWithCompleteSpy`, and `renderEditor` are placeholders for whatever the file already provides. If the file doesn't have a fetch-spy helper that captures the request body, add one in this step (a few lines of `vi.fn` wrapping).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix frontend run test -- editor-ai`

Expected: tests fail — current dispatch sends `action: "summarise"` for *Describe* and `action: "rephrase"` for *Rewrite*.

- [ ] **Step 3: Widen the action union**

Edit `frontend/src/hooks/useAICompletion.ts` line 41:

```ts
  action: 'continue' | 'rephrase' | 'expand' | 'summarise' | 'freeform' | 'rewrite' | 'describe';
```

(Adds `'rewrite' | 'describe'` to the union. `'rephrase'` and `'summarise'` stay — backend still accepts them, harmless to leave.)

- [ ] **Step 4: Fix `ACTION_MAP`**

Edit `frontend/src/pages/EditorPage.tsx` lines ~350–357:

```ts
  const ACTION_MAP: Record<Exclude<SelectionAction, 'ask'>, RunArgs['action']> = useMemo(
    () => ({
      rewrite: 'rewrite',
      describe: 'describe',
      expand: 'expand',
    }),
    [],
  );
```

- [ ] **Step 5: Run all relevant tests**

Run: `npm --prefix frontend run test -- "editor-ai|EditorPage|useAICompletion"`

Expected: all green.

- [ ] **Step 6: Run typecheck**

Run: `npm --prefix frontend run typecheck`

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/hooks/useAICompletion.ts \
        frontend/src/pages/EditorPage.tsx \
        frontend/tests/pages/editor-ai.integration.test.tsx
git commit -m "[fix-max-tokens] dispatch describe/rewrite actions 1:1 to backend

The selection-bubble ACTION_MAP was remapping describe→summarise and
rewrite→rephrase from before the backend grew real 'describe' and
'rewrite' actions in V14. The Describe button has been firing the
Summarise prompt template for months.

RunArgs.action union widens to include 'describe' and 'rewrite' (the
existing 'summarise' and 'rephrase' members stay — backend still
accepts them, no callers today).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Manual verification + open PR

**Files:** none (verification + PR creation).

- [ ] **Step 1: Run the full test matrix locally**

```bash
npm --prefix backend run typecheck
npm --prefix backend run test
npm --prefix frontend run typecheck
npm --prefix frontend run test
```

Expected: all green.

- [ ] **Step 2: Smoke-test against the live dev stack**

```bash
make dev          # if not already running
docker logs -f story-editor-backend-1 &
```

In the browser:
1. Open a story and select some text.
2. Click *Describe* on the bubble — should stream a description (not a summary). Confirm in the backend logs that the request had `action: "describe"`.
3. Click *Rewrite* — should stream a rewrite (not a rephrase). Confirm `action: "rewrite"`.
4. Click *Expand* — should stream an expansion.
5. Send a chat message — should stream a reply.
6. In Settings → Models, drag *Max tokens* to 800. Send another chat message; observe in backend logs that `max_completion_tokens: 800` reaches Venice.
7. In Settings → Models, drag *Max tokens* to 32 000. Send another message on a model whose cap is 16 384 (e.g. one of the 16k models in the catalogue); observe `max_completion_tokens: 16384`.
8. (Negative test, if you can swing it) Force a Venice 400 — pick a model, then craft a request with an out-of-range temperature via curl with the user's access token; confirm the response status is 400, the body has `details.veniceMessage`, and the dev overlay renders the original Venice text.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin fix/max-completion-tokens
gh pr create --base main --title "fix: max_completion_tokens correctness + Venice error fidelity" --body "$(cat <<'EOF'
## Summary

- Stop sending Venice `max_completion_tokens` derived from a 0.2-of-context heuristic. Use the real per-model `maxCompletionTokens` exposed on `/v1/models` (was unused), capped further by the user's `settings.chat.maxTokens` (was stored-and-ignored).
- Surface Venice's actual error text via `details.veniceMessage` and forward 400/404/422 statuses verbatim instead of collapsing them to 502.
- Fix the inline-bubble *Describe* and *Rewrite* buttons to dispatch the real backend actions (was firing *Summarise* / *Rephrase*).

## Changes

| Layer | What |
|---|---|
| Cache | `ModelInfo.maxCompletionTokens` + `getModelMaxCompletionTokens(id)`; one-time warn on missing field |
| Builder | `buildPrompt` takes `modelMaxCompletionTokens` + `userMaxCompletionTokens` as required; `max_completion_tokens = min(...)`; prompt budget derives as `context − response − 512` |
| Routes | `ai.routes.ts` + `chat.routes.ts` resolve real values; shared resolver module lifted from the duplicated route helpers |
| Schema | `chat.maxTokens` Zod cap raised to 1 000 000 (sanity guard, not protocol) |
| Errors | `mapVeniceError` / `mapVeniceErrorToSse` add `details.veniceMessage`; 400/404/422 forward |
| Frontend | `useChat.ts` forwards `ApiError.code`; Settings slider max → 32 000; bubble `ACTION_MAP` 1:1 |

Spec: `docs/superpowers/specs/2026-05-05-max-completion-tokens-redesign-design.md`

## Test plan

- [x] Backend: 13 new resolver tests, 6 new builder budget tests, 4 new cache tests, 4 new route assertions, 6 new error-mapping tests. Existing suite green.
- [x] Frontend: 1 new chat-hook test (forwarded code), 2 new editor-ai assertions (describe/rewrite dispatch). Existing suite green.
- [x] Typecheck: backend + frontend clean.
- [ ] Manual: bubble actions, chat send, slider behaviour, error overlay against a forced Venice 400.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

The PR URL prints to stdout — capture it for the user.

---

## Self-Review

**Spec coverage check:**

- ✅ Decision 1 (response budget) → Task 3 (`responseTokens = min(model_cap, user_setting)`)
- ✅ Decision 2 (prompt budget derived) → Task 3 (`promptBudgetTokens = context − response − 512`)
- ✅ Decision 3 (missing-cap fallback + warn) → Task 1 (`FALLBACK_MAX_COMPLETION_TOKENS` + `console.warn`)
- ✅ Decision 4 (test coverage) → Tasks 1, 3, 4, 6, 7, 9 cover every cell of the spec's testing table
- ✅ Decision 5 (Zod ceiling + slider) → Tasks 5 + 8
- ✅ Decision 6 (ACTION_MAP) → Task 9
- ✅ Decision 7 (error fidelity) → Tasks 6 + 7
- ✅ Out of scope (dynamic slider, reasoning reservation, retry/backoff, truncation strategy) — no task created, respected.

**Type consistency check:** `modelMaxCompletionTokens` and `userMaxCompletionTokens` are the canonical field names; `getModelMaxCompletionTokens` is the cache method; `resolveUserMaxCompletionTokens` is the resolver; `SAFETY_MARGIN_TOKENS = 512`; `FALLBACK_MAX_COMPLETION_TOKENS = 4096`. All consistent across tasks 1, 3, 4.

**Placeholder scan:** No "TBD" / "TODO" / "implement later" in any task. The TEMP comment in Task 3's route stubs is explicit about being replaced in Task 4 and the worker can verify by grepping for "TEMP: replaced" before the Task 4 commit.

**Edge cases:**
- Task 4 step 6 references "adapt to whatever helper exists" for `chat-persistence.test.ts` — this is OK because helper names are file-local and stable; the agent reads the head of the file. Same shape as Task 1 / Task 9 patterns.
- Task 9 step 1 references `selection-bubble-describe` and `selection-bubble-rewrite` test IDs — those are the actual data-testid values on the rendered bubble buttons. Worker should grep `data-testid="selection-bubble-` in `frontend/src/components/SelectionBubble.tsx` to confirm before pasting.
