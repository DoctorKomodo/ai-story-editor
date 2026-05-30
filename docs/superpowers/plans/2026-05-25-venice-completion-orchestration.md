# Venice completion orchestration — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the duplicated Venice-completion orchestration ritual across `ai.routes.ts`, `chat.routes.ts`, and `chapters.routes.ts` into five focused helpers; split `DEFAULT_SYSTEM_PROMPT` so structured-output calls can adopt the persona; fix the summarise route's missing model-settings wiring; add a dev-only `logVeniceErrorDev` for full upstream-exchange dumps.

**Architecture:** Pure-helper extraction in `backend/src/services/venice-call.service.ts` + sibling dev-log helper in `backend/src/lib/venice-errors.ts`. Each route still writes its own `client.chat.completions.create({...})` literal (streaming / non-streaming / structured diverge legitimately); the four pre-call steps + the error-catch sites adopt the helpers. System-prompt restructure migrates output-shape rules from `DEFAULT_SYSTEM_PROMPT` into a `PROSE_OUTPUT_RULES` constant prefixed onto per-action defaults.

**Tech Stack:** Node 22 + TypeScript strict + Express + OpenAI SDK v6 (Venice over the OpenAI-compatible wire) + Prisma + Zod + Vitest.

**Spec:** [docs/superpowers/specs/2026-05-25-venice-completion-orchestration-design.md](../specs/2026-05-25-venice-completion-orchestration-design.md) (commit `972f93d`).

**Branch:** `feature/venice-completion-orchestration` (already created).

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `backend/src/services/venice-call.service.ts` | **Create** | Five pure helpers around the pre-completion ritual: `hydrateUserSettings`, `buildVeniceParams`, `resolveTextGenWithFallback`, `logVeniceParams`, `promptCacheKey`. |
| `backend/src/lib/venice-errors.ts` | Modify | Add `logVeniceErrorDev` next to `mapVeniceError` / `mapVeniceErrorToSse` for dev-only full-exchange dumps. |
| `backend/src/services/prompt.service.ts` | Modify | Split `DEFAULT_SYSTEM_PROMPT` (persona only). Add `PROSE_OUTPUT_RULES` constant. Prefix every prose action in `DEFAULT_PROMPTS` with it. `summariseChapter` unchanged. |
| `backend/src/routes/ai.routes.ts` | Modify | Replace inline boilerplate with helper calls; adopt `logVeniceErrorDev` in pre-stream + mid-stream catches. |
| `backend/src/routes/chat.routes.ts` | Modify | Same as ai.routes.ts; pass `enableChatStreamHints: true`. `stream_options.include_usage` stays literal in the route's `.create()` call. |
| `backend/src/routes/chapters.routes.ts` | Modify | Wire helpers into summarise handler; send `userPrompts.system + '\n\n' + summariseChapter`; pass `includeVeniceSystemPrompt` explicitly to `buildVeniceParams`; add `prompt_cache_key` + `temperature` / `top_p` / `max_completion_tokens` from `resolveTextGenWithFallback`. New parse-failure log via `logVeniceErrorDev` with `rawContent`. |
| `backend/tests/services/venice-call.service.test.ts` | **Create** | Unit tests for each of the five helpers. |
| `backend/tests/lib/venice-errors.dev-log.test.ts` | **Create** | Unit tests for `logVeniceErrorDev` (prod no-op, scrubbing, size caps, rawContent, non-APIError shape). |
| `backend/tests/services/prompt.service.test.ts` | Modify | Add tests asserting the new invariants (persona-only `DEFAULT_SYSTEM_PROMPT`, prose actions start with `PROSE_OUTPUT_RULES`, `summariseChapter` unchanged). Existing `.toContain(...)` assertions keep passing without fixture changes. |
| `backend/tests/routes/chapters.summarise.test.ts` | Modify | Add assertions for captured request body: `temperature` / `top_p` / `max_completion_tokens` present, `venice_parameters.include_venice_system_prompt`, `venice_parameters.strip_thinking_response` on reasoning model, persona substring in `messages[0].content`. |

---

## Task 0 — bd issue setup

**Goal:** File the umbrella + 4 children + adjust `story-editor-lxo` so `bd ready` surfaces tasks in the right order and `/bd-execute` has plan links.

**Files:** none (bd operations only).

- [ ] **Step 1: Verify branch + clean tree**

```bash
git status
git log --oneline -5
```

Expected: on `feature/venice-completion-orchestration`, tree clean (or only `.beads/issues.jsonl` staged), HEAD at the spec-update commit (`972f93d` or descendant).

- [ ] **Step 2: File the umbrella issue**

```bash
bd create \
  --title "Venice completion call-site consolidation" \
  --type=feature \
  --priority=2 \
  --description "Umbrella for the venice-completion-orchestration spec. Plan-less per the brainstorming-split convention (children carry plan: links). Auto-closes when every child closes.

Spec: docs/superpowers/specs/2026-05-25-venice-completion-orchestration-design.md
Plan: docs/superpowers/plans/2026-05-25-venice-completion-orchestration.md

Children: 4 new bd issues for steps 1-4 + story-editor-lxo as step 5."
```

Capture the new id (e.g. `story-editor-XXX`) — note it for the dep-add steps below.

- [ ] **Step 3: File child issue for step 1 (helpers + dev error logging)**

```bash
bd create \
  --title "[venice-orch step 1] Helpers + logVeniceErrorDev" \
  --type=task \
  --priority=2 \
  --description "Implement step 1 of the venice-completion-orchestration spec. Creates backend/src/services/venice-call.service.ts (5 helpers) and adds logVeniceErrorDev to backend/src/lib/venice-errors.ts. No route changes.

See spec §Section 2 (helpers) and §Section 5 (dev error logging).
See plan §Task 1 for step-by-step."
bd update <new-id> --notes "plan: docs/superpowers/plans/2026-05-25-venice-completion-orchestration.md
verify: cd backend && npm run typecheck && npm test -- tests/services/venice-call.service.test.ts tests/lib/venice-errors.dev-log.test.ts"
```

Capture the new id. Then:

```bash
bd dep add <step-1-id> <umbrella-id>
```

- [ ] **Step 4: File child issue for step 2 (system-prompt restructure)**

```bash
bd create \
  --title "[venice-orch step 2] System-prompt restructure" \
  --type=task \
  --priority=2 \
  --description "Implement step 2 of the venice-completion-orchestration spec. Splits DEFAULT_SYSTEM_PROMPT into persona-only + PROSE_OUTPUT_RULES; prefixes every prose action in DEFAULT_PROMPTS. summariseChapter unchanged. No route changes.

See spec §Section 1 (system-prompt restructure).
See plan §Task 2 for step-by-step."
bd update <new-id> --notes "plan: docs/superpowers/plans/2026-05-25-venice-completion-orchestration.md
verify: cd backend && npm run typecheck && npm test -- tests/services/prompt.service.test.ts tests/services/prompt.actions.test.ts tests/services/prompt.user-prompts.test.ts tests/routes/ai-defaults.test.ts"
```

Capture the new id. Then:

```bash
bd dep add <step-2-id> <umbrella-id>
```

- [ ] **Step 5: File child issue for step 3 (ai-complete refactor)**

```bash
bd create \
  --title "[venice-orch step 3] ai-complete refactor" \
  --type=task \
  --priority=2 \
  --description "Implement step 3 of the venice-completion-orchestration spec. Wire helpers into ai.routes.ts; adopt logVeniceErrorDev. No behavior change. Depends on step 1.

See spec §Section 3 (ai.routes.ts).
See plan §Task 3 for step-by-step."
bd update <new-id> --notes "plan: docs/superpowers/plans/2026-05-25-venice-completion-orchestration.md
verify: cd backend && npm run typecheck && npm test -- tests/ai/complete.test.ts"
```

Capture the new id. Then:

```bash
bd dep add <step-3-id> <step-1-id>
bd dep add <step-3-id> <umbrella-id>
```

- [ ] **Step 6: File child issue for step 4 (chat refactor)**

```bash
bd create \
  --title "[venice-orch step 4] chat refactor" \
  --type=task \
  --priority=2 \
  --description "Implement step 4 of the venice-completion-orchestration spec. Wire helpers into chat.routes.ts; enableChatStreamHints: true. stream_options.include_usage stays literal. Depends on step 1.

See spec §Section 3 (chat.routes.ts).
See plan §Task 4 for step-by-step."
bd update <new-id> --notes "plan: docs/superpowers/plans/2026-05-25-venice-completion-orchestration.md
verify: cd backend && npm run typecheck && npm test -- tests/ai/chat-citations.test.ts tests/ai/chat-persistence.test.ts tests/ai/chat-rate-limit-headers.test.ts tests/ai/ask-ai-attachment.test.ts tests/routes/chat.test.ts"
```

Capture the new id. Then:

```bash
bd dep add <step-4-id> <step-1-id>
bd dep add <step-4-id> <umbrella-id>
```

- [ ] **Step 7: Update `story-editor-lxo` to be step 5**

```bash
bd update story-editor-lxo --notes "plan: docs/superpowers/plans/2026-05-25-venice-completion-orchestration.md
verify: cd backend && npm run typecheck && npm test -- tests/routes/chapters.summarise.test.ts"
bd update story-editor-lxo --description "Implement step 5 of the venice-completion-orchestration spec. Wire helpers into chapters.routes.ts summarise handler + add the missing behaviors: temperature/top_p/max_completion_tokens, include_venice_system_prompt, strip_thinking_response (reasoning models), prompt_cache_key, [venice.params] log. Also send userPrompts.system prefixed to summariseChapter. New parse-failure log via logVeniceErrorDev. Depends on steps 1 + 2 landing first.

See spec §Section 4 (summarise route gains) + §Section 3 (chapters.routes.ts).
See plan §Task 5 for step-by-step."
bd dep add story-editor-lxo <step-1-id>
bd dep add story-editor-lxo <step-2-id>
bd dep add story-editor-lxo <umbrella-id>
```

- [ ] **Step 8: Verify the bd graph**

```bash
bd show <umbrella-id>
bd ready
```

Expected: `bd show` lists 5 dependent issues (steps 1-4 + story-editor-lxo). `bd ready` shows steps 1 + 2 first (no deps), with 3/4/lxo hidden until prereqs close.

- [ ] **Step 9: Commit the bd state**

```bash
git add .beads/issues.jsonl
git commit -m "[venice-orch] file umbrella + 4 children, update lxo as step 5"
git push
```

---

## Task 1 — Helpers + dev error logging

**bd issue:** `<step-1-id>` from Task 0.

**Files:**
- Create: `backend/src/services/venice-call.service.ts`
- Modify: `backend/src/lib/venice-errors.ts`
- Test (create): `backend/tests/services/venice-call.service.test.ts`
- Test (create): `backend/tests/lib/venice-errors.dev-log.test.ts`

**Verify (final):** `cd backend && npm run typecheck && npm test -- tests/services/venice-call.service.test.ts tests/lib/venice-errors.dev-log.test.ts`

### Step block A — `promptCacheKey` (the smallest helper, builds momentum)

- [ ] **A.1: Write failing test for `promptCacheKey`**

Create `backend/tests/services/venice-call.service.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { promptCacheKey } from '../../src/services/venice-call.service';

describe('promptCacheKey', () => {
  it('returns a 32-char hex string for a single part', () => {
    const key = promptCacheKey('story-abc');
    expect(key).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is deterministic — same parts → same output', () => {
    expect(promptCacheKey('s', 'm')).toBe(promptCacheKey('s', 'm'));
  });

  it('different parts → different output', () => {
    expect(promptCacheKey('s1', 'm')).not.toBe(promptCacheKey('s2', 'm'));
    expect(promptCacheKey('s', 'm1')).not.toBe(promptCacheKey('s', 'm2'));
  });
});
```

- [ ] **A.2: Run and verify failure**

```bash
cd backend && npm test -- tests/services/venice-call.service.test.ts 2>&1 | tail -10
```

Expected: FAIL with "Cannot find module" or "promptCacheKey is not a function".

- [ ] **A.3: Create `venice-call.service.ts` with `promptCacheKey`**

Create `backend/src/services/venice-call.service.ts`:

```ts
import { createHash } from 'node:crypto';

// sha256(parts.join(':')).slice(0, 32) — unifies ai-complete's promptCacheKey
// (storyId, modelId), chat's chatPromptCacheKey (chatId, modelId), and
// summarise's new (chapterId, modelId). Hash so the cache-key is opaque to
// Venice telemetry while still deterministic per (parts).
export function promptCacheKey(...parts: string[]): string {
  return createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 32);
}
```

- [ ] **A.4: Run and verify pass**

```bash
cd backend && npm test -- tests/services/venice-call.service.test.ts 2>&1 | tail -5
```

Expected: 3 tests pass.

### Step block B — `hydrateUserSettings`

- [ ] **B.1: Write failing tests**

Append to `backend/tests/services/venice-call.service.test.ts`:

```ts
import { hydrateUserSettings } from '../../src/services/venice-call.service';
import { prisma } from '../../src/lib/prisma';
import { resetDb } from '../testdb';   // adjust import path per project convention

// If the project's existing test helpers differ, look at how other service tests
// (e.g. tests/services/user-settings-resolvers.test.ts) acquire prisma — match
// that pattern.

describe('hydrateUserSettings', () => {
  beforeEach(async () => {
    // Use whatever the project's test-db setup convention is. Pattern: create
    // a user with known settingsJson, then call hydrateUserSettings(user.id).
  });

  it('null settingsJson → defaults (includeVeniceSystemPrompt true, empty userPrompts, empty chat)', async () => {
    // Create user with settingsJson: null
    const user = await prisma.user.create({ data: { /* minimal valid user */ settingsJson: null } });
    const result = await hydrateUserSettings(user.id);
    expect(result.raw).toBeNull();
    expect(result.includeVeniceSystemPrompt).toBe(true);
    expect(result.userPrompts).toEqual({});
    expect(result.settings.chat).toEqual({ model: null, overrides: {} });
  });

  it('full settings shape passes through and resolvers compute correctly', async () => {
    const settingsJson = {
      ai: { includeVeniceSystemPrompt: false },
      prompts: { system: 'custom system' },
      chat: { model: 'llama-3.1-70b', overrides: { 'llama-3.1-70b': { temperature: 0.5 } } },
    };
    const user = await prisma.user.create({ data: { /* ... */ settingsJson } });
    const result = await hydrateUserSettings(user.id);
    expect(result.includeVeniceSystemPrompt).toBe(false);
    expect(result.userPrompts).toEqual({ system: 'custom system' });
    expect(result.settings.chat.model).toBe('llama-3.1-70b');
    expect(result.settings.chat.overrides['llama-3.1-70b'].temperature).toBe(0.5);
  });

  it('partial settings — missing chat — gets defensive default chat shape', async () => {
    const user = await prisma.user.create({
      data: { /* ... */ settingsJson: { ai: { includeVeniceSystemPrompt: false } } },
    });
    const result = await hydrateUserSettings(user.id);
    expect(result.settings.chat).toEqual({ model: null, overrides: {} });
  });
});
```

**Note:** the project's test-db setup pattern (user creation, cleanup) is at `backend/tests/services/user-settings-resolvers.test.ts` and `backend/tests/testdb.ts` (or equivalent). Mirror whichever fixture pattern other service tests use — don't roll your own.

- [ ] **B.2: Run and verify failure**

```bash
cd backend && npm test -- tests/services/venice-call.service.test.ts 2>&1 | tail -10
```

Expected: 3 new tests fail with "Cannot find module" or "hydrateUserSettings is not a function".

- [ ] **B.3: Implement `hydrateUserSettings`**

Append to `backend/src/services/venice-call.service.ts`:

```ts
import { prisma } from '../lib/prisma';
import type { UserSettings } from '../routes/user-settings.routes';
import {
  type PromptsSettings,
  resolveIncludeVeniceSystemPrompt,
  resolveUserPrompts,
} from './user-settings-resolvers';

export interface HydratedUserSettings {
  raw: unknown;                          // opaque JSON for callers that need it
  settings: UserSettings;                // safely coerced for resolveTextGenParams
  includeVeniceSystemPrompt: boolean;
  userPrompts: PromptsSettings;
}

/**
 * Loads user.settingsJson once, coerces to a full UserSettings shape, and
 * pre-runs the two existing resolvers. Replaces the ~12 inline lines of
 * defensive partial-settings hydration each of ai/chat carries today.
 *
 * Defensive coerce: settingsJson is `unknown` from Prisma; pass through as
 * Partial<UserSettings>, then fill chat with safe defaults (null model,
 * empty overrides) so downstream resolveTextGenParams never sees `undefined`.
 */
export async function hydrateUserSettings(userId: string): Promise<HydratedUserSettings> {
  const userRow = await prisma.user.findUnique({
    where: { id: userId },
    select: { settingsJson: true },
  });
  const raw = userRow?.settingsJson ?? null;

  const partialSettings = (raw as Partial<UserSettings>) ?? {};
  const settings: UserSettings = {
    ...partialSettings,
    chat: {
      model: null,
      overrides: {},
      ...partialSettings.chat,
    },
  };

  return {
    raw,
    settings,
    includeVeniceSystemPrompt: resolveIncludeVeniceSystemPrompt(raw),
    userPrompts: resolveUserPrompts(raw),
  };
}
```

- [ ] **B.4: Run and verify pass**

```bash
cd backend && npm test -- tests/services/venice-call.service.test.ts 2>&1 | tail -5
```

Expected: all 6 tests pass (3 from block A + 3 from block B).

### Step block C — `buildVeniceParams`

- [ ] **C.1: Write failing tests with the `!== undefined` precedence case**

Append to `backend/tests/services/venice-call.service.test.ts`:

```ts
import { buildVeniceParams } from '../../src/services/venice-call.service';

describe('buildVeniceParams', () => {
  it('spreads base unchanged when no flags set', () => {
    const base = { include_venice_system_prompt: true };
    expect(buildVeniceParams({ base, supportsReasoning: false })).toEqual(base);
  });

  it('supportsReasoning=true adds strip_thinking_response: true', () => {
    const out = buildVeniceParams({ base: {}, supportsReasoning: true });
    expect(out.strip_thinking_response).toBe(true);
  });

  it('enableWebSearch=true adds enable_web_search auto + enable_web_citations', () => {
    const out = buildVeniceParams({ base: {}, supportsReasoning: false, enableWebSearch: true });
    expect(out.enable_web_search).toBe('auto');
    expect(out.enable_web_citations).toBe(true);
  });

  it('enableChatStreamHints=true adds include_search_results_in_stream', () => {
    const out = buildVeniceParams({ base: {}, supportsReasoning: false, enableChatStreamHints: true });
    expect(out.include_search_results_in_stream).toBe(true);
  });

  // CRITICAL: precedence regression guard. If an implementer writes
  //   if (input.includeVeniceSystemPrompt) out.include_venice_system_prompt = ...
  // (truthy check) instead of `!== undefined`, this test fails.
  it('explicit includeVeniceSystemPrompt:false overrides base value of true', () => {
    const out = buildVeniceParams({
      base: { include_venice_system_prompt: true },
      supportsReasoning: false,
      includeVeniceSystemPrompt: false,
    });
    expect(out.include_venice_system_prompt).toBe(false);
  });

  it('explicit includeVeniceSystemPrompt:true writes through when base is empty', () => {
    const out = buildVeniceParams({
      base: {},
      supportsReasoning: false,
      includeVeniceSystemPrompt: true,
    });
    expect(out.include_venice_system_prompt).toBe(true);
  });
});
```

- [ ] **C.2: Run and verify failure**

```bash
cd backend && npm test -- tests/services/venice-call.service.test.ts 2>&1 | tail -10
```

Expected: 6 new tests fail with "buildVeniceParams is not a function".

- [ ] **C.3: Implement `buildVeniceParams` with `!== undefined` precedence**

Append to `backend/src/services/venice-call.service.ts`:

```ts
export interface BuildVeniceParamsInput {
  base: Record<string, unknown>;         // typically prompt.venice_parameters from buildPrompt
  supportsReasoning: boolean;
  enableWebSearch?: boolean;             // ai-complete + chat
  enableChatStreamHints?: boolean;       // chat only — adds include_search_results_in_stream
  includeVeniceSystemPrompt?: boolean;   // summarise (bypasses buildPrompt — caller must pass)
}

/**
 * Assemble the Venice-specific `venice_parameters` object for a completion
 * call. Spreads `base` first, then conditionally writes feature flags on top.
 *
 * Precedence rule: explicit input args use `!== undefined` checks (NOT truthy
 * checks). A user toggling `include_venice_system_prompt` OFF returns `false`
 * from the resolver — a truthy check would silently drop the field and Venice
 * would receive the default (true), violating the user's choice.
 *
 * For ai/chat: `base` (from buildPrompt) already contains include_venice_system_prompt
 * and they don't pass the explicit arg, so base wins. For summarise: base is `{}`
 * and the explicit arg writes whatever value the user toggled (true or false).
 */
export function buildVeniceParams(input: BuildVeniceParamsInput): Record<string, unknown> {
  const out: Record<string, unknown> = { ...input.base };

  if (input.supportsReasoning) {
    out.strip_thinking_response = true;
  }

  if (input.enableWebSearch === true) {
    out.enable_web_search = 'auto';
    out.enable_web_citations = true;
  }

  if (input.enableChatStreamHints === true) {
    out.include_search_results_in_stream = true;
  }

  if (input.includeVeniceSystemPrompt !== undefined) {
    out.include_venice_system_prompt = input.includeVeniceSystemPrompt;
  }

  return out;
}
```

- [ ] **C.4: Run and verify pass**

```bash
cd backend && npm test -- tests/services/venice-call.service.test.ts 2>&1 | tail -5
```

Expected: all 12 tests pass.

### Step block D — `resolveTextGenWithFallback`

- [ ] **D.1: Write failing tests**

Append to `backend/tests/services/venice-call.service.test.ts`:

```ts
import { resolveTextGenWithFallback } from '../../src/services/venice-call.service';
import type { ModelInfo } from '../../src/services/venice.models.service';
import type { UserSettings } from '../../src/routes/user-settings.routes';

describe('resolveTextGenWithFallback', () => {
  const emptySettings: UserSettings = { chat: { model: null, overrides: {} } } as UserSettings;

  it('modelInfo undefined → returns global-default fallback with provided maxCompletionTokens', () => {
    const out = resolveTextGenWithFallback(emptySettings, undefined, 1234);
    expect(out.temperature).toBeUndefined();
    expect(out.top_p).toBeUndefined();
    expect(out.max_completion_tokens).toBe(1234);
    expect(out.source.temperature).toBe('global-default');
    expect(out.source.top_p).toBe('global-default');
    expect(out.source.max_completion_tokens).toBe('global-default');
  });

  it('modelInfo present → delegates to resolveTextGenParams', () => {
    const modelInfo: ModelInfo = {
      id: 'llama-3.1-70b',
      name: 'Llama 3.1 70B',
      contextLength: 8192,
      maxCompletionTokens: 4096,
      defaultTemperature: 0.7,
      defaultTopP: 0.95,
      supportsReasoning: false,
      supportsVision: false,
      supportsResponseSchema: false,
    };
    const out = resolveTextGenWithFallback(emptySettings, modelInfo, 999);
    // No user override → falls back to Venice model defaults
    expect(out.temperature).toBe(0.7);
    expect(out.top_p).toBe(0.95);
    expect(out.source.temperature).toBe('venice-default');
  });
});
```

- [ ] **D.2: Run and verify failure**

```bash
cd backend && npm test -- tests/services/venice-call.service.test.ts 2>&1 | tail -10
```

Expected: 2 new tests fail with "resolveTextGenWithFallback is not a function".

- [ ] **D.3: Implement `resolveTextGenWithFallback`**

Append to `backend/src/services/venice-call.service.ts`:

```ts
import type { ModelInfo } from './venice.models.service';
import { type ResolvedTextGenParams, resolveTextGenParams } from './user-settings-resolvers';

/**
 * Thin wrapper over resolveTextGenParams that handles the modelInfo-null
 * case. ai/chat see null any time Venice's catalog cache refreshes between
 * fetchModels() and findModel() — the fallback is load-bearing for them.
 * Summarise has a 400-gate above so modelInfo is non-null there; the fallback
 * is defensive symmetry only for that call site.
 */
export function resolveTextGenWithFallback(
  settings: UserSettings,
  modelInfo: ModelInfo | undefined,
  fallbackMaxCompletionTokens: number,
): ResolvedTextGenParams {
  if (modelInfo === undefined) {
    return {
      temperature: undefined as unknown as number,  // matches existing inline pattern
      top_p: undefined as unknown as number,
      max_completion_tokens: fallbackMaxCompletionTokens,
      source: {
        temperature: 'global-default',
        top_p: 'global-default',
        max_completion_tokens: 'global-default',
      },
    };
  }
  return resolveTextGenParams(settings, modelInfo);
}
```

**Note on the type assertion:** the existing inline blocks in ai.routes/chat.routes type the resolved object as `{ temperature: number | undefined; top_p: number | undefined; max_completion_tokens: number; source: {...} }` even though `ResolvedTextGenParams` declares `temperature: number`. Match the inline pattern (assert through `unknown as number`) — fixing the wider type lie is out of scope.

- [ ] **D.4: Run and verify pass**

```bash
cd backend && npm test -- tests/services/venice-call.service.test.ts 2>&1 | tail -5
```

Expected: all 14 tests pass.

### Step block E — `logVeniceParams`

- [ ] **E.1: Write failing tests**

Append to `backend/tests/services/venice-call.service.test.ts`:

```ts
import { afterEach, beforeEach, vi } from 'vitest';
import { logVeniceParams } from '../../src/services/venice-call.service';

describe('logVeniceParams', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development');
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    logSpy.mockRestore();
  });

  it('logs [venice.params] with the full input shape', () => {
    logVeniceParams({
      route: 'chapter-summarise',
      userId: 'u1',
      modelId: 'llama-3.1-70b',
      resolved: {
        temperature: 0.7,
        top_p: 0.95,
        max_completion_tokens: 4096,
        source: { temperature: 'override', top_p: 'venice-default', max_completion_tokens: 'venice-default' },
      },
      action: 'summariseChapter',
      modelCap: 4096,
    });
    expect(logSpy).toHaveBeenCalledOnce();
    expect(logSpy.mock.calls[0][0]).toBe('[venice.params]');
    const payload = JSON.parse(logSpy.mock.calls[0][1] as string);
    expect(payload.route).toBe('chapter-summarise');
    expect(payload.userId).toBe('u1');
    expect(payload.temperature.value).toBe(0.7);
    expect(payload.temperature.source).toBe('override');
  });

  it('does not log in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    logVeniceParams({
      route: 'ai-complete', userId: 'u1', modelId: 'm', resolved: {
        temperature: 0.7, top_p: 0.95, max_completion_tokens: 100,
        source: { temperature: 'override', top_p: 'override', max_completion_tokens: 'override' },
      }, modelCap: 100,
    });
    expect(logSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **E.2: Run and verify failure**

```bash
cd backend && npm test -- tests/services/venice-call.service.test.ts 2>&1 | tail -10
```

Expected: 2 new tests fail with "logVeniceParams is not a function".

- [ ] **E.3: Implement `logVeniceParams`**

Append to `backend/src/services/venice-call.service.ts`:

```ts
export interface LogVeniceParamsInput {
  route: 'ai-complete' | 'chat' | 'chapter-summarise';
  userId: string;
  modelId: string;
  resolved: ResolvedTextGenParams;
  action?: string;
  modelCap: number | undefined;
  enableWebSearch?: unknown;
}

/**
 * Emit the [venice.params] structured dev log. Identical schema across the
 * three routes so a developer can diff resolved-params side-by-side.
 *
 * No-op in production.
 */
export function logVeniceParams(input: LogVeniceParamsInput): void {
  if (process.env.NODE_ENV === 'production') return;
  console.log(
    '[venice.params]',
    JSON.stringify({
      route: input.route,
      userId: input.userId,
      modelId: input.modelId,
      temperature: { value: input.resolved.temperature, source: input.resolved.source.temperature },
      top_p: { value: input.resolved.top_p, source: input.resolved.source.top_p },
      max_completion_tokens: {
        value: input.resolved.max_completion_tokens,
        source: input.resolved.source.max_completion_tokens,
      },
      action: input.action,
      model_cap: input.modelCap,
      enable_web_search: input.enableWebSearch,
    }),
  );
}
```

- [ ] **E.4: Run and verify pass**

```bash
cd backend && npm test -- tests/services/venice-call.service.test.ts 2>&1 | tail -5
```

Expected: all 16 tests pass.

### Step block F — `logVeniceErrorDev`

- [ ] **F.1: Write failing tests**

Create `backend/tests/lib/venice-errors.dev-log.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APIError } from 'openai';
import { logVeniceErrorDev, type VeniceRequestSnapshot } from '../../src/lib/venice-errors';

describe('logVeniceErrorDev', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development');
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    errSpy.mockRestore();
  });

  function snapshot(): VeniceRequestSnapshot {
    return {
      model: 'llama-3.1-70b',
      messageCount: 2,
      systemMessagePreview: 'You are an expert creative-writing assistant',
      userMessagePreview: 'Continue from: she turned and ran.',
      venice_parameters: { include_venice_system_prompt: true, strip_thinking_response: true },
      response_format: { type: 'json_schema' },
      promptCacheKey: 'abc123',
      temperature: 0.7,
      top_p: 0.95,
      max_completion_tokens: 4096,
    };
  }

  it('does not log in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    logVeniceErrorDev({
      err: new Error('boom'),
      ctx: { userId: 'u1', route: 'ai-complete' },
    });
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('logs [venice.error.dev] with class, name, message, stack for non-APIError', () => {
    const err = new TypeError('oops');
    logVeniceErrorDev({ err, ctx: { userId: 'u1', route: 'chat' } });
    expect(errSpy).toHaveBeenCalledOnce();
    expect(errSpy.mock.calls[0][0]).toBe('[venice.error.dev]');
    const payload = errSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.route).toBe('chat');
    expect(payload.errorClass).toBe('TypeError');
    expect(payload.errorName).toBe('TypeError');
    expect(payload.errorMessage).toBe('oops');
    expect(typeof payload.stack).toBe('string');
    // No upstream fields for non-APIError.
    expect(payload).not.toHaveProperty('upstreamStatus');
    expect(payload).not.toHaveProperty('upstreamBody');
  });

  it('logs upstream status + headers + body for APIError', () => {
    const headers = new Headers();
    headers.set('x-request-id', 'req-1');
    headers.set('x-ratelimit-remaining-requests', '5');
    headers.set('set-cookie', 'should-not-appear');
    const err = new APIError(429, { error: { message: 'rate limited', code: 'too_many' } } as never, 'rate limited', headers);
    logVeniceErrorDev({ err, ctx: { userId: 'u1', route: 'ai-complete' } });
    const payload = errSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.upstreamStatus).toBe(429);
    expect((payload.upstreamHeaders as Record<string, string>)['x-request-id']).toBe('req-1');
    expect((payload.upstreamHeaders as Record<string, string>)['x-ratelimit-remaining-requests']).toBe('5');
    expect(payload.upstreamHeaders).not.toHaveProperty('set-cookie');
    expect(payload.upstreamBody).toMatchObject({ error: { message: 'rate limited', code: 'too_many' } });
  });

  it('scrubs sk-* tokens in upstream body, headers, request snapshot', () => {
    const headers = new Headers();
    headers.set('x-request-id', 'sk-leak123abcdef456789xyz');
    const err = new APIError(
      400,
      { error: { message: 'check this key: sk-toxic000111222333444', code: 'bad' } } as never,
      'bad',
      headers,
    );
    const snap = snapshot();
    snap.systemMessagePreview = 'leaked key: sk-foobar123456789abcdef';
    logVeniceErrorDev({ err, ctx: { userId: 'u1', route: 'ai-complete' }, request: snap });
    const payload = errSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(JSON.stringify(payload)).not.toContain('sk-leak');
    expect(JSON.stringify(payload)).not.toContain('sk-toxic');
    expect(JSON.stringify(payload)).not.toContain('sk-foobar');
    expect(JSON.stringify(payload)).toContain('[redacted]');
  });

  it('includes rawContent when supplied', () => {
    logVeniceErrorDev({
      err: new SyntaxError('parse fail'),
      ctx: { userId: 'u1', route: 'chapter-summarise' },
      rawContent: '{"events":"truncated by token limit',
    });
    const payload = errSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.rawContent).toBe('{"events":"truncated by token limit');
  });

  it('omits rawContent when not supplied', () => {
    logVeniceErrorDev({ err: new Error('e'), ctx: { userId: 'u1', route: 'ai-complete' } });
    const payload = errSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('rawContent');
  });

  it('caps a 50KB upstreamBody at 8KB with a truncation marker', () => {
    const big = 'A'.repeat(50_000);
    const err = new APIError(500, { error: { message: big } } as never, 'big', new Headers());
    logVeniceErrorDev({ err, ctx: { userId: 'u1', route: 'ai-complete' } });
    const payload = errSpy.mock.calls[0][1] as Record<string, unknown>;
    const dump = JSON.stringify(payload.upstreamBody);
    expect(dump.length).toBeLessThanOrEqual(8 * 1024 + 100);  // 8KB + marker overhead
    expect(dump).toMatch(/truncated, original \d+ bytes/);
  });

  it('caps a long rawContent at 8KB with a truncation marker', () => {
    const big = 'X'.repeat(20_000);
    logVeniceErrorDev({
      err: new Error('parse'),
      ctx: { userId: 'u1', route: 'chapter-summarise' },
      rawContent: big,
    });
    const payload = errSpy.mock.calls[0][1] as Record<string, unknown>;
    expect((payload.rawContent as string).length).toBeLessThanOrEqual(8 * 1024 + 100);
    expect(payload.rawContent).toMatch(/truncated, original \d+ bytes/);
  });
});
```

- [ ] **F.2: Run and verify failure**

```bash
cd backend && npm test -- tests/lib/venice-errors.dev-log.test.ts 2>&1 | tail -10
```

Expected: tests fail with "Cannot find module" or "logVeniceErrorDev is not a function".

- [ ] **F.3: Implement `logVeniceErrorDev`**

Append to `backend/src/lib/venice-errors.ts`:

```ts
// ─── Dev-only full-exchange dump ──────────────────────────────────────────
//
// CLAUDE.md General rules: in non-production, decrypted narrative content
// (chapter bodies, prompts assembled for Venice, character bios, chat messages)
// MAY appear in dev logs — this is intentional, prompt/Venice-call debugging
// requires it. The SK_KEY_RE scrubber below catches Venice keys; narrative
// content is NOT scrubbed, by design.
//
// Absolute rules (all environments): no plaintext Venice keys (scrubbed),
// no passwords / recovery codes / DEKs / APP_ENCRYPTION_KEY (none of these
// are in the Venice exchange to begin with).

const MAX_UPSTREAM_BODY = 8 * 1024;
const MAX_VENICE_PARAMS = 2 * 1024;
const MAX_STACK = 4 * 1024;
const MAX_RAW_CONTENT = 8 * 1024;
const MAX_PREVIEW = 200;

const FORWARDED_HEADERS = [
  'x-request-id',
  'x-ratelimit-remaining-requests',
  'x-ratelimit-remaining-tokens',
  'x-ratelimit-limit-requests',
  'x-ratelimit-limit-tokens',
  'x-ratelimit-reset-requests',
  'x-ratelimit-reset-tokens',
  'retry-after',
] as const;

function scrubKeys(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(SK_KEY_RE, '[redacted]');
  if (Array.isArray(value)) return value.map(scrubKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubKeys(v)]));
  }
  return value;
}

function truncateString(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…[truncated, original ${s.length} bytes]`;
}

function truncateJson(value: unknown, max: number): unknown {
  const dump = JSON.stringify(value) ?? '';
  if (dump.length <= max) return value;
  return `${dump.slice(0, max)}…[truncated, original ${dump.length} bytes]`;
}

function selectHeaders(headers: SdkHeaders | null | undefined): Record<string, string> {
  if (!headers) return {};
  const out: Record<string, string> = {};
  for (const name of FORWARDED_HEADERS) {
    const value = readHeader(headers, name);
    if (typeof value === 'string') out[name] = value;
  }
  return out;
}

export interface VeniceRequestSnapshot {
  model: string;
  messageCount: number;
  systemMessagePreview?: string;
  userMessagePreview?: string;
  venice_parameters?: Record<string, unknown>;
  response_format?: unknown;
  promptCacheKey?: string;
  temperature?: number;
  top_p?: number;
  max_completion_tokens?: number;
}

export interface LogVeniceErrorDevInput {
  err: unknown;
  ctx: VeniceErrorContext;
  request?: VeniceRequestSnapshot;
  rawContent?: string;
}

/**
 * Dev-only full-exchange diagnostic dump. Runs alongside mapVeniceError;
 * mapVeniceError keeps producing the curated [venice.error] one-liner for
 * prod. This helper is a no-op in production.
 */
export function logVeniceErrorDev(input: LogVeniceErrorDevInput): void {
  if (process.env.NODE_ENV === 'production') return;

  const { err, ctx, request, rawContent } = input;
  const isApiError = err instanceof APIError;

  const payload: Record<string, unknown> = {
    route: ctx.route,
    userId: ctx.userId ?? null,
    errorClass: err instanceof Error ? err.constructor.name : typeof err,
    errorName: err instanceof Error ? err.name : null,
    errorMessage: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error && err.stack
      ? truncateString(scrubKeys(err.stack) as string, MAX_STACK)
      : null,
  };

  if (isApiError) {
    payload.upstreamStatus = err.status;
    payload.upstreamHeaders = scrubKeys(selectHeaders(err.headers as SdkHeaders | null | undefined));
    payload.upstreamBody = truncateJson(scrubKeys(err.error), MAX_UPSTREAM_BODY);
  }

  if (request) {
    const scrubbed: Record<string, unknown> = {
      model: request.model,
      messageCount: request.messageCount,
    };
    if (request.systemMessagePreview !== undefined) {
      scrubbed.systemMessagePreview = truncateString(
        scrubKeys(request.systemMessagePreview) as string,
        MAX_PREVIEW,
      );
    }
    if (request.userMessagePreview !== undefined) {
      scrubbed.userMessagePreview = truncateString(
        scrubKeys(request.userMessagePreview) as string,
        MAX_PREVIEW,
      );
    }
    if (request.venice_parameters !== undefined) {
      scrubbed.venice_parameters = truncateJson(scrubKeys(request.venice_parameters), MAX_VENICE_PARAMS);
    }
    if (request.response_format !== undefined) {
      scrubbed.response_format = scrubKeys(request.response_format);
    }
    if (request.promptCacheKey !== undefined) scrubbed.promptCacheKey = request.promptCacheKey;
    if (request.temperature !== undefined) scrubbed.temperature = request.temperature;
    if (request.top_p !== undefined) scrubbed.top_p = request.top_p;
    if (request.max_completion_tokens !== undefined) {
      scrubbed.max_completion_tokens = request.max_completion_tokens;
    }
    payload.request = scrubbed;
  }

  if (rawContent !== undefined) {
    payload.rawContent = truncateString(scrubKeys(rawContent) as string, MAX_RAW_CONTENT);
  }

  console.error('[venice.error.dev]', payload);
}
```

- [ ] **F.4: Run and verify pass**

```bash
cd backend && npm test -- tests/lib/venice-errors.dev-log.test.ts 2>&1 | tail -5
```

Expected: all 8 tests pass.

### Step block G — typecheck + full task verify + commit

- [ ] **G.1: Run typecheck**

```bash
cd backend && npm run typecheck 2>&1 | tail -5
```

Expected: clean (no errors).

- [ ] **G.2: Run the full task verify**

```bash
cd backend && npm run typecheck && npm test -- tests/services/venice-call.service.test.ts tests/lib/venice-errors.dev-log.test.ts 2>&1 | tail -10
```

Expected: typecheck passes, both test files green (16 + 8 = 24 tests).

- [ ] **G.3: Commit**

```bash
git add backend/src/services/venice-call.service.ts \
        backend/src/lib/venice-errors.ts \
        backend/tests/services/venice-call.service.test.ts \
        backend/tests/lib/venice-errors.dev-log.test.ts
git commit -m "[<step-1-id>] add venice-call.service helpers + logVeniceErrorDev

Five pure helpers around the pre-completion ritual (hydrateUserSettings,
buildVeniceParams, resolveTextGenWithFallback, logVeniceParams,
promptCacheKey) plus a dev-only logVeniceErrorDev next to mapVeniceError.

No route changes — purely additive infrastructure for steps 3-5.

buildVeniceParams precedence uses !== undefined (not truthy) so a user
toggling include_venice_system_prompt OFF reaches Venice as false, not
silently dropped. Test case guards against regression."
```

- [ ] **G.4: Hand off to `/bd-close-reviewed`**

```bash
/bd-close-reviewed <step-1-id>
```

Note: `security-reviewer` will fan because `venice-errors.ts` is in its lane (auth/key-adjacent). The dev-log helper's narrative-content-in-dev exposure is intentional per the file-level comment block (which cites CLAUDE.md). Reviewer should accept; if it flags, point at the spec §Section 5 "Dev-log content + security-reviewer note" paragraph.

---

## Task 2 — System-prompt restructure

**bd issue:** `<step-2-id>` from Task 0.

**Files:**
- Modify: `backend/src/services/prompt.service.ts`
- Modify: `backend/tests/services/prompt.service.test.ts` (add new invariant tests)

**Verify (final):** `cd backend && npm run typecheck && npm test -- tests/services/prompt.service.test.ts tests/services/prompt.actions.test.ts tests/services/prompt.user-prompts.test.ts tests/routes/ai-defaults.test.ts`

**Why no fixture sweep:** the existing prompt-service tests use `.toContain(DEFAULT_PROMPTS[key])` and structural `.toEqual({ defaults: DEFAULT_PROMPTS })` — both keep passing because the constants update in lockstep. Verified by grepping the test files: no `.toBe('You are an expert...')` snapshots exist. Frontend `Settings.prompts.test.tsx` and `useDefaultPrompts.test.tsx` mock with local constants, not real fixtures — also unaffected.

### Step block A — Read current per-action defaults

- [ ] **A.1: Capture current DEFAULT_PROMPTS bodies**

```bash
grep -A 25 "export const DEFAULT_PROMPTS" backend/src/services/prompt.service.ts
```

Expected: a Record literal with keys `system`, `continue`, `rewrite`, `expand`, `summarise`, `describe`, `scene`, `ask`, `summariseChapter`. Note each existing prose-action string body verbatim — you'll prefix `PROSE_OUTPUT_RULES + ' '` to each one in Step B.2.

### Step block B — Apply the restructure

- [ ] **B.1: Add the failing-on-new-invariant test first (TDD)**

Append to `backend/tests/services/prompt.service.test.ts` (after the existing `DEFAULT_SYSTEM_PROMPT` describe block):

```ts
import { PROSE_OUTPUT_RULES } from '../../src/services/prompt.service';

describe('[venice-orch step 2] system-prompt restructure', () => {
  it('DEFAULT_SYSTEM_PROMPT is persona-only — no output-shape rules', () => {
    expect(DEFAULT_SYSTEM_PROMPT).not.toMatch(/no quotation marks/i);
    expect(DEFAULT_SYSTEM_PROMPT).not.toMatch(/no preamble/i);
    expect(DEFAULT_SYSTEM_PROMPT).not.toMatch(/no XML tags/i);
    expect(DEFAULT_SYSTEM_PROMPT).not.toMatch(/no section labels/i);
    // Persona content survives:
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/creative-writing assistant/i);
  });

  it('PROSE_OUTPUT_RULES carries the output-shape rules', () => {
    expect(PROSE_OUTPUT_RULES).toMatch(/no quotation marks/i);
    expect(PROSE_OUTPUT_RULES).toMatch(/no preamble/i);
    expect(PROSE_OUTPUT_RULES).toMatch(/no XML tags/i);
    expect(PROSE_OUTPUT_RULES).toMatch(/no section labels/i);
  });

  const PROSE_ACTION_KEYS = ['continue', 'rewrite', 'expand', 'summarise', 'describe', 'scene', 'ask'] as const;
  for (const key of PROSE_ACTION_KEYS) {
    it(`DEFAULT_PROMPTS.${key} starts with PROSE_OUTPUT_RULES`, () => {
      expect(DEFAULT_PROMPTS[key]).toMatch(/no quotation marks/i);
      // Specifically: the rules constant string is a substring of the full prompt.
      expect(DEFAULT_PROMPTS[key]).toContain(PROSE_OUTPUT_RULES);
    });
  }

  it('DEFAULT_PROMPTS.summariseChapter does NOT include PROSE_OUTPUT_RULES (structured output)', () => {
    expect(DEFAULT_PROMPTS.summariseChapter).not.toContain('no quotation marks');
    expect(DEFAULT_PROMPTS.summariseChapter).toMatch(/JSON object matching the provided schema/i);
  });
});
```

- [ ] **B.2: Run and verify failure**

```bash
cd backend && npm test -- tests/services/prompt.service.test.ts 2>&1 | tail -15
```

Expected: new tests fail with either "Cannot find name 'PROSE_OUTPUT_RULES'" (import missing) OR "DEFAULT_SYSTEM_PROMPT matches /no quotation marks/" (the current text still has the output-shape rules).

- [ ] **B.3: Restructure `prompt.service.ts`**

Edit `backend/src/services/prompt.service.ts`. Find this block:

```ts
export const DEFAULT_SYSTEM_PROMPT =
  'You are an expert creative-writing assistant. ' +
  'Help the author continue, refine, and develop their story with vivid prose that matches their established voice and tone. ' +
  'Return only the requested content — no preamble, no meta-commentary, no quotation marks around the output, no XML tags, and no section labels.';
```

Replace with:

```ts
// Persona only — universal across every Venice call (prose + structured).
// Output-shape rules moved to PROSE_OUTPUT_RULES below so structured-output
// callers (e.g. chapter summarise → json_schema) can adopt the persona
// without inheriting "no quotation marks" (which would break JSON output).
export const DEFAULT_SYSTEM_PROMPT =
  'You are an expert creative-writing assistant. ' +
  'Help the author continue, refine, and develop their story with vivid prose ' +
  'that matches their established voice and tone.';

// Reusable suffix prefixed onto every prose-producing per-action default.
// Each action's full default is `${PROSE_OUTPUT_RULES} ${action-specific body}`.
// Structured-output actions (summariseChapter) do NOT include this.
export const PROSE_OUTPUT_RULES =
  'Return only the requested content — no preamble, no meta-commentary, ' +
  'no quotation marks around the output, no XML tags, and no section labels.';
```

Then find the `export const DEFAULT_PROMPTS = { ... }` literal. For each prose action key (`continue`, `rewrite`, `expand`, `summarise`, `describe`, `scene`, `ask`), prefix the existing string body with `` `${PROSE_OUTPUT_RULES} ` ``. Example pattern (the actual bodies are whatever you captured in step A.1):

```ts
export const DEFAULT_PROMPTS = {
  system: DEFAULT_SYSTEM_PROMPT,
  continue: `${PROSE_OUTPUT_RULES} ` +
    'continue the story from where the selection ends, matching the established voice. Aim for roughly 80–150 words.',
  rewrite: `${PROSE_OUTPUT_RULES} ` +
    'rewrite the selection with different phrasing while preserving meaning and voice. Return a single alternative version.',
  expand: `${PROSE_OUTPUT_RULES} ` + '...existing expand body verbatim from step A.1...',
  summarise: `${PROSE_OUTPUT_RULES} ` + '...existing summarise body verbatim from step A.1...',
  describe: `${PROSE_OUTPUT_RULES} ` + '...existing describe body verbatim from step A.1...',
  scene: `${PROSE_OUTPUT_RULES} ` + '...existing scene body verbatim from step A.1...',
  ask: `${PROSE_OUTPUT_RULES} ` + '...existing ask body verbatim from step A.1...',
  // summariseChapter UNCHANGED — already self-contained for JSON output.
  summariseChapter:
    'You produce structured per-chapter summaries for a long-form fiction project. ' +
    'Read the chapter and emit a JSON object matching the provided schema exactly. ' +
    'Be terse and concrete; the consumer is another LLM that will use your output as context when writing the next chapter.',
};
```

Replace each `...existing X body verbatim from step A.1...` placeholder with the exact string body you captured.

- [ ] **B.4: Run the test added in B.1**

```bash
cd backend && npm test -- tests/services/prompt.service.test.ts 2>&1 | tail -10
```

Expected: all new invariant tests pass.

- [ ] **B.5: Run the full task verify** (existing tests must keep passing)

```bash
cd backend && npm run typecheck && npm test -- tests/services/prompt.service.test.ts tests/services/prompt.actions.test.ts tests/services/prompt.user-prompts.test.ts tests/routes/ai-defaults.test.ts 2>&1 | tail -10
```

Expected: typecheck passes, all four test files green.

- [ ] **B.6: Commit**

```bash
git add backend/src/services/prompt.service.ts backend/tests/services/prompt.service.test.ts
git commit -m "[<step-2-id>] split DEFAULT_SYSTEM_PROMPT into persona + PROSE_OUTPUT_RULES

DEFAULT_SYSTEM_PROMPT now carries the persona only ('expert creative-writing
assistant, match the established voice'). Output-shape rules ('no preamble,
no quotation marks, no XML tags, no section labels') move into a new
PROSE_OUTPUT_RULES constant prefixed onto every prose action in DEFAULT_PROMPTS.

summariseChapter unchanged — already self-contained for JSON output.

Unlocks step 5: chapter-summarise can now send DEFAULT_SYSTEM_PROMPT
(persona) without contradicting json_schema strict mode."
```

- [ ] **B.7: Hand off to `/bd-close-reviewed`**

```bash
/bd-close-reviewed <step-2-id>
```

---

## Task 3 — ai-complete refactor

**bd issue:** `<step-3-id>` from Task 0.

**Files:**
- Modify: `backend/src/routes/ai.routes.ts`

**Verify (final):** `cd backend && npm run typecheck && npm test -- tests/ai/complete.test.ts`

**Nature:** pure refactor — no behavior change. Helpers produce identical request bodies to the inline code they replace. Existing integration tests pass without modification. If any test breaks, the refactor regressed.

### Step block A — Imports + symmetric setup

- [ ] **A.1: Update imports in `ai.routes.ts`**

At the top of `backend/src/routes/ai.routes.ts`, add helper imports and remove now-unused inline-resolver imports. Replace this import block:

```ts
import {
  resolveIncludeVeniceSystemPrompt,
  resolveTextGenParams,
  resolveUserPrompts,
} from '../services/user-settings-resolvers';
```

With:

```ts
import { resolveUserPrompts } from '../services/user-settings-resolvers';
import {
  buildVeniceParams,
  hydrateUserSettings,
  logVeniceParams,
  promptCacheKey,
  resolveTextGenWithFallback,
} from '../services/venice-call.service';
import { logVeniceErrorDev, type VeniceRequestSnapshot } from '../lib/venice-errors';
```

(`resolveUserPrompts` stays imported only if the file still uses it after the refactor — if `hydrateUserSettings` returns `userPrompts` as the only consumer, drop the standalone import. TypeScript will error if anything is unused.)

Also delete the module-private `promptCacheKey` function definition (the existing one near the top of the file) — the venice-call.service export replaces it.

- [ ] **A.2: Replace the user-settings hydration block**

Find this block (currently around lines 83-94 + 175-183):

```ts
const userRow = await prisma.user.findUnique({
  where: { id: userId },
  select: { settingsJson: true },
});
const rawSettings = userRow?.settingsJson ?? null;
const includeVeniceSystemPrompt = resolveIncludeVeniceSystemPrompt(rawSettings);
const userPrompts = resolveUserPrompts(rawSettings);
```

Replace with:

```ts
const { settings, includeVeniceSystemPrompt, userPrompts } = await hydrateUserSettings(userId);
```

Also delete the separate `const partialSettings = (rawSettings as Partial<UserSettings>) ?? {};` block (and the `userSettingsForResolve` literal that follows) — `settings` from `hydrateUserSettings` replaces both.

- [ ] **A.3: Replace the venice_parameters assembly block**

Find this block (currently around lines 153-166):

```ts
const venice_parameters: Record<string, unknown> = { ...baseVeniceParams };

const modelInfo = veniceModelsService.findModel(body.modelId, userId);
if (modelInfo?.supportsReasoning === true) {
  venice_parameters.strip_thinking_response = true;
}

if (body.enableWebSearch === true) {
  venice_parameters.enable_web_search = 'auto';
  venice_parameters.enable_web_citations = true;
}
```

Replace with:

```ts
const modelInfo = veniceModelsService.findModel(body.modelId, userId);
const venice_parameters = buildVeniceParams({
  base: baseVeniceParams,
  supportsReasoning: modelInfo?.supportsReasoning === true,
  enableWebSearch: body.enableWebSearch === true,
});
```

- [ ] **A.4: Replace the text-gen params resolution block**

Find the `resolvedParams` ternary block (currently around lines 184-200):

```ts
const resolvedParams: {
  temperature: number | undefined;
  top_p: number | undefined;
  max_completion_tokens: number;
  source: { temperature: string; top_p: string; max_completion_tokens: string };
} = modelInfo
  ? resolveTextGenParams(userSettingsForResolve, modelInfo)
  : {
      temperature: undefined,
      top_p: undefined,
      max_completion_tokens,
      source: {
        temperature: 'global-default',
        top_p: 'global-default',
        max_completion_tokens: 'global-default',
      },
    };
```

Replace with:

```ts
const resolved = resolveTextGenWithFallback(settings, modelInfo, max_completion_tokens);
```

Then update downstream references from `resolvedParams.X` → `resolved.X` (in the `[venice.params]` log block and the `.create()` call).

- [ ] **A.5: Replace the `[venice.params]` log block**

Find the dev log block (currently around lines 202-223):

```ts
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
      action: body.action,
      model_cap: modelMaxCompletionTokens,
      enable_web_search: venice_parameters.enable_web_search,
    }),
  );
}
```

Replace with:

```ts
logVeniceParams({
  route: 'ai-complete',
  userId,
  modelId: body.modelId,
  resolved,
  action: body.action,
  modelCap: modelMaxCompletionTokens,
  enableWebSearch: venice_parameters.enable_web_search,
});
```

### Step block B — Snapshot hoist + error-handler adoption

- [ ] **B.1: Hoist VeniceRequestSnapshot before `.create()`**

Just before the `const streamWithResp = (await client.chat.completions.create(...))` call (currently around line 239), insert:

```ts
const cacheKey = promptCacheKey(body.storyId, body.modelId);

const snapshot: VeniceRequestSnapshot = {
  model: body.modelId,
  messageCount: messages.length,
  systemMessagePreview: typeof messages[0]?.content === 'string' ? messages[0].content : undefined,
  userMessagePreview:
    typeof messages.at(-1)?.content === 'string' ? (messages.at(-1)!.content as string) : undefined,
  venice_parameters,
  promptCacheKey: cacheKey,
  temperature: resolved.temperature,
  top_p: resolved.top_p,
  max_completion_tokens: resolved.max_completion_tokens,
};
```

Then in the `.create()` call literal, replace the inline `prompt_cache_key: promptCacheKey(body.storyId, body.modelId)` with `prompt_cache_key: cacheKey` so both call sites reference the same value.

- [ ] **B.2: Update the pre-stream catch site**

Find the pre-stream catch (the `try { ... await client.chat.completions.create(...) ... } catch (err) { ... }` around lines ~239-280). Add `logVeniceErrorDev` BEFORE `mapVeniceError`:

```ts
} catch (err) {
  logVeniceErrorDev({ err, ctx: { userId, route: 'ai-complete' }, request: snapshot });
  if (mapVeniceError(err, res, { userId, route: 'ai-complete' })) return;
  throw err;
}
```

- [ ] **B.3: Replace the mid-stream `console.error` line**

Find this line (currently at ai.routes.ts:328):

```ts
console.error('[ai.complete:stream]', streamErr);
```

Replace with:

```ts
logVeniceErrorDev({ err: streamErr, ctx: { userId, route: 'ai-complete' }, request: snapshot });
```

(The mid-stream catch already calls `mapVeniceErrorToSse(...)` after the console.error; that stays. Only the bare console.error line is replaced.)

### Step block C — Verify + commit

- [ ] **C.1: Run typecheck**

```bash
cd backend && npm run typecheck 2>&1 | tail -5
```

Expected: clean. If TypeScript complains about unused imports or variables, clean them up.

- [ ] **C.2: Run the full task verify**

```bash
cd backend && npm run typecheck && npm test -- tests/ai/complete.test.ts 2>&1 | tail -10
```

Expected: typecheck passes, all complete.test.ts tests green. If anything fails, the refactor regressed — diff the request body the test captures vs the previous shape; differences should be zero.

- [ ] **C.3: Commit**

```bash
git add backend/src/routes/ai.routes.ts
git commit -m "[<step-3-id>] ai-complete: wire venice-call.service helpers

Replaces ~80 LOC of inline pre-completion ritual with helper calls:
hydrateUserSettings, buildVeniceParams, resolveTextGenWithFallback,
logVeniceParams, promptCacheKey. Hoists VeniceRequestSnapshot before
.create() so pre-stream + mid-stream catches both reference it.

logVeniceErrorDev replaces the bare console.error('[ai.complete:stream]')
line (one richer log per error instead of two).

No behavior change — request bodies are byte-identical to the pre-refactor
shape. complete.test.ts captures pass unchanged."
```

- [ ] **C.4: Hand off to `/bd-close-reviewed`**

```bash
/bd-close-reviewed <step-3-id>
```

---

## Task 4 — chat refactor

**bd issue:** `<step-4-id>` from Task 0.

**Files:**
- Modify: `backend/src/routes/chat.routes.ts`

**Verify (final):** `cd backend && npm run typecheck && npm test -- tests/ai/chat-citations.test.ts tests/ai/chat-persistence.test.ts tests/ai/chat-rate-limit-headers.test.ts tests/ai/ask-ai-attachment.test.ts tests/routes/chat.test.ts`

**Nature:** same shape as Task 3 (pure refactor), with these chat-specific differences:
- Pass `enableChatStreamHints: true` to `buildVeniceParams` (adds `include_search_results_in_stream`).
- Cache key is `promptCacheKey(chatId, body.modelId)`.
- `stream_options: { include_usage: true }` stays literal in the route's `.create()` call (chat persists `Message.tokens`).
- `action` in the log is `'ask' | 'scene'` (resolved per `chat.kind`).
- History assembly + retry logic + per-message DB writes stay in the route.

### Step block A — Symmetric setup (mirror Task 3, chat-specific differences noted)

- [ ] **A.1: Update imports** — same shape as Task 3 step A.1. Also delete the module-private `chatPromptCacheKey` function near the top of the file (the venice-call.service `promptCacheKey` replaces it).

- [ ] **A.2: Replace user-settings hydration** — same shape as Task 3 step A.2. Find the block (currently around lines 266-276), replace with `const { settings, includeVeniceSystemPrompt, userPrompts } = await hydrateUserSettings(userId);`. Also delete the separate `partialSettings` / `userSettingsForResolve` blocks (currently around lines 426-434).

- [ ] **A.3: Replace venice_parameters assembly** — same shape as Task 3 step A.3, **but pass `enableChatStreamHints: true`**:

```ts
const modelInfo = veniceModelsService.findModel(body.modelId, userId);
const venice_parameters = buildVeniceParams({
  base: baseVeniceParams,
  supportsReasoning: modelInfo?.supportsReasoning === true,
  enableWebSearch: body.enableWebSearch === true,
  enableChatStreamHints: true,
});
```

- [ ] **A.4: Replace text-gen params ternary** — same shape as Task 3 step A.4. Resulting line:

```ts
const resolved = resolveTextGenWithFallback(settings, modelInfo, max_completion_tokens);
```

- [ ] **A.5: Replace `[venice.params]` log** — same shape as Task 3 step A.5, but the `action` field is `'ask' | 'scene'`:

```ts
logVeniceParams({
  route: 'chat',
  userId,
  modelId: body.modelId,
  resolved,
  action,                                // existing local var: 'ask' | 'scene' per chat.kind
  modelCap: modelMaxCompletionTokens,
  enableWebSearch: venice_parameters.enable_web_search,
});
```

### Step block B — Snapshot hoist + error-handler adoption

- [ ] **B.1: Hoist VeniceRequestSnapshot before `.create()`**

Just before the `const streamWithResp = (await client.chat.completions.create(...))` call (currently around line 482), insert:

```ts
const cacheKey = promptCacheKey(chatId, body.modelId);

const snapshot: VeniceRequestSnapshot = {
  model: body.modelId,
  messageCount: messages.length,
  systemMessagePreview: typeof messages[0]?.content === 'string' ? messages[0].content : undefined,
  userMessagePreview:
    typeof messages.at(-1)?.content === 'string' ? (messages.at(-1)!.content as string) : undefined,
  venice_parameters,
  promptCacheKey: cacheKey,
  temperature: resolved.temperature,
  top_p: resolved.top_p,
  max_completion_tokens: resolved.max_completion_tokens,
};
```

In the `.create()` call literal, replace `prompt_cache_key: chatPromptCacheKey(chatId, body.modelId)` with `prompt_cache_key: cacheKey`. **Leave `stream_options: { include_usage: true }` alone** — it's chat-specific.

- [ ] **B.2: Update the pre-stream catch site**

Add `logVeniceErrorDev` before `mapVeniceError` in the pre-stream catch:

```ts
} catch (err) {
  logVeniceErrorDev({ err, ctx: { userId, route: 'chat' }, request: snapshot });
  if (mapVeniceError(err, res, { userId, route: 'chat' })) return;
  throw err;
}
```

- [ ] **B.3: Replace the mid-stream `console.error` line**

Find this line (currently at chat.routes.ts:629):

```ts
console.error('[chat.messages.send:stream]', streamErr);
```

Replace with:

```ts
logVeniceErrorDev({ err: streamErr, ctx: { userId, route: 'chat' }, request: snapshot });
```

**Leave alone** the nearby `console.error('[V15] Failed to persist assistant message', persistErr)` (chat.routes.ts:623) — that's a DB error, not a Venice error.

### Step block C — Verify + commit

- [ ] **C.1: Run typecheck**

```bash
cd backend && npm run typecheck 2>&1 | tail -5
```

Expected: clean.

- [ ] **C.2: Run the full task verify**

```bash
cd backend && npm run typecheck && npm test -- tests/ai/chat-citations.test.ts tests/ai/chat-persistence.test.ts tests/ai/chat-rate-limit-headers.test.ts tests/ai/ask-ai-attachment.test.ts tests/routes/chat.test.ts 2>&1 | tail -10
```

Expected: typecheck passes, all five test files green.

- [ ] **C.3: Commit**

```bash
git add backend/src/routes/chat.routes.ts
git commit -m "[<step-4-id>] chat: wire venice-call.service helpers

Same refactor as ai-complete, with chat-specific differences:
- enableChatStreamHints: true → include_search_results_in_stream
- promptCacheKey scoped to (chatId, modelId)
- stream_options.include_usage stays literal (chat persists Message.tokens)

logVeniceErrorDev replaces the bare console.error('[chat.messages.send:stream]')
line. The unrelated [V15] persist-failure log is left alone.

No behavior change — request bodies byte-identical to pre-refactor shape."
```

- [ ] **C.4: Hand off to `/bd-close-reviewed`**

```bash
/bd-close-reviewed <step-4-id>
```

---

## Task 5 — summarise behavior fix + helper wiring (closes story-editor-lxo)

**bd issue:** `story-editor-lxo`.

**Files:**
- Modify: `backend/src/routes/chapters.routes.ts`
- Modify: `backend/tests/routes/chapters.summarise.test.ts` (extend)

**Verify (final):** `cd backend && npm run typecheck && npm test -- tests/routes/chapters.summarise.test.ts`

**Nature:** real behavior change. Summarise gains five missing capabilities (temperature/top_p/max_completion_tokens, include_venice_system_prompt, strip_thinking_response, prompt_cache_key, persona system prompt, [venice.params] log) plus the dev-only logVeniceErrorDev on the parse-failure branch.

### Step block A — Write the failing test for the new behavior

- [ ] **A.1: Add the failing-on-new-behavior test**

Append to `backend/tests/routes/chapters.summarise.test.ts` (after the existing tests):

```ts
describe('[venice-orch step 5] summarise honors model settings + sends persona', () => {
  it('sends temperature, top_p, max_completion_tokens, venice_parameters, prompt_cache_key, and persona', async () => {
    // Use whatever fixture pattern the existing tests use:
    //   - seed a user with a per-model temperature override of 0.42 in chat.overrides
    //   - seed a chapter with non-empty body
    //   - stub Venice fetch to capture the request body (existing tests have this pattern)
    //   - call POST /api/stories/<storyId>/chapters/<chapterId>/summarise
    //   - assert the captured request body
    //
    // Look at the existing chapters.summarise.test.ts for the exact stub-Venice
    // helper name (likely `stubVeniceFetch`, `MODEL_LIST_BODY`, `jsonResponse`
    // imports). Mirror them — don't roll your own.

    // After dispatching the request and reading the captured request body:
    const sentBody = capturedRequestBody!;
    expect(sentBody.temperature).toBe(0.42);                       // user override applied
    expect(sentBody.top_p).toBeDefined();
    expect(sentBody.max_completion_tokens).toBeDefined();
    expect(sentBody.prompt_cache_key).toMatch(/^[0-9a-f]{32}$/);
    expect(sentBody.venice_parameters.include_venice_system_prompt).toBe(true);
    expect(sentBody.messages[0].role).toBe('system');
    // The persona substring from DEFAULT_SYSTEM_PROMPT (step 2 made it persona-only).
    expect(sentBody.messages[0].content).toContain('creative-writing assistant');
    // The summariseChapter task content also present.
    expect(sentBody.messages[0].content).toContain('JSON object matching the provided schema');
  });

  it('on reasoning model, sends strip_thinking_response: true', async () => {
    // Same fixture setup, but stub veniceModelsService.findModel to return a
    // model with supportsReasoning: true, supportsResponseSchema: true.
    const sentBody = capturedRequestBody!;
    expect(sentBody.venice_parameters.strip_thinking_response).toBe(true);
  });

  it('honors include_venice_system_prompt=false (user toggled OFF in settings)', async () => {
    // Seed user with settingsJson: { ai: { includeVeniceSystemPrompt: false } }
    const sentBody = capturedRequestBody!;
    expect(sentBody.venice_parameters.include_venice_system_prompt).toBe(false);
  });
});
```

- [ ] **A.2: Run and verify failure**

```bash
cd backend && npm test -- tests/routes/chapters.summarise.test.ts 2>&1 | tail -15
```

Expected: 3 new tests fail (request body missing the new fields).

### Step block B — Apply the route refactor + behavior fix

- [ ] **B.1: Update imports in `chapters.routes.ts`**

At the top of `backend/src/routes/chapters.routes.ts`, add:

```ts
import {
  buildVeniceParams,
  hydrateUserSettings,
  logVeniceParams,
  promptCacheKey,
  resolveTextGenWithFallback,
} from '../services/venice-call.service';
import { logVeniceErrorDev, type VeniceRequestSnapshot } from '../lib/venice-errors';
```

Keep the existing `resolvePrompt` import — summarise still needs it for the system + summariseChapter assembly.

- [ ] **B.2: Replace the inline user-settings load**

Find this block in the summarise handler (currently around lines 303-307):

```ts
const userRow = await prisma.user.findUnique({
  where: { id: userId },
  select: { settingsJson: true },
});
const userPrompts = resolveUserPrompts(userRow?.settingsJson ?? null);
```

Replace with:

```ts
const { settings, includeVeniceSystemPrompt, userPrompts } = await hydrateUserSettings(userId);
```

- [ ] **B.3: Assemble the system message + venice_parameters + resolved params + snapshot**

Just before the `const client = await getVeniceClient(userId);` line (currently around line 309), insert:

```ts
// Persona (from step-2 persona-only DEFAULT_SYSTEM_PROMPT) + task (summariseChapter,
// which is self-contained for JSON output). The two-message prompt bypasses
// buildPrompt entirely — summarise needs no world-notes / characters / previous-chapters
// scaffolding, just persona + task + chapter content.
const systemMessage =
  `${resolvePrompt(userPrompts, 'system')}\n\n${resolvePrompt(userPrompts, 'summariseChapter')}`;

const venice_parameters = buildVeniceParams({
  base: {},
  supportsReasoning: modelInfo.supportsReasoning === true,
  includeVeniceSystemPrompt,             // explicit (no buildPrompt to set it)
});

// modelInfo is non-null here (gated above with the 400 for unsupported models).
// Fallback path inside resolveTextGenWithFallback never fires; passing model cap
// as the fallback is defensive symmetry.
const resolved = resolveTextGenWithFallback(settings, modelInfo, modelInfo.maxCompletionTokens);

logVeniceParams({
  route: 'chapter-summarise',
  userId,
  modelId: body.modelId,
  resolved,
  action: 'summariseChapter',
  modelCap: modelInfo.maxCompletionTokens,
});

const cacheKey = promptCacheKey(chapterId, body.modelId);

const snapshot: VeniceRequestSnapshot = {
  model: body.modelId,
  messageCount: 2,
  systemMessagePreview: systemMessage,
  userMessagePreview: plaintext,
  venice_parameters,
  response_format: { type: 'json_schema', name: 'ChapterSummary' },
  promptCacheKey: cacheKey,
  temperature: resolved.temperature,
  top_p: resolved.top_p,
  max_completion_tokens: resolved.max_completion_tokens,
};
```

- [ ] **B.4: Update the `.create()` call**

Find the existing `.create({...})` call (currently around lines 312-328) and replace its body with:

```ts
const completion = await client.chat.completions.create({
  model: body.modelId,
  messages: [
    { role: 'system', content: systemMessage },
    { role: 'user', content: plaintext },
  ],
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'ChapterSummary',
      schema: chapterSummaryJsonSchema(),
      strict: true,
    },
  },
  temperature: resolved.temperature,
  top_p: resolved.top_p,
  max_completion_tokens: resolved.max_completion_tokens,
  prompt_cache_key: cacheKey,
  venice_parameters,
} as unknown as Parameters<typeof client.chat.completions.create>[0]);
```

- [ ] **B.5: Add `logVeniceErrorDev` to both catch sites**

Update the `client.chat.completions.create` try/catch (currently around lines 311-333) so the catch becomes:

```ts
} catch (err) {
  logVeniceErrorDev({ err, ctx: { userId, route: 'chapter-summarise' }, request: snapshot });
  if (mapVeniceError(err, res, { userId, route: 'chapter-summarise' })) return;
  throw err;
}
```

Then update the parse-failure catch (currently around lines 337-347) so the catch parameter is named and `logVeniceErrorDev` is called with `rawContent`:

```ts
const content = raw.choices?.[0]?.message?.content ?? '';
let parsed: ReturnType<typeof chapterSummarySchema.parse>;
try {
  parsed = chapterSummarySchema.parse(JSON.parse(content));
} catch (parseErr) {
  logVeniceErrorDev({
    err: parseErr,
    ctx: { userId, route: 'chapter-summarise' },
    request: snapshot,
    rawContent: content,
  });
  res.status(502).json({
    error: {
      message: 'Venice returned a malformed summary.',
      code: 'summary_parse_failed',
    },
  });
  return;
}
```

### Step block C — Verify + commit

- [ ] **C.1: Run typecheck**

```bash
cd backend && npm run typecheck 2>&1 | tail -5
```

Expected: clean. If any unused imports remain (e.g., `resolveUserPrompts` from earlier), remove them.

- [ ] **C.2: Run the new tests**

```bash
cd backend && npm test -- tests/routes/chapters.summarise.test.ts 2>&1 | tail -10
```

Expected: the 3 new tests from step A.1 pass, and all existing chapters.summarise.test.ts tests continue passing.

- [ ] **C.3: Run the full task verify**

```bash
cd backend && npm run typecheck && npm test -- tests/routes/chapters.summarise.test.ts 2>&1 | tail -10
```

Expected: typecheck passes, all tests green.

- [ ] **C.4: Commit**

```bash
git add backend/src/routes/chapters.routes.ts backend/tests/routes/chapters.summarise.test.ts
git commit -m "[lxo] summarise: honor user model settings + venice_parameters + persona

Wires venice-call.service helpers into the summarise handler and adds the
missing capabilities surfaced in bd story-editor-lxo:

- temperature / top_p / max_completion_tokens from resolveTextGenWithFallback
  (user override → Venice model default → global default chain, same as ai/chat)
- include_venice_system_prompt from the user toggle (explicit pass to
  buildVeniceParams since summarise bypasses buildPrompt)
- strip_thinking_response on reasoning models — critical for json_schema
  strict mode (reasoning tokens leaking would break the parse)
- prompt_cache_key(chapterId, modelId) — chapter+model scope
- DEFAULT_SYSTEM_PROMPT persona (now persona-only after step 2) prefixed
  to summariseChapter in messages[0].content
- [venice.params] structured dev log

Parse-failure catch now logs via logVeniceErrorDev with rawContent so the
rejected string is visible in dev (previously logged nothing).

Closes story-editor-lxo."
```

- [ ] **C.5: Hand off to `/bd-close-reviewed`**

```bash
/bd-close-reviewed story-editor-lxo
```

Note: `security-reviewer` will fan (touches a Venice-call route with user keys). The diff is small (handler-internal); reviewer should accept.

---

## Post-task — open the PR

After all five tasks close, the branch has 6 commits (bd setup + 5 task commits) and the umbrella bd auto-closes.

- [ ] **Step 1: Push the branch (if not already pushed)**

```bash
git push
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "Venice completion call-site consolidation" --body-file - <<'EOF'
## Summary

Closes bd umbrella `<umbrella-id>` (which closes story-editor-lxo + 4 child issues for the 5-step plan).

Five-task consolidation of the Venice-completion orchestration ritual across ai-complete, chat, and chapter-summarise:

1. Add five focused helpers in `backend/src/services/venice-call.service.ts` + `logVeniceErrorDev` in `venice-errors.ts`.
2. Split `DEFAULT_SYSTEM_PROMPT` into persona-only + `PROSE_OUTPUT_RULES` per-action.
3. ai-complete: wire helpers; adopt `logVeniceErrorDev`.
4. chat: same shape, with `enableChatStreamHints: true`.
5. summarise: wire helpers + fix missing behaviors (temperature/top_p/max_completion_tokens, include_venice_system_prompt, strip_thinking_response, prompt_cache_key, persona prefix, [venice.params] log). Closes story-editor-lxo.

Spec: [docs/superpowers/specs/2026-05-25-venice-completion-orchestration-design.md](docs/superpowers/specs/2026-05-25-venice-completion-orchestration-design.md)
Plan: [docs/superpowers/plans/2026-05-25-venice-completion-orchestration.md](docs/superpowers/plans/2026-05-25-venice-completion-orchestration.md)

## Test plan

- [x] `cd backend && npm run typecheck`
- [x] `cd backend && npm test` (full backend suite)
- [x] Per-task verify lines (5 of them, see plan §Task N)
- [ ] Manual: trigger summarise with a per-user temperature override → confirm `[venice.params]` log shows the user's value
- [ ] Manual: trigger summarise with `includeVeniceSystemPrompt: false` toggled → confirm `[venice.params]` log + Venice receives `false`
- [ ] Manual: cause a parse failure (stub a malformed Venice response) → confirm `[venice.error.dev]` log includes `rawContent`

## Out of scope (filed as separate follow-ups)

- Token persistence on summarise (`ChapterSummary.tokens` column).
- Settings tab "reset to default" affordance per prompt field.
- X4 / next AI surface composition of the helpers (no work until X4 is scoped).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

- [ ] **Step 3: Monitor CI**

```bash
gh pr view --json statusCheckRollup,state,mergeable
```

Expected: all checks pass; mergeable.

---

## Self-review (writing-plans skill checklist)

**1. Spec coverage check** — every spec section maps to a task:

- Spec §Section 1 (system-prompt restructure) → Task 2
- Spec §Section 2 (shared helpers) → Task 1 (step blocks A-E)
- Spec §Section 3 (per-route refactor: ai-complete, chat, summarise) → Tasks 3, 4, 5
- Spec §Section 4 (summarise route gains) → Task 5 (all 9 behaviors enumerated in B.3 + B.4 + B.5)
- Spec §Section 5 (dev error logging) → Task 1 step block F + Tasks 3/4/5 catch-site adoption
- Spec §Section 6 (sequencing + bd plan) → Task 0 + per-task `/bd-close-reviewed` handoffs
- Spec §Section 7 (risks) — all addressed:
  - `buildVeniceParams` summarise contract → Task 1 step C.3 implementation + test case
  - Practical cache hit on summarise → mentioned in Task 5 step B.3 comment + spec, no action needed
  - Test fixture sweep on refactor → Tasks 3 + 4 are nature: pure refactor (no fixture change expected); Task 2 explicitly notes no sweep needed (verified by grep)
  - Log volume in dev → caps applied in Task 1 step F.3
  - Request snapshot duplication → each route assembles its own (Tasks 3/4/5 step B.1); spec §Section 7 notes this is intentional, no extraction
- Spec §Section 8 (out-of-scope follow-ups) → repeated in PR body Step 2 above

**2. Placeholder scan** — searched for "TBD", "TODO", "implement later", "similar to Task N", "see spec for details":
- Task 1 step block B uses "look at how other service tests acquire prisma — match that pattern" — this is correct (project-conventions vary; the implementer reads the existing test files to match style, not invent a new pattern). Acceptable.
- Task 2 step B.3 uses "...existing X body verbatim from step A.1..." — explicitly directs the implementer to copy the body captured in the previous step (A.1 grep). Acceptable; the actual bodies aren't in the spec or plan because they're already in the codebase.
- Task 4 says "same shape as Task 3 step A.X" multiple times — repeated the differences fully (imports list, line numbers, chat-specific flag). Each Task 4 step has its own self-contained command/code block; the "same shape" wording is orienting, not instruction-skipping.
- Task 5 step A.1 uses placeholders for fixture setup ("Look at the existing chapters.summarise.test.ts for the exact stub-Venice helper name") — same justification as Task 1 step B; project conventions vary, the implementer matches existing patterns.

**3. Type consistency check** — names match across tasks:
- `HydratedUserSettings.includeVeniceSystemPrompt` (Task 1 B.3) → consumed as `includeVeniceSystemPrompt` in Tasks 3/4 (A.2) ✓
- `BuildVeniceParamsInput.includeVeniceSystemPrompt` (Task 1 C.3) → passed in Task 5 B.3 ✓
- `LogVeniceParamsInput.modelCap` (Task 1 E.3) → passed as `modelCap` in Tasks 3/4/5 ✓
- `VeniceRequestSnapshot.promptCacheKey` (Task 1 F.3) → populated as `promptCacheKey: cacheKey` in Tasks 3/4/5 B.1 ✓
- `logVeniceErrorDev(input)` signature with `err` / `ctx` / `request` / `rawContent` → called consistently in Tasks 3/4/5 ✓
- `resolveTextGenWithFallback(settings, modelInfo, fallbackMaxCompletionTokens)` → called with `settings, modelInfo, max_completion_tokens` in Tasks 3/4 and `settings, modelInfo, modelInfo.maxCompletionTokens` in Task 5 ✓

**4. Ambiguity check** — re-read each task:
- The `resolveTextGenWithFallback` type-assertion comment in Task 1 D.3 ("match the inline pattern") is clear about the precedent.
- Task 2's "no fixture sweep needed" claim is backed by the grep at the top of the task.
- Task 5's "modelInfo is non-null here" comment is restated in B.3 so the implementer doesn't worry about the fallback path.

No issues found. Plan is ready.

---

**Plan file:** `docs/superpowers/plans/2026-05-25-venice-completion-orchestration.md`

Link into bd via:

```bash
# After filing each child bd issue in Task 0, the bd update --notes commands
# already embed the plan: link. No separate scripts/bd-link-plan.sh call needed
# — those commands write the plan: line directly.
```
