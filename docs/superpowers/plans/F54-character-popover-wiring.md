# F54 — Wire CharacterPopover to charRef hover + Cast tab

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing `<CharacterPopover>` (F37) actually open in the running app from two anchors — a charRef mark hovered in prose (F36) and a Cast-tab card click (F28) — with the F37-spec'd 150 ms anchor-leave / 200 ms popover-leave grace window owned at the wirer.

**Architecture:** Single page-root mount in `EditorPage`. A small grace-timer state machine (`<CharacterPopoverHost>`) owns:
- the active `{ characterId, anchorEl }`
- the *pending-close* timer (cleared if the cursor re-enters either the anchor or the popover before it fires)
- the dispatch from `useCharRefHoverDispatcher` (hover anchor) and from a new `onOpenCharacter` callback wired through `Sidebar → CastTab` (click anchor)

`CharacterPopover` itself is unchanged — F37 already renders, positions, and dismisses on Escape / outside-click. F54 only adds the *wiring layer*: a host component + a route from CastTab clicks + a route from charRef hovers, and routes the **Edit** footer button into the existing F19 `<CharacterSheet>` modal that EditorPage already mounts.

**Tech Stack:** React 19 + TypeScript strict, TanStack Query (`useCharactersQuery`), the existing F36 `useCharRefHoverDispatcher`, the existing F37 `<CharacterPopover>`, the existing F19 `<CharacterSheet>`. Click anchor reuses CastTab's existing `onOpenCharacter(id)` prop — no new CastTab API.

**Prerequisites (incremental order):**
- **F51** ships the AppShell mount with `Sidebar` slotted, so a path exists for CastTab clicks to reach `EditorPage`. F51 wires the cast tab to a no-op for `onOpenCharacter` (since F19 sheet was already mounted on the legacy page); F54 redirects that callback to the popover host.
- **F52** ships the Paper editor swap — meaning `<Paper>` (which uses `formatBarExtensions` including `CharRef`) is the editor in the running page. Without F52, charRef spans don't render in prose and the hover route is unreachable.

**Out of scope:** authoring charRef marks (covered by F62), Consistency-check button (hidden until X8 ships), wiring popover from outside the EditorPage (Dashboard does not show characters).

---

### Task 1: Add `<CharacterPopoverHost>` component

**Files:**
- Create: `frontend/src/components/CharacterPopoverHost.tsx`
- Test: `frontend/tests/components/CharacterPopoverHost.test.tsx`

The host owns the popover's open/close state with a grace-timer state machine. Two enter sources: charRef hover (set via `useCharRefHoverDispatcher`) and Cast-tab click (set via the imperative `openFor` method on a ref). One leave source: the F36 dispatcher passing `null`. Anchor-leave grace = 150 ms; popover-leave grace = 200 ms (timing pinned by F37 author note in `CharacterPopover.tsx` JSDoc).

State machine:
- `idle` → ANY enter → `open({ characterId, anchorEl, source })`
- `open` → enter (different anchor) → `open` (replace immediately, no grace — newer anchor wins)
- `open` → leave from F36 dispatcher (`onHover(null)`) → schedule close after 150 ms (anchor-leave grace)
- `open` → mouse enters popover element → cancel pending close
- `open` → mouse leaves popover element → schedule close after 200 ms (popover-leave grace)
- `open` → re-enter same anchor before the timer fires → cancel pending close
- Click-source enters do NOT auto-close on hover-leave (clicks are sticky — only Escape / outside-click / explicit Edit-click / a different anchor opens close them). This matches F37's design: the popover owns Escape + outside-click; the host adds hover grace only when source is hover.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/tests/components/CharacterPopoverHost.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CharacterPopoverHost } from '@/components/CharacterPopoverHost';
import type { Character } from '@/hooks/useCharacters';

vi.mock('@/hooks/useCharacters', () => ({
  useCharactersQuery: () => ({
    data: [
      { id: 'c1', storyId: 's1', name: 'Alice', role: 'Protagonist', age: '30',
        appearance: 'Tall', voice: 'Calm', arc: 'Grows up',
        sortOrder: 0, createdAt: '', updatedAt: '' } satisfies Character,
    ],
    isLoading: false,
  }),
}));

function withQc(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('CharacterPopoverHost', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('opens popover when openFor is called with a character id', async () => {
    const onEdit = vi.fn();
    const ref: { current: { openFor: (id: string, el: HTMLElement) => void } | null } = {
      current: null,
    };
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    render(withQc(<CharacterPopoverHost storyId="s1" hostRef={ref} onEdit={onEdit} />));

    ref.current!.openFor('c1', anchor);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Character: Alice');
  });

  it('hover-source close fires after 150ms anchor-leave grace, cancelled by re-enter', async () => {
    // (assert the grace timer; see implementation for shape)
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/components/CharacterPopoverHost.test.tsx`
Expected: FAIL — `Cannot find module '@/components/CharacterPopoverHost'`.

- [ ] **Step 3: Write the host implementation**

```tsx
// frontend/src/components/CharacterPopoverHost.tsx
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { JSX, RefObject } from 'react';
import { CharacterPopover } from '@/components/CharacterPopover';
import { useCharactersQuery } from '@/hooks/useCharacters';
import { useCharRefHoverDispatcher } from '@/lib/tiptap-extensions';

const ANCHOR_LEAVE_GRACE_MS = 150;
const POPOVER_LEAVE_GRACE_MS = 200;

type Source = 'hover' | 'click';

interface OpenState {
  characterId: string;
  anchorEl: HTMLElement;
  source: Source;
}

export interface CharacterPopoverHostHandle {
  /** Open the popover anchored to `el`, source=`click`. */
  openFor(characterId: string, el: HTMLElement): void;
}

export interface CharacterPopoverHostProps {
  storyId: string;
  hostRef: RefObject<CharacterPopoverHostHandle | null>;
  /** Called with the character id when **Edit** is clicked. Wire to F19 sheet. */
  onEdit: (id: string) => void;
}

export function CharacterPopoverHost({
  storyId,
  hostRef,
  onEdit,
}: CharacterPopoverHostProps): JSX.Element | null {
  const { data: characters } = useCharactersQuery(storyId);
  const [open, setOpen] = useState<OpenState | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(
    (delayMs: number) => {
      cancelClose();
      closeTimerRef.current = setTimeout(() => {
        setOpen(null);
        closeTimerRef.current = null;
      }, delayMs);
    },
    [cancelClose],
  );

  const closeNow = useCallback(() => {
    cancelClose();
    setOpen(null);
  }, [cancelClose]);

  useImperativeHandle(
    hostRef,
    () => ({
      openFor: (characterId: string, el: HTMLElement) => {
        cancelClose();
        setOpen({ characterId, anchorEl: el, source: 'click' });
      },
    }),
    [cancelClose],
  );

  // Hover anchor: F36 dispatcher pushes events here.
  const onHover = useCallback(
    (event: { characterId: string; anchorEl: HTMLElement } | null) => {
      if (event) {
        cancelClose();
        setOpen({ characterId: event.characterId, anchorEl: event.anchorEl, source: 'hover' });
      } else {
        // Hover-source leaves get the 150 ms grace; click-source ignores hover-leave.
        setOpen((prev) => {
          if (prev && prev.source === 'hover') {
            scheduleClose(ANCHOR_LEAVE_GRACE_MS);
          }
          return prev;
        });
      }
    },
    [cancelClose, scheduleClose],
  );
  useCharRefHoverDispatcher(onHover);

  // Popover-leave grace: bind enter/leave to the rendered popover when it exists.
  useEffect(() => {
    if (!open) return;
    const popoverEl = document.querySelector<HTMLElement>('[data-character-popover-root]');
    if (!popoverEl) return;
    const handlePopoverEnter = (): void => cancelClose();
    const handlePopoverLeave = (): void => {
      if (open.source === 'hover') scheduleClose(POPOVER_LEAVE_GRACE_MS);
    };
    popoverEl.addEventListener('mouseenter', handlePopoverEnter);
    popoverEl.addEventListener('mouseleave', handlePopoverLeave);
    return () => {
      popoverEl.removeEventListener('mouseenter', handlePopoverEnter);
      popoverEl.removeEventListener('mouseleave', handlePopoverLeave);
    };
  }, [open, cancelClose, scheduleClose]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const character = useMemo(() => {
    if (!open || !characters) return null;
    return characters.find((c) => c.id === open.characterId) ?? null;
  }, [open, characters]);

  return (
    <div data-character-popover-root>
      <CharacterPopover
        character={character}
        anchorEl={open ? open.anchorEl : null}
        onClose={closeNow}
        onEdit={(id) => {
          closeNow();
          onEdit(id);
        }}
        consistencyEnabled={false}
      />
    </div>
  );
}
```

> Note: `CharacterPopover` already renders with `position: absolute` and computes coords from `anchorEl.getBoundingClientRect()`. The wrapping `<div data-character-popover-root>` is a stable DOM target the host can read with `document.querySelector` to bind `mouseenter` / `mouseleave` for the popover-leave grace. Layout is unchanged (the wrapper is a static block; the popover itself is absolute-positioned).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/components/CharacterPopoverHost.test.tsx`
Expected: PASS for the first test (`opens popover when openFor is called`). The grace-timer test from Step 1 — fill it in now using `vi.advanceTimersByTime` to assert the 150 ms close fires and is cancelled by a re-enter `onHover` event.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/CharacterPopoverHost.tsx frontend/tests/components/CharacterPopoverHost.test.tsx
git commit -m "[F54] add CharacterPopoverHost grace-timer state machine"
```

---

### Task 2: Mount `<CharacterPopoverHost>` at `EditorPage` page root

**Files:**
- Modify: `frontend/src/pages/EditorPage.tsx`

Mount the host alongside the existing `<CharacterSheet>` modal (the F19 sheet is already mounted at page root — F54 keeps that in place and routes the popover's **Edit** click into it via `setOpenCharacterId`).

- [ ] **Step 1: Add the host ref + element to EditorPage**

Add an import + a ref + mount the host. The exact wire points depend on F51's mount shape (which moves the sidebar tabs into `<Sidebar>`'s body slots) — apply against whichever EditorPage version is current after F51/F52 land. Below shows the relevant additions; do not re-mount the sheet, it already exists.

```tsx
// frontend/src/pages/EditorPage.tsx — additions
import { useRef } from 'react';
import {
  CharacterPopoverHost,
  type CharacterPopoverHostHandle,
} from '@/components/CharacterPopoverHost';

// Inside EditorPage(), near other refs:
const characterPopoverRef = useRef<CharacterPopoverHostHandle | null>(null);

const handleOpenCharacterFromCast = useCallback((id: string, el: HTMLElement) => {
  characterPopoverRef.current?.openFor(id, el);
}, []);

const handleEditCharacter = useCallback((id: string) => {
  setOpenCharacterId(id);
}, []);

// In the JSX, alongside <CharacterSheet ...>:
<CharacterPopoverHost
  storyId={story.id}
  hostRef={characterPopoverRef}
  onEdit={handleEditCharacter}
/>
```

> The sidebar's cast slot already calls `onOpenCharacter(id)` (F51 wired this to the `characterSheet` modal opener). F54 changes that wiring to call `handleOpenCharacterFromCast` instead, passing the `MouseEvent.currentTarget` as the anchor. CastTab itself accepts only `(id) => void`, so the click handler in `CharCard` (CastTab.tsx:88-92) needs to forward the event target. Either (a) widen the prop signature on `CastTab`'s `onOpenCharacter` to `(id: string, el: HTMLElement) => void` *and* keep callers backwards compatible by passing the second arg as optional, or (b) pass the event explicitly. Pick **(a)** — see Task 3.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/EditorPage.tsx
git commit -m "[F54] mount CharacterPopoverHost at editor page root"
```

---

### Task 3: Widen `CastTab.onOpenCharacter` to forward the anchor element

**Files:**
- Modify: `frontend/src/components/CastTab.tsx:20-24,82-83,85-92,116-121,156-167`
- Modify: `frontend/src/components/Sidebar.tsx` (cast tab pass-through, if F51 introduced a wrapper signature)
- Modify: `frontend/src/pages/EditorPage.tsx` (consume the new arg)
- Modify: `frontend/tests/components/CastTab.test.tsx` (existing — bump assertions)

- [ ] **Step 1: Update CastTab prop signature and CharCard click handler**

```tsx
// CastTab.tsx — props
export interface CastTabProps {
  characters: Character[] | undefined;
  onOpenCharacter: (id: string, anchorEl: HTMLElement) => void;
  isLoading?: boolean;
  emptyHint?: string;
}

interface CharCardProps {
  character: Character;
  onOpenCharacter: (id: string, anchorEl: HTMLElement) => void;
}

function CharCard({ character, onOpenCharacter }: CharCardProps): JSX.Element {
  const secondary = characterSecondary(character);
  return (
    <button
      type="button"
      onClick={(e) => {
        onOpenCharacter(character.id, e.currentTarget);
      }}
      // …rest unchanged
```

- [ ] **Step 2: Update Sidebar's cast tab plumbing if F51 abstracted the prop**

If F51 passes `onOpenCharacter` through a `<Sidebar castBody={…}>` slot rather than a prop, no change is needed here — the slot is rendered inside EditorPage and already has the anchor element from the click event. Confirm by reading `frontend/src/components/Sidebar.tsx` after F51 lands; if a typed pass-through prop exists, widen it the same way.

- [ ] **Step 3: Update existing CastTab test**

```tsx
// frontend/tests/components/CastTab.test.tsx — example assertion update
fireEvent.click(button);
expect(onOpenCharacter).toHaveBeenCalledWith('char-1', expect.any(HTMLElement));
```

Run: `cd frontend && npx vitest run tests/components/CastTab.test.tsx`
Expected: PASS.

- [ ] **Step 4: Update EditorPage consumer**

```tsx
// EditorPage.tsx — wire CastTab via Sidebar slot or prop
<CastTab
  characters={characters}
  onOpenCharacter={handleOpenCharacterFromCast}
  isLoading={charactersLoading}
/>
```

- [ ] **Step 5: Run the frontend type-check + suite**

```bash
cd frontend && npm run typecheck && npx vitest run
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/CastTab.tsx frontend/src/components/Sidebar.tsx \
        frontend/src/pages/EditorPage.tsx frontend/tests/components/CastTab.test.tsx
git commit -m "[F54] widen CastTab.onOpenCharacter to forward anchor element"
```

---

### Task 4: Smoke-test both anchors end to end

**Files:**
- Test: `frontend/tests/pages/EditorPage.character-popover.test.tsx`

Single integration test that renders EditorPage with a story whose chapter body contains a `charRef` mark (use the JSON shape produced by `setCharRef`). Asserts:
1. Hovering the rendered `.char-ref` span opens the popover anchored below the span.
2. Clicking a Cast tab card opens the popover anchored to the avatar button.
3. Clicking **Edit** in the popover closes it and opens the F19 character sheet (asserts via the modal title or test-id present in `<CharacterSheet>`).

- [ ] **Step 1: Write the test**

Use the existing test harness for EditorPage (mock `useChapterQuery`, `useCharactersQuery`, `useStoryQuery` via the same `msw` or vitest mocks the surrounding tests use; copy whichever pattern is canonical at the time of execution).

```tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderEditor } from '../helpers/renderEditor'; // existing helper or copy from neighbours

describe('EditorPage character popover', () => {
  it('opens popover from charRef hover and closes after grace', async () => {
    renderEditor({ chapterBodyWithCharRefId: 'c1', characters: [{ id: 'c1', name: 'Alice' }] });
    const span = await screen.findByText((_t, el) => el?.classList.contains('char-ref') ?? false);
    fireEvent.mouseOver(span);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
  });

  it('opens popover from Cast tab card click', async () => {
    renderEditor({ characters: [{ id: 'c1', name: 'Alice' }] });
    fireEvent.click(screen.getByRole('tab', { name: /cast/i }));
    fireEvent.click(screen.getByRole('button', { name: /alice/i }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
  });

  it('Edit button closes popover and opens character sheet', async () => {
    renderEditor({ characters: [{ id: 'c1', name: 'Alice' }] });
    fireEvent.click(screen.getByRole('tab', { name: /cast/i }));
    fireEvent.click(screen.getByRole('button', { name: /alice/i }));
    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('character-sheet')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test**

```bash
cd frontend && npx vitest run tests/pages/EditorPage.character-popover.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/tests/pages/EditorPage.character-popover.test.tsx
git commit -m "[F54] integration test: charRef hover + cast click open popover"
```

---

### Task 5: Verify the F54 task gate

**Files:**
- Modify: `TASKS.md` (tick `[F54]`)

- [ ] **Step 1: Run the F54 verify command**

If the task in `TASKS.md` already has a `verify:` line, run it via `/task-verify F54`. If it does not, add one before ticking — proposed:

```
verify: cd frontend && npm run typecheck && npx vitest run tests/components/CharacterPopoverHost.test.tsx tests/components/CastTab.test.tsx tests/pages/EditorPage.character-popover.test.tsx
```

- [ ] **Step 2: Tick [F54] in TASKS.md (only if verify passes)**

- [ ] **Step 3: Commit**

```bash
git add TASKS.md
git commit -m "[F54] tick — character popover wired"
```

---

## Self-Review Notes

- **Action mapping is locked.** Hover route via `useCharRefHoverDispatcher` (the F36 author's hook); click route via `CastTab.onOpenCharacter` widened to forward the avatar button element. No third anchor.
- **Grace timers pinned.** 150 ms anchor-leave / 200 ms popover-leave per F37 author note. Click source is sticky (Escape / outside-click / Edit / different anchor close it; hover-leave does not).
- **Edit footer routes into the existing F19 sheet** at page root. Consistency check stays hidden (`consistencyEnabled={false}`) — re-enable when X8 ships.
- **No CharacterPopover edits.** The popover handles its own Escape + outside-click; the host adds only hover grace and replaces anchor on a fresh enter. If the popover-leave listener pattern (`document.querySelector('[data-character-popover-root]')`) ever feels fragile, swap the wrapper for a forwarded ref on `CharacterPopover` — but that's a F37 change and out of scope here.
- **Prerequisites pinned**: F51 (Sidebar mounted in AppShell) and F52 (Paper renders prose with `formatBarExtensions`, so charRef spans actually exist in the DOM). F62 authoring is *not* a prerequisite for F54 to be feature-complete — manually-pasted `bodyJson` containing a charRef mark already exercises the hover route, and the Cast click route works regardless.
