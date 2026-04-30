# [F73] Storybook Component Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backfill Storybook stories for every component actively ported in Phase 2 of the design-system migration (PR #39, commit `93d58d9`). Eleven new `*.stories.tsx` files (twelve components minus `EditorPage` skip), landed as a single PR.

**Architecture:**
- One `*.stories.tsx` per component, sibling to the source file under `frontend/src/components/`. Storybook's auto-glob picks them up.
- Three bundles correspond to the three Phase 2 PRs in [docs/MIGRATION.md](../MIGRATION.md): Bundle 1 (token-swap leaves), Bundle 2 (primitive `Button` + token swap), Bundle 3 (full primitive composition).
- **`EditorPage` is intentionally skipped** — it's a page-level component that wires router + TanStack Query + auth state. Mocking that surface for a story has high maintenance cost and low value (you're not going to design-iterate on a route-level shell). Document the skip in the PR description.
- **`Editor` is the special case** — TipTap surface needs a real `useEditor` mount with the StarterKit. One minimum-viable `EditorDemo` wrapper in the story file; do NOT extract a shared harness on this PR (YAGNI; if a second story ever needs the same setup, extract then).
- Mock data colocates inline within each story file. Don't introduce a `_storyHelpers/` or `_fixtures/` directory — the data is small and indirection isn't worth it.

**Decision points pinned in the plan:**
1. **Single PR for all 11 stories.** HANDOFF.md guidance: "land it as one PR, not seven — backfill is low-risk and easier to review in aggregate". Per-component PRs would multiply review overhead with zero merge-conflict risk reduction.
2. **`EditorPage` skipped, documented in PR description.** Page-level components don't get stories until [X22] / future work establishes a pattern for it.
3. **Components from [X22] (`AccountPrivacyModal`, `Settings`, `StoryPicker`, `ModelPicker` — the four still hand-rolled modals) are NOT backfilled in this PR.** They'll get stories as part of [X22] itself when those components are refactored onto the `<Modal>` primitive. Backfilling them now would mean rewriting the stories the moment [X22] lands.
4. **Router / Query providers are story-local, not global.** If a component uses `useNavigate`, wrap individual stories in `<MemoryRouter>`. If it calls TanStack Query hooks, wrap in `<QueryClientProvider client={new QueryClient()}>`. Don't add global decorators in `.storybook/preview.tsx` — they'd pollute the primitive stories from [F69] / [F70] / [F71] for no reason.
5. **State coverage is ≤4 stories per component.** Don't ceremonially pad. The states that matter are the ones that look visually distinct (empty / populated / error / loading / open / etc.).
6. **Skip per-story manual ARIA / a11y verification** — that's a primitive concern (covered in [F70]). Component stories verify visual + composition correctness only.

**Tech Stack:** Storybook 9.x, React 19, TipTap v3, TanStack Query, react-router-dom v7, primitives from [frontend/src/design/primitives.tsx](../../frontend/src/design/primitives.tsx).

**Source-of-truth references:**
- [docs/MIGRATION.md](../MIGRATION.md) lines 75–130 — component table with bundle assignment per row.
- `git diff 10b634f..93d58d9 -- 'frontend/src/components/*.tsx' 'frontend/src/pages/*.tsx'` — authoritative diff of what PR #39 touched. Grep within for `from '@/design/primitives'` to find primitive-importing components (7 of the 12).
- The component sources themselves under `frontend/src/components/` — read each before writing its story to confirm props.

---

## File Structure

**Create (frontend) — 11 story files:**

| Bundle | Component | Stories | File |
|---|---|---|---|
| 1 | AutosaveIndicator | Idle, Saving, Saved, Error | `frontend/src/components/AutosaveIndicator.stories.tsx` |
| 1 | BalanceDisplay | WithBalance, Loading, Error | `frontend/src/components/BalanceDisplay.stories.tsx` |
| 1 | UsageIndicator | Default | `frontend/src/components/UsageIndicator.stories.tsx` |
| 2 | AIResult | Default, Empty, Error | `frontend/src/components/AIResult.stories.tsx` |
| 2 | ChapterList | WithChapters, Empty, Loading | `frontend/src/components/ChapterList.stories.tsx` |
| 2 | CharacterList | WithCharacters, Empty | `frontend/src/components/CharacterList.stories.tsx` |
| 2 | DarkModeToggle | Light, Dark | `frontend/src/components/DarkModeToggle.stories.tsx` |
| 2 | Editor | Default | `frontend/src/components/Editor.stories.tsx` (special-case TipTap demo wrapper) |
| 2 | Export | Default, Open | `frontend/src/components/Export.stories.tsx` |
| 3 | CharacterSheet | Open, OpenWithConfirm | `frontend/src/components/CharacterSheet.stories.tsx` |
| 3 | StoryModal | Create, Edit, WithError | `frontend/src/components/StoryModal.stories.tsx` |

**Skipped (with reason in PR description):**
- `EditorPage.stories.tsx` — page-level component; mocking router + auth + TanStack Query has high cost, low value.
- `AccountPrivacyModal.stories.tsx`, `Settings.stories.tsx`, `StoryPicker.stories.tsx`, `ModelPicker.stories.tsx` — owned by [X22]; will be authored when those components migrate onto the `<Modal>` primitive.

**Not touched:**
- Component source files (`frontend/src/components/*.tsx`) — read-only here. No prop changes, no refactors.
- `.storybook/preview.tsx` — no global decorators added.

---

## Pre-task: Per-component prop audit

Before writing any story, read the source for each of the 11 components and note:
1. The component's prop signature.
2. Whether it uses `useNavigate` / `Link` (needs `MemoryRouter` wrapping).
3. Whether it calls TanStack Query hooks (`useQuery` / `useMutation`) directly (needs `QueryClientProvider` wrapping).
4. Whether it consumes Zustand stores (story can either use the real store or wrap in a setter).

Capture findings inline in each task.

---

## Task 1: Bundle 1 — AutosaveIndicator

**Files:**
- Read: `frontend/src/components/AutosaveIndicator.tsx`
- Create: `frontend/src/components/AutosaveIndicator.stories.tsx`

- [ ] **Step 1: Audit the component**

Open the source. Note the prop signature (likely `{ status: 'idle' | 'saving' | 'saved' | 'error', lastSavedAt?: Date }` or similar; confirm before writing). No router / Query dependencies expected — it's a leaf chrome element.

- [ ] **Step 2: Create the story file**

Template (adjust prop names to match the actual source):

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { AutosaveIndicator } from './AutosaveIndicator';

const meta = {
  title: 'Components/AutosaveIndicator',
  component: AutosaveIndicator,
} satisfies Meta<typeof AutosaveIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = { args: { status: 'idle' } };
export const Saving: Story = { args: { status: 'saving' } };
export const Saved: Story = { args: { status: 'saved', lastSavedAt: new Date('2026-04-30T12:34:56Z') } };
export const Error: Story = { args: { status: 'error' } };
```

- [ ] **Step 3: Build + commit**

```bash
cd frontend && npm run build-storybook -- --quiet
git add frontend/src/components/AutosaveIndicator.stories.tsx
git commit -m "feat(storybook): AutosaveIndicator stories — Bundle 1 backfill"
```

---

## Task 2: Bundle 1 — BalanceDisplay

**Files:**
- Read: `frontend/src/components/BalanceDisplay.tsx`
- Create: `frontend/src/components/BalanceDisplay.stories.tsx`

- [ ] **Step 1: Audit the component**

Check whether `BalanceDisplay` reads its data from a TanStack Query hook internally (likely `useVeniceBalanceQuery` or similar) or accepts props. If hook-based, the story must wrap in a `QueryClientProvider` and seed the cache; if prop-based, pass the values directly.

- [ ] **Step 2: Create the story**

If prop-based (prefer this — refactor the source if it's hook-only and trivial; otherwise wrap):

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { BalanceDisplay } from './BalanceDisplay';

const meta = {
  title: 'Components/BalanceDisplay',
  component: BalanceDisplay,
} satisfies Meta<typeof BalanceDisplay>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithBalance: Story = { args: { balance: 12.34, status: 'ready' } };
export const Loading: Story = { args: { status: 'loading' } };
export const Error: Story = { args: { status: 'error' } };
```

If hook-based, use this wrapper pattern (and keep it consistent with later tasks):

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

function withQuery(initialData: unknown) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['venice', 'balance'], initialData);  // adjust key
  return (Story: () => JSX.Element) => (
    <QueryClientProvider client={client}>
      <Story />
    </QueryClientProvider>
  );
}
```

- [ ] **Step 3: Build + commit**

```bash
cd frontend && npm run build-storybook -- --quiet
git add frontend/src/components/BalanceDisplay.stories.tsx
git commit -m "feat(storybook): BalanceDisplay stories — Bundle 1 backfill"
```

---

## Task 3: Bundle 1 — UsageIndicator

**Files:**
- Read: `frontend/src/components/UsageIndicator.tsx`
- Create: `frontend/src/components/UsageIndicator.stories.tsx`

- [ ] **Step 1: Audit + write**

UsageIndicator is a thin metadata strip; one story is enough.

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { UsageIndicator } from './UsageIndicator';

const meta = {
  title: 'Components/UsageIndicator',
  component: UsageIndicator,
} satisfies Meta<typeof UsageIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { tokens: 1240, model: 'venice-uncensored' } };
```

- [ ] **Step 2: Build + commit**

```bash
cd frontend && npm run build-storybook -- --quiet
git add frontend/src/components/UsageIndicator.stories.tsx
git commit -m "feat(storybook): UsageIndicator story — Bundle 1 backfill"
```

---

## Task 4: Bundle 2 — AIResult

**Files:**
- Read: `frontend/src/components/AIResult.tsx`
- Create: `frontend/src/components/AIResult.stories.tsx`

- [ ] **Step 1: Audit the component**

Likely accepts `{ result: string | null, error?: string, onApply: () => void, onDismiss: () => void }` or similar. Confirm.

- [ ] **Step 2: Create the story**

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { AIResult } from './AIResult';

const meta = {
  title: 'Components/AIResult',
  component: AIResult,
  args: { onApply: () => {}, onDismiss: () => {} },
} satisfies Meta<typeof AIResult>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { result: 'Lyra paused at the threshold, weighing the cost of one more step.' },
};
export const Empty: Story = { args: { result: null } };
export const Error: Story = { args: { error: 'Venice request failed (502)' } };
```

- [ ] **Step 3: Build + commit**

```bash
cd frontend && npm run build-storybook -- --quiet
git add frontend/src/components/AIResult.stories.tsx
git commit -m "feat(storybook): AIResult stories — Bundle 2 backfill"
```

---

## Task 5: Bundle 2 — ChapterList

**Files:**
- Read: `frontend/src/components/ChapterList.tsx`
- Create: `frontend/src/components/ChapterList.stories.tsx`

- [ ] **Step 1: Audit**

Likely needs `MemoryRouter` (uses `Link` to navigate to chapter IDs) and may accept either a `chapters` prop array or call `useChaptersQuery` internally.

- [ ] **Step 2: Create the story (prop-based template)**

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { MemoryRouter } from 'react-router-dom';
import { ChapterList } from './ChapterList';

const meta = {
  title: 'Components/ChapterList',
  component: ChapterList,
  decorators: [(Story) => <MemoryRouter><div style={{ width: 240 }}><Story /></div></MemoryRouter>],
} satisfies Meta<typeof ChapterList>;

export default meta;
type Story = StoryObj<typeof meta>;

const sampleChapters = [
  { id: 'c1', title: 'Threshold', orderIndex: 0, wordCount: 1240 },
  { id: 'c2', title: 'Descent', orderIndex: 1, wordCount: 980 },
  { id: 'c3', title: 'Untitled', orderIndex: 2, wordCount: 0 },
];

export const WithChapters: Story = { args: { chapters: sampleChapters, activeChapterId: 'c2' } };
export const Empty: Story = { args: { chapters: [], activeChapterId: null } };
export const Loading: Story = { args: { chapters: undefined, activeChapterId: null } };
```

(If the source is hook-only, either refactor it to accept a `chapters` prop with a hook-driven default for prod, or wrap with `QueryClientProvider` per the BalanceDisplay pattern. Refactoring is cleaner; capture the choice in the PR description.)

- [ ] **Step 3: Build + commit**

```bash
cd frontend && npm run build-storybook -- --quiet
git add frontend/src/components/ChapterList.stories.tsx
git commit -m "feat(storybook): ChapterList stories — Bundle 2 backfill"
```

---

## Task 6: Bundle 2 — CharacterList

**Files:**
- Read: `frontend/src/components/CharacterList.tsx`
- Create: `frontend/src/components/CharacterList.stories.tsx`

- [ ] **Step 1: Audit + write (mirror ChapterList's pattern)**

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { CharacterList } from './CharacterList';

const meta = {
  title: 'Components/CharacterList',
  component: CharacterList,
  decorators: [(Story) => <div style={{ width: 240 }}><Story /></div>],
} satisfies Meta<typeof CharacterList>;

export default meta;
type Story = StoryObj<typeof meta>;

const sample = [
  { id: 'ch1', name: 'Lyra', role: 'protagonist', traits: 'careful, curious' },
  { id: 'ch2', name: 'Kade', role: 'antagonist', traits: 'sharp-tongued' },
];

export const WithCharacters: Story = { args: { characters: sample } };
export const Empty: Story = { args: { characters: [] } };
```

(Wrap in `MemoryRouter` if the source uses `Link`.)

- [ ] **Step 2: Build + commit**

```bash
cd frontend && npm run build-storybook -- --quiet
git add frontend/src/components/CharacterList.stories.tsx
git commit -m "feat(storybook): CharacterList stories — Bundle 2 backfill"
```

---

## Task 7: Bundle 2 — DarkModeToggle

**Files:**
- Read: `frontend/src/components/DarkModeToggle.tsx`
- Create: `frontend/src/components/DarkModeToggle.stories.tsx`

- [ ] **Step 1: Audit**

DarkModeToggle likely consumes a Zustand theme store directly. For story purposes, either pass a `theme` + `onChange` prop pair (refactor if needed) or render the real store and document that toggling the story switches the global theme decorator on the side. The latter is simpler — DarkModeToggle is leaf-level.

- [ ] **Step 2: Create the story**

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { DarkModeToggle } from './DarkModeToggle';

const meta = {
  title: 'Components/DarkModeToggle',
  component: DarkModeToggle,
} satisfies Meta<typeof DarkModeToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Light: Story = {};
export const Dark: Story = {
  parameters: { theme: 'dark' },  // overrides the global toolbar default
};
```

- [ ] **Step 3: Build + commit**

```bash
cd frontend && npm run build-storybook -- --quiet
git add frontend/src/components/DarkModeToggle.stories.tsx
git commit -m "feat(storybook): DarkModeToggle stories — Bundle 2 backfill"
```

---

## Task 8: Bundle 2 — Editor (special case — TipTap)

**Files:**
- Read: `frontend/src/components/Editor.tsx`
- Create: `frontend/src/components/Editor.stories.tsx`

- [ ] **Step 1: Audit the Editor surface**

Editor mounts TipTap with multiple extensions (StarterKit + project-specific marks like `aiContinuation`, `charRef`). Story-mounting all of them faithfully has high cost; story-mounting just StarterKit gives an authentic-enough rendering for visual reference.

- [ ] **Step 2: Create the story with a minimum-viable EditorDemo wrapper**

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import StarterKit from '@tiptap/starter-kit';
import { EditorContent, useEditor } from '@tiptap/react';

function EditorDemo() {
  const editor = useEditor({
    extensions: [StarterKit],
    content: '<h1>Threshold</h1><p>Lyra paused at the threshold, weighing the cost of one more step.</p><p>Behind her, the corridor breathed.</p>',
  });
  return (
    <div className="paper-prose" style={{ width: 640, padding: 24, background: 'var(--bg)' }}>
      <EditorContent editor={editor} />
    </div>
  );
}

const meta = {
  title: 'Components/Editor',
  component: EditorDemo,
} satisfies Meta<typeof EditorDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
```

(Important: the wrapper renders `EditorContent` directly, not the project's `<Editor>` component — that one likely takes props the story can't sensibly fake. The point of the story is to exercise the prose tokens (`--prose-font` / `--prose-size` / `--prose-line-height`) inside Storybook so theme switches are visible.)

If the wrapper grows past ~30 lines, extract to `frontend/src/components/_storyHelpers/editorHarness.tsx` and document in the PR.

- [ ] **Step 3: Build + commit**

```bash
cd frontend && npm run build-storybook -- --quiet
git add frontend/src/components/Editor.stories.tsx
git commit -m "feat(storybook): Editor story (TipTap StarterKit demo) — Bundle 2 backfill"
```

---

## Task 9: Bundle 2 — Export

**Files:**
- Read: `frontend/src/components/Export.tsx`
- Create: `frontend/src/components/Export.stories.tsx`

- [ ] **Step 1: Audit**

Export likely renders a button + an uncontrolled dropdown (`useState` for open/closed inside). Two stories: button alone (default closed), dropdown forced open.

- [ ] **Step 2: Create the story**

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Export } from './Export';

const meta = {
  title: 'Components/Export',
  component: Export,
  args: { onExport: (format: string) => console.log('export', format) },
} satisfies Meta<typeof Export>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Open: Story = { args: { defaultOpen: true } };
```

(If the source doesn't accept `defaultOpen`, either add it as a controlled prop pair or write the Open story as a wrapper component that programmatically clicks the trigger via a ref — adding the prop is cleaner.)

- [ ] **Step 3: Build + commit**

```bash
cd frontend && npm run build-storybook -- --quiet
git add frontend/src/components/Export.stories.tsx
git commit -m "feat(storybook): Export stories — Bundle 2 backfill"
```

---

## Task 10: Bundle 3 — CharacterSheet

**Files:**
- Read: `frontend/src/components/CharacterSheet.tsx`
- Create: `frontend/src/components/CharacterSheet.stories.tsx`

- [ ] **Step 1: Audit**

CharacterSheet is the [F70]-pattern modal — controlled `open`, has a nested `role="alertdialog"` confirm dialog. Use the same `Demo`-wrapper approach as Modal stories.

- [ ] **Step 2: Create the story**

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Button } from '@/design/primitives';
import { CharacterSheet } from './CharacterSheet';

const sampleCharacter = {
  id: 'ch1',
  name: 'Lyra',
  role: 'protagonist',
  bio: 'A cartographer with a quiet streak.',
  traits: 'careful, curious, slow to anger',
};

function Demo({ initiallyOpen = true, withConfirm = false }: { initiallyOpen?: boolean; withConfirm?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  // (The withConfirm prop should drive the story to land on the confirm-open
  // sub-state. If the component doesn't expose a way to programmatically open
  // the confirm dialog, document that the user clicks "Delete" in the story.)
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>Reopen</Button>
      <CharacterSheet
        open={open}
        onClose={() => setOpen(false)}
        character={sampleCharacter}
        onSave={async () => setOpen(false)}
        onDelete={async () => setOpen(false)}
      />
    </>
  );
}

const meta = {
  title: 'Components/CharacterSheet',
  component: Demo,
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = { args: {} };
export const OpenWithConfirm: Story = { args: { withConfirm: true } };
```

(Adjust `CharacterSheet` props to match the actual source. Mock data colocated.)

- [ ] **Step 3: Build + commit**

```bash
cd frontend && npm run build-storybook -- --quiet
git add frontend/src/components/CharacterSheet.stories.tsx
git commit -m "feat(storybook): CharacterSheet stories — Bundle 3 backfill"
```

---

## Task 11: Bundle 3 — StoryModal

**Files:**
- Read: `frontend/src/components/StoryModal.tsx`
- Create: `frontend/src/components/StoryModal.stories.tsx`

- [ ] **Step 1: Audit**

StoryModal is Bundle 3's other primitive composition. Three stories: Create (empty form), Edit (populated), WithError (title-error wired through the Field's `error` slot).

- [ ] **Step 2: Create the story**

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Button } from '@/design/primitives';
import { StoryModal } from './StoryModal';

const sampleStory = {
  id: 's1',
  title: 'The Cartographer',
  description: 'A novel about borders, both real and imagined.',
};

function Demo({
  story,
  initialError,
}: {
  story?: typeof sampleStory;
  initialError?: string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>Reopen</Button>
      <StoryModal
        open={open}
        onClose={() => setOpen(false)}
        story={story}
        initialError={initialError}
        onSave={async () => setOpen(false)}
      />
    </>
  );
}

const meta = {
  title: 'Components/StoryModal',
  component: Demo,
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Create: Story = { args: {} };
export const Edit: Story = { args: { story: sampleStory } };
export const WithError: Story = { args: { initialError: 'Title already in use' } };
```

(`initialError` may not exist as a prop on the real component — if not, add it as an optional prop with a sane default, or programmatically trigger the error state via a Demo wrapper that submits and captures the result.)

- [ ] **Step 3: Build + commit**

```bash
cd frontend && npm run build-storybook -- --quiet
git add frontend/src/components/StoryModal.stories.tsx
git commit -m "feat(storybook): StoryModal stories — Bundle 3 backfill"
```

---

## Task 12: Final verification + open PR

- [ ] **Step 1: Run the full verify**

```bash
cd frontend && npm run build-storybook -- --quiet \
  && npm run lint:design \
  && for c in AutosaveIndicator BalanceDisplay UsageIndicator AIResult ChapterList CharacterList DarkModeToggle Editor Export CharacterSheet StoryModal; do
       test -f frontend/src/components/$c.stories.tsx || { echo "missing: $c.stories.tsx"; exit 1; }
     done \
  && npx biome ci src/components/
```

Expected: all checks exit 0.

- [ ] **Step 2: Manual three-theme flip**

Run: `cd frontend && npm run storybook`

Click through every new story under `Components/` and toggle paper / sepia / dark via the toolbar. Capture any visual regressions in the PR description (especially in `Editor` — TipTap selection / cursor colour can drift across themes).

- [ ] **Step 3: Open PR**

```bash
git push origin feature/storybook-phase4
gh pr create --title "feat(storybook): backfill stories for Phase 2 component ports" --body "$(cat <<'EOF'
## Summary
- 11 new `*.stories.tsx` files covering every component actively ported in PR #39.
- Bundle 1 (token-swap leaves): AutosaveIndicator, BalanceDisplay, UsageIndicator.
- Bundle 2 (primitive Button + token swap): AIResult, ChapterList, CharacterList, DarkModeToggle, Editor, Export.
- Bundle 3 (full primitive composition): CharacterSheet, StoryModal.
- ~26 stories total; no component source changes (any prop additions noted per-task).

## Skipped (documented in plan)
- `EditorPage` — page-level component; mocking router + auth + Query has high cost, low value.
- `AccountPrivacyModal`, `Settings`, `StoryPicker`, `ModelPicker` — owned by [X22]; will be backfilled when those components migrate onto the Modal primitive.

## Verify
- `cd frontend && npm run build-storybook -- --quiet` ✓
- `cd frontend && npm run lint:design` ✓
- `cd frontend && npx biome ci src/components/` ✓
- Manual three-theme flip across every new story ✓
EOF
)"
```

---

## Self-review notes (run before merge)

1. **Spec coverage:** 11 of the 12 Phase 2 ports covered; `EditorPage` skip and `[X22]` deferral both documented.
2. **Placeholder scan:** Each task ships actual code. Where the source might require a small prop addition (e.g. `Export`'s `defaultOpen`), the plan flags the choice rather than hand-waving.
3. **Type consistency:** `Demo` wrappers in Tasks 10 / 11 use the same `useState(true)` + `Button` reopen pattern from [F70]. Mock data shapes are inline; no shared fixtures referenced from outside the story file.
4. **Sequencing:** Tasks 1–11 are independent (different files). Task 12 must run last. If [X22] lands first, Tasks 10 / 11 should additionally backfill the four `[X22]` components — note in PR description.
