# Finish the act() Warning Sweep (story-editor-10m) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive the frontend test suite's "An update to <Component> inside a test was not wrapped in act(...)" warning count from 50 to 0 without hiding output and without changing any production component.

**Architecture:** The warnings are **not** TanStack Query post-mount settles and **not** a SelectionBubble `useLayoutEffect` problem (the existing issue notes are a misdiagnosis — see "Corrected diagnosis"). They are un-`act()`-wrapped zustand `setState` calls in test teardown/setup that mutate a store while a subscribing component is **still mounted**. Vitest runs `afterEach` hooks in reverse registration order, so a test-file `afterEach` store reset fires *before* `setup.ts`'s global `cleanup()` unmounts the tree — the reset notifies still-mounted subscribers outside an act batch. The fix is to wrap those mutations in `act()`, exactly as `tests/hooks/useAuth.test.tsx:46-60` already does (with an in-code comment explaining the LIFO ordering). This plan introduces a small `actStore()` helper to DRY that wrap and applies it to the test files that were missed.

**Tech Stack:** Vitest 4, @testing-library/react (`act`, `cleanup`), zustand stores, jsdom.

## Corrected diagnosis (load-bearing — verify before trusting the issue notes)

The bd issue's `remaining-scope` notes claim each cluster "needs production-code investigation / component refactor" and that "standard X15 patterns are exhausted / efficacy unproven." That is wrong. Empirically proven during planning (each change reverted, all tests still passed):

| Test file | Component(s) in warning census | Un-acted mutation (warning source) | Wrapping it in `act()` |
|---|---|---|---|
| `tests/components/ThemeApply.test.tsx` | ThemeApply (5) | `afterEach` → `useSessionStore.setState({status:'idle'})` | 5 → 0 |
| `tests/components/InlineAIResult.test.tsx` | InlineAIResult (9) | `afterEach` → `useInlineAIResultStore.setState({inlineAIResult:null})` | 9 → 0 |
| `tests/components/SelectionBubble.test.tsx` | SelectionBubble (12) | `afterEach` → `useSelectionStore.setState({selection:null})` (mid-test mutations are *already* `act`-wrapped) | 12 → 0 |

That is 26 of 50 proven mechanical, including SelectionBubble, which the notes single out as needing an architectural refactor — it does not. The remaining clusters show the identical shape (an `afterEach` reset, sometimes via a helper like `resetTweaks()` / `resetSidebarTab()`).

**The fix pattern already exists in the repo:** `tests/hooks/useAuth.test.tsx` wraps its `afterEach` `useSessionStore.setState(...)` in `act()` and documents the exact LIFO root cause. This plan extends that pattern; it does not invent one.

## Global Constraints

- **No production-code changes.** Only files under `frontend/tests/**` are touched. If a warning genuinely cannot be removed without touching a `frontend/src/**` component, STOP and surface it to the user — do not refactor a component under this plan.
- **Never hide output.** Do not add `silent`, `disableConsoleIntercept`, `onConsoleLog`, or any console suppression to `frontend/vitest.config.ts`. The reporter consistency from PR #148 (`reporters: ['default']`) stays. The warnings must be *removed at the source*, not muted.
- **Wrap only mutations that fire while a component is mounted** — i.e. `afterEach` resets and any post-`render()` mid-test `setState`. A `beforeEach` reset or a `setState` that runs *before* `render()` in a test body is not a warning source; leave it unwrapped (wrapping it is harmless but adds noise — prefer minimal diffs).
- **Scope = the warning census only.** Do not sweep all 54 store-mutating test files; only the files that contribute to the count. The full-suite verify (count == 0) is the backstop.
- **All 1094+ tests must still pass.** `act()` wrapping changes flush timing, not resulting state.
- TypeScript strict; no `any`. Match surrounding test style.

## File Structure

- **Create:** `frontend/tests/utils/actStore.ts` — the `actStore(mutate)` helper (single source of truth for the wrap).
- **Create:** `frontend/tests/utils/actStore.test.tsx` — proves the helper suppresses the act warning a bare `setState` produces.
- **Modify (warning census — wrap the un-acted, still-mounted store mutations):**
  - `frontend/tests/components/ThemeApply.test.tsx`
  - `frontend/tests/components/AccountPrivacyModal-display-name.test.tsx` (DisplayNameSection, 10)
  - `frontend/tests/components/InlineAIResult.test.tsx`
  - `frontend/tests/components/SelectionBubble.test.tsx`
  - `frontend/tests/components/CastTab.delete.test.tsx` (CastTab, 4 — `CastTab.test.tsx`'s `afterEach` has no store mutation)
  - `frontend/tests/components/AppShell.test.tsx` (`resetTweaks()` in two `afterEach` blocks)
  - `frontend/tests/components/Sidebar.test.tsx` (`resetSidebarTab()` in `afterEach`)
  - `frontend/tests/components/ChatComposer.test.tsx` (two `afterEach` resets of `useAttachedSelectionStore`)
  - `frontend/tests/hooks/useAuth.session-reset.test.tsx` (the `TestComponent` straggler — mirror the already-fixed `useAuth.test.tsx`)
  - `frontend/tests/components/messageRow/TranscriptView.test.tsx` (1 straggler — confirm source during impl)

> The census above was built from `grep -oE "An update to [A-Za-z0-9_]+ inside a test"` over a full `--reporter=default` run. The implementer MUST rebuild the per-component breakdown empirically (Task 1 step) rather than trusting this list verbatim — a straggler may live in a file not listed here, and the full-suite count is the only authority.

---

### Task 1: Establish the empirical baseline and create the `actStore` helper

**Files:**
- Create: `frontend/tests/utils/actStore.ts`
- Create: `frontend/tests/utils/actStore.test.tsx`

**Interfaces:**
- Produces: `export function actStore(mutate: () => void): void` — runs `mutate` inside a synchronous `act()`.

- [ ] **Step 1: Capture the current baseline and per-component breakdown**

Run (from `frontend/`):
```bash
npm run test:frontend -- --run --reporter=default > /tmp/act-base.out 2>&1
echo "total: $(grep -c 'not wrapped in act' /tmp/act-base.out)"
grep -oE "An update to [A-Za-z0-9_]+ inside a test" /tmp/act-base.out \
  | sort | uniq -c | sort -rn
```
Expected: total `50`, all tests passing. Record the per-component breakdown — it is the work list and the way to find any straggler not in the File Structure census. (If the baseline differs from 50, note it; the goal is 0 regardless.)

- [ ] **Step 2: Write the failing helper test**

Create `frontend/tests/utils/actStore.test.tsx`. It asserts the helper suppresses the act warning a bare store mutation produces on a mounted subscriber:

```ts
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import { actStore } from './actStore';

const useCountStore = create<{ n: number }>(() => ({ n: 0 }));

function Probe(): React.ReactElement {
  const n = useCountStore((s) => s.n);
  return <span data-testid="n">{n}</span>;
}

describe('actStore', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    useCountStore.setState({ n: 0 });
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    errorSpy.mockRestore();
  });

  it('runs the mutation (state is updated)', () => {
    render(<Probe />);
    actStore(() => useCountStore.setState({ n: 5 }));
    expect(useCountStore.getState().n).toBe(5);
  });

  it('suppresses the "not wrapped in act" warning a bare setState triggers', () => {
    render(<Probe />);

    // Bare mutation outside act → React logs the act warning.
    useCountStore.setState({ n: 1 });
    const bareWarned = errorSpy.mock.calls.some((c) =>
      String(c[0]).includes('not wrapped in act'),
    );
    expect(bareWarned).toBe(true);

    errorSpy.mockClear();

    // Same mutation via actStore → no act warning.
    actStore(() => useCountStore.setState({ n: 2 }));
    const wrappedWarned = errorSpy.mock.calls.some((c) =>
      String(c[0]).includes('not wrapped in act'),
    );
    expect(wrappedWarned).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:frontend -- --run tests/utils/actStore.test.tsx`
Expected: FAIL — `actStore` is not defined / module not found.

- [ ] **Step 4: Implement the helper**

Create `frontend/tests/utils/actStore.ts`:

```ts
import { act } from '@testing-library/react';

/**
 * Wrap a synchronous store mutation (typically a zustand `setState` in a
 * test's `afterEach` reset, or a mid-test mutation after `render()`) in
 * React's `act()`, so the re-render it triggers on still-mounted
 * subscribers is flushed inside an act batch.
 *
 * Why this is needed: Vitest runs `afterEach` hooks in reverse registration
 * order, so a test-file teardown reset fires AFTER the test body but BEFORE
 * `tests/setup.ts`'s global `cleanup()` unmounts the tree. A bare
 * `store.setState(...)` there notifies still-mounted subscribers outside an
 * act batch, producing "An update to <Component> inside a test was not
 * wrapped in act(...)" warnings. See `tests/hooks/useAuth.test.tsx` for the
 * original hand-written instance of this pattern.
 *
 * Use only for mutations that fire while a component is mounted. A reset in
 * `beforeEach` (or before `render()` in a test body) needs no wrap.
 */
export function actStore(mutate: () => void): void {
  act(() => {
    mutate();
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:frontend -- --run tests/utils/actStore.test.tsx`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/tests/utils/actStore.ts frontend/tests/utils/actStore.test.tsx
git commit -m "[story-editor-10m] add actStore() test helper (act-wrap store mutations)"
```

---

### Task 2: Wrap the session-store teardown resets

**Files:**
- Modify: `frontend/tests/components/ThemeApply.test.tsx`
- Modify: `frontend/tests/components/AccountPrivacyModal-display-name.test.tsx`
- Modify: `frontend/tests/components/CastTab.delete.test.tsx`
- Modify: `frontend/tests/hooks/useAuth.session-reset.test.tsx`

**Interfaces:**
- Consumes: `actStore` from `../utils/actStore` (path adjusts per file depth, e.g. `../../utils/actStore` is not needed — all four are one level under `tests/`, so `../utils/actStore`; `useAuth.session-reset.test.tsx` is under `tests/hooks/`, so `../utils/actStore`).

- [ ] **Step 1: Confirm the warnings are present (red)**

Run:
```bash
npm run test:frontend -- --run --reporter=default \
  tests/components/ThemeApply.test.tsx \
  tests/components/AccountPrivacyModal-display-name.test.tsx \
  tests/components/CastTab.delete.test.tsx \
  tests/hooks/useAuth.session-reset.test.tsx \
  2>&1 | grep -c 'not wrapped in act'
```
Expected: a non-zero count.

- [ ] **Step 2: Wrap each `afterEach` store reset that runs while mounted**

In each file, import the helper and wrap the teardown store mutation(s). Example — `ThemeApply.test.tsx`:

```ts
// add to imports:
import { actStore } from '../utils/actStore';

afterEach(() => {
  actStore(() => {
    useSessionStore.setState({ user: null, status: 'idle' });
  });
  delete document.documentElement.dataset.theme;
  document.documentElement.style.removeProperty('--prose-font');
  document.documentElement.style.removeProperty('--prose-size');
  document.documentElement.style.removeProperty('--prose-line-height');
});
```

Apply the same transform to:
- `AccountPrivacyModal-display-name.test.tsx` — `afterEach` `useSessionStore.setState({ user: null, status: 'idle' })`.
- `CastTab.delete.test.tsx` — `afterEach` resets BOTH `useSessionStore` and `useSelectedCharacterStore`; wrap both in a single `actStore(() => { ... })`.
- `useAuth.session-reset.test.tsx` — mirror the existing `useAuth.test.tsx` fix: wrap the `afterEach` `useSessionStore.setState(...)` reset. (`beforeEach` resets and any pre-`render()` mutations stay unwrapped.)

Only wrap mutations that fire while a component is mounted. Do not wrap `beforeEach` resets.

- [ ] **Step 3: Verify isolated count is 0 (green) and tests pass**

Run:
```bash
npm run test:frontend -- --run --reporter=default \
  tests/components/ThemeApply.test.tsx \
  tests/components/AccountPrivacyModal-display-name.test.tsx \
  tests/components/CastTab.delete.test.tsx \
  tests/hooks/useAuth.session-reset.test.tsx \
  > /tmp/t2.out 2>&1
echo "exit=$? act=$(grep -c 'not wrapped in act' /tmp/t2.out)"
grep -E 'Tests +[0-9]+ (passed|failed)' /tmp/t2.out | tail -1
```
Expected: `exit=0`, `act=0`, all tests passed.

- [ ] **Step 4: Commit**

```bash
git add frontend/tests/components/ThemeApply.test.tsx \
  frontend/tests/components/AccountPrivacyModal-display-name.test.tsx \
  frontend/tests/components/CastTab.delete.test.tsx \
  frontend/tests/hooks/useAuth.session-reset.test.tsx
git commit -m "[story-editor-10m] act-wrap session-store teardown resets in tests"
```

---

### Task 3: Wrap the feature-store teardown resets

**Files:**
- Modify: `frontend/tests/components/InlineAIResult.test.tsx`
- Modify: `frontend/tests/components/SelectionBubble.test.tsx`
- Modify: `frontend/tests/components/ChatComposer.test.tsx`
- Modify: `frontend/tests/components/AppShell.test.tsx`
- Modify: `frontend/tests/components/Sidebar.test.tsx`

**Interfaces:**
- Consumes: `actStore` from `../utils/actStore`.

- [ ] **Step 1: Confirm the warnings are present (red)**

Run:
```bash
npm run test:frontend -- --run --reporter=default \
  tests/components/InlineAIResult.test.tsx \
  tests/components/SelectionBubble.test.tsx \
  tests/components/ChatComposer.test.tsx \
  tests/components/AppShell.test.tsx \
  tests/components/Sidebar.test.tsx \
  2>&1 | grep -c 'not wrapped in act'
```
Expected: a non-zero count.

- [ ] **Step 2: Wrap each teardown store reset that runs while mounted**

- `InlineAIResult.test.tsx` — `afterEach` `useInlineAIResultStore.setState({ inlineAIResult: null })`.
- `SelectionBubble.test.tsx` — `afterEach` `useSelectionStore.setState({ selection: null })`. (Mid-test mutations are already `act`-wrapped — leave them; do not double-wrap. Optionally swap their inline `act(() => ...)` for `actStore(() => ...)` for consistency, but that is not required and should be a clean mechanical swap if done.)
- `ChatComposer.test.tsx` — wrap BOTH `afterEach` resets (`useAttachedSelectionStore.setState({ attachedSelection: null })`, in the two `describe` blocks). The mid-test `useAttachedSelectionStore.setState(SAMPLE_ATTACHMENT)` calls run **before** `renderWithQuery(...)`, so they are not warning sources — leave them unwrapped.
- `AppShell.test.tsx` — the warnings come from `resetTweaks()` (`useUiStore.setState({ layout: 'three-col' })`) called in two `afterEach` blocks. Wrap the body of `resetTweaks` once:
  ```ts
  function resetTweaks(): void {
    actStore(() => {
      useUiStore.setState({ layout: 'three-col' });
    });
  }
  ```
  (Wrapping inside the helper fixes both `afterEach` call sites. `renderHook`-based `useFocusToggle` tests use their own `act` already.)
- `Sidebar.test.tsx` — same shape: wrap the body of `resetSidebarTab()` (`useSidebarTabStore.setState({ sidebarTab: 'chapters' })`) with `actStore`.

- [ ] **Step 3: Verify isolated count is 0 (green) and tests pass**

Run:
```bash
npm run test:frontend -- --run --reporter=default \
  tests/components/InlineAIResult.test.tsx \
  tests/components/SelectionBubble.test.tsx \
  tests/components/ChatComposer.test.tsx \
  tests/components/AppShell.test.tsx \
  tests/components/Sidebar.test.tsx \
  > /tmp/t3.out 2>&1
echo "exit=$? act=$(grep -c 'not wrapped in act' /tmp/t3.out)"
grep -E 'Tests +[0-9]+ (passed|failed)' /tmp/t3.out | tail -1
```
Expected: `exit=0`, `act=0`, all tests passed.

- [ ] **Step 4: Commit**

```bash
git add frontend/tests/components/InlineAIResult.test.tsx \
  frontend/tests/components/SelectionBubble.test.tsx \
  frontend/tests/components/ChatComposer.test.tsx \
  frontend/tests/components/AppShell.test.tsx \
  frontend/tests/components/Sidebar.test.tsx
git commit -m "[story-editor-10m] act-wrap feature-store teardown resets in tests"
```

---

### Task 4: Clear residual stragglers and verify the full suite is at zero

**Files:**
- Modify: `frontend/tests/components/messageRow/TranscriptView.test.tsx` (and any other file the full-suite run reveals)

> **Import-path note:** `TranscriptView.test.tsx` lives two levels under `tests/` (`tests/components/messageRow/`), so its import is `import { actStore } from '../../utils/actStore';` — NOT the `../utils/actStore` used by the Task 2/3 files. Any other straggler's import depth must be computed from its own path.

- [ ] **Step 1: Run the full suite and find any residual warnings**

Run (from `frontend/`):
```bash
npm run test:frontend -- --run --reporter=default > /tmp/act-final.out 2>&1
echo "exit=$? total=$(grep -c 'not wrapped in act' /tmp/act-final.out)"
grep -oE "An update to [A-Za-z0-9_]+ inside a test" /tmp/act-final.out \
  | sort | uniq -c | sort -rn
```
Expected after Tasks 2–3: a small residual (e.g. TranscriptView 1). If 0 already, skip to Step 4.

- [ ] **Step 2: Locate and fix each residual**

For each component still reported, find which test file mutates a store while that component is mounted and outside `act()`. Use:
```bash
# narrow to the offending test file by running candidates isolated:
npm run test:frontend -- --run --reporter=default tests/components/messageRow/TranscriptView.test.tsx 2>&1 \
  | grep -c 'not wrapped in act'
```
Then wrap the offending mutation with `actStore` (or, if the residual is a genuine post-`render()` mid-test mutation, wrap that call site). If a residual turns out to require a `frontend/src/**` production change to remove, STOP and surface it to the user per Global Constraints — do not refactor a component here.

- [ ] **Step 3: Re-run the offending file isolated to confirm 0**

Run: `npm run test:frontend -- --run --reporter=default <file> 2>&1 | grep -c 'not wrapped in act'`
Expected: `0`.

- [ ] **Step 4: Full-suite gate — count == 0 and all tests pass**

Run (from `frontend/`):
```bash
npm run test:frontend -- --run --reporter=default > /tmp/act-final.out 2>&1
ec=$?; cnt=$(grep -c 'not wrapped in act' /tmp/act-final.out)
echo "exit=$ec act=$cnt"
grep -E 'Tests +[0-9]+ (passed|failed)' /tmp/act-final.out | tail -1
[ "$ec" = "0" ] && [ "$cnt" = "0" ]
```
Expected: `exit=0`, `act=0`, all tests passed, final `[ ... ]` returns 0.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/tests
git commit -m "[story-editor-10m] clear residual act warnings; full suite at zero"
```

---

## Self-Review checklist (run before handing off)

- [ ] No file under `frontend/src/**` is modified (`git diff --stat origin/main -- frontend/src` is empty).
- [ ] `frontend/vitest.config.ts` is unchanged (no console suppression added).
- [ ] Full-suite act-warning count is 0 and all tests pass (Task 4 Step 4).
- [ ] The `actStore` helper is the single wrap mechanism; no ad-hoc `act(() => store.setState(...))` was newly added outside it (pre-existing inline `act` wraps may remain).

## bd / verify

- bd issue: **story-editor-10m**. Update its notes to record the corrected diagnosis (mechanical act-wrap of un-acted teardown store mutations; not TanStack Query / not a SelectionBubble refactor) and link this plan.
- **verify:** `cd frontend && npm run test:frontend -- --run --reporter=default > /tmp/fe-act.out 2>&1; ec=$?; cnt=$(grep -c 'not wrapped in act' /tmp/fe-act.out); echo "exit=$ec act=$cnt"; [ "$ec" = "0" ] && [ "$cnt" = "0" ]`
  - Frontend vitest is jsdom — no docker stack needed. `--reporter=default` matches the config from PR #148 so the count reflects what CI surfaces.
