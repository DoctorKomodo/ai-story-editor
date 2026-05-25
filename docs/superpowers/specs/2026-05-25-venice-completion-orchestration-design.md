# Venice completion orchestration — design

## Summary

Fix `story-editor-lxo` — the `POST /api/stories/:storyId/chapters/:chapterId/summarise` route skips user model settings (`temperature` / `top_p` / `max_completion_tokens`), the `include_venice_system_prompt` toggle, `strip_thinking_response` for reasoning models, the `prompt_cache_key` field, and the `[venice.params]` structured log. While there, also fix two adjacent issues: (a) the app-level `DEFAULT_SYSTEM_PROMPT` never reaches the summarise route because the handler bypasses `buildPrompt()` entirely, and (b) the ~80 LOC of pre-`create()` orchestration ritual duplicated between `ai.routes.ts` and `chat.routes.ts` is about to be pasted a third time on summarise — and a fourth time when X4 lands.

Approach: extract the duplicated ritual into five focused helpers in a new `backend/src/services/venice-call.service.ts`, split `DEFAULT_SYSTEM_PROMPT` so output-shape rules ("no quotation marks, no XML tags") live with the per-action prose prompts instead of contradicting structured-output calls, and add a dev-only `logVeniceErrorDev` helper that dumps the full Venice exchange when something fails. Each of the three completion call sites then composes the helpers + writes its own `client.chat.completions.create({...})` literal (streaming, non-streaming, structured — the divergent shapes stay where they belong, in the route).

## Motivation

Three problems, one trigger.

**The trigger** — bd `story-editor-lxo`: when a user customises temperature in Settings, every Venice call honours it except the summarise call, which silently runs at Venice's untuned defaults. Same for the include-Venice-system-prompt toggle, reasoning-model thinking-token stripping, and the prompt-cache key. The route was shipped without the wiring that the rest of the codebase has.

**The adjacent system-prompt gap** — `DEFAULT_SYSTEM_PROMPT` is documented as universal but mixes a persona ("You are an expert creative-writing assistant") with output-shape rules ("Return only the requested content — no preamble, no meta-commentary, no quotation marks around the output, no XML tags, and no section labels"). The "no quotation marks" clause is incompatible with JSON output, which is why the summarise route silently exempted itself from the whole system prompt — throwing the persona away with the rules.

**The structural smell** — the duplicated pre-`create()` ritual between ai-complete and chat (settings hydration, `venice_parameters` assembly, text-gen params resolution with the `modelInfo === null` fallback, the `[venice.params]` log) is about 80 LOC each. Summarise needs the same ritual. So does X4. Pasting it a third and fourth time means four places to keep in sync; the current state already has small drift (chat sets `include_search_results_in_stream`, ai-complete doesn't — both are defensible choices, but they should be visible per-call rather than buried in copy-pasted blocks).

## Goals

1. **Fix the summarise behavior gap.** Honour `temperature` / `top_p` / `max_completion_tokens`, `include_venice_system_prompt`, `strip_thinking_response` (reasoning models), `prompt_cache_key`, and emit the `[venice.params]` log. Closes `story-editor-lxo`.
2. **Reconcile the app system prompt's contract.** Split `DEFAULT_SYSTEM_PROMPT` into persona-only (universal) + output-shape rules (per-action). Persona then flows through every call site including summarise.
3. **Eliminate orchestration duplication.** Extract focused helpers so the three Venice completion call sites stop carrying ~80 LOC of identical pre-completion ritual. X4 won't paste it again.
4. **Improve dev error logging.** Log the full Venice exchange on any error in dev — request snapshot, response status + selected headers, raw response body, full stack trace. For parse failures, log the raw content the parser rejected. Prod logging stays the curated `[venice.error]` one-liner.

## Non-goals

- Not consolidating the `client.chat.completions.create()` call itself. Streaming vs non-streaming vs structured-output legitimately diverge per-route; pulling them under one envelope creates conditional flags worse than the duplication.
- Not changing `buildPrompt()` internals. The system-prompt restructure happens at `DEFAULT_PROMPTS` + per-action defaults; the prompt builder's reading of `userPrompts.system` is unchanged.
- Not changing the encryption / repo path. The `[E12]` leak test keeps passing unchanged.
- Not adding new Venice features. No web-search on summarise, no new actions, no streaming on summarise, no usage-token persistence (filed as separate follow-up).

## Section 1 — System-prompt restructure

`DEFAULT_SYSTEM_PROMPT` becomes persona-only. Output-shape rules move into a single shared `PROSE_OUTPUT_RULES` constant that each prose action's default prefixes. `summariseChapter` (the structured-output prompt) keeps its own self-contained text.

```ts
// backend/src/services/prompt.service.ts

// Persona only — universal across every Venice call.
export const DEFAULT_SYSTEM_PROMPT =
  'You are an expert creative-writing assistant. ' +
  'Help the author continue, refine, and develop their story with vivid prose ' +
  'that matches their established voice and tone.';

// Reusable suffix for prose-producing actions.
const PROSE_OUTPUT_RULES =
  'Return only the requested content — no preamble, no meta-commentary, ' +
  'no quotation marks around the output, no XML tags, and no section labels.';

export const DEFAULT_PROMPTS = {
  system: DEFAULT_SYSTEM_PROMPT,
  // Prose actions: prefix existing body verbatim from current DEFAULT_PROMPTS
  // (read from backend/src/services/prompt.service.ts). The implementer copies
  // each current string and prefixes it with `${PROSE_OUTPUT_RULES} `; no other
  // text changes. Only `continue` and `rewrite` are shown in full below as
  // exemplars of the transformation.
  continue:    `${PROSE_OUTPUT_RULES} continue the story from where the selection ends, matching the established voice. Aim for roughly 80–150 words.`,
  rewrite:     `${PROSE_OUTPUT_RULES} rewrite the selection with different phrasing while preserving meaning and voice. Return a single alternative version.`,
  expand:      `${PROSE_OUTPUT_RULES} ...existing body...`,
  summarise:   `${PROSE_OUTPUT_RULES} ...existing body...`,
  describe:    `${PROSE_OUTPUT_RULES} ...existing body...`,
  scene:       `${PROSE_OUTPUT_RULES} ...existing body...`,
  ask:         `${PROSE_OUTPUT_RULES} ...existing body...`,
  summariseChapter:  // unchanged — already self-contained for JSON output
    'You produce structured per-chapter summaries for a long-form fiction project. ' +
    'Read the chapter and emit a JSON object matching the provided schema exactly. ' +
    'Be terse and concrete; the consumer is another LLM that will use your output as context when writing the next chapter.',
};
```

**Placement in the assembled prompt:** unchanged. `buildPrompt()` joins `systemContent` + `taskBlock` (which becomes the per-action template) into a single `system` message, so the prose rules naturally end up at the end of the system content — the strongest recency position.

**Summarise route gains the system prompt** by assembling the two-message prompt directly (it doesn't go through `buildPrompt`):

```ts
const systemMessage =
  `${resolvePrompt(userPrompts, 'system')}\n\n${resolvePrompt(userPrompts, 'summariseChapter')}`;
// messages: [{role: 'system', content: systemMessage}, {role: 'user', content: plaintext}]
```

Persona reaches summarise. JSON-output rule (in `summariseChapter`) still governs the output shape. No conflict.

**User override preservation.** `resolvePrompt(userPrompts, key)` returns `userPrompts?.[key] ?? DEFAULT_PROMPTS[key]`. A user override replaces the entire default verbatim — there's no merge path, no template inheritance. If a user overrides `continue`, they lose `PROSE_OUTPUT_RULES` unless they copy them in. Same semantic as today (overriding currently loses "matching the established voice. Aim for 80–150 words." too) — the restructure just bundles one more clause into the same replaceable unit.

**Frontend impact:** zero code change. The Settings tab reads `DEFAULT_PROMPTS` via `GET /api/ai/default-prompts`; the new shapes appear as the displayed defaults automatically.

**Tests touched:** `backend/tests/services/prompt.service.test.ts` snapshots of assembled system messages need fixture updates (mechanical — same logic, different default strings). The new summarise route test (Section 3) asserts the captured request body includes the persona substring in `messages[0].content`.

## Section 2 — Shared helpers

New file `backend/src/services/venice-call.service.ts` — one home for "everything you need around a Venice completion call except the call itself." Five exports.

```ts
// ── 1. hydrate user settings ──────────────────────────────────────────────

export interface HydratedUserSettings {
  raw: unknown;                          // opaque JSON for callers that need it
  settings: UserSettings;                // safely coerced for resolveTextGenParams
  includeVeniceSystemPrompt: boolean;
  userPrompts: PromptsSettings;
}

export async function hydrateUserSettings(userId: string): Promise<HydratedUserSettings>;
// Loads user.settingsJson via prisma.user.findUnique({ where: { id: userId },
// select: { settingsJson: true } }), coerces partial → full UserSettings shape
// (defensive: empty chat.overrides, null chat.model), and pre-runs the two
// existing resolvers. Replaces the ~12 inline lines each of ai/chat carry today.


// ── 2. assemble venice_parameters ─────────────────────────────────────────

export interface BuildVeniceParamsInput {
  base: Record<string, unknown>;         // typically prompt.venice_parameters from buildPrompt
  supportsReasoning: boolean;
  enableWebSearch?: boolean;             // ai-complete + chat
  enableChatStreamHints?: boolean;       // chat only — adds include_search_results_in_stream
  includeVeniceSystemPrompt?: boolean;   // summarise (bypasses buildPrompt — caller must pass)
}

export function buildVeniceParams(input: BuildVeniceParamsInput): Record<string, unknown>;
// Spreads `base` first, then conditionally adds strip_thinking_response
// (reasoning), enable_web_search + enable_web_citations (web search),
// include_search_results_in_stream (chat stream hint), and
// include_venice_system_prompt (for summarise, which doesn't go through buildPrompt).
//
// Precedence: spread `base` first; any explicit input arg (`includeVeniceSystemPrompt`,
// the conditional booleans) writes after the spread and wins. For ai/chat, `base`
// already contains include_venice_system_prompt (set by buildPrompt) and they don't
// pass the explicit arg, so the base value sticks. For summarise, base is `{}` and
// the explicit arg writes it. Same input → same output across both call patterns.


// ── 3. resolve text-gen params with a sane modelInfo-null fallback ────────

export function resolveTextGenWithFallback(
  settings: UserSettings,
  modelInfo: ModelInfo | undefined,
  fallbackMaxCompletionTokens: number,
): ResolvedTextGenParams;
// Thin wrapper over the existing resolveTextGenParams: when modelInfo is null
// (model not in Venice's listed catalog yet), returns
// { temperature: undefined, top_p: undefined,
//   max_completion_tokens: fallback, source: 'global-default' (×3) }.
// Replaces the ~16-line inline ternary in ai/chat today.


// ── 4. structured dev log of resolved params ─────────────────────────────

export interface LogVeniceParamsInput {
  route: 'ai-complete' | 'chat' | 'chapter-summarise';
  userId: string;
  modelId: string;
  resolved: ResolvedTextGenParams;
  action?: string;                       // ai = body.action; chat = 'ask'|'scene'; summarise = 'summariseChapter'
  modelCap: number | undefined;          // modelMaxCompletionTokens from veniceModelsService
  enableWebSearch?: unknown;             // venice_parameters.enable_web_search ('auto' | undefined)
}

export function logVeniceParams(input: LogVeniceParamsInput): void;
// Emits [venice.params] as a single console.log when NODE_ENV !== 'production'.
// Identical schema across routes — no more per-route copy.


// ── 5. cache-key builder ─────────────────────────────────────────────────

export function promptCacheKey(...parts: string[]): string;
// sha256(parts.join(':')).slice(0, 32). Unifies ai-complete's promptCacheKey
// (storyId, modelId), chat's chatPromptCacheKey (chatId, modelId), and
// summarise's new one (chapterId, modelId).
```

**What stays in the route:** the Venice client construction (`getVeniceClient(userId)` — already a one-liner), the actual `.create({...})` call (where streaming / non-streaming / structured legitimately diverges), `.withResponse()` + rate-limit header forwarding (ai + chat only), the SSE writing loop (ai + chat only), `mapVeniceError` catch sites (already a helper), and route-specific data fetching (story/chapter/character/history repos).

**Why five helpers and not one envelope:** a single `prepareVeniceCompletion()` that returns `{client, completionArgs}` ends up needing conditional flags (`stream?`, `responseSchema?`, `withResponse?`, `streamHints?`) to fork inside. Conditional surface inside the helper is worse than four ordered calls outside it. The envelope alternative was considered and rejected in brainstorm.

**Test surface:** new `backend/tests/services/venice-call.service.test.ts`:
- `hydrateUserSettings` — null `settingsJson`, malformed settings, full-shape settings.
- `buildVeniceParams` — every combination of the four flags (16 cases trim to ~6 meaningful ones); ai/chat preserve `include_venice_system_prompt` from `base`; summarise sets it explicitly.
- `resolveTextGenWithFallback` — `modelInfo` null vs present (delegates to existing `resolveTextGenParams` for present case).
- `logVeniceParams` — captures `console.log` in test, asserts JSON shape; suppressed in `NODE_ENV=production`.
- `promptCacheKey` — determinism, length (32 hex chars), same-prefix-different-suffix uniqueness.

## Section 3 — Per-route refactor

Every prose call site does the same nine steps in order. The route writes its own `.create()` call literal in step 9; the rest comes from helpers.

1. `hydrateUserSettings(userId)` — DB hit + resolvers.
2. Model catalog primes + per-model lookups (`fetchModels` + `findModel` + `getModelContextLength` + `getModelMaxCompletionTokens`).
3. Route-specific data fetches (story, chapter, characters, message history, previousChapters, etc.).
4. Build prompt — via `buildPrompt(...)` for prose; hand-assembled for summarise.
5. `buildVeniceParams({...})`.
6. `resolveTextGenWithFallback(...)`.
7. `logVeniceParams({...})`.
8. `getVeniceClient(userId)`.
9. `client.chat.completions.create({...})` — route's bespoke shape (stream / non-stream / structured / `stream_options.include_usage`).
10. Error handling: `logVeniceErrorDev` → `mapVeniceError` (or `mapVeniceErrorToSse` mid-stream).

### ai.routes.ts — POST /api/ai/complete

Streaming, prose. The full ~80 LOC pre-call block collapses to:

```ts
const { settings, includeVeniceSystemPrompt, userPrompts } = await hydrateUserSettings(userId);

await veniceModelsService.fetchModels(userId);
const modelContextLength = veniceModelsService.getModelContextLength(body.modelId, userId);
const modelMaxCompletionTokens = veniceModelsService.getModelMaxCompletionTokens(body.modelId, userId);
const modelInfo = veniceModelsService.findModel(body.modelId, userId);

// ...story/chapter/characters/previousChapters loads via repos (unchanged)...

const { messages, venice_parameters: baseVeniceParams, max_completion_tokens } = buildPrompt({
  action: body.action, selectedText: body.selectedText, chapterContent, characters,
  worldNotes, previousChapters, modelContextLength, modelMaxCompletionTokens,
  userMaxCompletionTokens: Number.POSITIVE_INFINITY,
  includeVeniceSystemPrompt, userPrompts,
});

const venice_parameters = buildVeniceParams({
  base: baseVeniceParams,
  supportsReasoning: modelInfo?.supportsReasoning === true,
  enableWebSearch: body.enableWebSearch === true,
});

const resolved = resolveTextGenWithFallback(settings, modelInfo, max_completion_tokens);

logVeniceParams({
  route: 'ai-complete', userId, modelId: body.modelId, resolved,
  action: body.action, modelCap: modelMaxCompletionTokens,
  enableWebSearch: venice_parameters.enable_web_search,
});

const client = await getVeniceClient(userId);
// ...client.chat.completions.create({...}).withResponse() + SSE loop unchanged...
```

No behavior change — helpers produce identical request bodies. Existing integration tests pass without modification.

### chat.routes.ts — POST /api/chats/:id/messages

Same shape as ai-complete, with:
- `enableChatStreamHints: true` passed to `buildVeniceParams` (adds `include_search_results_in_stream`).
- Cache key `promptCacheKey(chatId, body.modelId)`.
- `stream_options: { include_usage: true }` stays literal in the route's `create()` call — chat persists token counts to `Message.tokens`, the other two routes don't.
- `action` in the log is `'ask' | 'scene'` (resolved per `chat.kind`).
- History assembly + retry logic stay in the route — chat-domain concerns, not orchestration.

### chapters.routes.ts — POST /api/stories/:storyId/chapters/:chapterId/summarise

Non-streaming, structured. Summarise bypasses `buildPrompt` (no world-notes / characters / previous-chapters scaffolding — just persona + task + content):

```ts
const { settings, includeVeniceSystemPrompt, userPrompts } = await hydrateUserSettings(userId);

try { await veniceModelsService.fetchModels(userId); }
catch (err) { if (mapVeniceError(err, res, { userId, route: 'chapter-summarise' })) return; throw err; }

const modelInfo = veniceModelsService.findModel(body.modelId, userId);
if (!modelInfo || modelInfo.supportsResponseSchema === false) {
  res.status(400).json({ error: { message: "...", code: 'model_unsupported_for_summarisation' } });
  return;
}

// Persona + summariseChapter task in one system message.
const systemMessage =
  `${resolvePrompt(userPrompts, 'system')}\n\n${resolvePrompt(userPrompts, 'summariseChapter')}`;

const venice_parameters = buildVeniceParams({
  base: {},
  supportsReasoning: modelInfo.supportsReasoning === true,
  includeVeniceSystemPrompt,            // summarise sets explicitly (no buildPrompt to default it)
});

// modelInfo is non-null here (gated above with the 400 response when missing),
// so the fallback path inside resolveTextGenWithFallback never fires for summarise.
// Passing model cap as the fallback is defensive symmetry — if the gate ever moves
// or a future caller passes a maybe-null modelInfo, the cap is the safest value.
const resolved = resolveTextGenWithFallback(
  settings, modelInfo,
  modelInfo.maxCompletionTokens,
);

logVeniceParams({
  route: 'chapter-summarise', userId, modelId: body.modelId, resolved,
  action: 'summariseChapter', modelCap: modelInfo.maxCompletionTokens,
});

const client = await getVeniceClient(userId);

try {
  const completion = await client.chat.completions.create({
    model: body.modelId,
    messages: [
      { role: 'system', content: systemMessage },
      { role: 'user', content: plaintext },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'ChapterSummary', schema: chapterSummaryJsonSchema(), strict: true },
    },
    temperature: resolved.temperature,
    top_p: resolved.top_p,
    max_completion_tokens: resolved.max_completion_tokens,
    prompt_cache_key: promptCacheKey(chapterId, body.modelId),
    venice_parameters,
  } as unknown as Parameters<typeof client.chat.completions.create>[0]);
  // ...parse + repo.update + respond unchanged (parse-failure branch in Section 5)...
} catch (err) {
  logVeniceErrorDev({ err, ctx: { route: 'chapter-summarise', userId }, request: snapshot });
  if (mapVeniceError(err, res, { userId, route: 'chapter-summarise' })) return;
  throw err;
}
```

## Section 4 — Summarise route gains

Explicit list of new behaviours that land in Section 3's summarise rewrite. Closes `story-editor-lxo`.

| Behavior | Source | Notes |
|---|---|---|
| `temperature` / `top_p` / `max_completion_tokens` | `resolveTextGenWithFallback` | Chain: user per-model override → Venice model default → global default. Same chain ai/chat use. |
| `include_venice_system_prompt` | `buildVeniceParams` (explicit) | User toggle in Settings reaches summarise. |
| `strip_thinking_response` (reasoning models) | `buildVeniceParams` (auto from `supportsReasoning`) | Critical for json_schema strict mode — reasoning tokens leaking into output could break the parse. |
| Persona system prompt | `resolvePrompt(userPrompts, 'system')` prefixed to `summariseChapter` | Section 1 restructure makes this consistent. |
| `prompt_cache_key` | `promptCacheKey(chapterId, body.modelId)` | Practical hit rate is low (chapter body changes between re-summarises invalidate the cached prefix); cost is one sha256, present for symmetry + future cache-window expansion. |
| `[venice.params]` log | `logVeniceParams` | Dev-only structured log; route now visible alongside ai-complete and chat. |
| Persona in test assertions | new test | `backend/tests/routes/chapters.summarise.test.ts` asserts the captured request body's `messages[0].content` includes the persona substring. |
| Full dev log on Venice error | `logVeniceErrorDev` | Section 5 — includes upstream body + headers + stack, scrubbed. |
| Full dev log on parse failure | `logVeniceErrorDev` w/ `rawContent` | Section 5 — currently logs nothing. |

## Section 5 — Dev error logging

New helper `logVeniceErrorDev` in `backend/src/lib/venice-errors.ts`, next to `mapVeniceError` + `mapVeniceErrorToSse`. Dev-only (early return on `NODE_ENV === 'production'`).

```ts
export interface VeniceRequestSnapshot {
  model: string;
  messageCount: number;
  systemMessagePreview?: string;       // first 200 chars, scrubbed
  userMessagePreview?: string;         // first 200 chars, scrubbed
  venice_parameters?: Record<string, unknown>;
  response_format?: unknown;
  promptCacheKey?: string;             // already a sha256 prefix — fine to log
  temperature?: number;
  top_p?: number;
  max_completion_tokens?: number;
}

export interface LogVeniceErrorDevInput {
  err: unknown;
  ctx: VeniceErrorContext;             // existing { userId, route } type
  request?: VeniceRequestSnapshot;     // omitted on pre-request failures
  rawContent?: string;                 // for parse-failure branches
}

export function logVeniceErrorDev(input: LogVeniceErrorDevInput): void;
```

Emits one `console.error('[venice.error.dev]', payload)` line per error with:

```ts
{
  route, userId,
  errorClass: 'APIError',              // err.constructor.name
  errorName: 'BadRequestError',        // err.name (SDK subclass)
  errorMessage: '...',
  upstreamStatus: 400,                 // when APIError
  upstreamHeaders: {                   // selected — only diagnosis-useful
    'x-request-id': '...',
    'x-ratelimit-remaining-requests': '...',
    'x-ratelimit-reset-requests': '...',
    'retry-after': '...',
  },
  upstreamBody: { /* raw err.error parsed body, scrubbed */ },
  stack: '...',
  request: { /* the VeniceRequestSnapshot, scrubbed */ },
  rawContent: '...',                   // present only on parse-failure branches
}
```

Recursive scrubber applies the existing `SK_KEY_RE` regex to every string leaf:

```ts
function scrubKeys(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(SK_KEY_RE, '[redacted]');
  if (Array.isArray(value)) return value.map(scrubKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubKeys(v)]));
  }
  return value;
}
```

**Call sites per route:**

- ai.routes.ts + chat.routes.ts pre-stream `create()` catch: `logVeniceErrorDev` before `mapVeniceError`.
- ai.routes.ts + chat.routes.ts mid-stream catch: `logVeniceErrorDev` before `mapVeniceErrorToSse`.
- chapters.routes.ts summarise `create()` catch: `logVeniceErrorDev` before `mapVeniceError`.
- **New** — chapters.routes.ts summarise parse-failure catch (`JSON.parse` or Zod `.parse` throws): `logVeniceErrorDev` with `rawContent: content` populated so the rejected string is visible. Currently logs nothing.

**Prod behavior unchanged.** `logVeniceErrorDev` early-returns in prod. The curated `[venice.error]` one-liner from `mapVeniceError` remains the prod log. Two lines per error in dev (`[venice.error]` curated + `[venice.error.dev]` raw); one line per error in prod.

**Response bodies unchanged.** `mapVeniceError`'s curated `{ error: { code, message, retryAfterSeconds?, details?: { veniceMessage } } }` is what users still see. The dev log is server-side only.

**Absolute logging rules from CLAUDE.md hold:** no plaintext Venice keys (scrubbed via `SK_KEY_RE`); no passwords / recovery codes / DEKs / `APP_ENCRYPTION_KEY` (none of these are in the Venice exchange to begin with). Sentinel coverage in the `[E12]` leak test is unaffected — logs are stdout-only, not disk.

**Test surface:** new `backend/tests/lib/venice-errors.dev-log.test.ts`:
- Returns early when `NODE_ENV === 'production'` (`vi.stubEnv` → spy on `console.error` sees nothing).
- Scrubs `sk-foo123abc456def789` in upstream body, headers, and request snapshot.
- Includes `rawContent` only when supplied.
- Handles non-`APIError` throws (`TypeError`, `SyntaxError`) — logs class + name + message + stack without upstream-* fields.
- Selected upstream headers present; unselected ones (cookies, etc.) absent.

## Section 6 — Sequencing & bd plan

### Branch + PR shape

- Branch `feature/venice-completion-orchestration` (already on it).
- **One PR**, five logically-ordered commits. Each commit independently mergeable — if later commits get descoped, earlier ones still ship clean. Matches the F-series bundling preference.
- PR opens after the third commit lands (additive infrastructure visible first), draft until summarise behavior is in.

### Task order

Order is "additive infrastructure first, behavior change last" — rollback target is obvious, each step's test surface stays small.

| # | Title | Scope | Depends on | Verify |
|---|---|---|---|---|
| 1 | Helpers + dev error logging | New `venice-call.service.ts` with five helpers + tests; `logVeniceErrorDev` in `venice-errors.ts` + tests. No route changes. | — | `cd backend && npm run typecheck && npm test -- tests/services/venice-call.service.test.ts tests/lib/venice-errors.dev-log.test.ts` |
| 2 | System-prompt restructure | Split `DEFAULT_SYSTEM_PROMPT`; add `PROSE_OUTPUT_RULES`; prefix prose `DEFAULT_PROMPTS` entries; update prompt-service fixture snapshots. No route changes. | — | `cd backend && npm run typecheck && npm test -- tests/services/prompt.service.test.ts` |
| 3 | ai-complete refactor | Wire helpers into `ai.routes.ts`; adopt `logVeniceErrorDev` in catch sites. No behavior change. | 1 | `cd backend && npm run typecheck && npm test -- tests/ai/complete.test.ts` |
| 4 | chat refactor | Wire helpers into `chat.routes.ts`; `enableChatStreamHints: true`; `stream_options.include_usage` and prompt_cache_key stay literal in route. | 1 | `cd backend && npm run typecheck && npm test -- tests/chat/` |
| 5 | summarise behavior + helper wiring | Wire helpers + `userPrompts.system` + structured-output path. New test for captured request body shape. **Closes `story-editor-lxo`.** | 1, 2 | `cd backend && npm run typecheck && npm test -- tests/routes/chapters.summarise.test.ts` |

### bd issue plan

Following the plan-less-coordinator-parent convention:

- **File new umbrella** `story-editor-<id>`: "Venice completion call-site consolidation". Plan-less per the brainstorming-split convention (the umbrella has no `plan:` line in `--notes`). The umbrella's **description** points at this spec file: "Spec: `docs/superpowers/specs/2026-05-25-venice-completion-orchestration-design.md`. Auto-closes when every child closes."
- **File 4 new child issues** for steps 1, 2, 3, 4. Each child's `--notes` carries:
  - `plan: docs/superpowers/specs/2026-05-25-venice-completion-orchestration-design.md` (the spec file is the plan; the section anchor is mentioned in the child's description for navigation, e.g. "See spec §Section 3 — ai-complete refactor").
  - `verify: <one-line from the task table above>`.
  - Then `bd dep add <child> <umbrella>` so they appear under the umbrella in `bd show`.
- **Update `story-editor-lxo`** to be step 5:
  - Replace its `plan: trivial` notes line with `plan: docs/superpowers/specs/2026-05-25-venice-completion-orchestration-design.md` (same spec; description points to §Section 4 — Summarise route gains for the precise scope).
  - Rewrite description scope: "Implement step 5 of the venice-completion-orchestration spec. Depends on steps 1 + 2 landing first."
  - `bd dep add story-editor-lxo <step-1-child>` and `bd dep add story-editor-lxo <step-2-child>`.
  - `bd dep add story-editor-lxo <umbrella>`.

Net result: `bd ready` surfaces steps 1 + 2 first (no deps), then 3 + 4 (depend on 1), then `lxo` (depends on 1 + 2). The umbrella stays open until all five close, then auto-closes per the brainstorming-split convention.

### Execution loop

For each `bd ready` child, run `/bd-execute <id>`. The spec is the shared reference; each child's plan link points to the relevant section. Implementer + spec-reviewer + code-quality-reviewer per task; `/bd-close-reviewed` gates on the per-task verify line + path-matched surface reviewers.

Step 5 specifically — `/bd-close-reviewed` will fan to `security-reviewer` (the close-gate script matches the `routes/chapters.routes.ts` path because it touches a Venice-call route with user keys). Appropriate; the existing summarise route was already cleared so the diff is small.

## Section 7 — Risks

- **`buildVeniceParams` summarise contract** — summarise needs `includeVeniceSystemPrompt` because it bypasses `buildPrompt`. Made it an optional input. For ai/chat, `base` (from `buildPrompt`) already contains the flag and is preserved by the spread; the helper doesn't re-set it from a separate param. Behavior for ai/chat is unchanged; summarise gets the new path. Could go either way — `optional` keeps the call sites symmetrical at the cost of one implicit-vs-explicit divergence in the helper's contract.
- **Practical cache hit on summarise** — chapter body changes between re-summarises invalidate the cached prefix. `prompt_cache_key` is present for symmetry + future use; near-zero practical hit rate today. Not a goal; flagging so it doesn't look like an oversight.
- **Test fixture sweep on refactor commits** — ai/chat integration tests capture request body shapes. Helpers produce identical output to inline code; if a test asserts on field ordering rather than presence, it'll fail mechanically. Easy fix; flagging as known-likely small sweep.
- **Log volume in dev** — `logVeniceErrorDev` doubles per-error output (curated `[venice.error]` + raw `[venice.error.dev]`). Acceptable for dev; prod unchanged.
- **Request snapshot duplication across routes** — each route assembles its own `VeniceRequestSnapshot`. Could extract a `buildVeniceRequestSnapshot(...)` helper if the construction repeats verbatim, but the three routes have slightly different available data (chat has chatId, summarise has chapterId). Small per-route literal is probably less leaky than a wide helper. Flagging as a possible follow-up if the snapshots end up identical in practice.

## Section 8 — Out-of-scope follow-ups

File these as separate bd issues if/when wanted; none block this work.

- **Token persistence on summarise** — non-streaming response already carries `usage`; could be persisted to a future `ChapterSummary.tokens` column. Cost-tracking feature.
- **Settings tab UX hint that overriding loses defaults** — small frontend affordance per Section 1's user-override note. "Reset to default" button per field.
- **X4 / next AI surface adoption** — when it lands, it composes the five helpers from day one. The spec serves as its template; no work to do until X4 is scoped.
- **`buildVeniceRequestSnapshot` helper** — only if the per-route snapshot literals end up identical in practice; not designing for it speculatively.
