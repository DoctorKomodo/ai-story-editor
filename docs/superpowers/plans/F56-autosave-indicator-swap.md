# F56 — Replace inline SaveIndicator with F48 `<AutosaveIndicator>`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline `SaveIndicator` placeholder inside `TopBar.tsx` (currently rendered at TopBar.tsx:238) with the dedicated F48 `<AutosaveIndicator>` component, threading the full `useAutosave` triple (`status`, `savedAt`, `retryAt`) so the "Save failed — retrying in Ns" state and live relative-time updates actually render.

**Architecture:** A mostly-mechanical swap. `TopBar`'s API changes from `{ saveState, savedAtRelative }` (placeholder pair) to `{ autosave: { status, savedAt, retryAt } }` (the F48 triple, which is what `useAutosave` already returns). EditorPage passes `useAutosave` output directly. The internal `SaveIndicator` function and `SaveState` type are deleted from TopBar.tsx; the new `<AutosaveIndicator>` from `frontend/src/components/AutosaveIndicator.tsx` is rendered in the same slot. Chapter saves continue to use the F52 mutation (`useUpdateChapterMutation`) — this plan does not touch the save pipeline, only the indicator.

**Tech Stack:** React 19 + TypeScript strict, existing `useAutosave` hook, existing `<AutosaveIndicator>` component.

**Prerequisites (incremental order):**
- **F48** ships `<AutosaveIndicator>` (already done — `frontend/src/components/AutosaveIndicator.tsx` exists).
- **F51** ships TopBar mounted in AppShell with the placeholder `SaveIndicator` + `saveState`/`savedAtRelative` props.
- **F52** routes chapter saves through `useUpdateChapterMutation` so `useAutosave`'s `save` callback hits the real PATCH endpoint with `bodyJson` (TipTap JSON).

**Out of scope:** Changing the autosave debounce (already 4 s per F48), moving the indicator out of TopBar (it stays in the right meta group exactly where the placeholder lives now), localising the relative-time formatter (F48 already owns it).

---

### Task 1: Update `TopBarProps` to take the autosave triple

**Files:**
- Modify: `frontend/src/components/TopBar.tsx`
- Modify: `frontend/tests/components/TopBar.test.tsx`

- [ ] **Step 1: Replace the placeholder props with the F48 triple**

```tsx
// TopBar.tsx — props
import { AutosaveIndicator, type AutosaveIndicatorProps } from '@/components/AutosaveIndicator';

export interface TopBarProps {
  // … existing fields except saveState / savedAtRelative
  autosave: {
    status: AutosaveIndicatorProps['status'];
    savedAt: AutosaveIndicatorProps['savedAt'];
    retryAt: AutosaveIndicatorProps['retryAt'];
  };
  // … rest unchanged
}
```

Then in the component body, replace the inline `<SaveIndicator state={saveState} relative={savedAtRelative} />` (TopBar.tsx:238) with:

```tsx
<AutosaveIndicator
  status={autosave.status}
  savedAt={autosave.savedAt}
  retryAt={autosave.retryAt}
/>
```

Delete:
- The local `SaveIndicator` function (TopBar.tsx:129–158).
- The `SaveState` type alias (find via `grep -n 'SaveState' frontend/src/components/TopBar.tsx`).
- Imports that are now unused (typically `ReactNode`, the local `Dot`/SVG used by the placeholder if any).
- `saveState` and `savedAtRelative` from the props destructuring + interface.

- [ ] **Step 2: Update the existing TopBar test**

```tsx
// tests/components/TopBar.test.tsx
render(
  <TopBar
    {/* existing required props */}
    autosave={{ status: 'saved', savedAt: Date.now() - 12_000, retryAt: null }}
  />,
);
expect(screen.getByText(/Saved · 12s ago/i)).toBeInTheDocument();
```

Add coverage for the failure state (`status: 'error', retryAt: Date.now() + 5_000`) — assert "Save failed — retrying in 5s" is rendered. The F48 component already has its own unit tests; here we just confirm the indicator is mounted with the correct props.

- [ ] **Step 3: Run the TopBar tests**

```bash
cd frontend && npx vitest run tests/components/TopBar.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/TopBar.tsx frontend/tests/components/TopBar.test.tsx
git commit -m "[F56] swap inline SaveIndicator for F48 AutosaveIndicator in TopBar"
```

---

### Task 2: Pass the autosave triple from EditorPage

**Files:**
- Modify: `frontend/src/pages/EditorPage.tsx`

The autosave hook is already invoked in EditorPage (post-F52). After F52, the call shape is `useAutosave({ payload: editorJson, save: (json) => updateChapter.mutateAsync({ id, bodyJson: json }) })`. F56 only needs to pass its full result into `<TopBar autosave={…}>`.

- [ ] **Step 1: Wire the prop**

```tsx
// EditorPage.tsx — replace the existing TopBar call
const autosave = useAutosave({
  payload: editorJson,
  save: async (json) => {
    if (!activeChapterId) return;
    await updateChapter.mutateAsync({ id: activeChapterId, bodyJson: json });
  },
});

// in the AppShell's topbar prop:
<TopBar
  // … existing props (storyTitle, chapterNumber, …)
  autosave={autosave}
/>
```

Delete the legacy `saveState` / `savedAtRelative` derivations EditorPage was computing for the placeholder (search for `savedAtRelative` and `formatRelative` left over from F51).

- [ ] **Step 2: Run typecheck + frontend tests**

```bash
cd frontend && npm run typecheck && npx vitest run
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/EditorPage.tsx
git commit -m "[F56] thread useAutosave triple into TopBar"
```

---

### Task 3: Sweep for stale `SaveState` / `SaveIndicator` references

**Files:**
- Audit: `grep -rn 'SaveState\|saveState\|savedAtRelative\|SaveIndicator' frontend/src` (must return zero hits outside `AutosaveIndicator.tsx`).

- [ ] **Step 1: Run the sweep**

```bash
cd frontend && grep -rn 'SaveState\|saveState\|savedAtRelative\|SaveIndicator' src tests \
  | grep -v 'AutosaveIndicator'
```

Expected: empty output (zero matches).

- [ ] **Step 2: If matches remain, fix in place**

Each match is a stale reference to the legacy two-arg API. Replace with the F48 triple shape. Re-run the sweep.

- [ ] **Step 3: Commit (if any sweep changes)**

```bash
git add -A
git commit -m "[F56] remove legacy SaveState references"
```

---

### Task 4: Verify the F56 task gate

**Files:**
- Modify: `TASKS.md`

- [ ] **Step 1: Confirm/add the verify command**

```
verify: cd frontend && npm run typecheck && npx vitest run tests/components/TopBar.test.tsx tests/components/AutosaveIndicator.test.tsx tests/hooks/useAutosave.test.ts
```

- [ ] **Step 2: Run via `/task-verify F56`** and only tick on exit code 0.

- [ ] **Step 3: Commit the tick**

```bash
git add TASKS.md
git commit -m "[F56] tick — F48 AutosaveIndicator wired into TopBar"
```

---

## Self-Review Notes

- **Pure swap, no semantics change**: F48 component already exists, F9 hook already exists, F52 routes saves through the real PATCH. F56 is the wire-up.
- **Triple shape (`status` / `savedAt` / `retryAt`)** is exactly what `useAutosave` returns — no transformation needed at the EditorPage callsite.
- **The "saving" → "saved" → idle flow is unchanged**; F48 component is the source of truth for the rendered text. The sweep ensures no stale "Saved · 12s ago" string lives in the placeholder anymore.
- **No test of the indicator behaviour itself** is added here — that's `tests/components/AutosaveIndicator.test.tsx` from F48. F56 tests assert mounting + prop forwarding only.
