# [F69] Storybook Primitive Stories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author Storybook stories for the seven non-Modal primitives in `frontend/src/design/` — `Button`, `IconButton`, `Field`, `Input`, `Textarea`, `Pill`, `Spinner` — covering each primitive's variant / state matrix. Single PR. Modal is its own task ([F70]) because it needs a stateful wrapper.

**Architecture:**
- One `*.stories.tsx` per primitive, sibling to [frontend/src/design/primitives.tsx](frontend/src/design/primitives.tsx) (the file that exports them all). Storybook's auto-glob in `.storybook/main.ts` picks them up by location alone — no registration step.
- Stories are pure presentational: `args` only, no state, no router, no QueryClient. Primitives are headless and don't depend on app context.
- Each story declares `Meta<typeof Primitive>` + named state stories using `StoryObj<typeof meta>`. Snippet shape from [docs/HANDOFF.md](../HANDOFF.md) § "First stories — cover the primitives".
- The state matrix per primitive is decided up-front (see § File Structure below) so coverage is consistent across files rather than ad-hoc per author.

**Decision points pinned in the plan:**
1. **No automated test runner per story file** — verification is the Storybook build (catches type errors, missing imports, prop drift) plus manual theme flip in the Storybook UI. Visual regression is owned by [X24], not this task.
2. **No blanket Biome ignore for stories.** If `biome ci` flags a hand-written story, fix it narrowly (drop unused import, type the args object). HANDOFF.md § "Tooling interactions" rationale: a blanket ignore lets real bugs slip in.
3. **`lint:design` deliberately scans stories** (the `.stories.tsx` exclusion was removed when [frontend/scripts/lint-design.mjs](../../frontend/scripts/lint-design.mjs) was updated for Phase 4). Stories must use only token classes — no `bg-blue-600` etc. This is enforced; don't sidestep with `lint:design-allow` markers.
4. **State matrix is exhaustive but not redundant.** Each story exercises a distinct, visible behavior. No "Default" alongside an args-only `Primary`; pick the more descriptive name and ship one.
5. **No story-local helper extraction in this PR.** If a state needs >5 lines of setup (it shouldn't for these primitives), inline it. Helper extraction is a follow-up if it ever becomes needed.

**Tech Stack:** Storybook 9.x (installed by [F68]), React 19, TypeScript strict, Tailwind v4 (token classes from `@theme` block in [frontend/src/index.css](../../frontend/src/index.css)), Biome 2.4.13.

**Source-of-truth references:**
- [frontend/src/design/primitives.tsx](../../frontend/src/design/primitives.tsx) — all primitive APIs. Read the JSX signature before writing each story; don't trust the inline plan in TASKS.md if it conflicts with the actual file.
- [docs/HANDOFF.md](../HANDOFF.md) § "First stories — cover the primitives" — the Button.stories.tsx template.
- [frontend/.storybook/preview.tsx](../../frontend/.storybook/preview.tsx) — theme decorator (paper / sepia / dark global toolbar) wired in [F68].

---

## File Structure

**Create (frontend):**
- `frontend/src/design/Button.stories.tsx` — 7 stories (Primary, Ghost, Danger, Link, Loading, Disabled, SmallGhost)
- `frontend/src/design/IconButton.stories.tsx` — 3 stories (Default, Active, Disabled)
- `frontend/src/design/Field.stories.tsx` — 3 stories (WithHint, WithError, Required)
- `frontend/src/design/Input.stories.tsx` — 5 stories (Default, Mono, Serif, Sans, Invalid, Disabled, Placeholder)
- `frontend/src/design/Textarea.stories.tsx` — 4 stories (Default, Filled, Invalid, Disabled)
- `frontend/src/design/Pill.stories.tsx` — 4 stories (Accent, AI, Danger, Neutral)
- `frontend/src/design/Spinner.stories.tsx` — 3 stories (Default, Large, ExtraLarge)

**Not touched in this PR:**
- `frontend/src/design/primitives.tsx` — read-only here; no API changes.
- `frontend/src/design/Modal.stories.tsx` — owned by [F70].
- `frontend/src/design/Tokens.stories.tsx` — owned by [F71].

**State matrix decided up-front** (per primitive, in stable order so the Storybook sidebar reads consistently):

| Primitive | Story name | Args |
|---|---|---|
| Button | Primary | `variant: 'primary'` |
| Button | Ghost | `variant: 'ghost'` (default) |
| Button | Danger | `variant: 'danger'` |
| Button | Link | `variant: 'link', children: 'Read more'` |
| Button | Loading | `variant: 'primary', loading: true, children: 'Saving…'` |
| Button | Disabled | `variant: 'primary', disabled: true` |
| Button | SmallGhost | `variant: 'ghost', size: 'sm'` |
| IconButton | Default | `ariaLabel: 'Close', children: <CloseGlyph/>` |
| IconButton | Active | `ariaLabel: 'Bold', active: true, children: <BGlyph/>` |
| IconButton | Disabled | `ariaLabel: 'Close', disabled: true, children: <CloseGlyph/>` |
| Field | WithHint | `label: 'Display name', hint: 'Optional', children: <Input/>` |
| Field | WithError | `label: 'Username', error: 'Already taken', children: <Input invalid/>` |
| Field | Required | `label: 'Password', hint: 'Required', children: <Input/>` |
| Input | Default | (font defaults to mono) |
| Input | Serif | `font: 'serif'` |
| Input | Sans | `font: 'sans'` |
| Input | Invalid | `invalid: true, defaultValue: 'foo bar'` |
| Input | Disabled | `disabled: true, defaultValue: 'read-only'` |
| Input | Placeholder | `placeholder: 'Enter a story title…'` |
| Textarea | Default | (font defaults to serif, rows=3) |
| Textarea | Filled | `defaultValue: 'Once upon a time…\n\nThe end.', rows: 5` |
| Textarea | Invalid | `invalid: true, defaultValue: '!!!'` |
| Textarea | Disabled | `disabled: true, defaultValue: 'cannot edit'` |
| Pill | Accent | `tone: 'accent', children: 'Open'` |
| Pill | AI | `tone: 'ai', children: 'AI'` |
| Pill | Danger | `tone: 'danger', children: 'Failed'` |
| Pill | Neutral | `tone: 'neutral', children: 'Draft'` |
| Spinner | Default | (12px) |
| Spinner | Large | `size: 24` |
| Spinner | ExtraLarge | `size: 48` |

(Input has 6 stories not 5; the table is authoritative.)

---

## Task 1: Button stories

**Files:**
- Create: `frontend/src/design/Button.stories.tsx`

- [ ] **Step 1: Create the file**

Verbatim from HANDOFF.md § "First stories", with `Disabled` and `SmallGhost` added per the matrix:

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './primitives';

const meta = {
  title: 'Primitives/Button',
  component: Button,
  args: { children: 'Save changes' },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = { args: { variant: 'primary' } };
export const Ghost: Story = { args: { variant: 'ghost' } };
export const Danger: Story = { args: { variant: 'danger' } };
export const Link: Story = { args: { variant: 'link', children: 'Read more' } };
export const Loading: Story = {
  args: { variant: 'primary', loading: true, children: 'Saving…' },
};
export const Disabled: Story = { args: { variant: 'primary', disabled: true } };
export const SmallGhost: Story = { args: { variant: 'ghost', size: 'sm' } };
```

- [ ] **Step 2: Verify it builds**

Run: `cd frontend && npm run build-storybook -- --quiet`
Expected: PASS, `storybook-static/` directory created, no warnings about Button stories.

- [ ] **Step 3: Manual theme flip (one-time per primitive)**

Run: `cd frontend && npm run storybook` (background)
Open: `http://localhost:6006`, navigate to `Primitives/Button`. Click each story. Use the Theme toolbar in the top bar to flip paper → sepia → dark. Confirm:
- Primary button text remains readable on its ink background in all three themes.
- Ghost border is visible against the surface in dark theme (the dark theme `--line` is `#2a2821` against a `#1c1b17` elevated surface — should be visible but quiet).
- Danger button's `--danger` token reads as a warm red/brown across themes.

Stop the dev server when done.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/design/Button.stories.tsx
git commit -m "feat(storybook): Button.stories.tsx with 7 state stories"
```

---

## Task 2: IconButton stories

**Files:**
- Create: `frontend/src/design/IconButton.stories.tsx`

- [ ] **Step 1: Create the file**

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { IconButton } from './primitives';

function CloseGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M18 6L6 18" />
      <path d="M6 6l12 12" />
    </svg>
  );
}

function BoldGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 4h7a4 4 0 010 8H6zM6 12h8a4 4 0 010 8H6z" />
    </svg>
  );
}

const meta = {
  title: 'Primitives/IconButton',
  component: IconButton,
  args: { ariaLabel: 'Close', children: <CloseGlyph /> },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Active: Story = {
  args: { ariaLabel: 'Bold', active: true, children: <BoldGlyph /> },
};
export const Disabled: Story = { args: { disabled: true } };
```

- [ ] **Step 2: Verify it builds**

Run: `cd frontend && npm run build-storybook -- --quiet`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/design/IconButton.stories.tsx
git commit -m "feat(storybook): IconButton.stories.tsx with 3 state stories"
```

---

## Task 3: Field stories

**Files:**
- Create: `frontend/src/design/Field.stories.tsx`

- [ ] **Step 1: Create the file**

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Field, Input, useId } from './primitives';

function FieldDemo({
  label,
  hint,
  error,
  invalid,
}: {
  label: string;
  hint?: string;
  error?: string;
  invalid?: boolean;
}) {
  const id = useId();
  return (
    <div style={{ width: 320 }}>
      <Field label={label} hint={hint} error={error} htmlFor={id}>
        <Input id={id} invalid={invalid} defaultValue="" placeholder="Type something…" />
      </Field>
    </div>
  );
}

const meta = {
  title: 'Primitives/Field',
  component: FieldDemo,
} satisfies Meta<typeof FieldDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithHint: Story = { args: { label: 'Display name', hint: 'Optional' } };
export const WithError: Story = {
  args: { label: 'Username', error: 'Already taken', invalid: true },
};
export const Required: Story = { args: { label: 'Password', hint: 'Required' } };
```

(Wraps `Field` + `Input` together because `Field` accepts `children` — solo `Field` doesn't render anything visible. The demo wrapper is two components; that's still a primitive story, not a composite one.)

- [ ] **Step 2: Verify it builds**

Run: `cd frontend && npm run build-storybook -- --quiet`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/design/Field.stories.tsx
git commit -m "feat(storybook): Field.stories.tsx with 3 state stories"
```

---

## Task 4: Input stories

**Files:**
- Create: `frontend/src/design/Input.stories.tsx`

- [ ] **Step 1: Create the file**

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Input } from './primitives';

const meta = {
  title: 'Primitives/Input',
  component: Input,
  args: { defaultValue: '' },
  decorators: [(Story) => <div style={{ width: 320 }}><Story /></div>],
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { placeholder: 'mono (default)' } };
export const Serif: Story = { args: { font: 'serif', placeholder: 'serif' } };
export const Sans: Story = { args: { font: 'sans', placeholder: 'sans' } };
export const Invalid: Story = { args: { invalid: true, defaultValue: 'foo bar' } };
export const Disabled: Story = { args: { disabled: true, defaultValue: 'read-only' } };
export const Placeholder: Story = { args: { placeholder: 'Enter a story title…' } };
```

- [ ] **Step 2: Verify it builds**

Run: `cd frontend && npm run build-storybook -- --quiet`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/design/Input.stories.tsx
git commit -m "feat(storybook): Input.stories.tsx with 6 state stories"
```

---

## Task 5: Textarea stories

**Files:**
- Create: `frontend/src/design/Textarea.stories.tsx`

- [ ] **Step 1: Create the file**

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Textarea } from './primitives';

const meta = {
  title: 'Primitives/Textarea',
  component: Textarea,
  args: { defaultValue: '' },
  decorators: [(Story) => <div style={{ width: 480 }}><Story /></div>],
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { placeholder: 'Your prose here…' } };
export const Filled: Story = {
  args: { defaultValue: 'Once upon a time…\n\nThe end.', rows: 5 },
};
export const Invalid: Story = { args: { invalid: true, defaultValue: '!!!' } };
export const Disabled: Story = { args: { disabled: true, defaultValue: 'cannot edit' } };
```

- [ ] **Step 2: Verify it builds**

Run: `cd frontend && npm run build-storybook -- --quiet`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/design/Textarea.stories.tsx
git commit -m "feat(storybook): Textarea.stories.tsx with 4 state stories"
```

---

## Task 6: Pill stories

**Files:**
- Create: `frontend/src/design/Pill.stories.tsx`

- [ ] **Step 1: Create the file**

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Pill } from './primitives';

const meta = {
  title: 'Primitives/Pill',
  component: Pill,
  args: { children: 'Open' },
} satisfies Meta<typeof Pill>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Accent: Story = { args: { tone: 'accent' } };
export const AI: Story = { args: { tone: 'ai', children: 'AI' } };
export const Danger: Story = { args: { tone: 'danger', children: 'Failed' } };
export const Neutral: Story = { args: { tone: 'neutral', children: 'Draft' } };
```

- [ ] **Step 2: Verify it builds**

Run: `cd frontend && npm run build-storybook -- --quiet`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/design/Pill.stories.tsx
git commit -m "feat(storybook): Pill.stories.tsx with 4 tone stories"
```

---

## Task 7: Spinner stories

**Files:**
- Create: `frontend/src/design/Spinner.stories.tsx`

- [ ] **Step 1: Create the file**

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Spinner } from './primitives';

const meta = {
  title: 'Primitives/Spinner',
  component: Spinner,
} satisfies Meta<typeof Spinner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Large: Story = { args: { size: 24 } };
export const ExtraLarge: Story = { args: { size: 48 } };
```

- [ ] **Step 2: Verify it builds**

Run: `cd frontend && npm run build-storybook -- --quiet`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/design/Spinner.stories.tsx
git commit -m "feat(storybook): Spinner.stories.tsx with 3 size stories"
```

---

## Task 8: Final verification + open PR

- [ ] **Step 1: Run the full verify**

```bash
cd frontend && npm run build-storybook -- --quiet && npm run lint:design && npx biome ci src/design/
```

Expected: all three commands exit 0. Specifically:
- `build-storybook` produces `storybook-static/` with no warnings.
- `lint:design` reports `✓ No design-token drift.` (the stories use only token classes).
- `biome ci src/design/` is clean. **If Biome flags anything, fix narrowly** — drop unused imports, type the args object explicitly. Do NOT add `**/*.stories.tsx` to `biome.json`'s ignore list. HANDOFF.md § "Tooling interactions" rationale.

- [ ] **Step 2: Manual three-theme flip across all stories**

Run: `cd frontend && npm run storybook`
For each of the 7 primitive sidebars, click through every story and toggle paper/sepia/dark via the toolbar. Confirm no obvious visual regressions (stuff invisible against the surface, contrast failure, hex literals showing through where a token should be). Document any regressions in the PR description; if a primitive itself is buggy across themes, that's a bug fix in `primitives.tsx` outside this PR's scope — file a follow-up.

Stop the dev server.

- [ ] **Step 3: Open PR**

```bash
git push -u origin feature/storybook-phase4
gh pr create --title "feat(storybook): primitive stories — Button, IconButton, Field, Input, Textarea, Pill, Spinner" --body "$(cat <<'EOF'
## Summary
- 7 primitive stories landing as a single PR per the [F69] plan.
- 30 stories total covering every documented variant / state of each primitive.
- No primitive API changes; this is pure story authoring.

## Verify
- `cd frontend && npm run build-storybook -- --quiet` ✓
- `cd frontend && npm run lint:design` ✓
- `cd frontend && npx biome ci src/design/` ✓
- Manual three-theme flip across every story ✓

## Follow-ups
- Modal.stories.tsx — [F70]
- Tokens.stories.tsx — [F71]
- Backfill stories for Phase 2 component ports — [F73]
EOF
)"
```

---

## Self-review notes (run before merge)

1. **Spec coverage:** Every primitive in the [F69] state-matrix table has a corresponding story file. Modal is excluded (owned by [F70]); Tokens is excluded (owned by [F71]).
2. **Placeholder scan:** No "TBD", no "similar to Task N", no "add validation here". Every step contains the actual code or command.
3. **Type consistency:** `BoldGlyph`/`CloseGlyph` are colocated in `IconButton.stories.tsx`, not imported from a shared file (DRY-violation avoidance — they're 4 lines each and used once).
4. **Sequencing:** Tasks 1–7 are independent; can be done in any order. Task 8 must run last.
