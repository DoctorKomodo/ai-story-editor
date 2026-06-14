# Shared Test Fixture Factories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ~21 per-file fixture factories for Character / Chapter / Model in the frontend test suite with three typed shared factory modules, so a future schema field add fails at one factory instead of N call sites.

**Architecture:** Add `frontend/tests/fixtures/{character,chapter,model}.ts`, each exporting a `make*` factory with an explicit return-type annotation (`: Character` / `: ChapterMeta` / `: Chapter` / `: Model`) and a `Partial<T>` override param. Migrate every duplicated per-file helper (and the two local-interface variants) to import the shared factory. Pure test refactor — no production code, no behavior change, identical test count.

**Tech Stack:** TypeScript (strict), Vitest 4 (jsdom, `globals: true`), `story-editor-shared` Zod-inferred types, frontend-local `Model` interface from `@/hooks/useModels`.

---

## Scope decisions (read before starting)

These were settled at plan-review and constrain the work:

1. **Out of scope — untyped wire fixtures (test rests on "N typed consumers").** This plan consolidates the *typed* per-file factories only. Two adjacent categories are deliberately excluded, and the exclusion rests on consumer count, not on an enumerated file list (so it stays correct under a reviewer who greps):

   - **Untyped wire-JSON fixtures** that feed `fetch` mocks at the zod `.parse()` boundary, typed `Record<string, unknown>` on purpose to exercise that boundary. The integration `makeCharacter`/`makeChapter` in `frontend/tests/pages/*.integration.test.tsx` are examples. **Do NOT migrate them** — typing them changes what the parse-boundary test proves.

   - **Story has nothing to consolidate.** There is exactly **one** typed Story fixture in the suite (`frontend/tests/hooks/useStories.test.tsx`). The other ~10 `makeStory` helpers (StoryBrowser, StoryPicker, dashboard, editor.test, the integration pages, etc.) are untyped parse-boundary wire-builders that must stay untyped. One typed consumer = nothing to DRY up. **No Story factory in this plan.** (Note: "no Story factory" ≠ "Story fixtures are DRY" — the ~10 untyped `makeStory` builders *could* be collapsed into a shared untyped `makeStoryWire()`, but that is a separate refactor with a different goal and the parse-boundary risk. Explicitly not this plan.)

   - **Untyped `modelsQueryKey` cache-seeds** are likewise excluded. Several tests seed the model cache with minimal partial literals via `qc.setQueryData(modelsQueryKey, …)` — e.g. `frontend/tests/components/SceneTab.test.tsx:69` (`[{ id: modelId, name: 'Scene Model' }]`) and `:865` (`[{ id: 'venice-scene-1', name: 'Scene Model', supportsWebSearch: true }]`). These are **not** typed `Model` fixtures: they are deliberate minimal seeds (`setQueryData` does not enforce `Model[]` at this key), and `makeModel` would inject `maxCompletionTokens`/`contextLength`/`supportsWebSearch` defaults the component may branch on. **Do NOT migrate them.** Only the three typed `Model` factories in Task 3 are in scope.

2. **Two chapter factories.** The shared type splits: `ChapterMeta` (list-endpoint shape, no body) vs `Chapter` (`ChapterMeta` + `bodyJson` + `summary` + `summaryUpdatedAt`). `chapter.ts` exports both `makeChapterMeta` and `makeChapter`; `makeChapter` is built on `makeChapterMeta` to stay DRY.

3. **Local-interface variants get migrated to the shared type.** `CharacterSheet.test.tsx` / `CharacterSheet.create.test.tsx` define a local `CharacterFixture` interface; `ChapterList.test.tsx` defines a local `ChapterFixture`. These have the same fields as the shared types. Migrate them to the shared `Character` / `ChapterMeta` type via the factory and delete the local interface. If migrating produces a genuine component-prop type error (the shared type is not assignable where the local interface was), STOP and report it as NEEDS_CONTEXT — do **not** cast or re-widen to silence it.

4. **Factory ergonomics: one `Partial<T>` override param.** Every shared factory is `make*(overrides: Partial<T> = {}): T` returning `{ ...defaults, ...overrides }`. Per-file helpers with positional params (`meta(id, orderIndex)`, `makeChar(id, name, role)`, `chr({id, orderIndex, name})`) are migrated to object-override call style at every call site (e.g. `meta('c1', 0)` → `makeChapterMeta({ id: 'c1', orderIndex: 0 })`).

**Branch:** `feature/test-fixture-factories` (already created off `main`). Commit prefix: `[story-editor-ote]`.

**Per-task verification command (run from repo root):**
```bash
npm --prefix frontend run typecheck && npm --prefix frontend run test
```
Expected after each task: typecheck exits 0; vitest reports all files passing with the **same total test count** as before the refactor (record the baseline count in Task 0).

---

## Task 0: Baseline

**Files:** none (measurement only).

- [ ] **Step 1: Record the green baseline**

Run from repo root:
```bash
npm --prefix frontend run typecheck && npm --prefix frontend run test 2>&1 | tail -20
```
Expected: typecheck exits 0; vitest prints a `Tests  N passed (N)` summary line. **Write down N** — every later task must reproduce exactly N passing tests. If the baseline is not green, STOP and report (the refactor needs a green starting point).

---

## Task 1: Character factory

**Files:**
- Create: `frontend/tests/fixtures/character.ts`
- Modify (delete local factory, import shared): `frontend/tests/components/CharacterPopover.test.tsx`, `frontend/tests/components/CharacterPopoverHost.test.tsx`, `frontend/tests/components/CharRefSuggestion.test.tsx`, `frontend/tests/components/CastTab.test.tsx`, `frontend/tests/components/CastTab.delete.test.tsx`, `frontend/tests/components/CastTab.dragA11y.test.tsx`, `frontend/tests/components/CharacterSheet.test.tsx`, `frontend/tests/components/CharacterSheet.create.test.tsx`, `frontend/tests/hooks/useCharacters.test.tsx`

- [ ] **Step 1: Create the shared Character factory**

Create `frontend/tests/fixtures/character.ts`:

```ts
import type { Character } from 'story-editor-shared';

/**
 * Typed Character fixture. The explicit `: Character` return annotation is
 * load-bearing: when characterSchema gains a required field, this single
 * factory fails to compile — not the dozens of call sites that consume it.
 * Override any field via the partial param.
 */
export function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: 'char-1',
    storyId: 'story-1',
    name: 'Elena',
    role: 'Protagonist',
    age: '32',
    appearance: 'Tall, with auburn hair',
    voice: 'Measured and warm',
    arc: 'From doubt to conviction',
    personality: 'Curious',
    backstory: null,
    relationships: null,
    color: null,
    initial: null,
    orderIndex: 0,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}
```

- [ ] **Step 2: Migrate `CharacterPopover.test.tsx`**

Delete the local `makeCharacter` (lines ~21-41). Add to the import block:
```ts
import { makeCharacter } from '../fixtures/character';
```
Call sites already use `makeCharacter(overrides)` — they need no change. Keep the existing `import type { Character } from 'story-editor-shared'` only if `Character` is still referenced elsewhere in the file; if it becomes unused, delete it (the suite has `noUnusedLocals`).

- [ ] **Step 3: Migrate `CharacterPopoverHost.test.tsx`**

Delete the local `makeCharacter` (lines ~14-34). Add `import { makeCharacter } from '../fixtures/character';`. Existing `makeCharacter(overrides)` call sites are unchanged. Drop the now-unused `import type { Character }` if nothing else uses it.

- [ ] **Step 4: Migrate `CharRefSuggestion.test.tsx`**

Delete the local `makeChar(id, name, role = null)` (lines ~27-46). Add `import { makeCharacter } from '../fixtures/character';`. Replace each `makeChar(id, name, role)` call with `makeCharacter({ id, name, role })` and each `makeChar(id, name)` with `makeCharacter({ id, name })`. Drop unused `Character` import if applicable.

- [ ] **Step 5: Migrate `CastTab.test.tsx`**

Delete the local `meta(id, orderIndex, name?)` (lines ~8-27). Add `import { makeCharacter } from '../fixtures/character';`. Replace `meta(id, orderIndex)` → `makeCharacter({ id, orderIndex })` and `meta(id, orderIndex, name)` → `makeCharacter({ id, orderIndex, name })`. Drop unused `Character` import if applicable.

- [ ] **Step 6: Migrate `CastTab.delete.test.tsx`**

Delete the local `chr({ id, orderIndex, name? })` (lines ~20-39). Add `import { makeCharacter } from '../fixtures/character';`. Replace `chr({ id, orderIndex, name })` → `makeCharacter({ id, orderIndex, name })` (the object shape is already override-compatible). Drop unused `Character` import if applicable.

- [ ] **Step 7: Migrate `CastTab.dragA11y.test.tsx`**

Delete the local `meta(id, orderIndex)` (lines ~5-24). Add `import { makeCharacter } from '../fixtures/character';`. Replace `meta(id, orderIndex)` → `makeCharacter({ id, orderIndex })`. Drop unused `Character` import if applicable.

- [ ] **Step 8: Migrate `useCharacters.test.tsx`**

Delete the local `meta(id, orderIndex)` (lines ~18-37). Add `import { makeCharacter } from '../fixtures/character';`. Replace `meta(id, orderIndex)` → `makeCharacter({ id, orderIndex })`. Drop unused `Character` import if applicable.

- [ ] **Step 9: Migrate `CharacterSheet.test.tsx` (local-interface variant)**

Delete the local `CharacterFixture` interface (lines ~23-40) and the local `char(overrides & { id })` factory (lines ~42-61). Add `import { makeCharacter } from '../fixtures/character';` and, if the file references the type by name, `import type { Character } from 'story-editor-shared';`. Replace `char({ id, ...rest })` calls with `makeCharacter({ id, ...rest })`. Replace any `CharacterFixture` type annotation in the file with `Character`. Run the per-task verify (Step 11) attentively here: if the component under test (`CharacterSheet`) rejects a `Character`-typed prop where it accepted `CharacterFixture`, STOP and report NEEDS_CONTEXT (see scope decision 3) — do not cast.

- [ ] **Step 10: Migrate `CharacterSheet.create.test.tsx` (local-interface variant)**

Delete the local `CharacterFixture` interface (lines ~21-38) and the local `makeChar(overrides & { id; name })` factory (lines ~40-60). Add `import { makeCharacter } from '../fixtures/character';` (and `import type { Character } from 'story-editor-shared';` if the type is named in the file). Replace `makeChar({ id, name, ...rest })` → `makeCharacter({ id, name, ...rest })`. Replace any `CharacterFixture` annotation with `Character`. Same NEEDS_CONTEXT caveat as Step 9.

- [ ] **Step 11: Run the per-task verify**

Run from repo root:
```bash
npm --prefix frontend run typecheck && npm --prefix frontend run test 2>&1 | tail -20
```
Expected: typecheck exits 0; vitest `Tests  N passed (N)` with N equal to the Task 0 baseline.

- [ ] **Step 12: Commit**

```bash
git add frontend/tests/fixtures/character.ts frontend/tests/components/CharacterPopover.test.tsx frontend/tests/components/CharacterPopoverHost.test.tsx frontend/tests/components/CharRefSuggestion.test.tsx frontend/tests/components/CastTab.test.tsx frontend/tests/components/CastTab.delete.test.tsx frontend/tests/components/CastTab.dragA11y.test.tsx frontend/tests/components/CharacterSheet.test.tsx frontend/tests/components/CharacterSheet.create.test.tsx frontend/tests/hooks/useCharacters.test.tsx
git commit -m "[story-editor-ote] test fixtures: consolidate Character factories into shared helper"
```

---

## Task 2: Chapter factories

**Files:**
- Create: `frontend/tests/fixtures/chapter.ts`
- Modify: `frontend/tests/hooks/useChapter.test.tsx`, `frontend/tests/components/ChapterList.test.tsx`, `frontend/tests/components/ChapterReorder.test.tsx`, `frontend/tests/components/ChapterList.dragA11y.test.tsx`, `frontend/tests/components/ChapterList.delete.test.tsx`

- [ ] **Step 1: Create the shared Chapter factories**

Create `frontend/tests/fixtures/chapter.ts`:

```ts
import type { Chapter, ChapterMeta } from 'story-editor-shared';

/**
 * Typed chapter-metadata fixture (list-endpoint shape, no body). The explicit
 * `: ChapterMeta` return annotation localizes schema drift to this factory.
 */
export function makeChapterMeta(overrides: Partial<ChapterMeta> = {}): ChapterMeta {
  return {
    id: 'c1',
    storyId: 's1',
    title: 'Opening',
    wordCount: 42,
    orderIndex: 0,
    status: 'draft',
    hasSummary: false,
    summaryIsStale: false,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-24T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Typed full-chapter fixture (meta + TipTap body + summary). Built on
 * makeChapterMeta so the shared metadata fields stay defined in one place.
 */
export function makeChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    ...makeChapterMeta(),
    bodyJson: { type: 'doc', content: [] },
    summary: null,
    summaryUpdatedAt: null,
    ...overrides,
  };
}
```

- [ ] **Step 2: Migrate `useChapter.test.tsx`**

This file has TWO local factories: `makeChapter(overrides)` (lines ~31-48, full Chapter) and `meta(id, orderIndex)` (lines ~192-205, ChapterMeta). Delete both. Add:
```ts
import { makeChapter, makeChapterMeta } from '../fixtures/chapter';
```
Existing `makeChapter(overrides)` calls are unchanged. Replace `meta(id, orderIndex)` → `makeChapterMeta({ id, orderIndex })`. Drop the now-unused `import type { Chapter, ChapterMeta }` if neither name is otherwise referenced (keep whichever is still used).

- [ ] **Step 3: Migrate `ChapterReorder.test.tsx`**

Delete the local `chap(id, orderIndex): ChapterMeta` (lines ~25-38). Add `import { makeChapterMeta } from '../fixtures/chapter';`. Replace `chap(id, orderIndex)` → `makeChapterMeta({ id, orderIndex })`. Drop unused `ChapterMeta` import if applicable.

- [ ] **Step 4: Migrate `ChapterList.dragA11y.test.tsx`**

Delete the local `meta(id, orderIndex): ChapterMeta` (lines ~5-18). Add `import { makeChapterMeta } from '../fixtures/chapter';`. Replace `meta(id, orderIndex)` → `makeChapterMeta({ id, orderIndex })`. Drop unused `ChapterMeta` import if applicable.

- [ ] **Step 5: Migrate `ChapterList.delete.test.tsx` (untyped local)**

Delete the local `chap({ id, orderIndex, title?, wordCount? })` (lines ~17-30, currently untyped). Add `import { makeChapterMeta } from '../fixtures/chapter';`. Replace `chap({ id, orderIndex, title, wordCount })` → `makeChapterMeta({ id, orderIndex, title, wordCount })`. This is an intended tightening: the fixture becomes typed `ChapterMeta`. If a call passed a field not on `ChapterMeta`, that's a real error to surface, not to widen.

- [ ] **Step 6: Migrate `ChapterList.test.tsx` (local-interface variant)**

Delete the local `ChapterFixture` interface (lines ~19-30) and the local `chap(overrides & { id; orderIndex }): ChapterFixture` factory (lines ~32-46). Add `import { makeChapterMeta } from '../fixtures/chapter';` (and `import type { ChapterMeta } from 'story-editor-shared';` if the type is named in the file). Replace `chap({ id, orderIndex, ...rest })` → `makeChapterMeta({ id, orderIndex, ...rest })`. Replace any `ChapterFixture` annotation with `ChapterMeta`. If `ChapterList` rejects a `ChapterMeta`-typed prop where it accepted `ChapterFixture`, STOP and report NEEDS_CONTEXT (scope decision 3).

- [ ] **Step 7: Run the per-task verify**

Run from repo root:
```bash
npm --prefix frontend run typecheck && npm --prefix frontend run test 2>&1 | tail -20
```
Expected: typecheck exits 0; vitest `Tests  N passed (N)` with N equal to the baseline.

- [ ] **Step 8: Commit**

```bash
git add frontend/tests/fixtures/chapter.ts frontend/tests/hooks/useChapter.test.tsx frontend/tests/components/ChapterList.test.tsx frontend/tests/components/ChapterReorder.test.tsx frontend/tests/components/ChapterList.dragA11y.test.tsx frontend/tests/components/ChapterList.delete.test.tsx
git commit -m "[story-editor-ote] test fixtures: consolidate Chapter/ChapterMeta factories into shared helper"
```

---

## Task 3: Model factory

**Files:**
- Create: `frontend/tests/fixtures/model.ts`
- Modify: `frontend/tests/components/ModelPickerInline.test.tsx`, `frontend/tests/components/ChatComposer.test.tsx`, `frontend/tests/components/Settings.models.test.tsx`

- [ ] **Step 1: Create the shared Model factory**

Create `frontend/tests/fixtures/model.ts`:

```ts
import type { Model } from '@/hooks/useModels';

/**
 * Typed Model fixture. `Model` is the frontend-local interface from
 * `@/hooks/useModels` (it mirrors the backend ModelInfo wire shape, not a
 * shared zod type). Explicit `: Model` return annotation localizes drift.
 */
export function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'llama-3.3-70b',
    name: 'Llama 3.3 70B',
    contextLength: 128_000,
    maxCompletionTokens: 16_384,
    supportsReasoning: false,
    supportsVision: false,
    supportsWebSearch: false,
    description: null,
    pricing: null,
    defaultTemperature: null,
    defaultTopP: null,
    ...overrides,
  };
}
```

- [ ] **Step 2: Migrate `ModelPickerInline.test.tsx`**

Delete the local `makeModel(overrides)` (lines ~10-25). Add `import { makeModel } from '../fixtures/model';`. Existing `makeModel(overrides)` calls are unchanged. Drop the now-unused `import type { Model } from '@/hooks/useModels'` if `Model` is not otherwise referenced (it likely still annotates `TWO_MODELS: Model[]` — keep it then).

- [ ] **Step 3: Migrate `ChatComposer.test.tsx`**

Delete the local `makeModel(over & { id })` (lines ~25-39). Add `import { makeModel } from '../fixtures/model';`. Replace `makeModel({ id, ...rest })` → `makeModel({ id, ...rest })` (call style unchanged — the shared factory's `id` is optional but supplying it is fine). Drop unused `Model` import if applicable.

- [ ] **Step 4: Migrate `Settings.models.test.tsx` (inline consts)**

This file has four inline `Model` consts `MODEL_M1`, `MODEL_M2`, `MODEL_M3`, `MODEL_REASONING` (lines ~100-126), each a fully-specified object literal annotated `: Model`. Replace each with a `makeModel({ ... })` call carrying only the fields that differ from the factory defaults. Add `import { makeModel } from '../fixtures/model';`. For example:
```ts
const MODEL_M1 = makeModel({ id: 'm1', name: 'Model One' });
const MODEL_REASONING = makeModel({ id: 'r1', name: 'Reasoner', supportsReasoning: true });
```
Preserve each const's existing distinguishing field values exactly (id, name, and any non-default capability/pricing/context values the test relies on — read the current literals and carry over every field that differs from the factory default). Drop the `import type { Model }` if the consts no longer annotate it and nothing else uses it.

- [ ] **Step 5: Run the per-task verify**

Run from repo root:
```bash
npm --prefix frontend run typecheck && npm --prefix frontend run test 2>&1 | tail -20
```
Expected: typecheck exits 0; vitest `Tests  N passed (N)` with N equal to the baseline.

- [ ] **Step 6: Commit**

```bash
git add frontend/tests/fixtures/model.ts frontend/tests/components/ModelPickerInline.test.tsx frontend/tests/components/ChatComposer.test.tsx frontend/tests/components/Settings.models.test.tsx
git commit -m "[story-editor-ote] test fixtures: consolidate Model factories into shared helper"
```

---

## Task 4: Prove the single-failure property (acceptance demo)

**Files:** none committed (temporary edit, reverted).

This task demonstrates the issue's acceptance criterion: adding a hypothetical required field to the Character schema produces exactly ONE fixture compile error (the factory), not N.

**Caveat (by design):** the demo is Character-only — it does not separately prove the single-failure property for Chapter or Model, and it only backstops a *missed* Character factory. That's acceptable: the property holds structurally for all three entities (each has one typed factory after Tasks 1-3), and the plan's file accounting already confirms no Chapter/Model factory is missed. The Character demo is the representative proof, not the exhaustive one.

- [ ] **Step 1: Temporarily add a required field to the schema**

Edit `shared/src/schemas/character.ts`: add `nickname: z.string(),` to `characterSchema` (after `name:` on line 10). This is a non-nullable, non-optional field, so every `Character` literal must now supply it.

- [ ] **Step 2: Typecheck and count the errors**

Run from repo root:
```bash
npm --prefix frontend run typecheck 2>&1 | grep -c "error TS"
```
Expected: a small number of errors **all originating in `frontend/tests/fixtures/character.ts`** (the factory's return object is missing `nickname`). Confirm with:
```bash
npm --prefix frontend run typecheck 2>&1 | grep "error TS" | grep -v "tests/fixtures/character.ts"
```
Expected: **no output** — i.e. no call site outside the factory fails. (Before this refactor, the same field add broke ~10 separate Character factories.) If any non-factory test file appears, a Character fixture was missed in Task 1 — note it and fix that file before reverting.

- [ ] **Step 3: Revert the schema edit**

```bash
git checkout shared/src/schemas/character.ts
```
Confirm clean:
```bash
git status --short shared/
```
Expected: no output (the schema file is back to committed state).

- [ ] **Step 4: Final green confirmation**

Run from repo root:
```bash
npm --prefix frontend run typecheck && npm --prefix frontend run test 2>&1 | tail -20
```
Expected: typecheck exits 0; vitest `Tests  N passed (N)` with N equal to the baseline. No commit (this task produced no committed changes).

---

## Self-review notes

- **Spec coverage:** Acceptance criterion 1 (one typed factory per entity; per-file helpers replaced) → Tasks 1-3. Criterion 2 (typecheck green, suite passes at same count) → per-task verify + Task 0 baseline. Criterion 3 (one field add = one compile error) → Task 4.
- **Excluded by design (scope decision 1):** untyped `Record<string, unknown>` wire-JSON integration fixtures; the ~10 untyped `makeStory` wire-builders (only one typed Story consumer exists, so nothing to consolidate); and the untyped `modelsQueryKey` cache-seeds (e.g. `SceneTab.test.tsx:69,865`). All documented with a count-based rationale, not dropped silently.
- **Type consistency:** `makeCharacter`/`makeChapter`/`makeChapterMeta`/`makeModel` names are stable across all tasks; `makeChapter` reuses `makeChapterMeta`; relative import path from `tests/components/` and `tests/hooks/` to `tests/fixtures/` is `../fixtures/<name>` (both are one level under `tests/`).
