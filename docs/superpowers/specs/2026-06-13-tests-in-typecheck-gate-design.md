# Bring `backend/tests` + `frontend/tests` into the typecheck gate — design (`story-editor-4ry`)

**Date:** 2026-06-13
**Issue:** story-editor-4ry — Bring backend/tests + frontend/tests into the typecheck gate

## Problem

Both `backend/tsconfig.json` and `frontend/tsconfig.app.json` exclude `tests/`, so test files are
not part of `tsc --noEmit`. Vitest transpiles them at run time (so they execute), but **type drift
between fixtures/mocks and source types is never caught by the typecheck gate** — only by manual
review or a runtime failure.

Surfaced in PR #104 review (Message entity consolidation): `encryption-leak.test.ts` used
`attachmentJson: { ref: … }` after a rename, but `MessageCreateInput.attachmentJson` is
`MessageAttachment | null` where `MessageAttachment` requires `{ selectionText, chapterId }`. The
test only compiled because `tests/` was outside the gate. The consolidation work leans on the type
gate to prevent schema/consumer drift; tests are full-fledged consumers of those types but live
outside the gate. The silent-harm path (fixtures rotting against canonical types) grows with every
future entity migration.

`shared/tsconfig.json` already includes `tests/**` — so the gap is exactly backend + frontend.

## Measured blast radius

> **REVISION (2026-06-14, during implementation):** The "Backend: 0 errors" figure below was
> **invalid** — it was measured against a *no-op* config. `backend/tsconfig.json` declares
> `"exclude": ["node_modules","dist","tests"]`, and a child config that `extends` it **inherits that
> `exclude`** unless it redeclares it. The original backend `tsconfig.test.json` (no `exclude` key)
> therefore type-checked **0 of 110 test files** (`tsc -p tsconfig.test.json --noEmit --listFiles |
> grep -c '/tests/'` → `0`). The corrected config (explicit `exclude` override + `@/*` `paths`
> re-added, since the base has none, + `tests/live/**` excluded to mirror `vitest.config.ts`) brings
> 109 test files into scope and reveals **29 real backend errors** — same class of fixture/mock drift
> as the frontend. Still **no production-code bugs**; all 29 fixed test-side. The frontend figures
> below are correct as written. See the corrected config in "Configuration" below and the
> plan's REVISION note. The original (now-corrected) text follows.

Probed by compiling each workspace's `src + tests` under its strict config:

- ~~**Backend: 0 errors.** Tests already conform. Adding the gate is purely structural.~~ **Corrected:
  29 errors** (the 0 was a no-op-config artifact — see REVISION above). Real per-site fixture/mock
  drift, fixed test-side.
- **Frontend: 206 errors across 41 test files.** Real per-site work. (Confirmed not a config artifact:
  adding `react`/`react-dom` to the `types` array did not change the count.)

The 206 frontend errors map to 13 root-cause clusters (recon); the 29 backend errors are the same
drift class (missing fixture fields, argument-shape drift, stale `@ts-expect-error`, extensionless
dynamic imports). **No genuine source-code bugs** were found in either workspace — every error is
test-side type sloppiness or fixture/mock drift. Therefore **no production code under `backend/src`
or `frontend/src` is touched** by this work.

## Decision (from brainstorming)

- **Full scope, one PR:** add both test tsconfigs *and* fix all 206 frontend errors. (User chose this
  over backend-only-now-split-frontend, and over a baseline/allowlist gate.)
- **Fold into the existing `typecheck` scripts**, not a separate `typecheck:tests` script. CI
  (`ci.yml` runs `npm -w <workspace> run typecheck`), `make typecheck`, and `make verify` then
  inherit the test gate automatically with nothing new to wire.
- **pre-commit stays biome-only.** It runs no `tsc` today (lint-staged → `biome check` only); adding
  `tsc` to every commit is out of scope and slow. CI is the real gate — the acceptance criterion's
  "or … pre-commit" is satisfied by CI coverage.
- **Fix mocks/fixtures to match the real types; never loosen source types or use `any`** to silence
  an error. Where a test legitimately needs a type the source doesn't export, import it from its
  canonical home (`story-editor-shared`), do not re-export it from a hook.
- **Sanctioned escape hatch for *intentional* type violations: `@ts-expect-error` (with a one-line
  reason), never `any`/`as`.** Some tests deliberately pass malformed input to exercise an error
  path. The correct expression of "this is wrong on purpose" is `// @ts-expect-error <why>` on the
  offending line — which the gate itself verifies (it errors if the next line turns out to be valid),
  so it can't rot silently. A cast or `any` would hide the violation from the gate. Recon found none
  of the current 206 are intentional-violation cases (all are genuine drift), so this is guidance for
  the few that may exist and for future tests, not a license to reach for it.
- **Strictness tax — accepted consciously.** The test configs inherit
  `noUnusedLocals`/`noUnusedParameters` from their base configs, so throwaway mocks must drop unused
  locals/params (e.g. prefix-unused with `_` or omit them). This is intended — it catches dead test
  code and stale mock args, which are a drift vector. (The original "backend already passes with 0
  errors" claim here was the no-op-config artifact — see the REVISION under "Measured blast radius";
  backend had 29 drift errors, fixed test-side.) If
  this friction proves costly in practice, relaxing **only those two flags in `tsconfig.test.json`**
  (not the base configs) is the defensible escape valve — but we start strict and only relax on
  evidence, not speculatively.

## Configuration

### Backend — `backend/tsconfig.test.json` (new)

```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",          // tsconfig.json pins rootDir: "src"; relax so tests/ is in scope
    "noEmit": true,          // typecheck only — the prod build is tsup, not tsc
    "incremental": false,
    // The base tsconfig.json has no `paths`; re-add the @/ alias so test files
    // that import `@/lib/...` resolve under the gate (vitest aliases @ → src).
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src/**/*", "tests/**/*"],
  // CRITICAL: the base excludes `tests` entirely; redeclare to DROP that (so tests are
  // actually checked) while still excluding the opt-in live suite (mirrors vitest.config.ts).
  // Without this override the gate inherits `exclude: ["tests"]` and checks 0 test files.
  "exclude": ["node_modules", "dist", "tests/live/**"]
}
```

> **The `exclude` + `paths` lines above are the 2026-06-14 correction** (see REVISION under "Measured
> blast radius"). The original snippet omitted both: it inherited the base's `exclude: ["tests"]` (→
> no-op gate) and lacked `paths` (→ `@/`-import test files would `TS2307` once tests were actually in
> scope).

`backend/package.json` `typecheck` script: `tsc --noEmit` → **`tsc -p tsconfig.test.json --noEmit`**.
With the `exclude` override, the test config covers both `src` and `tests` under the same strict flags
(via `extends`). The production build (`tsup`) is unaffected — it never used `tsc`.

### Frontend — `frontend/tsconfig.test.json` (new)

```jsonc
{
  "extends": "./tsconfig.app.json",
  "compilerOptions": {
    "composite": false,
    "incremental": false,
    // NOTE: an explicit `types` array disables automatic @types inclusion. This list is therefore
    // EXHAUSTIVE — any new test dependency that ships ambient types (a new @testing-library, a
    // global-registering matcher lib, etc.) must be added here or its types won't be found.
    "types": ["vitest/globals", "@testing-library/jest-dom", "node", "react", "react-dom"]
  },
  "include": ["src", "tests"]
}
```

Carry the `NOTE` above into the committed config as a real `jsonc` comment (the file is `.json` but
TS tolerates `// ` comments in tsconfig) so the footgun is documented at the point of use.

`frontend/package.json` `typecheck` script: `tsc -b` → **`tsc -b && tsc -p tsconfig.test.json --noEmit`**.
A separate `-p` invocation (not a third project reference) because the test `include` overlaps
`src`, which composite project references can't cleanly express. `globals: true` in the frontend
vitest config means tests use ambient `describe`/`it`/`expect`, so `vitest/globals` and the jest-dom
matcher types must be in the `types` array. (Setting an explicit `types` array disables automatic
`@types` inclusion, so `react`/`react-dom`/`node` are listed back in.)

Neither config is referenced from `frontend/tsconfig.json` (the solution file) — the `-p` invocation
runs it directly.

## Fix clusters (frontend, 206 errors / 41 files)

All fixes are in `frontend/tests/**`. Grouped by root cause; each cluster has a single canonical
fix pattern.

**Mechanical / bulk (~150):**

1. **Untyped `vi.fn()` → typed callback props (TS2322, ~88).** `vi.fn()` is `Mock<Procedure |
   Constructable>`, not assignable to a specific signature. Fix: `vi.fn<(args) => ret>()` matching
   the prop. Pattern already used in clean tests (`CharRefMark`, `Editor`, `Paper`).
2. **React 19 dropped the global `JSX` namespace (TS2503, 19).** Test helper signatures use bare
   `JSX.Element`. Fix: `React.JSX.Element` (or `import type { JSX } from 'react'`). 6 files.
3. **`Character` imported from the hook, not shared (TS2459, 6).** `@/hooks/useCharacters` imports
   `Character` as a local type and doesn't re-export it. Fix: `import type { Character } from
   'story-editor-shared'`. Same check for `useStories`/`useChapters` type imports. 6 files
   (CastTab×3, CharRefSuggestion, CharacterPopover, CharacterPopoverHost).
4. **fetch-mock `.calls` destructuring mismatch (TS2769/TS2345, ~10).** `mock.calls` entries are
   `[string, RequestInit | undefined]`; code destructures as `[string, RequestInit]`. Fix: a typed
   `.filter((call): call is [string, RequestInit] => …)` guard before `.map`, or index access. Used
   by the settings/auth PATCH-body assertion helpers.
5. **Handler/mock signature mismatches (TS2345, ~10).** Keyboard handlers must return
   `boolean | undefined`; soft-delete callbacks are `(id) => Promise<…>`. Fix: type the
   `vi.fn<Sig>()`.

**Fixture conformance (~15):**

6. **Chapter fixtures missing `hasSummary`/`summaryIsStale` (TS2739, 2).** The `Chapter`/`ChapterMeta`
   shape gained these. Fix: add `hasSummary: false, summaryIsStale: false` to the fixture helper
   (defaults verified against the shared type). `ChapterList.dragA11y`, `ChapterReorder`.
7. **Incomplete `Model` fixture (TS2322, ChatComposer:26).** Fixture missing
   `maxCompletionTokens`/`description`/`pricing`/`defaultTemperature`/`defaultTopP`. Fix: complete the
   `makeModel` helper against the shared `Model` type.
8. **Read-only `wordCount` in mutation input (TS2353, 2).** `ChapterUpdateInput` has no `wordCount`
   (backend-derived). Fix: drop it from the mutation `input` (keep it on the response mock).
   `useChapter.test.tsx`.
9. **Duplicate `id` via destructure + spread (TS2783, 2).** Fixture sets `id: over.id` then `...over`.
   Fix: remove the explicit `id:`. `TranscriptView`, `useBannerRetry`.
10. **`.text` on a ProseMirror node union (TS2339, 5).** Fix: add a `typeof n.text === 'string'`
    guard. `CharRefAuthoring`, `CharRefMark`.

**Needs care — match the real contract, do not widen source (~15):**

11. **`useBannerRetry` mock fixtures (TS2322, clusters 11c/13).** `makeFakeMutation()` returns a
    partial that doesn't satisfy `UseMutationResult`; `lastSendArgsRef` shape may not match
    `SendArgs`. Fix: read the real `useBannerRetry`/`useChat` hook signatures and type the fixtures to
    match (e.g. a typed partial cast to the precise param type the hook actually consumes). Do not
    loosen the hook's types.
12. **`apiStream` mock return type (TS2339, 3).** `apiStream` mocked with bare `vi.fn()` → downstream
    `.aborted` access fails. Fix: `vi.fn<typeof apiStream>()` so the mock carries the real signature.
    `useAICompletion`, `useChat`.
13. **Optional-chaining on a closure-assigned resolver (TS2349, 4).** `resolveFetch?.(…)` where the
    setter is always assigned before use. Fix: `if (resolveFetch) resolveFetch(…)` (or `!`).
    `ChapterList`, `CharacterSheet`, `OutlineTab`, `pages/editor`.

If, during implementation, any error turns out to expose a genuine source bug (recon found none),
stop and surface it rather than papering over it in the test.

## Testing / verification

- **Both new gates pass:** `cd backend && npx tsc -p tsconfig.test.json --noEmit` and
  `cd frontend && npx tsc -p tsconfig.test.json --noEmit` exit clean.
- **The full existing suites still pass** (no behavioral change): `npm --prefix backend run test`
  (stack up) and `npm --prefix frontend run test`. Type-only edits must not alter runtime behavior.
- **Regression proof (acceptance #3):** temporarily revert one fixture to a broken shape (e.g.
  `encryption-leak.test.ts`'s `attachmentJson` or a Chapter fixture's missing field), run the gate,
  confirm it now **fails**, then restore. This is a manual confirmation step, not a committed change.
- `npm --prefix frontend run lint:design` unaffected (no component/style changes).

## Verify

`cd backend && npx tsc -p tsconfig.test.json --noEmit && cd ../frontend && npx tsc -p tsconfig.test.json --noEmit && cd .. && npm --prefix frontend run test`

(Backend test *suite* needs the stack up per project memory, but the backend **typecheck** does not.
The verify line above runs both new typecheck gates plus the full frontend suite to prove the
type-only edits didn't change runtime behavior. The full backend suite is covered by `make verify`
with the stack up.)

## Out of scope (YAGNI)

- Any production code under `backend/src` / `frontend/src` (recon found no genuine source bugs).
- `shared/tests` (already in its gate).
- Adding `tsc` to the pre-commit hook (CI is the gate; pre-commit stays biome-only).
- A warnings-baseline / allowlist gate (that's story-editor-cgg; rejected here in favor of fixing all
  errors now).
- Refactoring test helpers beyond what each cluster's fix requires.
