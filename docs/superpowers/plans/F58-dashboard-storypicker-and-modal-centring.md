# F58 — DashboardPage StoryPicker rewrite + modal-centring refactor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh `DashboardPage` to render the F30 `<StoryPicker>` content as the primary entry surface (open by default at `/`) instead of the F5 card-grid placeholder. Selecting a story navigates to `/stories/:id`; New story still opens the F6 `<StoryModal>`. Refactor every page-root modal (`<StoryPicker>`, `<ModelPicker>`, `<SettingsModal>`) so the `t-modal-in` keyframe's `translate(-50%, -50%)` centring transform actually fires — replacing the current `grid place-items-center` flow that conflicts with the keyframe.

**Architecture:** Two independent threads in one plan:

1. **Dashboard rewrite** — DashboardPage stops shipping its own card-grid + dashed-border empty state. It renders `<StoryPicker open onClose={…} activeStoryId={null} onSelectStory onCreateStory />` as a non-dismissable surface (Escape no-op when at `/`), so the user lands directly on the story-list mockup. The empty-state copy ("No stories yet") moves into the StoryPicker body — F64's empty-state plan re-targets this shape.
2. **Modal-centring refactor** — Backdrop becomes a plain fade-in fixed-inset layer with no flex/grid centring; the modal card is positioned `fixed top-1/2 left-1/2` and uses the `t-modal-in` keyframe (which animates `transform: translate(-50%, -50%) scale(…)`). The keyframe's translate handles centring; the grid wrapper is removed.

**Tech Stack:** React 19 + TypeScript strict, react-router (`useNavigate`), existing F30 `<StoryPicker>` + F49 `t-backdrop-in` / `t-modal-in` classes from `frontend/src/index.css`.

**Prerequisites (incremental order):**
- **F30** ships `<StoryPicker>` with the `onSelectStory` / `onCreateStory` API.
- **F6** ships `<StoryModal>` for the New Story flow.
- **F49** ships the `t-modal-in` keyframe (already in `index.css:403`).
- **F51, F52, F55** all ship before F58 — F58 uses the post-F55 modal mount points in EditorPage too.

**Out of scope:**
- F64 dashboard empty-state copy (F58 makes the dashboard render `<StoryPicker>`; F64 then re-targets its empty-state hero against this shape).
- Backdrop click-to-dismiss policy changes — same behaviour as today, just without the grid wrapper.
- Animations on close (F49 chose mount-only; closes are unmount, no exit transition).

---

### Task 1: Make `<StoryPicker>` work as a non-dismissable / always-open surface

**Files:**
- Modify: `frontend/src/components/StoryPicker.tsx`
- Modify: `frontend/tests/components/StoryPicker.test.tsx`

`<StoryPicker>` currently treats `open=false` as "do not render" and Escape always calls `onClose`. The dashboard wants the picker as a permanent surface (no backdrop, no Escape close, no Close button). Add an opt-in `embedded?: boolean` prop:

- `embedded={true}` → renders the inner card only (no backdrop, no Close button, no Escape registration). Wraps the card in a sized container so the dashboard layout can centre it.
- `embedded={false}` (default) → today's modal behaviour, refactored per Task 4 to use the `t-modal-in` centring transform.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/StoryPicker.test.tsx — additions
it('embedded mode renders the card without a backdrop or Close button', () => {
  render(
    <QueryClientProvider client={qc}>
      <StoryPicker
        embedded
        open
        onClose={() => {}}
        activeStoryId={null}
        onSelectStory={() => {}}
      />
    </QueryClientProvider>,
  );
  expect(screen.queryByTestId('story-picker-backdrop')).not.toBeInTheDocument();
  expect(screen.queryByTestId('story-picker-close')).not.toBeInTheDocument();
  expect(screen.getByTestId('story-picker')).toBeInTheDocument();
});

it('embedded mode does not register Escape', () => {
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <StoryPicker embedded open onClose={onClose} activeStoryId={null} onSelectStory={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onClose).not.toHaveBeenCalled();
});
```

Run: `cd frontend && npx vitest run tests/components/StoryPicker.test.tsx`
Expected: FAIL — `embedded` prop unknown.

- [ ] **Step 2: Add the `embedded` prop**

```tsx
// StoryPicker.tsx
export interface StoryPickerProps {
  open: boolean;
  onClose: () => void;
  activeStoryId: string | null;
  onSelectStory: (id: string) => void;
  onCreateStory?: () => void;
  onImportDocx?: () => void;
  /** Render the inner card only — no backdrop, no Close button, no Escape. */
  embedded?: boolean;
}

export function StoryPicker({
  open,
  onClose,
  activeStoryId,
  onSelectStory,
  onCreateStory,
  onImportDocx,
  embedded = false,
}: StoryPickerProps): JSX.Element | null {
  // … hooks …

  // Skip Escape registration in embedded mode.
  useEscape(
    () => {
      if (embedded) return false;
      if (!open) return false;
      onClose();
    },
    { priority: 100, enabled: open && !embedded }, // priority comes from F57
  );

  if (!open) return null;

  const card = (
    <div
      role="dialog"
      aria-labelledby={headingId}
      data-testid="story-picker"
      className={[
        'w-[480px] max-w-[94vw] max-h-[82vh] flex flex-col overflow-hidden',
        'rounded-[var(--radius-lg)] border border-line-2 bg-bg-elevated shadow-pop',
        embedded ? '' : 't-modal-in fixed top-1/2 left-1/2', // see Task 4 for the modal centring
      ].join(' ')}
      // aria-modal only when not embedded
      aria-modal={embedded ? undefined : 'true'}
    >
      {/* header — Close button hidden when embedded */}
      <header className="…">
        {/* … */}
        {!embedded && (
          <button ref={closeBtnRef} data-testid="story-picker-close" /* … */ />
        )}
      </header>
      {/* body + footer unchanged */}
    </div>
  );

  if (embedded) return card;

  return (
    <div
      role="presentation"
      data-testid="story-picker-backdrop"
      onMouseDown={handleBackdropMouseDown}
      className="t-backdrop-in fixed inset-0 z-50 bg-[rgba(20,18,12,.4)] backdrop-blur-[3px]"
    >
      {card}
    </div>
  );
}
```

Note: this lays the centring groundwork too — the card uses `fixed top-1/2 left-1/2` so the `t-modal-in` keyframe's `translate(-50%, -50%)` centres it. Task 4 confirms the same shape for ModelPicker and Settings.

- [ ] **Step 3: Run the tests**

```bash
cd frontend && npx vitest run tests/components/StoryPicker.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/StoryPicker.tsx frontend/tests/components/StoryPicker.test.tsx
git commit -m "[F58] StoryPicker: embedded mode + t-modal-in centring transform"
```

---

### Task 2: Refresh `DashboardPage` to render the embedded `<StoryPicker>`

**Files:**
- Modify: `frontend/src/pages/DashboardPage.tsx`
- Modify: `frontend/tests/pages/dashboard.test.tsx` (or wherever the dashboard test lives — confirm at execution time)

- [ ] **Step 1: Write the failing test**

```tsx
// tests/pages/dashboard.test.tsx — replace the F5-card-grid assertions
it('renders an embedded StoryPicker as the primary surface', async () => {
  // mock useStoriesQuery to return [...]
  render(<DashboardPage />, { wrapper: routerAndQueryWrapper });
  expect(await screen.findByTestId('story-picker')).toBeInTheDocument();
  expect(screen.queryByTestId('story-picker-backdrop')).not.toBeInTheDocument();
});

it('clicking a story row navigates to /stories/:id', async () => {
  // mock navigate; click row; assert navigate('/stories/<id>') called once.
});

it('clicking New story opens the F6 StoryModal', async () => {
  // click footer button; assert StoryModal mounted.
});

it('Escape on the dashboard is a no-op (no Close button to call)', () => {
  render(<DashboardPage />, { wrapper: routerAndQueryWrapper });
  fireEvent.keyDown(document, { key: 'Escape' });
  // (no expectation other than "did not throw" — picker remains)
});
```

Run: `cd frontend && npx vitest run tests/pages/dashboard.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Rewrite `DashboardPage`**

```tsx
// frontend/src/pages/DashboardPage.tsx
import type { JSX } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { StoryPicker } from '@/components/StoryPicker';
import { StoryModal } from '@/components/StoryModal';

export function DashboardPage(): JSX.Element {
  const navigate = useNavigate();
  const [storyModalOpen, setStoryModalOpen] = useState(false);

  return (
    <main className="min-h-screen flex items-center justify-center bg-bg p-8">
      <StoryPicker
        embedded
        open
        onClose={() => {}}
        activeStoryId={null}
        onSelectStory={(id) => navigate(`/stories/${id}`)}
        onCreateStory={() => setStoryModalOpen(true)}
      />
      <StoryModal mode="create" open={storyModalOpen} onClose={() => setStoryModalOpen(false)} />
    </main>
  );
}
```

> Removes: `<DarkModeToggle>`, the F5 card grid, the dashed-border empty state, and the standalone "New Story" header button. The picker's footer "New story" button replaces the header CTA. Empty-state copy ("No stories yet") moves into the StoryPicker body — F64 owns its final wording.

- [ ] **Step 3: Run the tests**

```bash
cd frontend && npx vitest run tests/pages/dashboard.test.tsx tests/components/StoryPicker.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/DashboardPage.tsx frontend/tests/pages/dashboard.test.tsx
git commit -m "[F58] DashboardPage renders embedded StoryPicker as primary surface"
```

---

### Task 3: Sweep `StoryCard` / unused imports

**Files:**
- Audit: `grep -rn "StoryCard" frontend/src frontend/tests`
- Audit: `grep -rn "DarkModeToggle" frontend/src frontend/tests`

- [ ] **Step 1: Decide**

If `<StoryCard>` is referenced only by `DashboardPage`, delete the component file + its test. If still used elsewhere (e.g. inside `<StoryPicker>` rows — confirm), leave it. Same for `<DarkModeToggle>` — it likely moves to Settings → Appearance and may already be there post-F46; if so, drop the dashboard reference only.

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "[F58] remove dashboard-only F5 card-grid components"
```

---

### Task 4: Refactor `<ModelPicker>` and `<SettingsModal>` to use `t-modal-in` centring

**Files:**
- Modify: `frontend/src/components/ModelPicker.tsx`
- Modify: `frontend/src/components/Settings.tsx`
- Modify: `frontend/tests/components/ModelPicker.test.tsx`
- Modify: `frontend/tests/components/Settings.shell-venice.test.tsx`

Mirror the StoryPicker pattern from Task 1 — backdrop is a plain fixed-inset fade-in (no `grid place-items-center`); card uses `t-modal-in fixed top-1/2 left-1/2` so the keyframe's `translate(-50%, -50%)` centres it.

- [ ] **Step 1: Update each modal's wrapper**

```tsx
// ModelPicker.tsx — old shape
<div className="t-backdrop-in fixed inset-0 z-50 grid place-items-center bg-[rgba(20,18,12,.4)] backdrop-blur-[3px]">
  <div className="t-modal-in …">…</div>
</div>

// new shape
<div className="t-backdrop-in fixed inset-0 z-50 bg-[rgba(20,18,12,.4)] backdrop-blur-[3px]" data-testid="model-picker-backdrop" onMouseDown={handleBackdropMouseDown}>
  <div role="dialog" className="t-modal-in fixed top-1/2 left-1/2 …" data-testid="model-picker">
    …
  </div>
</div>
```

Repeat the same change in `Settings.tsx`. The `t-modal-in` keyframe's `to:` step has `transform: translate(-50%, -50%) scale(1)` — the keyframe is responsible for centring, no flex/grid wrapper needed.

> Critical: confirm there's no other transform on the card (e.g. `transform: rotate(…)`) that would conflict with the keyframe's `translate`. Tailwind's `transform` utility composes via CSS variables on modern Tailwind — if the card has `transform`-related utilities, audit and remove them.

- [ ] **Step 2: Run the existing modal tests**

```bash
cd frontend && npx vitest run tests/components/ModelPicker.test.tsx tests/components/Settings.shell-venice.test.tsx
```

Expected: PASS — DOM structure changes (no inner grid wrapper) but visible content + behaviour unchanged.

- [ ] **Step 3: Add a snapshot/visual sanity test (optional but recommended)**

If the project has a Playwright suite hitting these modals, run it locally — the centring should look identical to before. If only vitest exists, a small JSDOM assertion that the card has class `t-modal-in` and the backdrop does NOT have `place-items-center` is sufficient.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ModelPicker.tsx frontend/src/components/Settings.tsx \
        frontend/tests/components/ModelPicker.test.tsx frontend/tests/components/Settings.shell-venice.test.tsx
git commit -m "[F58] ModelPicker/Settings: t-modal-in centring transform replaces grid wrapper"
```

---

### Task 5: Verify the F49 entrance animation actually fires

**Files:**
- Test: `frontend/tests/components/modal-entrance.test.tsx` (new)

Today the keyframe is in `index.css` but its `translate(-50%, -50%)` was being overridden by the flex/grid wrapper. After Task 4, the keyframe owns the final transform.

- [ ] **Step 1: Write a JSDOM-friendly assertion**

```tsx
// tests/components/modal-entrance.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StoryPicker } from '@/components/StoryPicker';

describe('Modal entrance — F49 t-modal-in', () => {
  it('StoryPicker card has t-modal-in and the backdrop does not centre via grid', () => {
    render(<StoryPicker open onClose={() => {}} activeStoryId={null} onSelectStory={() => {}} />, {
      wrapper: queryWrapper,
    });
    const card = screen.getByTestId('story-picker');
    const backdrop = screen.getByTestId('story-picker-backdrop');
    expect(card.className).toMatch(/t-modal-in/);
    expect(card.className).toMatch(/fixed top-1\/2 left-1\/2/);
    expect(backdrop.className).not.toMatch(/place-items-center/);
  });
});
```

Mirror for ModelPicker + Settings.

- [ ] **Step 2: Run the test**

```bash
cd frontend && npx vitest run tests/components/modal-entrance.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/tests/components/modal-entrance.test.tsx
git commit -m "[F58] guardrail: assert t-modal-in classes wired on all page-root modals"
```

---

### Task 6: Verify the F58 task gate

**Files:**
- Modify: `TASKS.md`

- [ ] **Step 1: Confirm the verify command**

The task currently has:
```
verify: cd frontend && npm run test:frontend -- --run tests/pages/dashboard.test.tsx tests/components/StoryPicker.test.tsx
```

Extend to also cover ModelPicker / Settings / the new entrance test:
```
verify: cd frontend && npm run test:frontend -- --run tests/pages/dashboard.test.tsx tests/components/StoryPicker.test.tsx tests/components/ModelPicker.test.tsx tests/components/Settings.shell-venice.test.tsx tests/components/modal-entrance.test.tsx
```

- [ ] **Step 2: Run via `/task-verify F58`** and only tick on exit code 0.

- [ ] **Step 3: Commit the tick**

```bash
git add TASKS.md
git commit -m "[F58] tick — dashboard StoryPicker + modal centring refactor"
```

---

## Self-Review Notes

- **Two-thread plan** is intentional — both threads are F49-deferred work (dashboard hero from F5; modal-centring from F49 author note). They share the `t-modal-in` refactor, so doing them together avoids touching the same files twice.
- **`embedded` prop is the cleanest surface** for "render the picker without modal chrome" — no fork in StoryPicker's body, only the backdrop / Close / Escape registration toggle.
- **Backdrop click-to-dismiss** stays on the modal-mode StoryPicker (existing `handleBackdropMouseDown`); embedded mode has no backdrop, so no dismissal path. The dashboard never wants to close the picker — that's the entire surface.
- **`t-modal-in` translate stays exactly as F49 author wrote it** (`translate(-50%, -50%) scale(1)`), with the card positioned `fixed top-1/2 left-1/2`. No keyframe edit; only the wrapper.
- **F64 dashboard empty-state hero** is now downstream of this plan — re-target it against the embedded StoryPicker shape after F58 lands.
- **`<StoryCard>` likely becomes dead code.** The sweep in Task 3 catches it; if the component is imported anywhere outside the dashboard, leave it.
