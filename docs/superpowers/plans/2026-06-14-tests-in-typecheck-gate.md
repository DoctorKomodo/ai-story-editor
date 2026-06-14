# Bring `backend/tests` + `frontend/tests` into the typecheck gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `backend/tsconfig.test.json` + `frontend/tsconfig.test.json`, fold them into the existing `typecheck` scripts so CI / `make verify` inherit them, and fix all test-type errors (**29 backend + 206 frontend**) — all test-side, no production code.

**Architecture:** Two new test tsconfigs that `extend` their workspace base config and add `tests/**` to scope. Each workspace lands its config file *unwired* first (so no committed `typecheck` script ever points at a red gate), then the errors are fixed in cluster-grouped tasks using the compiler output as the worklist, then the script is wired once that workspace's gate is green.

> **REVISION (2026-06-14, during execution of `story-editor-4ry`):** The original plan claimed "backend is already clean (0 errors)" and wired the backend script immediately in Task 1. That recon was **invalid** — it was measured against a *no-op* config. `backend/tsconfig.json` declares `"exclude": ["node_modules","dist","tests"]`, and a child config that `extends` it **inherits that `exclude`** unless it redeclares it. The plan's original `backend/tsconfig.test.json` (no `exclude` key) therefore type-checked **0 of 110 test files** — the wired `typecheck` script exited green but checked nothing new (verify with `tsc -p tsconfig.test.json --noEmit --listFiles | grep -c '/tests/'` → `0`). The corrected config (explicit `exclude` override + `@/*` `paths` re-added, since the base has none + `tests/live/**` excluded to mirror `vitest.config.ts`) brings 109 test files into scope and reveals **29 real backend errors**. Backend now mirrors the frontend shape: config-lands-unwired → fix cluster → wire. The frontend half is unaffected — `frontend/tsconfig.app.json` uses `include: ["src"]` with **no** `exclude`, so the frontend test config works exactly as originally written (130 files in scope, 206 errors confirmed). The already-committed `df1bcdd` (no-op config + premature wiring) is corrected forward in the revised Task 1 below.

**Tech Stack:** TypeScript 5 (`tsc`), Vitest 4, React 19, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-06-13-tests-in-typecheck-gate-design.md`

> **Commit convention:** commit messages below are prefixed with this plan's bd issue id `[story-editor-4ry]`, per CLAUDE.md Git Rules (`[TASK_ID] brief description`).

> **Compiler-as-worklist:** Several tasks fix a *cluster* of errors that share one root cause. The exact site list is whatever `npx tsc -p tsconfig.test.json --noEmit` reports — that command IS the checklist. Each task gives the canonical fix pattern + representative before→after, then says "apply to every flagged site in this cluster" and verifies by the cluster's error codes/count dropping to zero. This is the correct shape for type-drift cleanup; it is not a placeholder.

> **Two hard rules for every fix task (from the spec):**
> 1. **Never** silence an error with `any` or a cast, and **never** loosen a production type. Fix the test to match the real type. If a test needs a type the source doesn't export, import it from `story-editor-shared`.
> 2. For tests that pass malformed input *on purpose* (error-path tests), use `// @ts-expect-error <reason>` on the offending line — never `any`/cast. (Recon found none of the current 206 are intentional-violation cases, so you likely won't need this — but use it, not a cast, if you hit one.)
> If any error turns out to expose a genuine **source** bug (recon found none), STOP and report it (DONE_WITH_CONCERNS) rather than papering over it in the test.

---

## File Structure

- `backend/tsconfig.test.json` — **new.** Extends `tsconfig.json`; relaxes `rootDir` to `.`, `noEmit: true`, **redeclares `exclude` (drops the inherited `"tests"`, adds `tests/live/**`)**, **re-adds `paths` (`@/*` — the base has none)**, includes `src` + `tests`.
- `backend/package.json` — `typecheck` script → `tsc -p tsconfig.test.json --noEmit` (**unwired in Task 1, wired in Task 1b after backend is green**).
- `backend/tests/**` — ~10 files edited across the backend fix cluster (Task 1b). No production files.
- `frontend/tsconfig.test.json` — **new.** Extends `tsconfig.app.json`; explicit `types` array (with the exhaustive-list NOTE comment), includes `src` + `tests`.
- `frontend/package.json` — `typecheck` script → `tsc -b && tsc -p tsconfig.test.json --noEmit` (**wired in the final task only**).
- `frontend/tests/**` — ~41 files edited across the fix-cluster tasks. No production files.

No CI/Makefile edits: `.github/workflows/ci.yml` (lines 79/82) and the `Makefile` `typecheck` target already call `npm -w <workspace> run typecheck`, so they inherit the change.

---

### Task 1: Backend test tsconfig (corrected config — UNWIRED; establishes the ~29-error baseline)

> **Supersedes the original Task 1.** Commit `df1bcdd` already created a *no-op* `backend/tsconfig.test.json` (inherited `exclude:["tests"]` → 0 test files checked) and prematurely wired the backend `typecheck` script to it. This task corrects both forward: fix the config so it actually checks tests, and **revert the script back to the src-only check** until Task 1b makes the gate green. No history rewrite — forward commit.

**Files:**
- Modify: `backend/tsconfig.test.json` (correct the existing file from `df1bcdd`)
- Modify: `backend/package.json` (revert `typecheck` to `tsc --noEmit` — unwire)

- [ ] **Step 1: Correct `backend/tsconfig.test.json`**

```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true,
    "incremental": false,
    // The base tsconfig.json has no `paths`; re-add the @/ alias so test files
    // that import `@/lib/...` resolve under the gate (vitest aliases @ → src).
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src/**/*", "tests/**/*"],
  // The base excludes `tests` entirely; redeclare to DROP that (so tests are checked)
  // while still excluding the opt-in live suite (mirrors vitest.config.ts exclude).
  "exclude": ["node_modules", "dist", "tests/live/**"]
}
```

- [ ] **Step 2: Confirm the gate now actually checks test files**

Run: `cd backend && npx tsc -p tsconfig.test.json --noEmit --listFiles | grep -c '/tests/'`
Expected: `109` (non-zero — proves the no-op is fixed).

- [ ] **Step 3: Establish the backend error baseline**

Run: `cd backend && npx tsc -p tsconfig.test.json --noEmit 2>&1 | grep -c "error TS"`
Expected: `29`. This is the baseline Task 1b burns down. (Breakdown: 9×TS2345, 4×TS2307, 3×TS7006, 3×TS2741, 3×TS2578, 3×TS2322, 2×TS6133, 2×TS1470.)

- [ ] **Step 4: Unwire the backend `typecheck` script**

In `backend/package.json`, revert:
```json
    "typecheck": "tsc -p tsconfig.test.json --noEmit",
```
back to:
```json
    "typecheck": "tsc --noEmit",
```
(Keeps the branch CI-green: the wired script must never point at a red gate. Re-wired in Task 1b after the 29 errors are fixed.)

- [ ] **Step 5: Verify the unwired script still passes**

Run: `npm -w story-editor-backend run typecheck`
Expected: PASS (exit 0 — src-only check, unchanged from before this plan).

- [ ] **Step 6: Commit**

```bash
git add backend/tsconfig.test.json backend/package.json
git commit -m "[story-editor-4ry] backend: correct tsconfig.test.json to actually check tests (unwired; 29 errors to fix)"
```

---

### Task 1b: Fix the 29 backend test-type errors + wire the backend gate

**Files:** `backend/tests/**` — the files the compiler flags (see Step 1). No production files. Then `backend/package.json` (wire, final step).

**Root causes (cluster):** fixture drift against canonical types after entity/schema changes — same class of bug the whole plan exists to catch. Representative sites from the baseline:
- **TS2741 (3)** — fixtures missing a now-required field: `AuthenticatedUser.sessionId` (`ownership.middleware.test.ts:11,103`), `ModelInfo.supportsResponseSchema` (`user-settings-resolvers.test.ts:67`).
- **TS2345 (9)** — argument-shape drift: `chat-messages-list.test.ts` Express `Request` generic mismatches (×7), `LogVeniceParamsInput` missing `reasoningEnabled` (`venice-call.service.test.ts:194`), `VeniceRawModel` shape (`venice.models.service.test.ts:489`).
- **TS2307 (4)** — extensionless **dynamic** `await import('../../src/...')` under NodeNext (`session-dek.test.ts:203`, `story.repo.test.ts:100,104`) + `@/lib/text-gen-defaults` (`text-gen-defaults.test.ts:25`; resolved by the Task 1 `paths` add, confirm). Static imports of the same modules already resolve — fix the dynamic-import specifiers to match how the source is actually importable (add the explicit extension the resolver wants, or switch to the static-import style the file already uses).
- **TS2322 (3)** — `null` → Prisma `InputJsonValue` (`complete.test.ts:655`) and `Promise<…>` vs `PrismaPromise<…>` (`chapters.test.ts:269`, `outline.test.ts:276`).
- **TS7006 (3)** — implicit-`any` callback params (`venice-errors.test.ts:565,593,614`) — annotate the param with its real type.
- **TS2578 (3)** — unused `@ts-expect-error` (`venice.models.service.test.ts:341,379,390`) — the underlying call now type-checks; remove the directive (do not leave it).
- **TS6133 (2)** — unused locals (`complete.test.ts:289` `_req`, `message.repo.test.ts:240` `_userMsgA`) — remove or genuinely use.

**The compiler output IS the worklist** — fix every flagged site per the two hard rules (fix the test to match the real type; never `any`/cast/source-widening; `@ts-expect-error <reason>` only for deliberate error-path inputs). If any error exposes a genuine **source** bug, STOP and report DONE_WITH_CONCERNS. (Recon found none — all flagged source modules exist and are imported successfully elsewhere.)

- [ ] **Step 1: Enumerate the cluster**

Run: `cd backend && npx tsc -p tsconfig.test.json --noEmit 2>&1 | grep "error TS"`
This is the site list.

- [ ] **Step 2: Fix every flagged site**

Read the real type before each fix (the error message names the expected type; confirm field names against `shared/src/**` or the backend source that declares them — e.g. `grep -rn "sessionId" backend/src/middleware backend/src/types`, the `ModelInfo`/`LogVeniceParamsInput`/`VeniceRawModel` declarations). Apply the canonical fix. Do not loosen any source type.

- [ ] **Step 3: Verify the gate is fully clean**

Run: `cd backend && npx tsc -p tsconfig.test.json --noEmit 2>&1 | grep -c "error TS"`
Expected: `0`.

- [ ] **Step 4: Confirm no behavior change (backend suite)**

The backend suite needs the stack up (vitest `globalSetup` resets the test DB against Postgres). Ensure `make dev` is running, then:
Run: `npm -w story-editor-backend run test`
Expected: PASS, same test count as before (type-only edits). If the stack isn't up, run `make dev` first and wait for healthy. (Per project memory: backend test verify lines require the compose stack up.)

- [ ] **Step 5: Wire the backend `typecheck` script**

Now that the gate is green, in `backend/package.json` change:
```json
    "typecheck": "tsc --noEmit",
```
to:
```json
    "typecheck": "tsc -p tsconfig.test.json --noEmit",
```

- [ ] **Step 6: Verify the wired script**

Run: `npm -w story-editor-backend run typecheck`
Expected: PASS (exit 0 — now covers src + tests).

- [ ] **Step 7: Commit**

```bash
git add backend/tests backend/package.json
git commit -m "[story-editor-4ry] backend tests: fix 29 fixture-drift type errors; wire tests into the typecheck gate"
```

---

### Task 2: Frontend test tsconfig (config only — NOT wired yet)

**Files:**
- Create: `frontend/tsconfig.test.json`

- [ ] **Step 1: Create `frontend/tsconfig.test.json`**

```jsonc
{
  "extends": "./tsconfig.app.json",
  "compilerOptions": {
    "composite": false,
    "incremental": false,
    // NOTE: an explicit `types` array disables automatic @types inclusion. This list is
    // EXHAUSTIVE — any new test dependency that ships ambient types (a new @testing-library, a
    // global-registering matcher lib, etc.) must be added here or its types won't be found.
    "types": ["vitest/globals", "@testing-library/jest-dom", "node", "react", "react-dom"]
  },
  "include": ["src", "tests"]
}
```
(`.json` extension but TS tolerates `// ` comments in tsconfig — keep the NOTE.)

- [ ] **Step 2: Establish the baseline error count**

Run: `cd frontend && npx tsc -p tsconfig.test.json --noEmit 2>&1 | grep -c "error TS"`
Expected: `206`. This is the "failing test" baseline the fix tasks burn down.

- [ ] **Step 3: Do NOT wire the script yet**

Leave `frontend/package.json` `typecheck` as `tsc -b`. The config file is not referenced by any script or CI, so committing it alone keeps `npm run typecheck` (and CI) green. Wiring happens in Task 8 after the gate is clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/tsconfig.test.json
git commit -m "[story-editor-4ry] frontend: add tsconfig.test.json (unwired; 206 errors to fix)"
```

---

### Task 3: Fix typed-`vi.fn()` callback-prop mocks (~122 errors — the bulk of the job)

> **This is the largest task: 122 of the 206 errors** (≈60%), not the ~88 an earlier estimate suggested. The grep below (`Mock<Procedure | Constructable>`) actually matches ~127 lines because a few `TS2345` handler-mock errors reference the same type — that's fine, fixing them here is correct; Task 4 just won't find them still failing.
>
> **Do NOT treat "mock-grep → 0" as "all TS2322 done."** Eight TS2322 errors do **not** contain the `Mock<Procedure | Constructable>` substring and are handled elsewhere: 1× Model fixture (Task 6), 6× `useBannerRetry` `RefObject<SendArgs | null>` (Task 4), 1× Paper `Mock<(editor: Editor) => void>` already-typed-but-wrong mock (Task 4). The real completeness check is Task 7's total→0 gate.

**Files:** `frontend/tests/**` — the files the compiler flags with `TS2322/TS2345: ... Mock<Procedure | Constructable> is not assignable to ...` (Settings.*, StoryModal, StoryPicker, SceneComposer, SessionPicker, CharacterSheet, and others). (Paper's `:195` editor mock is a *different* shape — handled in Task 4, not here.)

**Root cause:** bare `vi.fn()` is `Mock<Procedure | Constructable>`, not assignable to a specific callback signature.

**Canonical fix:** give `vi.fn` the exact signature the prop/arg expects.

- [ ] **Step 1: Enumerate the cluster**

Run: `cd frontend && npx tsc -p tsconfig.test.json --noEmit 2>&1 | grep "Mock<Procedure | Constructable>"`
This is the site list for this task.

- [ ] **Step 2: Apply the canonical fix to every flagged site**

For each site, type the mock to the signature the error message names. Examples:
```ts
// Before
const onClose = vi.fn();
const onCreated = vi.fn();
// After
const onClose = vi.fn<() => void>();
const onCreated = vi.fn<(createdId: string | null) => void>();
```
The exact signature is whatever the consuming prop/hook declares (the error message's "is not assignable to type '...'" names it). This pattern is already used in `CharRefMark.test.tsx`, `Editor.test.tsx`, `Paper.test.tsx` — match their style. Do not use `any`.

- [ ] **Step 3: Verify the cluster is gone**

Run: `cd frontend && npx tsc -p tsconfig.test.json --noEmit 2>&1 | grep -c "Mock<Procedure | Constructable>"`
Expected: `0`. The overall count should drop by ~122 (to roughly 84 remaining): `... | grep -c "error TS"`. Do not expect 0 overall yet — the remaining errors are Tasks 4–7.

- [ ] **Step 4: Confirm no behavior change**

Run: `npm --prefix frontend run test -- Settings StoryModal StoryPicker SceneComposer SessionPicker CharacterSheet Paper`
Expected: PASS (type-only edits; runtime unchanged). Adjust the filter to the files actually touched.

- [ ] **Step 5: Commit**

```bash
git add frontend/tests
git commit -m "[story-editor-4ry] frontend tests: type vi.fn() callback mocks (TS2322 mock cluster)"
```

---

### Task 4: Fix hook/stream/ref mock-contract fixtures (~22 errors)

**Files:** `frontend/tests/hooks/useKeyboardShortcuts.test.tsx`, `useSoftDelete.test.tsx`, `useAICompletion.test.tsx`, `useChat.test.tsx`, `useBannerRetry.test.tsx`, `api-401-terminal.test.ts`, **`frontend/tests/components/Paper.test.tsx`** (confirm against compiler output).

**Root cause:** mocks/fixtures whose shape must match a real hook/function contract — keyboard handlers (`(e: KeyboardEvent) => boolean | undefined`), soft-delete callbacks (`(id) => Promise<…>`), `apiStream` (mock needs the real signature so downstream `.aborted` resolves), `useBannerRetry`'s `makeFakeMutation()` and its `lastSendArgsRef` (typed `RefObject<{ content; enableWebSearch }>` but the hook wants `RefObject<SendArgs | null>`, 6 sites), and **Paper's `:195` `onReady` mock** (`vi.fn<(editor: Editor) => void>()` — already typed but missing `| null`; the bare-mock grep in Task 3 does NOT catch it).

**Canonical fix:** read the **real** signature in source and type the mock/fixture to it. Do **not** widen the source type.

- [ ] **Step 1: Read the real contracts**

Read the signatures you're mocking before editing:
- `frontend/src/hooks/useKeyboardShortcuts.ts` (handler return type),
- `frontend/src/hooks/useSoftDelete.ts` (remove-callback signature),
- `frontend/src/lib/api.ts` (`apiStream` signature),
- `frontend/src/hooks/useBannerRetry.ts` + `useChat.ts` (what `mutation` / `lastSendArgsRef` / `SendArgs` actually require).

- [ ] **Step 2: Apply fixes**

```ts
// keyboard handler
const handler = vi.fn<(e: KeyboardEvent) => boolean | undefined>();
// soft-delete callback
const removeFn = vi.fn<(id: string) => Promise<void>>();
// apiStream mock carries the real signature
apiStream: vi.fn<typeof apiStream>(),
// Paper onReady mock — add the missing | null
const onReady = vi.fn<(editor: Editor | null) => void>();
```
For `useBannerRetry`: type `makeFakeMutation()`'s return and `lastSendArgsRef` to the precise types the hook consumes. The `lastSendArgsRef` fixture is currently `useRef({ content, enableWebSearch })` → `RefObject<{ content; enableWebSearch }>`, but the hook wants `RefObject<SendArgs | null>`; seed it as `useRef<SendArgs | null>(…)` with a value that satisfies `SendArgs` (read `SendArgs` in `useChat.ts`/`useBannerRetry.ts` first). A typed partial is fine **only** if the hook's parameter type genuinely accepts a partial; otherwise build the full shape — don't cast to `any`. If you find the hook's param type is unreasonably broad/narrow and the *source* should change, STOP and report it (don't change source silently).

- [ ] **Step 3: Verify**

Run: `cd frontend && npx tsc -p tsconfig.test.json --noEmit 2>&1 | grep -E "useKeyboardShortcuts|useSoftDelete|useAICompletion|useChat|useBannerRetry|api-401-terminal|Paper"`
Expected: `0` lines.

- [ ] **Step 4: Confirm no behavior change**

Run: `npm --prefix frontend run test -- useKeyboardShortcuts useSoftDelete useAICompletion useChat useBannerRetry api-401-terminal Paper`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/tests
git commit -m "[story-editor-4ry] frontend tests: type hook/stream mock fixtures to real contracts"
```

---

### Task 5: Fix type-source imports — `Character` from shared + React 19 `JSX` namespace (Clusters 2/3, 25 errors)

**Files:** CastTab×3, CharRefSuggestion, CharacterPopover, CharacterPopoverHost (Character import); Autosave×2, ChapterReorder, CharRefMark, useChat, useUserSettings, useVeniceAccount (JSX). Confirm against compiler output.

- [ ] **Step 1: `Character` import (TS2459, 6 sites)**

`@/hooks/useCharacters` imports `Character` as a local type and doesn't re-export it. Change test imports:
```ts
// Before
import { Character } from '@/hooks/useCharacters';
// After
import type { Character } from 'story-editor-shared';
```
Check the same files for other types imported from a hook that should come from `story-editor-shared` (e.g. `Story`, `Chapter`, `Message`) and redirect those too. Do **not** add a re-export to the hook.

- [ ] **Step 2: `JSX` namespace (TS2503, 19 sites)**

React 19 dropped the global `JSX` namespace. Change bare `JSX.Element` in test helper signatures:
```ts
// Before
function Harness(): JSX.Element { ... }
// After
function Harness(): React.JSX.Element { ... }
```
(Use `React.JSX.Element`; ensure `React` is imported in the file. Equivalent: `import type { JSX } from 'react'` — pick whichever matches the file's existing React import style.)

- [ ] **Step 3: Verify**

Run: `cd frontend && npx tsc -p tsconfig.test.json --noEmit 2>&1 | grep -cE "TS2459|TS2503|namespace 'JSX'"`
Expected: `0`.

- [ ] **Step 4: Confirm no behavior change**

Run: `npm --prefix frontend run test -- CastTab CharRefSuggestion CharacterPopover Autosave ChapterReorder CharRefMark useChat useUserSettings useVeniceAccount`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/tests
git commit -m "[story-editor-4ry] frontend tests: import Character from shared; React.JSX.Element for React 19"
```

---

### Task 6: Fix fixture-shape drift (Clusters 4/7/8 + Model fixture, ~8 errors)

**Files:** `ChapterList.dragA11y.test.tsx`, `ChapterReorder.test.tsx` (Chapter fields); `ChatComposer.test.tsx` (Model); `useChapter.test.tsx` (wordCount); `TranscriptView.test.tsx`, `useBannerRetry.test.tsx` (duplicate id). Confirm against compiler output.

- [ ] **Step 1: Chapter fixtures missing `hasSummary`/`summaryIsStale` (TS2739)**

First read the canonical type: `grep -n "hasSummary\|summaryIsStale" shared/src/**/*.ts` to confirm the field names/types and that `false` is the right default. Then add to the fixture helper(s):
```ts
hasSummary: false,
summaryIsStale: false,
```

- [ ] **Step 2: Complete the `Model` fixture (TS2322, ChatComposer:26)**

Read the shared `Model` type. Add the missing fields to the `makeModel` helper with type-correct defaults, e.g.:
```ts
maxCompletionTokens: 4096,
description: null,
pricing: null,
defaultTemperature: null,
defaultTopP: null,
```
(Match the actual optionality/types in the shared `Model`; use `null` only where the type allows it, otherwise omit optional fields.)

- [ ] **Step 3: Drop read-only `wordCount` from mutation input (TS2353, useChapter.test.tsx)**

`ChapterUpdateInput` has no `wordCount` (backend-derived). Remove it from the mutation `input` object; keep it on the response mock (`makeChapter({ wordCount: 5 })`).

- [ ] **Step 4: Remove duplicate-`id` spread (TS2783)**

In the flagged fixture helpers, the explicit `id: over.id,` duplicates `...over`. Remove the explicit line.

- [ ] **Step 5: Verify**

Run: `cd frontend && npx tsc -p tsconfig.test.json --noEmit 2>&1 | grep -cE "TS2739|TS2353|TS2783"`
Expected: `0`. And the `ChatComposer` Model error is gone (`... | grep -c "ChatComposer"` → 0).

- [ ] **Step 6: Confirm no behavior change**

Run: `npm --prefix frontend run test -- ChapterList ChapterReorder ChatComposer useChapter TranscriptView useBannerRetry`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/tests
git commit -m "[story-editor-4ry] frontend tests: conform Chapter/Model fixtures; drop read-only wordCount input"
```

---

### Task 7: Fix remaining narrowing/guard errors — fetch-mock calls, ProseMirror `.text`, resolver closures (TS2769/TS2345/TS2339/TS2349, ~19 errors)

**Files:** Settings.*/auth/reset-password (fetch-mock `.calls`); CharRefAuthoring, CharRefMark (`.text`); ChapterList, CharacterSheet, OutlineTab, pages/editor (optional-chaining resolver). Confirm against compiler output. (This task clears whatever remains.)

- [ ] **Step 1: fetch-mock `.calls` destructuring (TS2769/TS2345)**

The mock-call entries are `[string, RequestInit | undefined]`. Replace the `.filter(...).map(([, init]: [string, RequestInit]) => init)` pattern with a type-guard filter:
```ts
fetchMock.mock.calls
  .filter((call): call is [string, RequestInit] =>
    call[0] === '/api/users/me/settings' && call[1]?.method === 'PATCH')
  .map(([, init]) => init);
```
Apply to each PATCH/request-body assertion helper the compiler flags.

- [ ] **Step 2: ProseMirror `.text` guard (TS2339)**

Add a `typeof n.text === 'string'` guard before reading `.text`:
```ts
const run = para?.content?.find(
  (n) => n.type === 'text' && typeof n.text === 'string' && n.text.includes('Eli Bracken'),
);
```

- [ ] **Step 3: Optional-chaining on closure-assigned resolver (TS2349)**

`resolveFetch?.(…)` fails because the closure var is callable-or-undefined. The setter is always assigned before use, so:
```ts
if (resolveFetch) resolveFetch(jsonResponse(200, { chapters: [] }));
```
(or `resolveFetch!(…)` if the file's style prefers it — `if` guard is clearer).

- [ ] **Step 4: Verify the gate is fully clean**

Run: `cd frontend && npx tsc -p tsconfig.test.json --noEmit 2>&1 | grep -c "error TS"`
Expected: `0`. (All 206 fixed across Tasks 3–7.)

- [ ] **Step 5: Confirm no behavior change**

Run: `npm --prefix frontend run test -- Settings auth reset-password CharRefAuthoring CharRefMark ChapterList CharacterSheet OutlineTab editor`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/tests
git commit -m "[story-editor-4ry] frontend tests: type-guard fetch-mock calls, ProseMirror .text, resolver closures"
```

---

### Task 8: Wire the frontend gate + full verify + regression proof

**Files:** `frontend/package.json`

- [ ] **Step 1: Pre-check — gate is clean**

Run: `cd frontend && npx tsc -p tsconfig.test.json --noEmit`
Expected: exit 0, no output. If anything remains, fix it (per the two hard rules) before wiring.

- [ ] **Step 2: Wire the frontend `typecheck` script**

In `frontend/package.json`, change:
```json
    "typecheck": "tsc -b",
```
to:
```json
    "typecheck": "tsc -b && tsc -p tsconfig.test.json --noEmit",
```

- [ ] **Step 3: Verify both workspace gates via their scripts**

Run: `npm -w story-editor-backend run typecheck && npm -w story-editor-frontend run typecheck`
Expected: PASS (this is exactly what CI lines 79/82 run).

- [ ] **Step 4: Full frontend suite (no behavior change)**

Run: `npm --prefix frontend run test`
Expected: PASS, with the **same test count as before this plan** (these are type-only edits — no tests added or removed). Record the actual pre-change baseline (run the suite once on `main` if unsure) and confirm it's unchanged; do not enforce a hardcoded number.

- [ ] **Step 5: Regression proof (acceptance #3 — manual, restore after)**

Temporarily break one fixture to prove the gate catches drift, then restore:
```bash
# pick a fixture, e.g. revert a Chapter fixture's hasSummary line, then:
cd frontend && npx tsc -p tsconfig.test.json --noEmit   # EXPECT: it now FAILS with a TS error
# restore the fixture
git checkout -- frontend/tests/<the-file>
cd frontend && npx tsc -p tsconfig.test.json --noEmit   # EXPECT: clean again
```
Do **not** commit the temporary break. Record in the task report which fixture you used and that the gate failed then passed.

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json
git commit -m "[story-editor-4ry] frontend: wire tests into the typecheck gate (script)"
```

---

## Self-Review

**Spec coverage:**
- Backend tsconfig.test.json (corrected: `exclude` override + `@/*` paths) + 29 backend test fixes + script wiring. ✓ Tasks 1, 1b
- Frontend tsconfig.test.json (with exhaustive-`types` NOTE comment). ✓ Task 2
- Fold into existing `typecheck` scripts (CI/Makefile inherit; no new wiring). ✓ Tasks 1b, 8 + confirmed ci.yml 79/82 / Makefile
- Fix all 206 frontend errors across the clusters. ✓ Tasks 3–7:
  - **T3** — 122 bare-`vi.fn()` `Mock<Procedure | Constructable>` (TS2322) + the ~5 TS2345 that reference the same type.
  - **T4** — keyboard/soft-delete handler mocks, `apiStream` mock, `useBannerRetry` `makeFakeMutation` + 6× `lastSendArgsRef` `RefObject<SendArgs|null>`, and the 1× Paper `:195` already-typed-but-wrong mock.
  - **T5** — `Character`-from-shared imports (TS2459) + `React.JSX.Element` (TS2503).
  - **T6** — Chapter fixture fields (TS2739), 1× Model fixture (the ChatComposer TS2322), read-only `wordCount` input (TS2353), duplicate-`id` spread (TS2783).
  - **T7** — fetch-mock `.calls` guard (TS2769/TS2345), ProseMirror `.text` guard (TS2339), resolver-closure optional-chaining (TS2349) — and as the last fix task, the total→0 backstop for any straggler.
  - (No cluster is double-assigned; the 8 non-`Mock<Procedure|Constructable>` TS2322s are split 1→T6, 7→T4 as listed above.)
- No production code; never `any`/cast/source-widening; `@ts-expect-error` for intentional violations; import missing types from shared. ✓ hard-rules banner + Task 4/5 callouts
- Regression proof (revert-a-fixture). ✓ Task 8 Step 5
- pre-commit stays biome-only; shared already gated. ✓ (not touched)

**Placeholder scan:** The cluster tasks use compiler output as the site enumerator (intentional, documented) rather than pasting 206 file:line pairs — each has a concrete grep-based verify (cluster error codes → 0) and representative before→after code. No TBD/TODO.

**Type consistency:** `tsc -p tsconfig.test.json --noEmit` used identically as the per-cluster verify throughout; backend `typecheck` → `tsc -p tsconfig.test.json --noEmit`; frontend `typecheck` → `tsc -b && tsc -p tsconfig.test.json --noEmit` (matches the corrected bd verify line). Config field names (`rootDir`, `composite`, `types`, `include`) consistent between the File Structure section and Tasks 1–2.

**Ordering safety:** No committed state has a red `typecheck` script. Each workspace lands its config *unwired* (backend: Task 1 reverts the premature `df1bcdd` wiring; frontend: Task 2 never wires), is wired only after its own gate is green (backend: Task 1b Step 5; frontend: Task 8 Step 2). Intermediate cluster commits touch only `backend/tests` / `frontend/tests`, never the script/CI, so the branch stays CI-green throughout.
