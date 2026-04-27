# [F62] CharRef Mark Authoring (`@`-trigger autocomplete) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give authors a way to attach the `charRef` mark (already shipped in `[F36]`) to text in the chapter editor. Typing `@` in the editor opens an inline menu listing the active story's characters; arrow keys navigate, Enter (or click) inserts the character's name as a `charRef`-marked span. Once a mark exists, the existing F37 hover popover starts firing.

**Prerequisites (incremental order):**
- `[F52]` has shipped → `Paper.tsx` is mounted in `EditorPage`, so the new extension is reachable in the running app (not just in unit tests).
- `[F54]` has shipped → `<CharacterPopover>` is wired to `useCharRefHoverDispatcher`, so a hover on the inserted mark actually opens the popover.
- `[F62]` itself only adds the authoring affordance; the mark, popover, and hover dispatcher are all already in place.

**Architecture:**
- New TipTap extension `CharRefSuggestion` built on **`@tiptap/suggestion`** (a small official utility — needs adding to `package.json`). The plugin handles the `@`-trigger detection, query string extraction, ↑↓⏎ key dispatch, and exposes a `command()` callback that we use to insert the marked text.
- Headless rendering: the plugin's `render` callbacks write the open/close/move/items state into a new Zustand store (`useCharRefSuggestionStore`). A new `<CharRefMenu>` component subscribes to the store and draws the popup. This keeps the extension list module-level (so `useEditor`'s extension memo stays stable when stories change) while letting React own the actual UI.
- Character list provision: the extension's `items({ query })` callback reads from a module-level provider ref (same pattern as `useCharRefHoverDispatcher` in `tiptap-extensions.ts`). A new hook `useCharRefSuggestionProvider(getCharacters)` installs the provider on mount and clears it on unmount. `Paper.tsx` calls this hook with `useCharactersQuery(activeStoryId)`.
- Insertion: when an item is selected, the plugin's `command({ editor, range, props })` callback runs an editor chain that (a) deletes the trigger range (`@que`), (b) inserts the character's name as plain text, (c) sets `charRef` mark on the just-inserted run, (d) inserts a single trailing space (so the next typed character isn't caught into the mark — `inclusive: false` already handles this on the right edge but a trailing space matches the UX of every other `@`-mention system). Done in a single chain so it's one undo step.
- Filtering: case-insensitive prefix match on `name` first, then case-insensitive substring match for ranking. Cap to 8 visible items. If the active story has no characters, the menu opens with a single muted row reading "No characters in this story yet" — no insertion possible; Escape closes.
- Positioning: the menu renders into a portal at `document.body` and is positioned via `clientRect` from the suggestion plugin (caret coordinates). On scroll/resize the plugin re-fires `onUpdate` with a fresh rect.

**Decision points pinned (so this plan ships without "TBD: pick one" left over):**
1. **Trigger char `@` only.** Not `[[`. Common, low conflict with prose, easy to dismiss.
2. **`allowSpaces: false`** on the suggestion config. Matches Slack/Discord/GitHub mention UX; the user closes on space if no character matched. (We rely on this to avoid an open menu following the user across an entire paragraph.)
3. **Insertion replaces the typed query and the trigger.** `@en` + Enter on "Elena Marsh" produces "Elena Marsh" wrapped in a `charRef` mark, NOT "@en Elena Marsh". This matches every other autocomplete and is what the typed range from `@tiptap/suggestion` reports.
4. **Empty-state row is not selectable.** Arrow keys do nothing; Enter is a no-op; only Escape / typing closes the menu.
5. **No keyboard shortcut to open the menu manually.** The trigger is the only entry point in this plan. (A future `[F33]` selection-bubble entry was a deferred alternative — not in scope.)
6. **No ARIA combobox.** The menu is a `role="listbox"` with `aria-activedescendant`; the trigger is a regular contenteditable region. This avoids the rabbit-hole of synchronising a real combobox with ProseMirror.

**Tech Stack:** `@tiptap/core` 2.27 (already installed), `@tiptap/react` 2.27, **new dep: `@tiptap/suggestion` 2.27** (peer-version-locked to the existing `@tiptap/core`). Zustand (existing). React 19. Vitest + Testing Library + jsdom. ProseMirror types are transitively available.

**Source-of-truth references:**
- Existing extension list: `frontend/src/lib/tiptap-extensions.ts:147-160` (`formatBarExtensions`); `setCharRef({ characterId })` command at lines 90-101.
- Production editor mount: `frontend/src/components/Paper.tsx:139-160` (uses `formatBarExtensions`).
- Active story id: `frontend/src/store/activeStory.ts` — `useActiveStoryStore((s) => s.activeStoryId)`.
- Character data: `frontend/src/hooks/useCharacters.ts` — `useCharactersQuery(storyId)`, `Character` type with `id`, `name`, `role`.
- Hover popover (already firing on existing marks; F62 only ensures marks exist): `frontend/src/components/CharacterPopover.tsx`.
- `inclusive: false` on the CharRef mark: `frontend/src/lib/tiptap-extensions.ts:70` — confirms typed text after the mark won't extend it.
- TipTap suggestion plugin docs (public API): https://tiptap.dev/docs/editor/api/utilities/suggestion
- Existing zustand pattern: `frontend/src/store/inlineAIResult.ts` (smaller store) and `frontend/src/store/selection.ts` for shape conventions.

---

## File Structure

**Create (frontend):**
- `mockups/frontend-prototype/design/char-ref-authoring.jsx` — design-first mockup for the `@`-trigger menu
- `mockups/frontend-prototype/design/char-ref-authoring.notes.md` — addendum
- `frontend/src/store/charRefSuggestion.ts` — zustand store + provider ref helper
- `frontend/src/lib/charRefSuggestion.ts` — the TipTap extension
- `frontend/src/components/CharRefMenu.tsx` — the popup
- `frontend/src/hooks/useCharRefSuggestionProvider.ts` — installs the character-list provider
- `frontend/tests/components/CharRefAuthoring.test.tsx` — verify-command target
- `frontend/tests/store/charRefSuggestion.test.ts` — store unit tests
- `frontend/tests/lib/charRefSuggestion.test.ts` — extension unit tests (filter ranking, insertion command)

**Modify (frontend):**
- `frontend/package.json` — add `"@tiptap/suggestion": "^2.27.2"` to `dependencies`.
- `frontend/src/lib/tiptap-extensions.ts` — append the configured `CharRefSuggestion` extension to `formatBarExtensions`. The configuration uses the module-level provider ref so the extension instance is stable across re-renders.
- `frontend/src/components/Paper.tsx` — call `useCharRefSuggestionProvider(activeStoryCharacters)` and render `<CharRefMenu />` once near the editor mount so the portal is sibling to the editor (React tree position doesn't matter for portals, but co-location keeps the wiring obvious).

**Not touched:**
- `setCharRef` / `unsetCharRef` commands and the `CharRef` mark — already present and correct.
- Hover popover (F37) — once marks exist, it will fire automatically.
- `Editor.tsx` (F8 legacy editor with `StarterKit` only) — still used in tests and the legacy harness; does **not** receive `CharRefSuggestion`. The production editor is `Paper.tsx`. F62 changes do not apply to Editor.tsx.

---

## Task 1: Mockup the @-trigger menu

**Files:**
- Create: `mockups/frontend-prototype/design/char-ref-authoring.jsx`
- Create: `mockups/frontend-prototype/design/char-ref-authoring.notes.md`

- [ ] **Step 1: Write the mockup JSX**

Create `mockups/frontend-prototype/design/char-ref-authoring.jsx`:

```jsx
// CharRef @-trigger menu — appears below the caret when the user types `@`
// in the editor and starts narrowing by typed query. Mirrors the styling
// of other Inkwell popovers (paper-card surface, 1px line, soft shadow).

function CharRefMenu({ items, activeIndex, query, x, y }) {
  if (items.length === 0) {
    return (
      <div className="char-ref-menu" style={{ position: "fixed", left: x, top: y }}>
        <p className="char-ref-empty">No characters in this story yet.</p>
      </div>
    );
  }
  return (
    <ul className="char-ref-menu" role="listbox" aria-label="Characters" style={{ position: "fixed", left: x, top: y }}>
      {items.map((c, i) => (
        <li
          key={c.id}
          role="option"
          id={`charref-opt-${c.id}`}
          aria-selected={i === activeIndex}
          className={`char-ref-item ${i === activeIndex ? "active" : ""}`}
          onMouseDown={(e) => e.preventDefault()}
        >
          <span className="char-ref-name">{highlight(c.name, query)}</span>
          {c.role && <span className="char-ref-role">{c.role}</span>}
        </li>
      ))}
    </ul>
  );
}

function highlight(name, query) {
  if (!query) return name;
  const i = name.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return name;
  return (
    <>
      {name.slice(0, i)}
      <mark>{name.slice(i, i + query.length)}</mark>
      {name.slice(i + query.length)}
    </>
  );
}
```

- [ ] **Step 2: Write the addendum**

Create `mockups/frontend-prototype/design/char-ref-authoring.notes.md`:

```markdown
# CharRef @-trigger menu (addendum)

Closes the [F62] gap: F36 ships the `charRef` mark + F37 hover popover, but
nothing in the editor authors the mark. This menu is the missing affordance.

## Trigger
- `@` in any contenteditable region of the chapter editor opens the menu.
- The menu stays open while the user types alpha-numeric / `_` / `-` /
  `'` characters — these can appear in character names. Space, Enter,
  Escape, or any non-name char closes it. Backspacing through the `@`
  closes it.
- The menu is **never** opened by a programmatic `editor.insertText('@')`
  outside a user keystroke — the suggestion plugin is keystroke-driven by
  default; we don't override that.

## Layout
- Surface: `paper-card` style — `var(--bg-elevated)`, 1px `var(--line-2)`,
  6px radius, 0 4px 16px rgba(0,0,0,.08) shadow. Width 240px (clamps to
  90vw on narrow viewports).
- Each row: 28px tall, 8px horizontal padding, name + optional muted role
  (e.g. "Protagonist", "Antagonist"). Active row gets `var(--surface-hover)`.
- Position: rendered into `document.body` at `position: fixed`, anchored
  to the caret's `clientRect` returned by the suggestion plugin. Default
  placement: 4px below the caret's bottom edge. If the menu would overflow
  the viewport bottom, flip above the caret instead.

## Keyboard
- ↓ / ↑ — move active row (wraps).
- Enter — insert the active item; close the menu.
- Tab — same as Enter (matches Slack / Discord).
- Escape — close without inserting; the typed `@query` stays as plain text.
- Mouse: click on a row inserts that item. The row's `onMouseDown` calls
  `preventDefault()` so the editor selection doesn't collapse before the
  command fires.

## Insertion
The insertion runs in a single editor chain (one undo step):
1. Delete the trigger range `@<query>`.
2. Insert the character's full `name` as plain text.
3. Set `charRef` mark `{ characterId }` on the just-inserted run.
4. Insert one trailing space.

The `inclusive: false` flag on the mark + the trailing space ensure the
next typed character is plain text, not part of the mark.

## Empty state
If `useCharactersQuery(activeStoryId)` returns `[]` (or is still loading
and has no cached items), the menu opens with a single muted row reading
"No characters in this story yet." — not selectable; the user can dismiss
with Escape or by typing more characters. Does not block the editor.

## What we deliberately do NOT do (in F62)
- A "Mention character…" entry in the F33 selection bubble — alternative
  was punted; can be added later.
- A keyboard shortcut to open the menu manually with no `@` typed.
- An "add new character" affordance from the menu when no match exists.
- Suggestions on the *first* keystroke before any letter — i.e. `@`
  alone shows the full list of up to 8 characters, not zero.
- Persistence of the typed query across blur/focus.
```

- [ ] **Step 3: Commit**

```bash
git add mockups/frontend-prototype/design/char-ref-authoring.jsx \
       mockups/frontend-prototype/design/char-ref-authoring.notes.md
git commit -m "[F62] mockup: charRef @-trigger menu"
```

---

## Task 2: Add `@tiptap/suggestion` dependency

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json` (auto-generated by `npm install`)

- [ ] **Step 1: Install the package**

```bash
cd frontend && npm install @tiptap/suggestion@^2.27.2 --save
```

This pins to the same minor as the existing `@tiptap/core` to avoid version skew (peer-dep checked by npm).

- [ ] **Step 2: Verify the install and that types are present**

```bash
cd frontend && node -e "console.log(require('@tiptap/suggestion'))" && npx tsc --noEmit
```

Expected: prints the module's exports (`Suggestion`, etc.) and the project type-checks cleanly.

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "[F62] dep: @tiptap/suggestion ^2.27.2"
```

---

## Task 3: Zustand store for the suggestion menu state

**Files:**
- Create: `frontend/src/store/charRefSuggestion.ts`
- Create: `frontend/tests/store/charRefSuggestion.test.ts`

The extension writes `{ open, items, activeIndex, query, clientRect, onSelect }` into this store; the menu component reads it. Decoupling lets the extension list stay module-level while the menu owns rendering.

- [ ] **Step 1: Write the failing store test**

Create `frontend/tests/store/charRefSuggestion.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import {
  resetCharRefSuggestionStore,
  useCharRefSuggestionStore,
} from '@/store/charRefSuggestion';

describe('useCharRefSuggestionStore', () => {
  afterEach(() => {
    resetCharRefSuggestionStore();
  });

  it('starts closed with no items, query empty, activeIndex 0', () => {
    const s = useCharRefSuggestionStore.getState();
    expect(s.open).toBe(false);
    expect(s.items).toEqual([]);
    expect(s.activeIndex).toBe(0);
    expect(s.query).toBe('');
    expect(s.clientRect).toBeNull();
  });

  it('open() sets the full state in one update', () => {
    const onSelect = (): void => undefined;
    useCharRefSuggestionStore.getState().open({
      items: [{ id: 'c1', name: 'Elena' }],
      query: 'el',
      clientRect: new DOMRect(10, 20, 0, 16),
      onSelect,
    });
    const s = useCharRefSuggestionStore.getState();
    expect(s.open).toBe(true);
    expect(s.items.length).toBe(1);
    expect(s.activeIndex).toBe(0);
    expect(s.onSelect).toBe(onSelect);
  });

  it('moveDown / moveUp wrap around', () => {
    useCharRefSuggestionStore.getState().open({
      items: [
        { id: '1', name: 'A' },
        { id: '2', name: 'B' },
        { id: '3', name: 'C' },
      ],
      query: '',
      clientRect: null,
      onSelect: () => undefined,
    });
    const { moveDown, moveUp } = useCharRefSuggestionStore.getState();
    moveDown();
    expect(useCharRefSuggestionStore.getState().activeIndex).toBe(1);
    moveDown();
    moveDown();
    expect(useCharRefSuggestionStore.getState().activeIndex).toBe(0); // wrapped
    moveUp();
    expect(useCharRefSuggestionStore.getState().activeIndex).toBe(2); // wrapped
  });

  it('moveDown / moveUp on empty items keep activeIndex at 0 (no-op)', () => {
    useCharRefSuggestionStore.getState().open({
      items: [],
      query: '',
      clientRect: null,
      onSelect: () => undefined,
    });
    useCharRefSuggestionStore.getState().moveDown();
    expect(useCharRefSuggestionStore.getState().activeIndex).toBe(0);
  });

  it('updateItems replaces items and resets activeIndex when the list shrinks past it', () => {
    useCharRefSuggestionStore.getState().open({
      items: [
        { id: '1', name: 'A' },
        { id: '2', name: 'B' },
        { id: '3', name: 'C' },
      ],
      query: '',
      clientRect: null,
      onSelect: () => undefined,
    });
    useCharRefSuggestionStore.getState().moveDown();
    useCharRefSuggestionStore.getState().moveDown(); // activeIndex = 2
    useCharRefSuggestionStore
      .getState()
      .updateItems({ items: [{ id: '1', name: 'A' }], query: 'a', clientRect: null });
    const s = useCharRefSuggestionStore.getState();
    expect(s.items).toHaveLength(1);
    expect(s.activeIndex).toBe(0);
    expect(s.query).toBe('a');
  });

  it('close() resets to the initial state', () => {
    useCharRefSuggestionStore.getState().open({
      items: [{ id: '1', name: 'A' }],
      query: 'a',
      clientRect: new DOMRect(0, 0, 0, 0),
      onSelect: () => undefined,
    });
    useCharRefSuggestionStore.getState().close();
    const s = useCharRefSuggestionStore.getState();
    expect(s.open).toBe(false);
    expect(s.items).toEqual([]);
    expect(s.query).toBe('');
    expect(s.activeIndex).toBe(0);
    expect(s.clientRect).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend && npm run test:frontend -- --run tests/store/charRefSuggestion.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the store**

Create `frontend/src/store/charRefSuggestion.ts`:

```ts
import { create } from 'zustand';

export interface CharRefSuggestionItem {
  id: string;
  name: string;
  role?: string | null;
}

export interface CharRefSuggestionOpenInput {
  items: CharRefSuggestionItem[];
  query: string;
  clientRect: DOMRect | null;
  onSelect: (item: CharRefSuggestionItem) => void;
}

export interface CharRefSuggestionUpdateInput {
  items: CharRefSuggestionItem[];
  query: string;
  clientRect: DOMRect | null;
}

export interface CharRefSuggestionState {
  open: boolean;
  items: CharRefSuggestionItem[];
  activeIndex: number;
  query: string;
  clientRect: DOMRect | null;
  onSelect: ((item: CharRefSuggestionItem) => void) | null;
  open: (input: CharRefSuggestionOpenInput) => void;
  updateItems: (input: CharRefSuggestionUpdateInput) => void;
  moveDown: () => void;
  moveUp: () => void;
  close: () => void;
}

const INITIAL = {
  open: false,
  items: [] as CharRefSuggestionItem[],
  activeIndex: 0,
  query: '',
  clientRect: null as DOMRect | null,
  onSelect: null as ((item: CharRefSuggestionItem) => void) | null,
};

// NB: the `open` field and the `open` method share a name. Zustand allows
// this because they live on the same object; consumers read state.open
// (boolean) and call state.open(input) (method). We resolve the
// readability tradeoff in favour of matching how every popover store in
// this project is written (see `useInlineAIResultStore`).

export const useCharRefSuggestionStore = create<CharRefSuggestionState>((set, get) => ({
  ...INITIAL,
  open: (input) =>
    set({
      open: true,
      items: input.items,
      activeIndex: 0,
      query: input.query,
      clientRect: input.clientRect,
      onSelect: input.onSelect,
    }),
  updateItems: (input) => {
    const { activeIndex } = get();
    set({
      items: input.items,
      activeIndex: input.items.length === 0 ? 0 : Math.min(activeIndex, input.items.length - 1),
      query: input.query,
      clientRect: input.clientRect,
    });
  },
  moveDown: () => {
    const { items, activeIndex } = get();
    if (items.length === 0) return;
    set({ activeIndex: (activeIndex + 1) % items.length });
  },
  moveUp: () => {
    const { items, activeIndex } = get();
    if (items.length === 0) return;
    set({ activeIndex: (activeIndex - 1 + items.length) % items.length });
  },
  close: () => set(INITIAL),
}));

/** Test seam — drains the store to the initial state. */
export function resetCharRefSuggestionStore(): void {
  useCharRefSuggestionStore.setState(INITIAL);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd frontend && npm run test:frontend -- --run tests/store/charRefSuggestion.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/charRefSuggestion.ts frontend/tests/store/charRefSuggestion.test.ts
git commit -m "[F62] store: charRefSuggestion (open/move/close)"
```

---

## Task 4: TipTap extension `CharRefSuggestion`

**Files:**
- Create: `frontend/src/lib/charRefSuggestion.ts`
- Create: `frontend/tests/lib/charRefSuggestion.test.ts`

- [ ] **Step 1: Write the unit test (filter ranking + insertion)**

Create `frontend/tests/lib/charRefSuggestion.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  filterCharacters,
  setCharRefSuggestionProvider,
  __getCharRefSuggestionProvider,
} from '@/lib/charRefSuggestion';

describe('filterCharacters', () => {
  const cast = [
    { id: '1', name: 'Elena Marsh', role: 'Protagonist' },
    { id: '2', name: 'Eli Bracken', role: 'Antagonist' },
    { id: '3', name: 'Marcus Stone', role: null },
    { id: '4', name: 'Ada Holloway', role: null },
    { id: '5', name: 'Adam West', role: null },
    { id: '6', name: 'Bella Reyes', role: null },
    { id: '7', name: 'Connor Hale', role: null },
    { id: '8', name: 'Diana Ortiz', role: null },
    { id: '9', name: 'Esther Wilde', role: null }, // 9th item — should be cut off
  ];

  it('returns all items (capped to 8) on empty query', () => {
    expect(filterCharacters(cast, '')).toHaveLength(8);
  });

  it('prefix matches rank above substring matches', () => {
    const out = filterCharacters(cast, 'el');
    expect(out[0]?.name).toBe('Elena Marsh');
    expect(out[1]?.name).toBe('Eli Bracken');
    // Bella Reyes contains 'el' as substring (B-e-l-la); should appear after the prefix matches.
    const bella = out.find((c) => c.id === '6');
    expect(bella).toBeDefined();
    if (bella) {
      const bellaIdx = out.indexOf(bella);
      const elenaIdx = out.findIndex((c) => c.id === '1');
      expect(bellaIdx).toBeGreaterThan(elenaIdx);
    }
  });

  it('case-insensitive', () => {
    expect(filterCharacters(cast, 'ELE').map((c) => c.id)).toEqual(['1']);
    expect(filterCharacters(cast, 'elE').map((c) => c.id)).toEqual(['1']);
  });

  it('returns the empty list when nothing matches', () => {
    expect(filterCharacters(cast, 'zzz')).toHaveLength(0);
  });
});

describe('character provider ref', () => {
  it('default returns []', () => {
    setCharRefSuggestionProvider(null);
    expect(__getCharRefSuggestionProvider()()).toEqual([]);
  });

  it('setCharRefSuggestionProvider installs a getter', () => {
    setCharRefSuggestionProvider(() => [{ id: 'x', name: 'X', role: null }]);
    expect(__getCharRefSuggestionProvider()()[0]?.name).toBe('X');
    setCharRefSuggestionProvider(null);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend && npm run test:frontend -- --run tests/lib/charRefSuggestion.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the extension**

Create `frontend/src/lib/charRefSuggestion.ts`:

```ts
import { Extension } from '@tiptap/core';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';
import { useCharRefSuggestionStore } from '@/store/charRefSuggestion';

export interface CharRefSuggestionItem {
  id: string;
  name: string;
  role: string | null;
}

const MAX_ITEMS = 8;

let provider: (() => CharRefSuggestionItem[]) | null = null;

/**
 * Install (or remove with `null`) the function the extension calls to read
 * the active story's character list. Wired by `useCharRefSuggestionProvider`.
 */
export function setCharRefSuggestionProvider(
  fn: (() => CharRefSuggestionItem[]) | null,
): void {
  provider = fn;
}

/** Test seam. */
export function __getCharRefSuggestionProvider(): () => CharRefSuggestionItem[] {
  return () => (provider ? provider() : []);
}

export function filterCharacters(
  characters: ReadonlyArray<CharRefSuggestionItem>,
  query: string,
): CharRefSuggestionItem[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) {
    return characters.slice(0, MAX_ITEMS);
  }
  // Score: 0 = prefix match, 1 = substring match, 2 = no match.
  const scored = characters
    .map((c) => {
      const lower = c.name.toLowerCase();
      if (lower.startsWith(q)) return { c, score: 0 };
      if (lower.includes(q)) return { c, score: 1 };
      return { c, score: 2 };
    })
    .filter((entry) => entry.score < 2)
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return a.c.name.localeCompare(b.c.name);
    });
  return scored.slice(0, MAX_ITEMS).map((entry) => entry.c);
}

interface CommandProps {
  editor: import('@tiptap/core').Editor;
  range: { from: number; to: number };
  props: CharRefSuggestionItem;
}

const suggestionConfig: Omit<SuggestionOptions<CharRefSuggestionItem>, 'editor'> = {
  char: '@',
  startOfLine: false,
  allowSpaces: false,
  // Allow apostrophes / hyphens / underscores in the typed query — they appear
  // in real character names.
  // The default regex breaks on punctuation; override with one that keeps name-ish chars.
  // Keep this aligned with the validation policy in the addendum doc.
  // The plugin uses `.` for the trigger pattern; our pattern is for the
  // *query*, applied character-class-style. Default works for letters and
  // digits; we extend with `'`, `-`, `_`.
  // (If a future TipTap minor changes the option name, this is the spot.)
  // ~~ no `pattern` in the plugin's public API — instead we rely on
  // allowedPrefixes + the default char-by-char tokenizer; punctuation
  // closes the suggestion, which is what we want for a tight UX.

  items: ({ query }) => {
    const characters = provider ? provider() : [];
    return filterCharacters(characters, query);
  },

  command: ({ editor, range, props }: CommandProps) => {
    // One chain = one undo step.
    editor
      .chain()
      .focus()
      .deleteRange(range)
      .insertContent(props.name)
      .setTextSelection({
        from: range.from,
        to: range.from + props.name.length,
      })
      .setMark('charRef', { characterId: props.id })
      .setTextSelection(range.from + props.name.length)
      .unsetMark('charRef')
      .insertContent(' ')
      .run();
  },

  render: () => {
    return {
      onStart: (props) => {
        useCharRefSuggestionStore.getState().open({
          items: props.items,
          query: props.query,
          clientRect: props.clientRect ? props.clientRect() : null,
          onSelect: (item) => {
            // Re-enter the plugin's command flow.
            props.command(item);
          },
        });
      },
      onUpdate: (props) => {
        useCharRefSuggestionStore.getState().updateItems({
          items: props.items,
          query: props.query,
          clientRect: props.clientRect ? props.clientRect() : null,
        });
        // Re-bind onSelect because props.command can change identity.
        useCharRefSuggestionStore.setState({
          onSelect: (item) => props.command(item),
        });
      },
      onKeyDown: (props) => {
        const state = useCharRefSuggestionStore.getState();
        if (props.event.key === 'ArrowDown') {
          state.moveDown();
          return true;
        }
        if (props.event.key === 'ArrowUp') {
          state.moveUp();
          return true;
        }
        if (props.event.key === 'Enter' || props.event.key === 'Tab') {
          const item = state.items[state.activeIndex];
          if (item && state.onSelect) {
            state.onSelect(item);
            return true;
          }
          // Empty list — let Enter fall through to a regular paragraph break.
          return false;
        }
        if (props.event.key === 'Escape') {
          state.close();
          return true;
        }
        return false;
      },
      onExit: () => {
        useCharRefSuggestionStore.getState().close();
      },
    };
  },
};

export const CharRefSuggestion = Extension.create({
  name: 'charRefSuggestion',
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...suggestionConfig,
      }),
    ];
  },
});
```

- [ ] **Step 4: Append to the production extension list**

Edit `frontend/src/lib/tiptap-extensions.ts`. Add the import at the top:

```ts
import { CharRefSuggestion } from '@/lib/charRefSuggestion';
```

And update the `formatBarExtensions` array (currently lines 147-160) to include it:

```ts
export const formatBarExtensions = [
  StarterKit,
  Underline,
  Link.configure({
    openOnClick: false,
    HTMLAttributes: {
      rel: 'noopener noreferrer',
      target: '_blank',
    },
  }),
  Highlight,
  AIContinuation,
  CharRef,
  CharRefSuggestion,
];
```

The provider ref defaults to `null` → empty list → menu shows the empty-state row but is otherwise a safe no-op for any consumer (FormatBar harness, tests) that hasn't installed a provider.

- [ ] **Step 5: Run the unit tests**

```bash
cd frontend && npm run test:frontend -- --run tests/lib/charRefSuggestion.test.ts
```

Expected: PASS.

Also run the existing `formatBarExtensions` consumers to confirm no regressions:

```bash
cd frontend && npm run test:frontend -- --run tests/components/FormatBar.test.tsx tests/components/Editor.test.tsx tests/components/CharRefMark.test.tsx
```

Expected: PASS for all (the harness without a provider sees an empty character list, which is the safe default).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/charRefSuggestion.ts \
       frontend/src/lib/tiptap-extensions.ts \
       frontend/tests/lib/charRefSuggestion.test.ts
git commit -m "[F62] extension: CharRefSuggestion built on @tiptap/suggestion"
```

---

## Task 5: `<CharRefMenu>` popup component

**Files:**
- Create: `frontend/src/components/CharRefMenu.tsx`

The menu is a single component that subscribes to the store, portals into `document.body`, and renders fixed-positioned. Click-handling uses `onMouseDown` + `preventDefault()` so the editor selection doesn't collapse before the command fires.

- [ ] **Step 1: Write the component**

Create `frontend/src/components/CharRefMenu.tsx`:

```tsx
import type { JSX } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCharRefSuggestionStore } from '@/store/charRefSuggestion';

const MENU_WIDTH = 240;
const MENU_GAP = 4;
const MAX_HEIGHT_VH = 0.4;

interface MenuPosition {
  left: number;
  top: number;
  flipped: boolean;
}

function computePosition(
  rect: DOMRect | null,
  menuHeight: number,
  viewportHeight: number,
  viewportWidth: number,
): MenuPosition | null {
  if (!rect) return null;
  const wantBelow = rect.bottom + MENU_GAP + menuHeight <= viewportHeight;
  const top = wantBelow ? rect.bottom + MENU_GAP : Math.max(8, rect.top - MENU_GAP - menuHeight);
  const left = Math.min(rect.left, viewportWidth - MENU_WIDTH - 8);
  return { left, top, flipped: !wantBelow };
}

function HighlightedName({ name, query }: { name: string; query: string }): JSX.Element {
  if (query.length === 0) return <>{name}</>;
  const lower = name.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx < 0) return <>{name}</>;
  return (
    <>
      {name.slice(0, idx)}
      <mark className="bg-transparent font-medium text-[var(--ink)]">
        {name.slice(idx, idx + query.length)}
      </mark>
      {name.slice(idx + query.length)}
    </>
  );
}

export function CharRefMenu(): JSX.Element | null {
  const labelId = useId();
  const open = useCharRefSuggestionStore((s) => s.open);
  const items = useCharRefSuggestionStore((s) => s.items);
  const activeIndex = useCharRefSuggestionStore((s) => s.activeIndex);
  const query = useCharRefSuggestionStore((s) => s.query);
  const clientRect = useCharRefSuggestionStore((s) => s.clientRect);
  const onSelect = useCharRefSuggestionStore((s) => s.onSelect);
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ vw: number; vh: number; menuH: number }>(() => ({
    vw: typeof window !== 'undefined' ? window.innerWidth : 1024,
    vh: typeof window !== 'undefined' ? window.innerHeight : 768,
    menuH: 0,
  }));

  useEffect(() => {
    if (!open) return;
    const onResize = (): void => {
      setSize((prev) => ({ ...prev, vw: window.innerWidth, vh: window.innerHeight }));
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!ref.current) return;
    setSize((prev) => ({ ...prev, menuH: ref.current?.offsetHeight ?? 0 }));
  }, [open, items.length]);

  if (!open) return null;

  const position = computePosition(clientRect, size.menuH, size.vh, size.vw);
  if (!position) return null;

  const isEmpty = items.length === 0;

  return createPortal(
    <div
      ref={ref}
      role={isEmpty ? 'note' : 'listbox'}
      aria-labelledby={labelId}
      data-testid="char-ref-menu"
      style={{
        position: 'fixed',
        left: position.left,
        top: position.top,
        width: MENU_WIDTH,
        maxHeight: `${String(Math.floor(size.vh * MAX_HEIGHT_VH))}px`,
        overflowY: 'auto',
        zIndex: 60,
      }}
      className="bg-[var(--bg-elevated)] border border-[var(--line-2)] rounded-[var(--radius)] shadow-[0_4px_16px_rgba(0,0,0,0.08)] py-1"
    >
      <span id={labelId} className="sr-only">
        Characters
      </span>
      {isEmpty ? (
        <p className="px-2.5 py-2 text-[12px] text-[var(--ink-3)] m-0">
          No characters in this story yet.
        </p>
      ) : (
        items.map((item, i) => (
          <button
            type="button"
            key={item.id}
            id={`charref-opt-${item.id}`}
            role="option"
            aria-selected={i === activeIndex}
            onMouseDown={(e) => {
              e.preventDefault();
              if (onSelect) onSelect(item);
            }}
            className={`w-full text-left px-2.5 py-1.5 flex items-baseline gap-2 transition-colors ${
              i === activeIndex
                ? 'bg-[var(--surface-hover)]'
                : 'bg-transparent hover:bg-[var(--surface-hover)]'
            }`}
          >
            <span className="text-[13px] text-[var(--ink)]">
              <HighlightedName name={item.name} query={query} />
            </span>
            {item.role ? (
              <span className="text-[11px] text-[var(--ink-4)] ml-auto">{item.role}</span>
            ) : null}
          </button>
        ))
      )}
    </div>,
    document.body,
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/CharRefMenu.tsx
git commit -m "[F62] component: <CharRefMenu> portal popup"
```

---

## Task 6: Provider hook + wire into Paper

**Files:**
- Create: `frontend/src/hooks/useCharRefSuggestionProvider.ts`
- Modify: `frontend/src/components/Paper.tsx`

- [ ] **Step 1: Write the provider hook**

Create `frontend/src/hooks/useCharRefSuggestionProvider.ts`:

```ts
import { useEffect, useRef } from 'react';
import {
  type CharRefSuggestionItem,
  setCharRefSuggestionProvider,
} from '@/lib/charRefSuggestion';

/**
 * Installs a module-level getter so the (statically registered) suggestion
 * extension can read the active story's characters at the moment a query
 * fires, without rebuilding the editor's extension list.
 *
 * The returned getter calls `getCharacters()` afresh each time, so changes
 * to the underlying TanStack Query result are visible without any extra
 * subscription plumbing.
 */
export function useCharRefSuggestionProvider(
  getCharacters: () => CharRefSuggestionItem[],
): void {
  const ref = useRef(getCharacters);
  useEffect(() => {
    ref.current = getCharacters;
  }, [getCharacters]);

  useEffect(() => {
    setCharRefSuggestionProvider(() => ref.current());
    return () => {
      setCharRefSuggestionProvider(null);
    };
  }, []);
}
```

- [ ] **Step 2: Wire into Paper.tsx**

Edit `frontend/src/components/Paper.tsx`. Near the imports, add:

```tsx
import { CharRefMenu } from '@/components/CharRefMenu';
import { useCharactersQuery } from '@/hooks/useCharacters';
import { useCharRefSuggestionProvider } from '@/hooks/useCharRefSuggestionProvider';
import { useActiveStoryStore } from '@/store/activeStory';
```

Inside the `Paper` component body (after the `editor = useEditor(...)` block), add:

```tsx
const activeStoryId = useActiveStoryStore((s) => s.activeStoryId);
const charactersQuery = useCharactersQuery(activeStoryId ?? undefined);
useCharRefSuggestionProvider(() =>
  (charactersQuery.data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    role: c.role,
  })),
);
```

In the JSX, just before the closing `</article>`, render the menu:

```tsx
<CharRefMenu />
```

(Position-wise it doesn't matter — `CharRefMenu` portals to `document.body`. We mount it inside Paper so that when Paper unmounts (e.g. switching to a different page) the menu disappears too.)

- [ ] **Step 3: Type-check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/useCharRefSuggestionProvider.ts \
       frontend/src/components/Paper.tsx
git commit -m "[F62] wire CharRefSuggestion into Paper editor"
```

---

## Task 7: End-to-end component test

**Files:**
- Create: `frontend/tests/components/CharRefAuthoring.test.tsx` (the verify-command target)

This test mounts a TipTap editor with `formatBarExtensions`, installs a provider with three characters, and exercises the full flow: type `@`, narrow with a query, navigate with arrow keys, press Enter, assert the resulting document contains a `charRef` mark on the inserted name.

- [ ] **Step 1: Write the test**

Create `frontend/tests/components/CharRefAuthoring.test.tsx`:

```tsx
import { Editor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import type { JSX } from 'react';
import { useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CharRefMenu } from '@/components/CharRefMenu';
import { setCharRefSuggestionProvider } from '@/lib/charRefSuggestion';
import { formatBarExtensions } from '@/lib/tiptap-extensions';
import { resetCharRefSuggestionStore, useCharRefSuggestionStore } from '@/store/charRefSuggestion';

const CAST = [
  { id: 'c1', name: 'Elena Marsh', role: 'Protagonist' },
  { id: 'c2', name: 'Eli Bracken', role: 'Antagonist' },
  { id: 'c3', name: 'Marcus Stone', role: null },
];

function Harness({ onReady }: { onReady?: (e: Editor) => void }): JSX.Element {
  const editor = useEditor({
    extensions: formatBarExtensions,
    content: '<p></p>',
  });
  useEffect(() => {
    if (editor && onReady) onReady(editor);
  }, [editor, onReady]);
  return (
    <>
      <div data-testid="editor">
        <EditorContent editor={editor} />
      </div>
      <CharRefMenu />
    </>
  );
}

describe('charRef @-trigger authoring (F62)', () => {
  beforeEach(() => {
    setCharRefSuggestionProvider(() => CAST);
  });
  afterEach(() => {
    setCharRefSuggestionProvider(null);
    act(() => {
      resetCharRefSuggestionStore();
    });
  });

  it('typing @ opens the menu with all characters (capped to 8)', async () => {
    const user = userEvent.setup();
    let editor: Editor | undefined;
    render(<Harness onReady={(e) => { editor = e; }} />);

    await waitFor(() => expect(editor).toBeDefined());
    if (!editor) throw new Error('editor');

    editor.commands.focus();
    await user.keyboard('@');

    await waitFor(() => {
      expect(screen.getByTestId('char-ref-menu')).toBeInTheDocument();
    });
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(screen.getByRole('option', { name: /elena marsh/i })).toBeInTheDocument();
  });

  it('narrows the list as the user types', async () => {
    const user = userEvent.setup();
    let editor: Editor | undefined;
    render(<Harness onReady={(e) => { editor = e; }} />);
    await waitFor(() => expect(editor).toBeDefined());
    editor?.commands.focus();

    await user.keyboard('@el');

    await waitFor(() => {
      // Both Elena Marsh and Eli Bracken start with "el" — both shown.
      const opts = screen.getAllByRole('option');
      expect(opts.length).toBe(2);
    });
    expect(screen.queryByRole('option', { name: /marcus stone/i })).not.toBeInTheDocument();
  });

  it('ArrowDown / ArrowUp move the activeIndex; Enter inserts the active item with charRef mark', async () => {
    const user = userEvent.setup();
    let editor: Editor | undefined;
    render(<Harness onReady={(e) => { editor = e; }} />);
    await waitFor(() => expect(editor).toBeDefined());
    if (!editor) throw new Error('editor');

    editor.commands.focus();
    await user.keyboard('@e');

    await waitFor(() => {
      expect(screen.getByTestId('char-ref-menu')).toBeInTheDocument();
    });
    // ArrowDown to highlight the second option (Eli Bracken).
    await user.keyboard('{ArrowDown}');
    expect(useCharRefSuggestionStore.getState().activeIndex).toBe(1);
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.queryByTestId('char-ref-menu')).not.toBeInTheDocument();
    });

    // The doc now contains "Eli Bracken " and the name run carries the charRef mark.
    const json = editor.getJSON();
    const text = editor.getText();
    expect(text).toContain('Eli Bracken ');
    const para = json.content?.[0];
    const run = para?.content?.find(
      (n) =>
        n.type === 'text' &&
        typeof n.text === 'string' &&
        n.text.includes('Eli Bracken') &&
        Array.isArray(n.marks) &&
        n.marks.some((m) => m.type === 'charRef' && m.attrs?.characterId === 'c2'),
    );
    expect(run).toBeDefined();
  });

  it('Escape closes the menu without inserting; the typed @query stays as plain text', async () => {
    const user = userEvent.setup();
    let editor: Editor | undefined;
    render(<Harness onReady={(e) => { editor = e; }} />);
    await waitFor(() => expect(editor).toBeDefined());
    if (!editor) throw new Error('editor');

    editor.commands.focus();
    await user.keyboard('@el');
    await waitFor(() => expect(screen.getByTestId('char-ref-menu')).toBeInTheDocument());

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('char-ref-menu')).not.toBeInTheDocument());

    expect(editor.getText()).toContain('@el');
    // No charRef mark anywhere.
    const json = editor.getJSON();
    const para = json.content?.[0];
    const hasMark = para?.content?.some(
      (n) => Array.isArray(n.marks) && n.marks.some((m) => m.type === 'charRef'),
    );
    expect(hasMark).toBeFalsy();
  });

  it('clicking a row inserts that character and closes the menu (mousedown preventDefault keeps the selection)', async () => {
    const user = userEvent.setup();
    let editor: Editor | undefined;
    render(<Harness onReady={(e) => { editor = e; }} />);
    await waitFor(() => expect(editor).toBeDefined());
    if (!editor) throw new Error('editor');

    editor.commands.focus();
    await user.keyboard('@m');
    const marcusOption = await screen.findByRole('option', { name: /marcus stone/i });

    // userEvent.click maps to mousedown+mouseup+click. We want to confirm
    // mousedown alone (with our preventDefault) is sufficient.
    await user.pointer({ keys: '[MouseLeft>]', target: marcusOption });
    await user.pointer({ keys: '[/MouseLeft]' });

    await waitFor(() => {
      expect(screen.queryByTestId('char-ref-menu')).not.toBeInTheDocument();
    });
    expect(editor.getText()).toContain('Marcus Stone ');
  });

  it('empty cast → menu opens with the empty-state row, Enter is a no-op', async () => {
    setCharRefSuggestionProvider(() => []);
    const user = userEvent.setup();
    let editor: Editor | undefined;
    render(<Harness onReady={(e) => { editor = e; }} />);
    await waitFor(() => expect(editor).toBeDefined());
    if (!editor) throw new Error('editor');

    editor.commands.focus();
    await user.keyboard('@');

    await waitFor(() => {
      expect(screen.getByText(/no characters in this story yet/i)).toBeInTheDocument();
    });
    expect(screen.queryAllByRole('option')).toHaveLength(0);

    // Enter falls through to a paragraph break; document should not get a charRef mark.
    await user.keyboard('{Enter}');
    const json = editor.getJSON();
    const hasMark = (json.content ?? []).some(
      (block) =>
        Array.isArray(block.content) &&
        block.content.some(
          (n) => Array.isArray(n.marks) && n.marks.some((m) => m.type === 'charRef'),
        ),
    );
    expect(hasMark).toBeFalsy();
  });

  it('typing a space after @query closes the menu (allowSpaces:false)', async () => {
    const user = userEvent.setup();
    let editor: Editor | undefined;
    render(<Harness onReady={(e) => { editor = e; }} />);
    await waitFor(() => expect(editor).toBeDefined());
    if (!editor) throw new Error('editor');

    editor.commands.focus();
    await user.keyboard('@el');
    await waitFor(() => expect(screen.getByTestId('char-ref-menu')).toBeInTheDocument());

    await user.keyboard(' ');
    await waitFor(() => expect(screen.queryByTestId('char-ref-menu')).not.toBeInTheDocument());
  });

  it('the inserted run has charRef mark only on the name, not on the trailing space', async () => {
    const user = userEvent.setup();
    let editor: Editor | undefined;
    render(<Harness onReady={(e) => { editor = e; }} />);
    await waitFor(() => expect(editor).toBeDefined());
    if (!editor) throw new Error('editor');

    editor.commands.focus();
    await user.keyboard('@el{Enter}');

    await waitFor(() => expect(screen.queryByTestId('char-ref-menu')).not.toBeInTheDocument());

    const para = editor.getJSON().content?.[0];
    const runs = para?.content ?? [];
    const named = runs.find(
      (r) => Array.isArray(r.marks) && r.marks.some((m) => m.type === 'charRef'),
    );
    const space = runs.find(
      (r) => r.type === 'text' && typeof r.text === 'string' && r.text === ' ',
    );
    expect(named).toBeDefined();
    expect(space).toBeDefined();
    expect(space?.marks ?? []).toEqual([]);
  });
});
```

Notes for the engineer:

- The test runs in `jsdom`. ProseMirror's positioning APIs work but `getBoundingClientRect()` returns zeros — that is fine because the suggestion plugin still calls `clientRect()` and the menu is asserted to render; we don't assert on the absolute position.
- `userEvent.keyboard('@')` is the `Shift+2` chord on US layout. `userEvent.setup()` handles this transparently.
- If `userEvent.pointer` is not available in the project's `@testing-library/user-event` version, replace the click test with `fireEvent.mouseDown(marcusOption)` + `fireEvent.mouseUp(marcusOption)` from `@testing-library/react`.

- [ ] **Step 2: Run the test**

```bash
cd frontend && npm run test:frontend -- --run tests/components/CharRefAuthoring.test.tsx
```

Expected: PASS (8 tests). If any fail because of jsdom + ProseMirror selection quirks, fix the implementation — do not change the assertions. The most likely failure spot is the `command()` chain in `charRefSuggestion.ts`; if `setMark` doesn't apply because the selection isn't where we think it is, swap to `editor.chain().insertContentAt(range, ...)` with a marked text node:

```ts
.insertContentAt(range, [
  { type: 'text', text: props.name, marks: [{ type: 'charRef', attrs: { characterId: props.id } }] },
  { type: 'text', text: ' ' },
])
```

This is the more robust insertion shape — apply it now to head off the failure rather than discovering it on the test run. Replace the `.deleteRange(range).insertContent(props.name).setTextSelection({...}).setMark(...).setTextSelection(...).unsetMark(...).insertContent(' ')` chain in the extension with the simpler `insertContentAt` form above.

- [ ] **Step 3: Commit (after switching to insertContentAt)**

```bash
git add frontend/src/lib/charRefSuggestion.ts frontend/tests/components/CharRefAuthoring.test.tsx
git commit -m "[F62] e2e test + simpler insertContentAt insertion"
```

---

## Task 8: Verify and tick

- [ ] **Step 1: Run the verify command**

```bash
/task-verify F62
```

Or directly:

```bash
cd frontend && npm run test:frontend -- --run tests/components/CharRefAuthoring.test.tsx
```

Expected: exit 0.

- [ ] **Step 2: Run surrounding suites**

```bash
cd frontend && npm run test:frontend -- --run \
  tests/components/CharRefAuthoring.test.tsx \
  tests/components/CharRefMark.test.tsx \
  tests/components/CharacterPopover.test.tsx \
  tests/components/FormatBar.test.tsx \
  tests/components/Editor.test.tsx \
  tests/store/charRefSuggestion.test.ts \
  tests/lib/charRefSuggestion.test.ts
```

Expected: all green. The existing F36 / F37 tests must still pass — F62 only adds a new extension to the list and the existing `CharRef` mark / hover popover are unchanged.

- [ ] **Step 3: Manual smoke (UI)**

```bash
make dev
```

In a browser:
1. Sign in, open a story that has at least one character (create one via the Cast tab if needed).
2. Open a chapter; click into the editor. Type `@` — menu opens listing the cast.
3. Type a few letters — list narrows; the highlighted substring matches.
4. Arrow keys move active row; Enter inserts; the name appears with a 1px dotted underline (the F36 `.char-ref` style).
5. Hover the inserted name — the F37 popover fires (this is the gap that F62 is closing — confirm it works).
6. Type `@x` (no match) — empty-state row visible.
7. Type `@` then space — menu closes, "@ " stays in the editor as plain text.
8. Type `@e` then Escape — menu closes, "@e" stays.
9. Open a story with **no** characters — `@` opens menu with "No characters in this story yet."

If any step fails, fix the code and re-run.

- [ ] **Step 4: Tick `[F62]` in `TASKS.md`**

The pre-edit hook auto-ticks on verify pass; if not, manually flip `- [ ]` to `- [x]`.

- [ ] **Step 5: Final commit**

```bash
git add TASKS.md
git commit -m "[F62] tick — charRef @-trigger authoring path complete"
```

---

## Self-Review Notes

- **Spec coverage:**
  - "Spec the affordance" — done in Task 1's `.notes.md`. Decision recorded: `@`-trigger only.
  - "`@`-trigger autocomplete from the active story's cast" — extension uses `char: '@'`; provider reads `useCharactersQuery(activeStoryId)`.
  - "Up/down keyboard nav + Enter to insert" — Tasks 4 + 5 implement and Task 7 tests both.
  - "Persists into chapters.bodyJson via setCharRef({ characterId })" — `command()` uses the existing `charRef` mark with the character's id; the existing chapter save pipeline writes JSON unchanged.
  - "Visual feedback while typing (filtering the list)" — `<HighlightedName>` highlights the matched substring; list re-ranks per-keystroke via `filterCharacters`.
  - "Decision must be in the design before implementation" — Task 1 commits design first.
  - "verify: cd frontend && npm run test:frontend -- --run tests/components/CharRefAuthoring.test.tsx" — Task 7 creates exactly that file.

- **Implementation completeness check (no follow-up TBDs):**
  - `@tiptap/suggestion` dep is added in Task 2 — not deferred.
  - The provider-ref pattern keeps `formatBarExtensions` static, so there's no editor-rebuild churn when the active story changes mid-session. Existing tests that import `formatBarExtensions` keep working without changes.
  - Empty cast / empty query / no-match cases are explicit in code AND tests; no "TODO: handle empty state" left over.
  - Insertion is finalised on `insertContentAt` (the robust shape) so the chain doesn't depend on selection bookkeeping.
  - Position computation handles below/above flip and right-edge clamping; the only thing it doesn't do is left-edge negative numbers, which isn't reachable from a real caret position.
  - Mark/space split is explicit (the trailing space is its own text node without marks) and tested.
  - `inclusive: false` on the existing `CharRef` mark + the trailing space together make sure the next typed char is plain.
  - jsdom positioning is acknowledged as a known limitation; tests assert presence and content, not pixel coords.
  - All ProseMirror plugin lifecycles (`onStart` / `onUpdate` / `onKeyDown` / `onExit`) write to the store; the menu component subscribes; `onExit` always resets the store, so an unmount-mid-suggestion or focus-loss leaves no stale popup.

- **Type consistency:** `CharRefSuggestionItem` is defined once in `lib/charRefSuggestion.ts` and re-imported by the store and the menu. `Character` (from `useCharacters.ts`) is mapped to the lighter shape inside Paper.tsx, not leaked through the suggestion API.

- **Security checklist:**
  - The character `name` field flows from the existing decrypted character repo result; it is plaintext only because the user is authenticated and looking at their own story. The suggestion menu does not write the name to localStorage / sessionStorage.
  - No new network calls — F62 reuses `useCharactersQuery`.
  - `characterId` written into `chapters.bodyJson` is the same id that already flows through the F36 mark; the chapter repo encrypts the JSON before write per [E5]/[E11] — F62 doesn't see plaintext bodyJson at rest.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/F62-charref-authoring.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, with the dep-add (Task 2) and the e2e test (Task 7) as natural review checkpoints.

**2. Inline Execution** — run tasks in this session via `superpowers:executing-plans`.

Which approach?
