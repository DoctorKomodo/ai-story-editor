# F64 — Empty Dashboard Hero + Editor Empty-State Hint Strip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace two thin / missing empty states with mockup-fidelity surfaces.

1. **Dashboard zero-stories hero** — when the user has no stories, the embedded `<StoryPicker>` (F58) renders a centred brand-mark + copy ("Your stories live here") + supporting line, while the StoryPicker's own footer "New story" button remains the primary CTA. Today (post-F58) the empty-state body is a single mono "No stories yet" line at `StoryPicker.tsx:154`.
2. **Editor empty-chapter hint strip** — when a chapter's TipTap document is empty, render a single mono row below the prose with three short hints: `select text → bubble · hover names → card · ⌥↵ → continue`. Sourced from `mockups/archive/v1-2025-11/design/editor.jsx:85-108`.

**Architecture:**
- Both surfaces are pure render-time decisions — no new state, no new API calls.
- **Dashboard hero** lives inside `<StoryPicker>`'s body — replaces the existing `count === 0` branch (StoryPicker.tsx:153–154). The hero only renders when `count === 0`. It's identical in modal-mode and embedded-mode StoryPicker (per F58 the embedded variant is the dashboard primary surface).
- **Editor hint strip** lives inside `Paper.tsx` — appears at the bottom of the `.paper-prose` block when `editor.isEmpty === true`. Reads from the live TipTap editor instance via the `onReady` callback already in place.
- Two small presentational components: `<StoryPickerEmpty>` and `<EditorEmptyHints>`. Both pure, no hooks beyond what's needed for the click callback or editor subscription.

**Tech Stack:** React 19 + TypeScript strict. TipTap's `editor.isEmpty` getter for the editor strip. No new deps.

**Prerequisites (incremental order):**
- **F52** mounts `<Paper>` in EditorPage, so the hint strip is visible the moment F64 ships.
- **F58** refactors DashboardPage to render `<StoryPicker embedded>` as the primary entry surface. F64 layers its empty-state hero into StoryPicker's existing `count === 0` branch — both modal-mode (Editor's open-stories button) and embedded-mode (Dashboard) render the same hero.

**Out of scope:** Any change to `<StoryModal>` (F6), the AI hint strip when AI-disabled (separate state, not "empty"), the `<DashboardEmpty>` / dashboard-route fallback that the prior obsolete F64 draft contained — all moot post-F58.

---

### Task 1: Mockup the empty surfaces

**Files:**
- Create: `mockups/archive/v1-2025-11/design/storypicker-empty.jsx`
- Create: `mockups/archive/v1-2025-11/design/editor-empty-hints.jsx`
- Modify: `mockups/archive/v1-2025-11/README.md` (add a row pointing at the two new files)

The mockups are HTML+inline-style React snippets following the convention of every other file under `mockups/archive/v1-2025-11/design/*.jsx`. They're not built — they're the visual spec the React component is recreated against.

- [ ] **Step 1: Storypicker empty hero**

```jsx
// mockups/archive/v1-2025-11/design/storypicker-empty.jsx
export function StoryPickerEmpty() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 14,
      padding: '64px 24px',
      textAlign: 'center',
      minHeight: 280,
    }}>
      <span style={{
        display: 'grid',
        placeItems: 'center',
        width: 56,
        height: 56,
        borderRadius: 8,
        background: 'var(--accent-soft)',
        color: 'var(--ink)',
      }} aria-hidden="true">
        {/* feather mark — same SVG as AuthForm */}
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />
          <line x1="16" y1="8" x2="2" y2="22" />
          <line x1="17.5" y1="15" x2="9" y2="15" />
        </svg>
      </span>
      <h3 style={{ font: '500 20px var(--serif)', color: 'var(--ink)' }}>Your stories live here</h3>
      <p style={{ font: '13px var(--sans)', color: 'var(--ink-4)', maxWidth: 320 }}>
        Start a new project to set the genre, target word count, and writing voice — Inkwell keeps every chapter, character, and chat scoped to it.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Editor hint strip**

```jsx
// mockups/archive/v1-2025-11/design/editor-empty-hints.jsx
export function EditorEmptyHints() {
  return (
    <div style={{
      marginTop: 32,
      padding: '12px 0',
      borderTop: '1px solid var(--line)',
      display: 'flex',
      gap: 18,
      justifyContent: 'center',
      font: '11px var(--mono)',
      color: 'var(--ink-4)',
      letterSpacing: '.04em',
      textTransform: 'uppercase',
    }}>
      <span>select text → bubble</span>
      <span style={{ color: 'var(--ink-5)' }}>·</span>
      <span>hover names → card</span>
      <span style={{ color: 'var(--ink-5)' }}>·</span>
      <span>⌥↵ → continue</span>
    </div>
  );
}
```

- [ ] **Step 3: Commit the mockups**

```bash
git add mockups/archive/v1-2025-11/design/storypicker-empty.jsx \
        mockups/archive/v1-2025-11/design/editor-empty-hints.jsx \
        mockups/archive/v1-2025-11/README.md
git commit -m "[F64] mockups for storypicker empty hero + editor hint strip"
```

---

### Task 2: Implement `<StoryPickerEmpty>` and slot it into `<StoryPicker>`

**Files:**
- Create: `frontend/src/components/StoryPickerEmpty.tsx`
- Modify: `frontend/src/components/StoryPicker.tsx`
- Test: `frontend/tests/components/StoryPickerEmpty.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/StoryPickerEmpty.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StoryPickerEmpty } from '@/components/StoryPickerEmpty';

describe('StoryPickerEmpty', () => {
  it('renders the brand mark, headline, and supporting line', () => {
    render(<StoryPickerEmpty />);
    expect(screen.getByRole('heading', { name: /your stories live here/i })).toBeInTheDocument();
    expect(screen.getByText(/start a new project/i)).toBeInTheDocument();
  });
});
```

Run: `cd frontend && npx vitest run tests/components/StoryPickerEmpty.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Implement the component**

```tsx
// frontend/src/components/StoryPickerEmpty.tsx
import type { JSX } from 'react';

function FeatherMark(): JSX.Element {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />
      <line x1="16" y1="8" x2="2" y2="22" />
      <line x1="17.5" y1="15" x2="9" y2="15" />
    </svg>
  );
}

export function StoryPickerEmpty(): JSX.Element {
  return (
    <div
      data-testid="story-picker-empty"
      className="flex flex-col items-center justify-center gap-3.5 py-16 px-6 text-center min-h-[280px]"
    >
      <span
        aria-hidden="true"
        className="grid place-items-center w-14 h-14 rounded-[var(--radius)] bg-[var(--accent-soft)] text-ink"
      >
        <FeatherMark />
      </span>
      <h3 className="font-serif text-[20px] font-medium text-ink">Your stories live here</h3>
      <p className="font-sans text-[13px] text-ink-4 max-w-[320px]">
        Start a new project to set the genre, target word count, and writing voice — Inkwell keeps every chapter, character, and chat scoped to it.
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Slot into StoryPicker**

Replace the `count === 0` branch (StoryPicker.tsx:153–154) with `<StoryPickerEmpty />`. Imports added at the top.

```tsx
) : count === 0 ? (
  <StoryPickerEmpty />
) : (
  // … rest of the rows
)
```

- [ ] **Step 4: Update StoryPicker test**

```tsx
// tests/components/StoryPicker.test.tsx — addition
it('renders <StoryPickerEmpty> when stories array is empty', async () => {
  // mock useStoriesQuery to return { data: [] }
  render(<StoryPicker open onClose={() => {}} activeStoryId={null} onSelectStory={() => {}} />, {
    wrapper: queryWrapper,
  });
  expect(await screen.findByTestId('story-picker-empty')).toBeInTheDocument();
});
```

- [ ] **Step 5: Run the tests**

```bash
cd frontend && npx vitest run tests/components/StoryPickerEmpty.test.tsx tests/components/StoryPicker.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/StoryPickerEmpty.tsx frontend/src/components/StoryPicker.tsx \
        frontend/tests/components/StoryPickerEmpty.test.tsx frontend/tests/components/StoryPicker.test.tsx
git commit -m "[F64] StoryPickerEmpty hero replaces single-line empty state"
```

---

### Task 3: Implement `<EditorEmptyHints>` and slot it into `<Paper>`

**Files:**
- Create: `frontend/src/components/EditorEmptyHints.tsx`
- Modify: `frontend/src/components/Paper.tsx`
- Test: `frontend/tests/components/EditorEmptyHints.test.tsx`
- Test: `frontend/tests/components/Paper.empty-hints.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/components/EditorEmptyHints.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EditorEmptyHints } from '@/components/EditorEmptyHints';

describe('EditorEmptyHints', () => {
  it('renders three hint segments separated by middle dots', () => {
    render(<EditorEmptyHints />);
    expect(screen.getByText(/select text → bubble/i)).toBeInTheDocument();
    expect(screen.getByText(/hover names → card/i)).toBeInTheDocument();
    expect(screen.getByText(/⌥↵ → continue/i)).toBeInTheDocument();
  });
});
```

```tsx
// tests/components/Paper.empty-hints.test.tsx
it('renders the editor hint strip when the editor is empty', async () => {
  // initialBodyJson = null (or {type:'doc',content:[]}); Paper mounts.
  // Wait for editor.onReady to fire; assert <EditorEmptyHints /> is in the DOM.
});

it('hides the editor hint strip once the editor has content', async () => {
  // initialBodyJson with a paragraph; assert hints not present.
});
```

Run: `cd frontend && npx vitest run tests/components/EditorEmptyHints.test.tsx tests/components/Paper.empty-hints.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Implement `<EditorEmptyHints>`**

```tsx
// frontend/src/components/EditorEmptyHints.tsx
import type { JSX } from 'react';

export function EditorEmptyHints(): JSX.Element {
  return (
    <div
      data-testid="editor-empty-hints"
      className="mt-8 pt-3 border-t border-line flex justify-center gap-[18px] font-mono text-[11px] uppercase tracking-[.04em] text-ink-4"
    >
      <span>select text → bubble</span>
      <span aria-hidden="true" className="text-ink-5">·</span>
      <span>hover names → card</span>
      <span aria-hidden="true" className="text-ink-5">·</span>
      <span>⌥↵ → continue</span>
    </div>
  );
}
```

- [ ] **Step 3: Wire it into Paper**

Inside `Paper.tsx`, capture `editor.isEmpty` reactively. The simplest approach: a small `useState` mirroring `editor.isEmpty`, updated via the existing `onUpdate` ref callback.

```tsx
// Paper.tsx — additions
import { EditorEmptyHints } from '@/components/EditorEmptyHints';

// inside Paper(), near the editor mount:
const [isEmpty, setIsEmpty] = useState<boolean>(true);

const editor = useEditor({
  // … existing config
  onUpdate({ editor }) {
    // existing onUpdate plumbing — also flip isEmpty
    setIsEmpty(editor.isEmpty);
    onUpdateRef.current?.({ /* … */ });
  },
  onCreate({ editor }) {
    setIsEmpty(editor.isEmpty);
  },
});
```

In the JSX, render the hints after the `EditorContent`:

```tsx
<EditorContent editor={editor} className="paper-prose" />
{isEmpty && <EditorEmptyHints />}
```

> Note: `editor.isEmpty` is a TipTap-supplied getter (`@tiptap/core` `Editor.prototype.isEmpty`). Mirror it via local state so React re-renders when the document toggles between empty and non-empty.

- [ ] **Step 4: Run the tests**

```bash
cd frontend && npx vitest run tests/components/EditorEmptyHints.test.tsx tests/components/Paper.empty-hints.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/EditorEmptyHints.tsx frontend/src/components/Paper.tsx \
        frontend/tests/components/EditorEmptyHints.test.tsx frontend/tests/components/Paper.empty-hints.test.tsx
git commit -m "[F64] EditorEmptyHints strip renders below empty Paper"
```

---

### Task 4: Verify the F64 task gate

**Files:**
- Modify: `TASKS.md`

- [ ] **Step 1: Confirm/add the verify command**

```
verify: cd frontend && npm run typecheck && npx vitest run tests/components/StoryPickerEmpty.test.tsx tests/components/StoryPicker.test.tsx tests/components/EditorEmptyHints.test.tsx tests/components/Paper.empty-hints.test.tsx
```

- [ ] **Step 2: Run via `/task-verify F64`** and only tick on exit code 0.

- [ ] **Step 3: Commit the tick**

```bash
git add TASKS.md
git commit -m "[F64] tick — empty-state hero + editor hint strip"
```

---

## Self-Review Notes

- **Re-targeted against post-F58 shape.** The dashboard hero lives inside StoryPicker's `count === 0` branch — so it appears in both the modal-mode picker (when a user with stories opens it via the editor) and the embedded-mode picker (the dashboard primary surface). One implementation, two surfaces.
- **No `<DashboardEmpty>` component**, no separate `DashboardPage` empty branch — F58 deleted those concepts. F64 layers onto StoryPicker only.
- **Hint strip lives in Paper, not EditorPage.** Paper already owns the editor instance and the prose surface; EditorPage just feeds props in. Putting the strip in Paper keeps the empty/non-empty toggle scoped to the editor boundary.
- **`editor.isEmpty` is TipTap's reactive boundary.** Mirroring it via local state is the canonical pattern (`onUpdate` + `onCreate`), since TipTap doesn't push isEmpty changes through React props otherwise.
- **No keyboard shortcut, no hover affordance** — the hint strip is purely informational. F47 keyboard shortcuts already wire `⌥↵` to ContinueWriting (mentioned in the strip); the strip just surfaces the existing contract.
- **Brand mark inlined** — same pattern as `StoryPicker`'s own initial-tile (no shared `<BrandMark>` component yet); the F58 modal-centring refactor has no impact here.
