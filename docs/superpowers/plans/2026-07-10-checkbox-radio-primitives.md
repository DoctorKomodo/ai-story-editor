# Checkbox / Radio / RadioGroup Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `Checkbox`, `Radio`, `RadioGroup`, and `CheckboxField` primitives to the design system and migrate the 8 hand-rolled checkbox sites + `NewDraftDialog`'s radios onto them, so `story-editor-6ze` cannot add an 11th/5th bespoke control.

**Architecture:** `Checkbox`/`Radio` are bare, presentational, forwardRef inputs in `frontend/src/design/primitives.tsx`, built on the same `Omit<InputHTMLAttributes, 'type'>` + `cx()` house pattern as `Input`/`Textarea`. `RadioGroup` is a generic `<fieldset>` composition; `CheckboxField` is the two-line labelled-checkbox composition lifted verbatim (in behavior) from `SettingsWritingTab`'s local `ToggleRow`. Migrations preserve every `checked`/`onChange`/`disabled`/`data-testid`/`id`/`aria-*` contract; the only visual changes are the spec's pre-approved ones.

**Tech Stack:** React 19, TypeScript strict, Tailwind v4 (CSS-first tokens), Vitest + @testing-library/react (jsdom), Storybook (CSF3, `@storybook/react-vite`).

**Spec:** `docs/superpowers/specs/2026-07-10-checkbox-radio-primitives-design.md`
**bd issue:** `story-editor-0x2` (blocks `story-editor-6ze`)

## Global Constraints

- TypeScript strict, no `any`. `RadioGroup` is generic over the value union (`<T extends string>`); no `string` widening.
- Design tokens only. `frontend/scripts/lint-design.mjs` (`npm --prefix frontend run lint:design`) rejects Tailwind palette colors, `bg-white`/`text-black`, `shadow-{sm,md,lg,xl,2xl}`, `focus:ring-*`, raw hex, and bare `rgb()`/`hsl()`. `accent-accent`, `text-ink-*`, `bg-[var(--token)]` are permitted (`accent-accent` maps to `--color-accent: var(--accent)` and matches no lint pattern — already used at `StoryModal.tsx:284`).
- Storybook is the UI source of truth. New primitives get `Primitives/<Name>` stories co-located in `frontend/src/design/`.
- Commit message format: `[story-editor-0x2] <brief description>`.
- A pre-commit hook runs `biome check --write` on staged files. Do not fight it; let it reformat.
- **Every existing regression suite must pass completely unmodified** — no query changes, no assertion changes. The load-bearing ones: `Settings.writing.test.tsx` (the five `writing-*-toggle` ids being lifted into `CheckboxField`), `Settings.models`, `Settings.prompts`, `SettingsDataTab`, `Settings.shell-venice`, plus every `getByRole('checkbox'|'radio')`. If a migration seems to need a test edited, the migration is wrong — fix the component.
- **Pre-approved visual deltas (do NOT "fix" these):** the 4 browser-default checkboxes gain `accent-accent` + 16px; ChatComposer's checkbox grows 14px → 16px; the two-line rows' checkbox top-margin shifts `mt-1` → `mt-0.5`. No test asserts a checkbox/radio size or classname (grep-verified).

### Existing-surface inventory (required by `docs/agent-workflow.md` §2)

Verified by grep/read against this branch (`feature/checkbox-radio-primitives`, based on `origin/main`) before the plan was written:

| Thing | Exists? | Where | Decision |
|---|---|---|---|
| `Input`/`Textarea` forwardRef + `cx()` + `Omit`-less `InputHTMLAttributes` | Yes | `primitives.tsx:405-453` | **Follow the pattern.** `Checkbox`/`Radio` add `Omit<…, 'type'>` (they own `type`). |
| `cx` classname merge | Yes | `primitives.tsx:51-53` | Reuse. No `clsx` dependency exists. |
| `Field` (label + hint + error) | Yes | `primitives.tsx` (~`FieldProps`) | Not reused by `CheckboxField` — `Field` is for text inputs (label *above*), `CheckboxField` is label *beside*. Distinct. |
| `ToggleRow` (the shape to lift) | Yes | `SettingsWritingTab.tsx:90-129` | **Lift into `design/` as `CheckboxField`**, delete the local copy. |
| A `Checkbox`/`Radio`/`RadioGroup` primitive | **No** | — | This is what we build. |
| `Primitives/*` story namespace | Yes | `frontend/src/design/*.stories.tsx` | Follow (see `Input.stories.tsx`). |
| `frontend/tests/design/` | Yes | `ModalCentering.test.tsx`, `ThinkingDots.test.tsx` | Put new unit tests here. |
| `accent-accent` token utility | Yes | `--color-accent: var(--accent)` (`index.css`) | Use as the primitive base. |
| `.recovery-code-confirm input[type="checkbox"]` CSS rule | Yes | `index.css:273-275` | **Delete** when RecoveryCodeCard migrates (Task 4). |

**No new dependency is added.**

---

## File Structure

- **Modify** `frontend/src/design/primitives.tsx` — add `Checkbox`, `Radio`, `RadioGroup`, `CheckboxField` after `Textarea` (~line 453, before the Pill block).
- **Create** `frontend/tests/design/Checkbox.test.tsx`, `frontend/tests/design/Radio.test.tsx` — unit tests for the four new exports.
- **Create** `frontend/src/design/Checkbox.stories.tsx` (`Primitives/Checkbox`, covering `Checkbox` + `CheckboxField`), `frontend/src/design/Radio.stories.tsx` (`Primitives/Radio`, covering `Radio` + `RadioGroup`).
- **Modify** the 8 checkbox call sites + `NewDraftDialog` (radios), one per migration task.
- **Modify** `frontend/src/index.css` — delete the redundant checkbox CSS rule (in the RecoveryCodeCard task).

**Task order:** Task 1 builds `Checkbox`/`Radio`/`RadioGroup` + tests + stories. Task 2 builds `CheckboxField` + its story coverage. Tasks 3-11 each migrate one site (bare-`Checkbox` sites first, then the two `CheckboxField` sites, then the radios), easiest → riskiest. Each task is independently committable and reviewable.

---

## Task 1: `Checkbox`, `Radio`, `RadioGroup` primitives

**Files:**
- Modify: `frontend/src/design/primitives.tsx` (insert after `Textarea`, ~line 453)
- Test: `frontend/tests/design/Checkbox.test.tsx` (create), `frontend/tests/design/Radio.test.tsx` (create)
- Create: `frontend/src/design/Checkbox.stories.tsx`, `frontend/src/design/Radio.stories.tsx`

**Interfaces:**
- Consumes: `cx` (`primitives.tsx:51`), `forwardRef`, `InputHTMLAttributes`, `ReactNode` — all already imported in `primitives.tsx`.
- Produces, exported from `@/design/primitives`:
  - `Checkbox: (props: CheckboxProps) => JSX.Element` where `CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>`.
  - `Radio: (props: RadioProps) => JSX.Element`, same prop type.
  - `RadioGroup<T extends string>(props: RadioGroupProps<T>): JSX.Element` with `RadioOption<T> = { value: T; label: ReactNode; disabled?: boolean; testId?: string }` and `RadioGroupProps<T> = { name: string; legend: ReactNode; srOnlyLegend?: boolean; value: T; onChange: (value: T) => void; options: RadioOption<T>[]; disabled?: boolean }`.
  Tasks 3-11 import these.

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/design/Checkbox.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from '@/design/primitives';

describe('Checkbox', () => {
  it('renders a checkbox input carrying the base classes', () => {
    render(<Checkbox aria-label="agree" />);
    const box = screen.getByRole('checkbox', { name: 'agree' });
    expect(box).toHaveAttribute('type', 'checkbox');
    expect(box.className).toMatch(/accent-accent/);
    expect(box.className).toMatch(/w-4/);
  });

  it('reflects checked and fires onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} aria-label="agree" />);
    await user.click(screen.getByRole('checkbox', { name: 'agree' }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('does not fire onChange while disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox checked={false} disabled onChange={onChange} aria-label="agree" />);
    await user.click(screen.getByRole('checkbox', { name: 'agree' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('forwards data-testid, id, and aria-describedby, and merges className', () => {
    render(
      <Checkbox
        id="cb1"
        data-testid="cb-test"
        aria-describedby="hint1"
        className="mt-0.5"
        aria-label="agree"
      />,
    );
    const box = screen.getByTestId('cb-test');
    expect(box).toHaveAttribute('id', 'cb1');
    expect(box).toHaveAttribute('aria-describedby', 'hint1');
    expect(box.className).toMatch(/accent-accent/); // base kept
    expect(box.className).toMatch(/mt-0\.5/); // caller class merged, not replaced
  });
});
```

Create `frontend/tests/design/Radio.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Radio, RadioGroup } from '@/design/primitives';

describe('Radio', () => {
  it('renders a radio input with the base classes', () => {
    render(<Radio name="g" value="a" aria-label="option a" />);
    const radio = screen.getByRole('radio', { name: 'option a' });
    expect(radio).toHaveAttribute('type', 'radio');
    expect(radio.className).toMatch(/accent-accent/);
  });
});

describe('RadioGroup', () => {
  const options = [
    { value: 'fork' as const, label: 'Fork', testId: 'opt-fork' },
    { value: 'blank' as const, label: 'Start blank', testId: 'opt-blank' },
  ];

  it('renders a labelled group with one radio per option and marks the selected one', () => {
    render(
      <RadioGroup
        name="mode"
        legend="Starting point"
        value="fork"
        onChange={vi.fn()}
        options={options}
      />,
    );
    const group = screen.getByRole('radiogroup', { name: 'Starting point' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Fork' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Start blank' })).not.toBeChecked();
  });

  it('calls onChange with the selected value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RadioGroup
        name="mode"
        legend="Starting point"
        value="fork"
        onChange={onChange}
        options={options}
      />,
    );
    await user.click(screen.getByRole('radio', { name: 'Start blank' }));
    expect(onChange).toHaveBeenCalledWith('blank');
  });

  it('hides the legend visually when srOnlyLegend is set but keeps it accessible', () => {
    render(
      <RadioGroup
        name="mode"
        legend="Starting point"
        srOnlyLegend
        value="fork"
        onChange={vi.fn()}
        options={options}
      />,
    );
    // Still the accessible name of the group.
    expect(screen.getByRole('radiogroup', { name: 'Starting point' })).toBeInTheDocument();
    // Legend element carries sr-only.
    expect(screen.getByText('Starting point').className).toMatch(/sr-only/);
  });

  it('disables all radios when the group is disabled', () => {
    render(
      <RadioGroup
        name="mode"
        legend="Starting point"
        value="fork"
        onChange={vi.fn()}
        options={options}
        disabled
      />,
    );
    expect(screen.getByRole('radio', { name: 'Fork' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Start blank' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm --prefix frontend run test -- --run tests/design/Checkbox.test.tsx tests/design/Radio.test.tsx
```

Expected: FAIL — `"Checkbox" is not exported by src/design/primitives.tsx` (and `Radio`/`RadioGroup`).

- [ ] **Step 3: Implement the three primitives**

In `frontend/src/design/primitives.tsx`, insert **after** the closing `});` of `Textarea` (~line 453) and **before** the `/* ===… Pill …=== */` comment:

```tsx
/* ============================================================================
 * Checkbox / Radio — bare, controlled, token-styled native inputs.
 *
 * `type` is Omit-ted from the props so the primitive genuinely owns it: the
 * base type is not overridable, and `{...rest}` cannot smuggle a different
 * one back in. Everything else (checked, onChange, disabled, id, name, value,
 * data-testid, aria-*) flows through unchanged, so callers keep their exact
 * contracts. `className` merges last for per-site alignment (e.g. `mt-0.5`).
 * ========================================================================== */

const CHECK_CONTROL_BASE =
  'accent-accent w-4 h-4 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, ...rest },
  ref,
): JSX.Element {
  return <input ref={ref} type="checkbox" className={cx(CHECK_CONTROL_BASE, className)} {...rest} />;
});

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {}

export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio(
  { className, ...rest },
  ref,
): JSX.Element {
  return <input ref={ref} type="radio" className={cx(CHECK_CONTROL_BASE, className)} {...rest} />;
});

/* ============================================================================
 * RadioGroup — a labelled <fieldset> that drives selection from one `value`.
 * Generic over the value union so callers keep their literal types.
 * ========================================================================== */

export interface RadioOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  testId?: string;
}

export interface RadioGroupProps<T extends string> {
  /** Shared `name` across the options. */
  name: string;
  /** Accessible group label, rendered as a <legend>. */
  legend: ReactNode;
  /** Visually hide the legend (keeps it as the group's accessible name). */
  srOnlyLegend?: boolean;
  value: T;
  onChange: (value: T) => void;
  options: RadioOption<T>[];
  /** Disable every radio in the group. */
  disabled?: boolean;
}

export function RadioGroup<T extends string>({
  name,
  legend,
  srOnlyLegend,
  value,
  onChange,
  options,
  disabled,
}: RadioGroupProps<T>): JSX.Element {
  return (
    // `role="radiogroup"` is explicit: a bare <fieldset>'s implicit ARIA role
    // is `group`, NOT `radiogroup` (verified in jsdom). Without it,
    // getByRole('radiogroup') does not match. The <legend> is the group's
    // accessible name either way.
    <fieldset role="radiogroup" className="flex flex-col gap-1.5 border-0 p-0 m-0">
      <legend className={srOnlyLegend ? 'sr-only' : 'text-[12px] font-medium text-ink-2 mb-1'}>
        {legend}
      </legend>
      {options.map((opt) => (
        <label
          key={opt.value}
          className="flex items-center gap-2 font-sans text-[13px] text-ink cursor-pointer"
        >
          <Radio
            name={name}
            value={opt.value}
            checked={value === opt.value}
            disabled={disabled || opt.disabled}
            data-testid={opt.testId}
            onChange={() => {
              onChange(opt.value);
            }}
          />
          {opt.label}
        </label>
      ))}
    </fieldset>
  );
}
```

Note: the `role="radiogroup"` on the `<fieldset>` is load-bearing. A bare `<fieldset>` exposes the implicit ARIA role `group`, **not** `radiogroup` (empirically verified in this repo's jsdom: `getByRole('radiogroup')` throws on a plain `<fieldset>`, and matches once `role="radiogroup"` is set). The `<legend>` supplies the group's accessible name in both cases. Do not remove the explicit `role`.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm --prefix frontend run test -- --run tests/design/Checkbox.test.tsx tests/design/Radio.test.tsx
```

Expected: PASS (4 Checkbox + 5 Radio/RadioGroup tests).

- [ ] **Step 5: Add the Storybook stories**

Create `frontend/src/design/Checkbox.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Checkbox } from './primitives';

const meta = {
  title: 'Primitives/Checkbox',
  component: Checkbox,
  args: { 'aria-label': 'Example checkbox' },
  decorators: [
    (Story) => (
      <div style={{ padding: 16 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unchecked: Story = { args: { defaultChecked: false } };
export const Checked: Story = { args: { defaultChecked: true } };
export const Disabled: Story = { args: { defaultChecked: true, disabled: true } };
```

Create `frontend/src/design/Radio.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { RadioGroup } from './primitives';

const meta = {
  title: 'Primitives/Radio',
  component: RadioGroup,
  args: {
    name: 'demo',
    legend: 'Starting point',
    value: 'fork',
    onChange: () => {},
    options: [
      { value: 'fork', label: 'Fork active draft' },
      { value: 'blank', label: 'Start blank' },
    ],
  },
} satisfies Meta<typeof RadioGroup<string>>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const SrOnlyLegend: Story = { args: { srOnlyLegend: true } };
export const Disabled: Story = { args: { disabled: true } };
```

- [ ] **Step 6: Typecheck, design-lint, and run the full frontend suite**

```bash
npm --prefix frontend run typecheck && \
npm --prefix frontend run lint:design && \
npm --prefix frontend run test -- --run
```

Expected: typecheck clean; `✓ No design-token drift.`; all suites pass (9 new tests added, nothing else changes).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/design/primitives.tsx \
        frontend/src/design/Checkbox.stories.tsx \
        frontend/src/design/Radio.stories.tsx \
        frontend/tests/design/Checkbox.test.tsx \
        frontend/tests/design/Radio.test.tsx
git commit -m "[story-editor-0x2] add Checkbox / Radio / RadioGroup primitives + stories + tests"
```

---

## Task 2: `CheckboxField` primitive (the `ToggleRow` lift)

**Files:**
- Modify: `frontend/src/design/primitives.tsx` (insert after `RadioGroup` from Task 1)
- Test: `frontend/tests/design/Checkbox.test.tsx` (extend — add a `CheckboxField` block)
- Modify: `frontend/src/design/Checkbox.stories.tsx` (add `CheckboxField` stories)

**Interfaces:**
- Consumes: `Checkbox` (Task 1), `ReactNode`.
- Produces: `CheckboxField(props: CheckboxFieldProps): JSX.Element` where `CheckboxFieldProps = { id: string; label: ReactNode; hint?: ReactNode; testId?: string; checked: boolean; disabled?: boolean; onChange: (next: boolean) => void }`. Tasks 6 and 7 import it.

- [ ] **Step 1: Write the failing test**

Append to `frontend/tests/design/Checkbox.test.tsx` (add the import: `import { Checkbox, CheckboxField } from '@/design/primitives';`):

```tsx
describe('CheckboxField', () => {
  it('renders the label and hint, wires the checkbox to the label via id', () => {
    render(
      <CheckboxField
        id="cf1"
        label="Auto-save"
        hint="Persist drafts as you type"
        testId="cf-test"
        checked={false}
        onChange={vi.fn()}
      />,
    );
    const box = screen.getByTestId('cf-test');
    expect(box).toHaveAttribute('id', 'cf1');
    expect(box).toHaveAttribute('type', 'checkbox');
    expect(screen.getByText('Auto-save')).toBeInTheDocument();
    expect(screen.getByText('Persist drafts as you type')).toBeInTheDocument();
  });

  it('calls onChange with the next boolean', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <CheckboxField id="cf2" label="Focus" testId="cf2" checked={false} onChange={onChange} />,
    );
    await user.click(screen.getByTestId('cf2'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('omits the hint node when no hint is given', () => {
    render(<CheckboxField id="cf3" label="Bare" testId="cf3" checked onChange={vi.fn()} />);
    // Only the label text is present; no second span.
    expect(screen.getByText('Bare')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm --prefix frontend run test -- --run tests/design/Checkbox.test.tsx
```

Expected: FAIL — `"CheckboxField" is not exported by src/design/primitives.tsx`.

- [ ] **Step 3: Implement `CheckboxField`**

In `frontend/src/design/primitives.tsx`, insert **after** the `RadioGroup` function from Task 1:

```tsx
/* ============================================================================
 * CheckboxField — a two-line labelled checkbox (label + optional hint beside
 * the box). Lifted from SettingsWritingTab's ToggleRow. The box is `mt-0.5`
 * to sit on the label's cap-height (the 16px Checkbox needs less top offset
 * than the old ~13px browser-default box's `mt-1`).
 * ========================================================================== */

export interface CheckboxFieldProps {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  testId?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}

export function CheckboxField({
  id,
  label,
  hint,
  testId,
  checked,
  disabled,
  onChange,
}: CheckboxFieldProps): JSX.Element {
  return (
    <label htmlFor={id} className="flex items-start gap-2 text-[12px] py-1">
      <Checkbox
        id={id}
        data-testid={testId}
        checked={checked}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.checked);
        }}
        className="mt-0.5"
      />
      <span className="flex flex-col gap-[2px]">
        <span className="font-medium text-ink-2">{label}</span>
        {hint != null ? <span className="text-ink-4 font-sans">{hint}</span> : null}
      </span>
    </label>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm --prefix frontend run test -- --run tests/design/Checkbox.test.tsx
```

Expected: PASS (the 4 Checkbox + 3 CheckboxField tests).

- [ ] **Step 5: Add `CheckboxField` stories**

First, extend the top-of-file import in `frontend/src/design/Checkbox.stories.tsx` so it pulls both components (keep imports at the top — don't append a second `import` after the exports):

```tsx
import { Checkbox, CheckboxField } from './primitives';
```

Then append this export at the bottom of the file:

```tsx
export const Field: StoryObj<typeof CheckboxField> = {
  render: (args) => <CheckboxField {...args} />,
  args: {
    id: 'story-cf',
    label: 'Auto-save',
    hint: 'Persist drafts automatically as you type',
    checked: true,
    onChange: () => {},
  },
};
```

(`CheckboxField` is a separate component from the story's `meta.component` (`Checkbox`); a `render`-based `StoryObj<typeof CheckboxField>` export keeps it in the same `Primitives/Checkbox` page without fighting the `satisfies Meta<typeof Checkbox>` typing.)

- [ ] **Step 6: Typecheck + full suite**

```bash
npm --prefix frontend run typecheck && npm --prefix frontend run lint:design && npm --prefix frontend run test -- --run
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/design/primitives.tsx \
        frontend/src/design/Checkbox.stories.tsx \
        frontend/tests/design/Checkbox.test.tsx
git commit -m "[story-editor-0x2] add CheckboxField primitive (lift of ToggleRow)"
```

---

## Task 3: Migrate `StoryModal` checkbox

Simplest bare-`Checkbox` site — already `accent-accent w-4 h-4`, so zero visual change.

**Files:**
- Modify: `frontend/src/components/StoryModal.tsx:275-289` + its `@/design/primitives` import (line ~21)
- Test (unmodified): `frontend/tests/components/StoryModal.test.tsx`

**Interfaces:** Consumes `Checkbox`. Produces nothing.

- [ ] **Step 1: Add the import.** Add `Checkbox` to the existing `@/design/primitives` import block in `StoryModal.tsx` (alphabetical: it sorts before `Field`).

- [ ] **Step 2: Replace the `<input>`.** Replace `StoryModal.tsx:279-285` (the `<input type="checkbox" … className="accent-accent w-4 h-4" />`) with:

```tsx
              <Checkbox
                id={includePreviousChaptersId}
                checked={includePreviousChaptersInPrompt}
                onChange={(e) => setIncludePreviousChaptersInPrompt(e.target.checked)}
              />
```

The `className="accent-accent w-4 h-4"` drops — the primitive supplies it. The wrapping `<label htmlFor={…}>` and the `<span>` stay.

- [ ] **Step 3: Run the regression suite unmodified + typecheck.**

```bash
npm --prefix frontend run test -- --run tests/components/StoryModal.test.tsx && npm --prefix frontend run typecheck
```

Expected: PASS. If any assertion fails, fix the component, not the test.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/StoryModal.tsx
git commit -m "[story-editor-0x2] migrate StoryModal checkbox onto Checkbox"
```

---

## Task 4: Migrate `RecoveryCodeCard` checkbox + delete the CSS rule

Adds the accent + 16px look (visible), and removes the last global element-selector styling of a form control.

**Files:**
- Modify: `frontend/src/components/RecoveryCodeCard.tsx:85-93` + add a `@/design/primitives` import (it has none today)
- Modify: `frontend/src/index.css:273-275` (delete the rule)
- Test (unmodified): `frontend/tests/components/RecoveryCodeCard.test.tsx`

**Interfaces:** Consumes `Checkbox`. Produces nothing.

- [ ] **Step 1: Add the import.** Add to the top of `RecoveryCodeCard.tsx`:

```tsx
import { Checkbox } from '@/design/primitives';
```

- [ ] **Step 2: Replace the `<input>`.** Replace `RecoveryCodeCard.tsx:86-92` (`<input type="checkbox" … />`) with:

```tsx
        <Checkbox
          className="mt-0.5"
          checked={confirmed}
          onChange={(e) => {
            setConfirmed(e.target.checked);
          }}
        />
```

`mt-0.5` (2px) reproduces the deleted CSS rule's `margin-top: 2px`. Keep the wrapping `<label className="recovery-code-confirm">` and the `<span>`.

- [ ] **Step 3: Delete the CSS rule.** Remove these three lines from `frontend/src/index.css` (currently 273-275):

```css
.recovery-code-confirm input[type="checkbox"] {
  margin-top: 2px;
}
```

Keep the `.recovery-code-confirm` label rule above it (`display: flex; align-items: flex-start; gap; font-size; color; line-height`) — it styles the `<label>`, not the input.

- [ ] **Step 4: Run the regression suite unmodified + typecheck + design-lint.**

```bash
npm --prefix frontend run test -- --run tests/components/RecoveryCodeCard.test.tsx && \
npm --prefix frontend run typecheck && npm --prefix frontend run lint:design
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/RecoveryCodeCard.tsx frontend/src/index.css
git commit -m "[story-editor-0x2] migrate RecoveryCodeCard checkbox; drop redundant CSS rule"
```

---

## Task 5: Migrate `SettingsPromptsTab`, `SettingsDataTab`, `SettingsModelsTab`, `ChatComposer` checkboxes

Four bare-`Checkbox` sites in one task — each is a single `<input>` swap inside an existing label. Grouped because each is trivial and they share the identical mechanical change; a reviewer judges them as one set. `ChatComposer` carries the one visible size change (14px → 16px).

**Files:**
- Modify: `SettingsPromptsTab.tsx:157-162`, `SettingsDataTab.tsx:369-377`, `SettingsModelsTab.tsx:291-299`, `ChatComposer.tsx:290-299` + a `@/design/primitives` import in each (none has one today). (Step-level code blocks below identify each `<input>` by its attributes; the ranges are guidance.)
- Tests (unmodified): `frontend/tests/components/Settings.prompts.test.tsx`, `SettingsDataTab.test.tsx`, `Settings.models.test.tsx`, and any ChatComposer suite.

**Interfaces:** Consumes `Checkbox`. Produces nothing.

- [ ] **Step 1: `SettingsPromptsTab`.** Add `import { Checkbox } from '@/design/primitives';`. Replace the `<input type="checkbox" data-testid={\`prompts-toggle-${meta.key}\`} checked={checked} onChange={handleToggle} />` with:

```tsx
        <Checkbox
          data-testid={`prompts-toggle-${meta.key}`}
          checked={checked}
          onChange={handleToggle}
        />
```

- [ ] **Step 2: `SettingsDataTab`.** Add `import { Checkbox } from '@/design/primitives';`. Replace its `<input type="checkbox" data-testid="data-restore-safety" … />` with:

```tsx
                <Checkbox
                  data-testid="data-restore-safety"
                  checked={safetyBackup}
                  disabled={restoring || importer.isPending}
                  onChange={(e) => {
                    setSafetyBackup(e.target.checked);
                  }}
                />
```

- [ ] **Step 3: `SettingsModelsTab`.** Add `import { Checkbox } from '@/design/primitives';`. Replace its `<input id={reasoningId} data-testid="param-reasoning" type="checkbox" … className="accent-accent w-4 h-4" />` with:

```tsx
          <Checkbox
            id={reasoningId}
            data-testid="param-reasoning"
            checked={reasoningOn}
            disabled={slidersDisabled || !reasoningSupported}
            onChange={(e) => onReasoning(e.target.checked)}
          />
```

The trailing conditional `{!reasoningSupported ? (<span>Not supported…</span>) : null}` and the `<span>Reasoning</span>` stay inside the label — unchanged.

- [ ] **Step 4: `ChatComposer`.** Add `import { Checkbox } from '@/design/primitives';` (new import — it has none). Replace its `<input id="chat-web-search" type="checkbox" … className="h-3.5 w-3.5" />` with:

```tsx
            <Checkbox
              id="chat-web-search"
              checked={useWebSearch}
              onChange={(e) => {
                setUseWebSearch(e.target.checked);
              }}
              aria-describedby="chat-web-search-hint"
            />
```

The `className="h-3.5 w-3.5"` drops (14px → 16px is the accepted delta). `aria-describedby` is preserved and its target `<span id="chat-web-search-hint">` is untouched.

- [ ] **Step 5: Run the four suites unmodified + typecheck + design-lint.**

```bash
npm --prefix frontend run test -- --run \
  tests/components/Settings.prompts.test.tsx \
  tests/components/SettingsDataTab.test.tsx \
  tests/components/Settings.models.test.tsx && \
npm --prefix frontend run typecheck && npm --prefix frontend run lint:design
```

Then the full suite once to catch any ChatComposer-touching integration test:

```bash
npm --prefix frontend run test -- --run
```

Expected: PASS. If any assertion fails, fix the component.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/SettingsPromptsTab.tsx \
        frontend/src/components/SettingsDataTab.tsx \
        frontend/src/components/SettingsModelsTab.tsx \
        frontend/src/components/ChatComposer.tsx
git commit -m "[story-editor-0x2] migrate PromptsTab/DataTab/ModelsTab/ChatComposer checkboxes onto Checkbox"
```

---

## Task 6: Migrate `Settings.tsx` Behaviour toggle onto `CheckboxField`

Two-line labelled checkbox. Introduces a `useId()` because this site has no `id` today.

**Files:**
- Modify: `frontend/src/components/Settings.tsx:476-496` + the `@/design/primitives` import (line ~26) + the React import (line ~19, add `useId` if not already there)
- Test (unmodified): `frontend/tests/components/Settings.shell-venice.test.tsx`

**Interfaces:** Consumes `CheckboxField`. Produces nothing.

- [ ] **Step 1: Confirm `useId` availability.** `Settings.tsx:19` already imports `useId` (`import { useEffect, useId, useRef, useState } from 'react';`). No import change needed for React. Add `CheckboxField` to the `@/design/primitives` import at line 26 (currently `import { Modal, ModalBody, ModalFooter, ModalHeader } from '@/design/primitives';`).

- [ ] **Step 2: Add an id.** In the component body (near the other state/ids), add:

```tsx
  const veniceSystemPromptId = useId();
```

- [ ] **Step 3: Replace the block.** Replace `Settings.tsx:476-496` (the whole `<label className="flex items-start gap-2 text-[12px] py-1"> … </label>`, from the `<label>` through its closing `</label>`) with:

```tsx
        <CheckboxField
          id={veniceSystemPromptId}
          testId="venice-include-system-prompt"
          label="Include Venice's default system prompt"
          hint="When on, Venice prepends its own default system prompt before Inkwell's. When off, only Inkwell's system prompt is sent."
          checked={includeVeniceSystemPrompt}
          disabled={!settingsQuery.data || updateSettings.isPending}
          onChange={handleToggleVenicePrompt}
        />
```

Note the copy: the original used `Venice&apos;s` / `Inkwell&apos;s` HTML entities inside JSX text; as a plain string prop, use a normal apostrophe (`Venice's`). The `data-testid` moves to `testId`. `handleToggleVenicePrompt` already takes a boolean (`onChange={(e) => handleToggleVenicePrompt(e.target.checked)}` in the original), so pass it directly as `onChange={handleToggleVenicePrompt}`.

- [ ] **Step 4: Run the suite unmodified + typecheck.**

```bash
npm --prefix frontend run test -- --run tests/components/Settings.shell-venice.test.tsx && npm --prefix frontend run typecheck
```

Expected: PASS. The suite queries `data-testid="venice-include-system-prompt"`, which `CheckboxField` forwards to its inner `Checkbox`. If it fails, fix the component.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Settings.tsx
git commit -m "[story-editor-0x2] migrate Settings Behaviour toggle onto CheckboxField"
```

---

## Task 7: Migrate `SettingsWritingTab` — delete `ToggleRow`, use `CheckboxField`

The lift's payoff: remove the local `ToggleRow` and point its five call sites at the primitive.

**Files:**
- Modify: `frontend/src/components/SettingsWritingTab.tsx` — delete `ToggleRow` (`:88-128`, including its banner comment), rename its 5 usages (lines 203/212/221/229/238), adjust imports
- Test (unmodified): `frontend/tests/components/Settings.writing.test.tsx`

**Interfaces:** Consumes `CheckboxField`. Produces nothing.

- [ ] **Step 1: Add the import, remove now-unused React types.** Add `import { CheckboxField } from '@/design/primitives';`. `ToggleRow` was the only user of `ChangeEvent` in this file (via `(e: ChangeEvent<HTMLInputElement>)`); after deleting it, remove `ChangeEvent` from the `import type { ChangeEvent, JSX, ReactNode } from 'react';` at line 21 **only if** no other usage remains — grep first: `grep -n "ChangeEvent" frontend/src/components/SettingsWritingTab.tsx`. `ReactNode` is used by `ToggleRowProps.hint`; after deletion, grep it too and drop if unused. Let `tsc`/biome confirm.

- [ ] **Step 2: Delete `ToggleRow` + `ToggleRowProps`.** Remove `SettingsWritingTab.tsx:88-128` — from the `// --- ToggleRow ---` banner comment (line 88) through the closing `}` of `function ToggleRow` (line 128), inclusive of `interface ToggleRowProps { … }` in between.

- [ ] **Step 3: Rename the 5 call sites.** In the `SettingsWritingTab` component body, change each `<ToggleRow …>` to `<CheckboxField …>`. The props are identical (`id`, `label`, `hint`, `testId`, `checked`, `disabled?`, `onChange`), so **only the tag name changes** on all five (`writing-typewriter-toggle`, `writing-focus-toggle`, `writing-autosave-toggle`, `writing-smart-quotes-toggle`, `writing-em-dash-toggle`). Do a literal find-replace of `<ToggleRow` → `<CheckboxField` and `</ToggleRow>` → (none — they're self-closing).

- [ ] **Step 4: Run the suite unmodified + typecheck + design-lint.**

```bash
npm --prefix frontend run test -- --run tests/components/Settings.writing.test.tsx && \
npm --prefix frontend run typecheck && npm --prefix frontend run lint:design
```

Expected: PASS. This suite (`Settings.writing.test.tsx:140-149`) asserts all five `writing-*-toggle` testids render and that toggles bind to settings/PATCH/localStorage — `CheckboxField` forwards `testId` and calls `onChange(boolean)` identically to `ToggleRow`, so it stays green. If it fails, fix the component.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/SettingsWritingTab.tsx
git commit -m "[story-editor-0x2] replace SettingsWritingTab ToggleRow with CheckboxField primitive"
```

---

## Task 8: Migrate `NewDraftDialog` radios onto `RadioGroup`

The one radio migration. The two hand-rolled `<input type="radio">`s + `<fieldset>` collapse into one `RadioGroup`.

**Files:**
- Modify: `frontend/src/components/NewDraftDialog.tsx:102-126` + the `@/design/primitives` import (line ~4-13)
- Test (unmodified): any `NewDraftDialog` suite (grep `frontend/tests` for `new-draft` / the radio labels).

**Interfaces:** Consumes `RadioGroup`. Produces nothing.

- [ ] **Step 1: Add the import.** Add `RadioGroup` to the existing `@/design/primitives` import block in `NewDraftDialog.tsx` (lines 4-13).

- [ ] **Step 2: Replace the `<fieldset>`.** Replace `NewDraftDialog.tsx:102-126` (the entire `<fieldset className="flex flex-col gap-1.5 …"> … </fieldset>`, from `<fieldset>` through `</fieldset>`) with:

```tsx
        <RadioGroup
          name="new-draft-mode"
          legend="Starting point"
          srOnlyLegend
          value={mode}
          onChange={setMode}
          options={[
            { value: 'fork', label: forkLabel },
            { value: 'blank', label: 'Start blank' },
          ]}
        />
```

`mode` is `'fork' | 'blank'` (`useState<'fork' | 'blank'>` at line 62), so `RadioGroup<'fork' | 'blank'>` is inferred and `onChange={setMode}` type-checks (`Dispatch<SetStateAction<'fork'|'blank'>>` is assignable to `(value: 'fork'|'blank') => void`). The `<legend className="sr-only">Starting point</legend>` becomes `legend="Starting point" srOnlyLegend`.

- [ ] **Step 3: Run the regression suite unmodified + typecheck + design-lint.**

```bash
npm --prefix frontend run test -- --run && npm --prefix frontend run typecheck && npm --prefix frontend run lint:design
```

(Full suite — the exact NewDraftDialog test file name isn't asserted here; run all so nothing querying the `Fork`/`Start blank` radios by role slips through.) Expected: PASS. The radios keep their label text (`getByRole('radio', { name: forkLabel })` still matches) and the `name="new-draft-mode"` grouping. If a test fails, fix the component.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/NewDraftDialog.tsx
git commit -m "[story-editor-0x2] migrate NewDraftDialog radios onto RadioGroup"
```

---

## Task 9: Final sweep — confirm no bespoke checkbox/radio survives (except the documented misfit)

Not a code task — a verification gate that belongs to the plan so the migration's completeness is proven.

**Files:** none modified (unless the sweep finds a straggler).

- [ ] **Step 1: Sweep for remaining raw inputs.**

```bash
grep -rn 'type="checkbox"' frontend/src/
grep -rn 'type="radio"' frontend/src/
```

Expected:
- `type="checkbox"`: **zero** hits in `frontend/src/components/**`. (The `index.css` rule was deleted in Task 4.) Any hit inside `primitives.tsx` is the `Checkbox` primitive itself — that's correct.
- `type="radio"`: hits only in `SettingsAppearanceTab.tsx` (the documented misfit — visually-hidden tile-picker radios, deliberately not migrated) and in `primitives.tsx` (the `Radio` primitive). **No** hit in `NewDraftDialog.tsx`.

If any *other* component still has a raw `type="checkbox"|"radio"`, it was missed — migrate it following the nearest matching task above, or (if it's a genuine non-target like the theme tiles) STOP and confirm with the reviewer before adding it to the spec's misfit list.

- [ ] **Step 2: Confirm the primitives are the only styled control base.**

```bash
grep -rn 'accent-accent' frontend/src/
```

Expected: hits only in `primitives.tsx` (`CHECK_CONTROL_BASE`). No component should still hand-write `accent-accent w-4 h-4` on a checkbox/radio (StoryModal and SettingsModelsTab dropped theirs in Tasks 3 and 5). A leftover means a site kept its class instead of relying on the primitive.

- [ ] **Step 3: Full verify.**

```bash
npm --prefix frontend run typecheck && npm --prefix frontend run test -- --run && npm --prefix frontend run lint:design
```

Expected: typecheck clean; all suites pass; `✓ No design-token drift.`

- [ ] **Step 4: (Only if Step 1 or 2 found a straggler) commit the fix.** Otherwise no commit — this task is a gate.

---

## Verify (the bd `verify:` line)

```bash
npm --prefix frontend run typecheck && npm --prefix frontend run test && npm --prefix frontend run lint:design
```

## Out of scope (do not do these)

- `SettingsAppearanceTab`'s theme-tile radios (`type="radio" className="sr-only"`) — a visually-hidden tile-picker, not an instance of the visible `Radio` primitive. Documented misfit; left hand-rolled.
- Any switch/toggle-slider redesign — these are checkboxes with a checkbox look, not iOS switches.
- `6ze`'s own fork checkbox — this unblocks it; it does not build it.
- Focus-ring changes — the codebase uses `focus:border-*`, no ring (lint-enforced). The primitives inherit the native input outline just as the hand-rolled ones did.
