# X29 — Settings → Prompts tab — Design

**Date:** 2026-05-04
**Branch:** `feature/x29-prompts-tab` (cut from `origin/main`)
**Status:** Spec — pending review before plan

---

## Problem

`SettingsModelsTab.tsx` renders a "System prompt" section that only appears when an `activeStoryId` is set, and writes to the per-story `Story.systemPrompt` column. From the Settings tab there is no "active story" concept (Settings is reachable independently of the editor view), so the field is most often gated behind the empty-state copy "Pick a story to set a custom system prompt." The UI is dead in the common case.

Beyond the system prompt, the action templates that drive Continue, Rewrite/Rephrase, Expand, Summarise, and Describe are hardcoded in `prompt.service.ts:84` (`buildTaskBlock`). Users cannot tune these to match their voice, genre, or workflow even though the system prompt is — in principle — overridable.

The per-story `Story.systemPrompt` exists as columns and a code path but has no live UI surface for editing it (the dead Models-tab section was the only one). The encryption + repo machinery for those columns earns no value today.

## Goal

A new **Prompts** tab (Settings, immediately to the right of Models) lets the user override any of the six system-/action prompts at the user level. Each prompt shows its built-in default read-only by default; ticking "Override default" enables an editable field seeded with the default. Unticking reverts to the default.

The per-story `Story.systemPrompt` is removed entirely (column, repo paths, route reads, prompt-builder field, frontend type).

## Non-Goals

- A `{selection}` placeholder convention. Action templates auto-append `\n\nSelection: «...»` after the user's instruction text exactly as the built-in templates do today. (Open option for a future revisit if anyone asks.)
- Per-story prompt overrides. Dropped, not relocated.
- Per-character or per-chapter prompt overrides.
- Overriding `freeform` or `ask` actions — they have no template (the user-typed instruction *is* the prompt).
- A separate Rewrite vs. Rephrase override. Both action names route to a single `rewrite` user override (the in-builder strings stay distinct so each surface's wording is preserved).
- Schema changes beyond the `Story.systemPrompt` column drop. The `settingsJson` blob holds the new `prompts` slice — no new columns.
- A general "preset" / "import / export" mechanic for prompts. YAGNI.

## Approach

### Resolution chain

System content (`prompt.service.ts:130`) becomes:
```
userPrompts.system?.trim() || DEFAULT_SYSTEM_PROMPT
```
(`Story.systemPrompt` is gone — see "Removal scope" below.)

Action templates (`prompt.service.ts:84` `buildTaskBlock`) become:
```
(userPrompts[action]?.trim() || BUILT_IN_TEMPLATE[action]) + sel
```
where `sel` is the auto-appended `\n\nSelection: «...»` exactly as today, kept inside the builder, never inside user text.

`freeform` and `ask` keep their current pure-pass-through behaviour. They are not user-overridable.

### Storage shape

A new slice on `settingsJson`:

```ts
prompts: {
  system: string | null;     // null = use DEFAULT_SYSTEM_PROMPT
  continue: string | null;   // null = use built-in continue template
  rewrite: string | null;    // covers both 'rephrase' and 'rewrite' actions
  expand: string | null;
  summarise: string | null;
  describe: string | null;
}
```

Default for the entire slice is all `null`. The deep-merge in `backend/src/lib/deep-merge.ts` handles partial PATCHes against this shape transparently — it already merges any new top-level slice without code changes.

### Default-prompts endpoint

The frontend renders the built-in defaults read-only when override is off. Defaults live as exported constants on the backend:

```ts
// prompt.service.ts
export const DEFAULT_PROMPTS = {
  system: DEFAULT_SYSTEM_PROMPT,
  continue: 'Task: continue the story from where the selection ends, matching the established voice. Aim for roughly 80–150 words.',
  rewrite:  'Task: rewrite the selection with different phrasing while preserving meaning and voice. Return a single alternative version.',
  expand:   'Task: expand the selection with more detail, description, and depth. Keep the same POV, tense, and voice.',
  summarise:'Task: summarise the selection to its essential points. Use 1–3 sentences.',
  describe: 'Task: describe the subject of the selection with vivid sensory, physical, and emotional detail. Maintain the story\'s POV and tense.',
} as const;
```

These are exposed via `GET /api/ai/default-prompts` returning `{ defaults: DEFAULT_PROMPTS }`. Cached in TanStack Query with `staleTime: Infinity` (constants change only with deploys; a hard refresh re-fetches). Single source of truth for both frontend display and backend resolution.

The `buildTaskBlock` switch keeps reading from `DEFAULT_PROMPTS` so there's no string duplication.

### Routes / wiring

`ai.routes.ts:195` and `chat.routes.ts:276` currently extract `storySystemPrompt` from `story.systemPrompt`. After the removal:

```ts
const userPrompts = req.user.settingsJson?.prompts ?? {};
// ... pass to buildPrompt as { userPrompts }
```

The `req.user.settingsJson` augmentation already happens in the auth middleware (`/api/users/me/settings` reads from this same source). No new middleware needed.

`buildPrompt`'s signature gains `userPrompts?: Partial<typeof DEFAULT_PROMPTS>` and drops `storySystemPrompt`. The internal switch reads `userPrompts[action]?.trim() || DEFAULT_PROMPTS[action]` per case.

### Frontend — new `SettingsPromptsTab.tsx`

Tab order in `Settings.tsx`: Appearance · Writing · Models · **Prompts** · Account.

Component layout (flat list, top-to-bottom in resolution order):

```
┌─ System prompt ────────────────────────────────────┐
│ (default text rendered muted, read-only)           │
│ [textarea, min-h-[120px], serif]                   │
│ ☐ Override default                                 │
└────────────────────────────────────────────────────┘

┌─ Continue ─────────────────────────────────────────┐
│ (default text)                                     │
│ [single-line input]                                │
│ ☐ Override default                                 │
└────────────────────────────────────────────────────┘

(Rewrite, Expand, Summarise, Describe — same shape)
```

State per row (one component, parameterised):

- Read default from `useDefaultPromptsQuery()` (`/api/ai/default-prompts`, `staleTime: Infinity`).
- Read override value from `useUserSettings().prompts[key]`.
- `checked = override !== null`.
- When unchecked: render the default in a read-only `<input>` / `<textarea>` styled muted (`text-ink-4`, `bg-bg-2`, `cursor-default`).
- On check (transition `false → true`): PATCH `prompts.{key}` with the current default text (so the field is immediately editable, populated, and round-trips).
- When checked: render an editable field seeded with the override value. Onblur PATCHes if the trimmed value changed (mirrors existing tab patterns).
- On uncheck (transition `true → false`): PATCH `prompts.{key}: null`.
- "Reset" link inside the editable state: equivalent to unchecking.

The Venice "Include default system prompt" toggle stays on the Models tab (per-X26). It's a Venice/model-API setting; future model-side toggles will land there.

### Removal scope — `Story.systemPrompt`

Single migration drops three columns: `systemPromptCiphertext`, `systemPromptIv`, `systemPromptAuthTag`. Per project rule, no backfill — pre-deployment, no rows to preserve.

Files / surfaces touched:

- `backend/prisma/schema.prisma` — drop the 3 columns + the comment block listing `systemPrompt` among encrypted fields (~`schema.prisma:65, 77–79`).
- `backend/src/repos/story.repo.ts` — drop encrypt-on-write and decrypt-on-read for `systemPrompt`. Drop from the `Story` shape returned to callers.
- `backend/src/routes/ai.routes.ts:195`, `backend/src/routes/chat.routes.ts:276` — drop the `storySystemPrompt` extraction.
- `backend/src/services/prompt.service.ts` — drop `storySystemPrompt` from `BuildPromptInput`, drop the resolution branch (`prompt.service.ts:130–133`), add `userPrompts`.
- `backend/src/routes/stories.routes.ts` (if it accepts `systemPrompt` in PATCH) — drop the field from the Zod schema.
- `frontend/src/hooks/useStories.ts` — drop `systemPrompt` from `Story` types and any `UpdateStoryInput`.
- `frontend/src/components/SettingsModelsTab.tsx:244–278` — delete the entire system-prompt section, the `useStoryQuery` import, the `useUpdateStoryMutation` import, the `lastSeededRef`, the `promptDraft` state, and `handlePromptBlur`.
- `docs/api-contract.md` — Story shape (drop `systemPrompt`) + the `/api/ai/complete` request shape if `storySystemPrompt` was ever documented there (it isn't a request field today; just the internal resolution).
- `docs/encryption.md` — drop `Story.systemPrompt` from the encrypted-fields table.
- Tests:
  - `backend/tests/services/prompt.service.test.ts` — replace `storySystemPrompt`-override cases with `userPrompts.system`-override cases. Add per-action override + null-fallback cases.
  - `backend/tests/repos/story.repo.test.ts` — drop `systemPrompt` round-trip.
  - `backend/tests/routes/stories.test.ts` — drop any PATCH-with-systemPrompt assertion.
  - `frontend/tests/components/SettingsModelsTab.*.test.tsx` — drop the per-story-prompt scenarios.

V13 (the original per-story override task) was archived. No edits to `docs/done/done-V.md` (immutable per CLAUDE.md). The deprecation is recorded in this design doc and in the X29 task line.

## Architecture

### Module map

```
frontend/src/components/SettingsPromptsTab.tsx        (new)
frontend/src/components/SettingsPromptsTab.stories.tsx (new)
frontend/src/hooks/useDefaultPrompts.ts                (new)
frontend/src/hooks/useUserSettings.ts                  (extend DEFAULT_SETTINGS + UserSettings + mergeSettings + UserSettingsPatch)
frontend/src/components/Settings.tsx                   (add tab + content slot)
frontend/src/components/SettingsModelsTab.tsx          (delete system-prompt section + per-story plumbing)

backend/src/routes/ai.routes.ts                        (drop storySystemPrompt; pass userPrompts)
backend/src/routes/chat.routes.ts                      (drop storySystemPrompt; pass userPrompts)
backend/src/routes/user-settings.routes.ts             (extend Zod schema with prompts slice; defaults)
backend/src/routes/ai-defaults.routes.ts               (new — GET /api/ai/default-prompts)
backend/src/services/prompt.service.ts                 (export DEFAULT_PROMPTS; refactor buildTaskBlock; new userPrompts param; drop storySystemPrompt)
backend/src/repos/story.repo.ts                        (drop systemPrompt encrypt/decrypt + from result shape)

backend/prisma/schema.prisma                           (drop 3 columns)
backend/prisma/migrations/<ts>_drop_story_system_prompt/migration.sql  (new)

docs/api-contract.md                                   (Story shape; new /api/ai/default-prompts endpoint)
docs/encryption.md                                     (drop systemPrompt from encrypted fields)
docs/venice-integration.md                             (note user-level overrides resolution chain; add a § Prompt resolution)
TASKS.md                                               (tick X29, update plan link)
```

### Data flow (write path)

```
User ticks "Override default" on Continue row
  → SettingsPromptsTab calls updateSetting.mutate({ prompts: { continue: <default text> } })
  → useUpdateUserSetting (existing) optimistically updates the TanStack cache + PATCHes
  → backend/user-settings.routes deep-merges into User.settingsJson and persists
  → checkbox now reflects checked; field becomes editable, populated with the default
```

```
User edits text and blurs
  → handleBlur: if trimmed value differs, updateSetting.mutate({ prompts: { continue: <newValue> } })
  → optimistic update + PATCH; field shows the new override
```

```
User unticks "Override default"
  → updateSetting.mutate({ prompts: { continue: null } })
  → optimistic update + PATCH; field reverts to muted read-only default
```

### Data flow (read path)

```
User triggers Continue (⌥+Enter)
  → frontend POSTs /api/ai/complete (action: 'continue', selection, …)
  → ai.routes reads req.user.settingsJson.prompts → passes userPrompts to buildPrompt
  → buildTaskBlock('continue') resolves: userPrompts.continue?.trim() || DEFAULT_PROMPTS.continue
  → returns task block + auto-appended Selection: «…»
  → builder assembles full prompt, returns to route, route streams Venice response
```

## Testing

- `backend/tests/services/prompt.service.test.ts`:
  - For each of `system`, `continue`, `rewrite`, `expand`, `summarise`, `describe`:
    - With `userPrompts.{key}` set → assembled prompt uses the override.
    - With `userPrompts.{key}` null/missing → assembled prompt uses the built-in default.
    - With `userPrompts.{key} = '   '` (whitespace-only) → falls back to default.
  - Selection auto-append still happens for overridden action templates (the `Selection: «...»` block appears after the user's text).
  - `freeform` and `ask` ignore `userPrompts` (no override path).
- `backend/tests/routes/user-settings.test.ts`:
  - Round-trip PATCH `{ prompts: { system: 'X' } }` → GET returns `prompts.system === 'X'`, others null.
  - Deep-merge: `PATCH { prompts: { system: 'X' } }` then `PATCH { prompts: { continue: 'Y' } }` → both retained.
  - PATCH `{ prompts: { system: null } }` clears the override.
- `backend/tests/routes/ai-defaults.test.ts` (new):
  - `GET /api/ai/default-prompts` returns `{ defaults: { system, continue, rewrite, expand, summarise, describe } }` with all fields non-empty strings.
  - Auth required.
- `frontend/tests/components/SettingsPromptsTab.test.tsx` (new):
  - Default state: all rows read-only, checkbox unchecked, default text from mocked `/default-prompts`.
  - Tick checkbox → field becomes editable, seeded with default; PATCH issued with default text.
  - Edit + blur → PATCH issued with new value.
  - Untick checkbox → PATCH `{ prompts: { <key>: null } }`; field reverts to read-only default.
  - "Reset" link inside edit state behaves identically to untick.
- `frontend/tests/components/SettingsModelsTab.test.tsx`:
  - Drop the per-story system-prompt scenarios.
  - Confirm no `useStoryQuery` / `useUpdateStoryMutation` references remain.
- Story-removal regression:
  - `backend/tests/repos/story.repo.test.ts` — drop `systemPrompt` round-trip case.
  - `backend/tests/routes/stories.test.ts` — drop PATCH-with-systemPrompt cases.

The encryption leak test (`[E12]`) re-runs unchanged; one fewer encrypted column means one fewer assertion target, but the test iterates the schema, so it self-adjusts.

## Migration

One Prisma migration:

```sql
ALTER TABLE "Story"
  DROP COLUMN "systemPromptCiphertext",
  DROP COLUMN "systemPromptIv",
  DROP COLUMN "systemPromptAuthTag";
```

No data backfill (per the project's pre-deployment rule). The `repo-boundary-reviewer` agent must clear the `story.repo.ts` change before the migration is committed (rule from CLAUDE.md: any change touching `backend/src/repos/**` plus a narrative-column migration is in-scope).

## Security review

`security-reviewer` is not strictly in-scope (no auth/session/key/crypto-primitive changes). However, `repo-boundary-reviewer` is required:

- `story.repo.ts` change (column removal from encrypt/decrypt path).
- Migration touching narrative columns.

Invoke after the implementation lands, before ticking X29.

## Risks / open items

- **Backwards compatibility for existing `Story.systemPrompt` rows.** Per CLAUDE.md "no data-migration branches" rule and the project's pre-deployment status, existing rows are dropped without backfill. No risk in practice; recorded for completeness.
- **Default-prompts cache invalidation.** Constants change only on deploy. `staleTime: Infinity` plus a hard refresh on user load is sufficient. No bust mechanism needed.
- **User overrides going stale vs. new defaults.** A future deploy could change `DEFAULT_PROMPTS.continue`; users with an override see their override (correct), users without see the new default (correct). No drift.
- **Whitespace-only overrides.** Treated as "no override" via `?.trim()`. The UI still shows the field as checked; on blur, an empty trim PATCHes `null` and unchecks. Tested.
- **Rewrite/Rephrase action consolidation.** Both surfaces (selection bubble = "rewrite", AI panel = "rephrase") now read from a single `userPrompts.rewrite`. Surface labels stay distinct; only the override key is shared. A user who overrides "Rewrite" sees the override apply to both surfaces. Documented in the tab UI: row label is "Rewrite / Rephrase" with sub-text "Used by both the selection bubble and the AI panel."

## Sequence

1. Backend: `DEFAULT_PROMPTS` export + `buildTaskBlock` refactor + `userPrompts` parameter on `BuildPromptInput`. Tests pass against the new signature.
2. Backend: `/api/ai/default-prompts` route + tests.
3. Backend: extend `user-settings.routes` Zod schema with `prompts` slice + defaults + tests.
4. Backend: route call sites (`ai.routes`, `chat.routes`) pass `userPrompts`; remove `storySystemPrompt` reads.
5. Backend: drop `systemPrompt` from `story.repo.ts` (encrypt + decrypt + result shape); update repo tests.
6. Backend: Prisma migration to drop the 3 `Story` columns; `prisma generate`; `npm run db:test:reset` + full backend test pass.
7. Frontend: `useDefaultPromptsQuery` hook + `useUserSettings` extension (`DEFAULT_SETTINGS.prompts`, mergeSettings).
8. Frontend: `SettingsPromptsTab.tsx` + Storybook story.
9. Frontend: wire tab into `Settings.tsx` (between Models and Account).
10. Frontend: delete the system-prompt section from `SettingsModelsTab.tsx`; drop unused imports / state / refs / handlers; update tests.
11. Frontend: drop `systemPrompt` from `useStories` types.
12. Docs: `docs/api-contract.md`, `docs/encryption.md`, `docs/venice-integration.md` updates.
13. Repo-boundary review on `story.repo.ts` + migration; address findings.
14. `TASKS.md`: tick `[X29]` with verify command.
15. PR.

## Verify command

```bash
cd backend && npm run test:backend -- --run \
  tests/services/prompt.service.test.ts \
  tests/routes/user-settings.test.ts \
  tests/routes/ai-defaults.test.ts \
  tests/repos/story.repo.test.ts \
  tests/routes/stories.test.ts \
&& cd ../frontend && npm run test:frontend -- --run \
  tests/components/SettingsPromptsTab.test.tsx \
  tests/components/SettingsModelsTab.test.tsx
```
