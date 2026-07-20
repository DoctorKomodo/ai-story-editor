# Settings Uniform Tab Height Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the Settings modal resizing vertically when switching tabs — fix the modal to a single height (`82vh`, what the tallest tab, Prompts, already occupies) so every tab renders in the same-size window.

**Architecture:** The `Modal` primitive hardcodes its card classes and takes no `className`, so callers can't adjust sizing without forking. Add an optional `className` passthrough (cx-merged last). The Settings modal then passes `h-[82vh]`: the card already has `max-h-[82vh]` + an `overflow-hidden` shell + a `flex-1 overflow-y-auto` body, so a fixed height makes tall tabs scroll (Prompts already does) and short tabs show trailing space — no more jump. While in `Settings.tsx`, replace the 6-way `activeTab === … ? … :` tab-render ternary with a `Record<SettingsTab, ComponentType>` lookup map.

**Tech Stack:** React 19 + TypeScript (strict), TailwindCSS v4 (design tokens), Vitest + Testing Library (jsdom).

## Global Constraints

- **Frontend only.** No backend, no new dependency, no schema change.
- **No `any` types** — TypeScript strict is on.
- **Design tokens only** in `frontend/src/` (`h-[82vh]` / `max-h-[82vh]` are the existing viewport tokens; no raw colors). The `lint:design` guard rejects raw colors.
- **`Modal` primitive stays backward-compatible:** the new `className` prop is optional and defaults to `undefined`; every existing `Modal` caller (StoryPicker, ConfirmDialog, StoryModal, CharacterSheet, AccountPrivacyModal, ChapterSummarySheet, NewDraftDialog, …) must render byte-identically. `className` is cx-merged **after** the built-in classes so it can extend but the defaults still apply.
- **Behavior-preserving refactor:** the tab-render lookup map must render exactly the same component per tab as the current ternary; no tab added, removed, reordered, or relabelled.
- **Out of scope (filed separately):** migrating the hand-rolled Settings-tab inputs/buttons (Venice/Writing/Appearance/Backup) to the `Input`/`Field`/`Button` primitives — that's a whole-surface migration, its own bd issue.
- **Commit prefix:** `[<BD_ID>]`. Commit after each passing task.
- **Test DB / stack:** not required — every test here is frontend jsdom (Vitest).

---

## File Structure

- `frontend/src/design/primitives.tsx` — **modify.** `Modal` gains an optional `className?: string` prop, cx-merged after the built-in card classes (`~:96-146`).
- `frontend/src/components/Settings.tsx` — **modify.** Pass `className="h-[82vh]"` to `<Modal>` (`~:112-119`); replace the tab-render ternary (`:167-179`) with a `Record<SettingsTab, () => JSX.Element>` lookup map declared at module scope.
- `frontend/tests/design/Modal.className.test.tsx` — **create.** Assert the `className` passthrough merges onto the card and that omitting it leaves the built-in classes intact (mirrors the render pattern in `frontend/tests/design/ModalCentering.test.tsx`).
- `frontend/tests/components/Settings.shell-venice.test.tsx` — **modify.** Add one test asserting the `settings-modal` card carries `h-[82vh]`. Extend the existing harness (`renderModal`, `vi.stubGlobal('fetch', …)`, `defaultSettings`, `keyStatus`); the existing "renders six tabs in order" (`:141`) and "clicking Models flips active state" (`:164`) tests already guard the tab-map refactor.

### Existing-surface inventory (grep-backed)

- **`Modal` primitive** — `frontend/src/design/primitives.tsx:96`. Card className is `cx(SIZE_CLASS[size], 'max-w-[94vw] max-h-[82vh] flex flex-col overflow-hidden', 'rounded-…', embedded ? '' : 't-modal-in')` at `:137-142`. It does **not** currently accept `className`. `cx` is the project class-merge util already imported in the file.
- **`Modal` callers** (must stay identical): `grep -rl '<Modal\b' frontend/src` → Settings, StoryModal, CharacterSheet, ConfirmDialog, AccountPrivacyModal, ChapterSummarySheet, NewDraftDialog, StoryPicker/StoryBrowser. All pass only existing props; none pass `className` today, so an optional addition is inert for them.
- **Modal card testid** — `data-testid="settings-modal"` (`Settings.tsx:117`); the shell test already renders the modal via `renderModal` and asserts on `settings-*` testids.
- **Tab render** — the `activeTab === 'venice' ? <VeniceTab/> : … : <SettingsDataTab/>` chain at `Settings.tsx:167-179`. Tab ids come from the `TABS` array (`:48-55`) and the `SettingsTab` union (`@/types/settings`). Components in scope: `VeniceTab` (local), `SettingsModelsTab`, `SettingsPromptsTab`, `SettingsWritingTab`, `SettingsAppearanceTab`, `SettingsDataTab`.
- **No `Modal`-primitive className test exists** — `frontend/tests/design/` has `ModalCentering.test.tsx` (centring only), `Checkbox`, `Radio`, `ConfirmDialog`; none covers a `className` passthrough. New focused file is correct (not a duplicate).

Task order: **Task 1** (primitive passthrough) → **Task 2** (Settings consumes it + tab-map; depends on Task 1).

---

### Task 1: `Modal` primitive — optional `className` passthrough

**Files:**
- Modify: `frontend/src/design/primitives.tsx` — `ModalProps` interface + `Modal` signature + the card `cx(...)` call.
- Test: `frontend/tests/design/Modal.className.test.tsx` (create).

**Interfaces:**
- Produces: `ModalProps` gains `className?: string`. When provided, it is appended as the **last** argument to the card's `cx(...)` so it extends (and can override on conflict) the built-in classes. When omitted, the card className is unchanged from today.
- Consumes: nothing new (`cx` already imported).

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/design/Modal.className.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Modal, ModalBody, ModalHeader } from '@/design/primitives';

// NOTE: assert on whitespace-split TOKENS, never substring — `max-h-[82vh]`
// CONTAINS the substring `h-[82vh]`, so `.toContain('h-[82vh]')` would
// false-match the built-in cap and prove nothing. Token membership
// distinguishes the `h-[82vh]` class from `max-h-[82vh]`.
describe('Modal className passthrough', () => {
  it('merges a caller className onto the card without dropping the built-ins', () => {
    render(
      <Modal open onClose={() => {}} labelledBy="t" testId="probe" className="h-[82vh]">
        <ModalHeader titleId="t" title="probe" />
        <ModalBody>body</ModalBody>
      </Modal>,
    );
    const tokens = screen.getByTestId('probe').className.split(/\s+/);
    expect(tokens).toContain('h-[82vh]'); // caller class present as its own token
    expect(tokens).toContain('max-h-[82vh]'); // built-in cap retained
    expect(tokens).toContain('flex'); // built-in retained
  });

  it('omitting className leaves the built-in card classes intact and adds no fixed height', () => {
    render(
      <Modal open onClose={() => {}} labelledBy="t" testId="probe2">
        <ModalHeader titleId="t" title="probe" />
        <ModalBody>body</ModalBody>
      </Modal>,
    );
    const tokens = screen.getByTestId('probe2').className.split(/\s+/);
    expect(tokens).toContain('max-h-[82vh]'); // built-in cap still there
    expect(tokens).not.toContain('h-[82vh]'); // no fixed-height token leaked in
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix frontend run test -- Modal.className`
Expected: the first test FAILS on `expect(tokens).toContain('h-[82vh]')` — `Modal` ignores the `className` prop today, so no `h-[82vh]` token reaches the card. (This assertion failure is the RED signal. Do **not** rely on a type error for RED — vitest transpiles via esbuild/swc and strips types without type-checking, so an excess-prop type error would NOT fail the run. The second test passes already, which is fine — it's the omit-case guard.)

- [ ] **Step 3: Add the `className` prop and merge it**

In `frontend/src/design/primitives.tsx`, add to `ModalProps` (find the interface just above `export function Modal`):

```tsx
  /** Extra classes merged onto the card (after the built-ins). E.g. a fixed height. */
  className?: string;
```

Add `className` to the destructure in the `Modal` signature (alongside `children`):

```tsx
  testId,
  backdropTestId,
  className,
  children,
```

Append it as the final `cx(...)` argument on the card:

```tsx
      className={cx(
        SIZE_CLASS[size],
        'max-w-[94vw] max-h-[82vh] flex flex-col overflow-hidden',
        'rounded-[var(--radius-lg)] border border-line-2 bg-bg-elevated shadow-pop',
        embedded ? '' : 't-modal-in',
        className,
      )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --prefix frontend run test -- Modal.className`
Expected: PASS (both cases).

- [ ] **Step 5: Typecheck**

Run: `npm --prefix frontend run typecheck`
Expected: no errors (confirms the optional prop typechecks and no caller broke).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/design/primitives.tsx frontend/tests/design/Modal.className.test.tsx
git commit -m "[<BD_ID>] Modal: optional className passthrough on the card"
```

---

### Task 2: `SettingsModal` — fixed 82vh height + tab-render lookup map

**Files:**
- Modify: `frontend/src/components/Settings.tsx` — `<Modal>` gets `className="h-[82vh]"`; tab-render ternary → `Record<SettingsTab, () => JSX.Element>` map.
- Test: `frontend/tests/components/Settings.shell-venice.test.tsx` — add the height assertion.

**Interfaces:**
- Consumes: `Modal`'s new `className` prop (Task 1).
- Produces: no new exports. The `settings-modal` card now carries `h-[82vh]`. Tab rendering is table-driven but visually/behaviorally identical.

- [ ] **Step 1: Write the failing test**

In `frontend/tests/components/Settings.shell-venice.test.tsx`, add this test inside the top-level `describe` block, using the file's `routeFetch` harness exactly as the "renders dialog with title…" test (`~:123`) does. Assert on whitespace-split **tokens**, not substring — `max-h-[82vh]` contains the substring `h-[82vh]`, so `.toContain('h-[82vh]')` would false-pass on the built-in cap and never go RED:

```tsx
  it('pins the modal to a fixed 82vh height so tabs do not resize the window', () => {
    vi.stubGlobal(
      'fetch',
      routeFetch({
        '/api/users/me/settings': () => jsonResponse(200, defaultSettings()),
        '/api/users/me/venice-key': () => jsonResponse(200, keyStatus()),
      }),
    );
    renderModal(<SettingsModal open onClose={onClose} />);
    const tokens = screen.getByTestId('settings-modal').className.split(/\s+/);
    expect(tokens).toContain('h-[82vh]');
  });
```

(`keyStatus()` defaults to `hasKey: false`, so the venice-account query never fires and the modal mounts cleanly with just these two routes. Match the file's helper names exactly — do not invent new ones.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix frontend run test -- Settings.shell-venice`
Expected: the new test FAILS — the card has no `h-[82vh]` yet.

- [ ] **Step 3: Pass the fixed height to the Modal**

In `frontend/src/components/Settings.tsx`, add `className="h-[82vh]"` to the `<Modal>` (alongside `size="xl"`):

```tsx
    <Modal
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      size="xl"
      className="h-[82vh]"
      testId="settings-modal"
      backdropTestId="settings-backdrop"
    >
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --prefix frontend run test -- Settings.shell-venice`
Expected: PASS (the new height test + all existing shell/venice tests).

- [ ] **Step 5: Replace the tab-render ternary with a lookup map**

Declare a **module-scope** map. `VeniceTab` is a hoisted `function` declaration, so a module-scope `const` map can reference it even though it appears lower in the file — verified: this pattern passes `biome check` (no use-before-define) and evaluates fine at module load. Place the map below the `TABS` array (after the icon components):

```tsx
const TAB_PANELS: Record<SettingsTab, () => JSX.Element> = {
  venice: VeniceTab,
  models: SettingsModelsTab,
  prompts: SettingsPromptsTab,
  writing: SettingsWritingTab,
  appearance: SettingsAppearanceTab,
  data: SettingsDataTab,
};
```

Then, inside `SettingsModal`, bind the active panel just before `return (`:

```tsx
  const ActivePanel = TAB_PANELS[activeTab];
```

and replace the ternary chain in `<ModalBody>` (current `:167-179`):

```tsx
        {activeTab === 'venice' ? (
          <VeniceTab />
        ) : activeTab === 'models' ? (
          <SettingsModelsTab />
        ) : activeTab === 'prompts' ? (
          <SettingsPromptsTab />
        ) : activeTab === 'writing' ? (
          <SettingsWritingTab />
        ) : activeTab === 'appearance' ? (
          <SettingsAppearanceTab />
        ) : (
          <SettingsDataTab />
        )}
```

with:

```tsx
        <ActivePanel />
```

(Do not convert `VeniceTab` from a `function` declaration to a `const` — the hoisting is what makes the module-scope map valid, and changing it is out of scope. `() => JSX.Element` is the correct value type today since every panel is zero-arg; `ComponentType` would be more future-proof but isn't needed.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm --prefix frontend run test -- Settings.shell-venice`
Expected: PASS. The "renders six tabs in order with Venice active by default" (`:141`) and "clicking Models flips active state and hides Venice panel" (`:164`) tests guard that the map renders the same panels the ternary did.

- [ ] **Step 7: Typecheck + design-lint**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend run lint:design`
Expected: no errors; no token drift.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/Settings.tsx frontend/tests/components/Settings.shell-venice.test.tsx
git commit -m "[<BD_ID>] SettingsModal: fixed 82vh height + tab-render lookup map"
```

---

## Final Verification

- [ ] **Full verify:**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend run test -- Modal.className Settings && make lint`
Expected: typecheck clean; the new Modal + all Settings suites green; Biome + design-lint clean.

---

## Self-Review Notes (design → task coverage)

- Fixed 82vh height so tabs share one size → Task 2 Step 3 + height test. Uses the existing `82vh` token; `h-[82vh]` never exceeds the built-in `max-h-[82vh]`, so no viewport overflow.
- `Modal` reusable enabler (className passthrough, other callers inert) → Task 1 + its two tests (present-when-passed, unchanged-when-omitted).
- Tab-render simplification (ternary → map, behavior-preserving) → Task 2 Step 5, guarded by the existing six-tabs + tab-switch tests.
- Follow-up: full Settings-tab primitive migration is filed as a separate bd issue, not in this plan.
