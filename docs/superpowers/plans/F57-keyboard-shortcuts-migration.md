# F57 — Migrate scattered keydown listeners to `useKeyboardShortcuts`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every component-owned `document.addEventListener('keydown', …)` / `window.addEventListener('keydown', …)` block into the F47 `useKeyboardShortcuts` registry via `useEscape` / `useAltEnter` (and leave `useModEnter` for ChatComposer's textarea-local case, untouched). Pick priorities so an open modal's Escape closes the modal first, popovers next, and the selection bubble last — preventing the bubble's Escape from racing the modal's.

**Architecture:** F47 already exposes a single document-level keydown listener with an in-memory `Registration[]` sorted by priority desc. Each `useEscape` / `useAltEnter` call adds a registration; the topmost registration whose handler does **not** return `false` short-circuits the chain. F57 replaces each component's hand-rolled listener with the matching hook + a numeric priority drawn from this contract:

| Layer | Priority |
|---|---|
| Modals (StoryPicker / ModelPicker / Settings) | **100** |
| Popover (CharacterPopover) | **50** |
| Inline AI card (InlineAIResult) | **20** |
| Selection bubble | **10** |

`ContinueWriting` listens on `alt+enter` (unique key, priority irrelevant — no other surface registers `alt+enter`).

**Tech Stack:** React 19 + TypeScript strict, existing F47 `useKeyboardShortcuts` / `useEscape` / `useAltEnter` hooks.

**Prerequisites (incremental order):**
- **F47** ships the priority registry (already done — `frontend/src/hooks/useKeyboardShortcuts.ts` exports `useEscape`/`useAltEnter`/`useModEnter`).
- **F51, F52, F53, F54, F55** all ship before F57 — F57 sweeps the post-F55 component tree.

**Out of scope:**
- ChatComposer's `Cmd/Ctrl+Enter` send handler. Per task copy, that one stays a textarea-local listener (it's scoped to the focused textarea, not document-wide).
- Outside-click dismissal in `<CharacterPopover>` (the `mousedown` listener, not the `keydown`). That stays.
- Visual changes — this is purely a listener migration.

---

### Task 1: Inventory existing listeners (one-time audit)

**Files:** read-only.

- [ ] **Step 1: Confirm the inventory before editing**

```bash
cd frontend && grep -rn "addEventListener\(.['\"]keydown['\"]" src/components | grep -v 'tests/'
```

Expected matches (verify exact line numbers at execution time, since other Fs may have moved code):
- `src/components/SelectionBubble.tsx` — Escape handler.
- `src/components/ContinueWriting.tsx` — Alt+Enter handler.
- `src/components/StoryPicker.tsx` — Escape handler.
- `src/components/ModelPicker.tsx` — Escape handler.
- `src/components/Settings.tsx` — Escape handler.
- `src/components/CharacterPopover.tsx` — Escape handler (note: also has a `mousedown` listener for outside-click — leave that one in place).

`InlineAIResult.tsx` does **not** currently have a document-level keydown listener (its dismissal flows through the store via the **Discard** button). F57 *adds* an Escape handler to it (priority 20) so the user can dismiss the card with Escape — that's the spirit of the task copy.

- [ ] **Step 2: Confirm useKeyboardShortcuts already has the priority semantics**

```bash
grep -n "priority" /home/asg/projects/story-editor/frontend/src/hooks/useKeyboardShortcuts.ts
```

Expected: `priority` field on `Registration`, sorted desc, handlers return `boolean | void` (truthy / undefined = "I handled it, stop"; explicit `false` = "let the next handler try"). Confirm the dispatch loop respects this contract before relying on it — if the wire shape is "first match wins regardless of return value", patch the dispatcher first (separate task — call out and stop).

---

### Task 2: Migrate `<StoryPicker>` (priority 100)

**Files:**
- Modify: `frontend/src/components/StoryPicker.tsx`
- Modify: `frontend/tests/components/StoryPicker.test.tsx`

- [ ] **Step 1: Replace the listener block**

```tsx
// StoryPicker.tsx — top of file
import { useEscape } from '@/hooks/useKeyboardShortcuts';

// inside the component (replacing the existing useEffect at ~line 84):
useEscape(
  () => {
    if (!open) return false; // let the next registration try
    onClose();
  },
  { priority: 100, enabled: open },
);
```

Delete the existing `useEffect` that did `window.addEventListener('keydown', handler)`.

- [ ] **Step 2: Run the existing tests**

```bash
cd frontend && npx vitest run tests/components/StoryPicker.test.tsx
```

Expected: PASS — the same Escape behaviour, just routed through F47.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/StoryPicker.tsx
git commit -m "[F57] StoryPicker: useEscape priority 100"
```

---

### Task 3: Migrate `<ModelPicker>` (priority 100)

**Files:**
- Modify: `frontend/src/components/ModelPicker.tsx`
- Modify: `frontend/tests/components/ModelPicker.test.tsx`

- [ ] **Step 1: Replace the listener block** (same shape as Task 2 — replace the `useEffect` at ~line 71 with `useEscape({ priority: 100, enabled: open })`).

- [ ] **Step 2: Run the existing tests**

```bash
cd frontend && npx vitest run tests/components/ModelPicker.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ModelPicker.tsx
git commit -m "[F57] ModelPicker: useEscape priority 100"
```

---

### Task 4: Migrate `<SettingsModal>` (priority 100)

**Files:**
- Modify: `frontend/src/components/Settings.tsx`
- Modify: `frontend/tests/components/Settings.shell-venice.test.tsx`

- [ ] **Step 1: Replace the listener block** (same shape — `useEffect` at ~line 109 → `useEscape({ priority: 100, enabled: open })`).

- [ ] **Step 2: Run the existing test**

```bash
cd frontend && npx vitest run tests/components/Settings.shell-venice.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Settings.tsx
git commit -m "[F57] SettingsModal: useEscape priority 100"
```

---

### Task 5: Migrate `<CharacterPopover>` (priority 50)

**Files:**
- Modify: `frontend/src/components/CharacterPopover.tsx`
- Modify: `frontend/tests/components/CharacterPopover.test.tsx`

- [ ] **Step 1: Replace only the keydown listener**

```tsx
// CharacterPopover.tsx — top of file
import { useEscape } from '@/hooks/useKeyboardShortcuts';

// inside the component, replacing the keydown half of the existing useEffect (~line 113):
useEscape(
  () => {
    if (!character || !anchorEl) return false;
    onClose();
  },
  { priority: 50, enabled: !!character && !!anchorEl },
);
```

The `mousedown` outside-click listener (~line 122) **stays** — F47 only handles keys.

- [ ] **Step 2: Run the existing test**

```bash
cd frontend && npx vitest run tests/components/CharacterPopover.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/CharacterPopover.tsx
git commit -m "[F57] CharacterPopover: useEscape priority 50 (keep mousedown listener)"
```

---

### Task 6: Add Escape dismissal to `<InlineAIResult>` (priority 20)

**Files:**
- Modify: `frontend/src/components/InlineAIResult.tsx`
- Modify: `frontend/tests/components/InlineAIResult.test.tsx`

The component has no keydown listener today. Per task copy, F57 adds one so the inline card can be Escape-dismissed (matching the keyboard contract documented in `CLAUDE.md` — *"`Escape` = dismiss selection bubble / inline AI card / close modal"*).

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/InlineAIResult.test.tsx — new case
it('Escape clears the inline AI result', () => {
  useInlineAIResultStore.setState({
    inlineAIResult: { text: 'sel', status: 'done', output: 'out', action: 'rewrite', actionLabel: 'Rewrite' },
  });
  render(<InlineAIResult editor={null} />);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(useInlineAIResultStore.getState().inlineAIResult).toBeNull();
});
```

Run: `cd frontend && npx vitest run tests/components/InlineAIResult.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Wire `useEscape`**

```tsx
// InlineAIResult.tsx — top
import { useEscape } from '@/hooks/useKeyboardShortcuts';

export function InlineAIResult({ editor, onRetry }: InlineAIResultProps): JSX.Element | null {
  const inlineAIResult = useInlineAIResultStore((s) => s.inlineAIResult);
  const clear = useInlineAIResultStore((s) => s.clear);

  useEscape(
    () => {
      if (!inlineAIResult) return false;
      clear();
    },
    { priority: 20, enabled: !!inlineAIResult },
  );

  if (!inlineAIResult) return null;
  // … rest unchanged
}
```

- [ ] **Step 3: Run the test**

```bash
cd frontend && npx vitest run tests/components/InlineAIResult.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/InlineAIResult.tsx frontend/tests/components/InlineAIResult.test.tsx
git commit -m "[F57] InlineAIResult: add useEscape priority 20"
```

---

### Task 7: Migrate `<SelectionBubble>` (priority 10)

**Files:**
- Modify: `frontend/src/components/SelectionBubble.tsx`
- Modify: `frontend/tests/components/SelectionBubble.test.tsx`

The bubble's existing block (~line 95–99) registers `mouseup` / `keyup` / `scroll` *and* `keydown`. Only the `keydown` listener moves — the rest stay (they recompute the bubble's position, not its dismissal).

- [ ] **Step 1: Replace only the keydown half**

```tsx
// SelectionBubble.tsx
import { useEscape } from '@/hooks/useKeyboardShortcuts';

// In the component:
useEscape(
  () => {
    if (!visible) return false;
    onDismiss?.();
  },
  { priority: 10, enabled: visible },
);
```

Update the existing `useEffect` to drop the `keydown` add/remove pair, leaving the `mouseup` / `keyup` / `scroll` listeners untouched.

- [ ] **Step 2: Run the existing tests**

```bash
cd frontend && npx vitest run tests/components/SelectionBubble.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/SelectionBubble.tsx
git commit -m "[F57] SelectionBubble: useEscape priority 10 (keep position listeners)"
```

---

### Task 8: Migrate `<ContinueWriting>` (alt+enter — no priority conflict)

**Files:**
- Modify: `frontend/src/components/ContinueWriting.tsx`
- Modify: `frontend/tests/components/ContinueWriting.test.tsx`

- [ ] **Step 1: Replace the listener**

```tsx
// ContinueWriting.tsx
import { useAltEnter } from '@/hooks/useKeyboardShortcuts';

// inside the component, replacing the useEffect at ~line 112:
useAltEnter(
  () => {
    if (!visible || !editor || !chapterId || !storyId) return false;
    runContinue(); // the same handler the old listener invoked
  },
  { enabled: visible !== false },
);
```

Keep the editor-focus check the old handler used (`document.activeElement` inside the editor) — port it into the callback body, not the registration condition, so it short-circuits without consuming the event when focus is elsewhere.

- [ ] **Step 2: Run the existing tests**

```bash
cd frontend && npx vitest run tests/components/ContinueWriting.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ContinueWriting.tsx
git commit -m "[F57] ContinueWriting: useAltEnter via F47 registry"
```

---

### Task 9: Cross-cutting test — modal Escape beats popover Escape beats bubble Escape

**Files:**
- Test: `frontend/tests/hooks/useKeyboardShortcuts.priority.test.tsx`

A new integration test that mounts (in one render) a fake **modal-open** scenario, a popover, and an inline result store entry, then dispatches Escape and asserts ONLY the modal closes. Then unmount the modal, dispatch again — the popover closes. Then unmount the popover, dispatch — the inline card clears. Then unmount the card, dispatch — the bubble dismisses.

- [ ] **Step 1: Write the test**

```tsx
// tests/hooks/useKeyboardShortcuts.priority.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useEscape } from '@/hooks/useKeyboardShortcuts';

function Probe({ onClose, label, priority }: { onClose: () => void; label: string; priority: number }) {
  useEscape(onClose, { priority });
  return <div>{label}</div>;
}

describe('useKeyboardShortcuts priority order', () => {
  it('higher priority Escape handler runs first and stops the chain', () => {
    const modalClose = vi.fn();
    const popoverClose = vi.fn();
    const bubbleClose = vi.fn();
    render(
      <>
        <Probe onClose={modalClose} label="modal" priority={100} />
        <Probe onClose={popoverClose} label="popover" priority={50} />
        <Probe onClose={bubbleClose} label="bubble" priority={10} />
      </>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(modalClose).toHaveBeenCalledTimes(1);
    expect(popoverClose).not.toHaveBeenCalled();
    expect(bubbleClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test**

```bash
cd frontend && npx vitest run tests/hooks/useKeyboardShortcuts.priority.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/tests/hooks/useKeyboardShortcuts.priority.test.tsx
git commit -m "[F57] integration: modal>popover>bubble Escape priority order"
```

---

### Task 10: Sweep for stragglers + verify the F57 task gate

**Files:**
- Audit: `grep -rn "addEventListener\(['\"]keydown['\"]" frontend/src/components`
- Modify: `TASKS.md`

- [ ] **Step 1: Run the sweep**

```bash
cd frontend && grep -rn "addEventListener(\\['\\\"]keydown" src/components
```

Expected: empty output. Any remaining match is a missed migration — fix in place.

- [ ] **Step 2: Confirm the verify command from `TASKS.md`**

The task already has:
```
verify: cd frontend && npm run test:frontend -- --run tests/hooks/useKeyboardShortcuts.test.tsx tests/components/SelectionBubble.test.tsx tests/components/InlineAIResult.test.tsx tests/components/StoryPicker.test.tsx tests/components/ModelPicker.test.tsx tests/components/Settings.shell-venice.test.tsx tests/components/CharacterPopover.test.tsx tests/components/ContinueWriting.test.tsx
```

Run via `/task-verify F57` and only tick on exit code 0.

- [ ] **Step 3: Commit the tick**

```bash
git add TASKS.md
git commit -m "[F57] tick — keyboard shortcuts unified under F47 registry"
```

---

## Self-Review Notes

- **Priority numbers are stable contract**: 100 / 50 / 20 / 10. Document them in `useKeyboardShortcuts.ts` JSDoc as part of Task 2 if not already there.
- **`useEscape` registrations are gated by `enabled`** — modals only register while open; the popover only while a character + anchor exist; the inline card only while a result exists; the bubble only while visible. Without this gating, an idle modal would still claim Escape and starve lower layers.
- **Two listener kinds, one component**: `<CharacterPopover>` and `<SelectionBubble>` both keep their non-keydown listeners (mousedown for outside-click; mouseup/keyup/scroll for re-positioning). F57 only owns `keydown`.
- **`<ChatComposer>` is intentionally untouched.** Its `Cmd/Ctrl+Enter` is a textarea-local listener (focus-scoped, not document-scoped). Migrating it would *break* the per-textarea behaviour — a global `useModEnter` would fire whenever the user is typing anywhere in the app.
- **No new InlineAIResult prop** — Escape calls the store's `clear()` directly, mirroring the existing **Discard** button.
