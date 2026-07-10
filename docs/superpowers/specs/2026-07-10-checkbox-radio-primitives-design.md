# Checkbox / Radio / RadioGroup Primitives — Design Spec

**bd issue:** `story-editor-0x2`
**Blocks:** `story-editor-6ze` (its fork "Also copy chats & scenes" checkbox + the `NewDraftDialog` fork/blank radios it sits beside must consume these primitives, not add an 11th/5th hand-rolled control).
**Date:** 2026-07-10

---

## Problem

This is a Storybook-driven design system with a `Primitives/` namespace, yet there is **no** `Checkbox` or `Radio` primitive. Form controls are hand-rolled with raw `<input type="checkbox|radio">` + ad-hoc token classes, and they have drifted:

**Checkbox — 8 component sites, three visual treatments:**

| Site | File:line | Today's classes | Label shape | data-testid | → Target |
|---|---|---|---|---|---|
| RecoveryCodeCard | `RecoveryCodeCard.tsx:87` | *(none; styled by a CSS element-selector)* | inline `<span>` | — | bare `Checkbox` |
| StoryModal | `StoryModal.tsx:281` | `accent-accent w-4 h-4` | inline, `htmlFor` | — | bare `Checkbox` |
| SettingsPromptsTab | `SettingsPromptsTab.tsx:158` | *(browser default)* | inline | `prompts-toggle-${key}` | bare `Checkbox` |
| Settings (Behaviour) | `Settings.tsx:478` | `mt-1` | **two-line** (label + description) | `venice-include-system-prompt` | `CheckboxField` |
| ChatComposer | `ChatComposer.tsx:292` | `h-3.5 w-3.5` (14px) | inline, `htmlFor`, `aria-describedby` | — | bare `Checkbox` |
| SettingsDataTab | `SettingsDataTab.tsx:370` | *(browser default)* | inline | `data-restore-safety` | bare `Checkbox` |
| SettingsModelsTab | `SettingsModelsTab.tsx:294` | `accent-accent w-4 h-4` | inline + trailing "Not supported" | `param-reasoning` | bare `Checkbox` |
| SettingsWritingTab | `SettingsWritingTab.tsx:114` (`ToggleRow`) | `mt-1` | **two-line** (label + hint) | passed in | `CheckboxField` (this IS the lift) |

**The split:** the two **two-line** sites (Settings Behaviour + SettingsWritingTab's `ToggleRow`) migrate to `CheckboxField`; the other six single-inline-label sites use **bare `Checkbox`** with their existing `<label><Checkbox/><span>…</span></label>` wrapper kept. `SettingsModelsTab` stays bare because its trailing conditional "Not supported by this model" span is inline structure `CheckboxField` doesn't model.

**Note on `Settings.tsx`:** its Behaviour checkbox has **no `id`/`htmlFor`** today (the `<input>` is a direct child of the `<label>`). `CheckboxField` requires an `id`, so this one site's migration adds a `useId()` — a genuine (if trivial) a11y improvement, not a pure lift. The "zero prop changes" claim below applies only to `SettingsWritingTab`'s five `ToggleRow` callers.

**Radio — 2 component sites (3 radio JSX inputs, 5 radios at runtime):**

| Site | File:line | Pattern | Decision |
|---|---|---|---|
| NewDraftDialog | `NewDraftDialog.tsx:106,117` | 2 visible fork/blank radios in a `<fieldset>` | **Migrate** → `RadioGroup` |
| SettingsAppearanceTab | `SettingsAppearanceTab.tsx:107` | 1 templated `<input type="radio" className="sr-only">` rendered over 3 tiles (`ThemeTileButton` in `THEME_TILES.map`) — input hidden, the **tile** is the affordance | **Documented misfit — do not migrate** |

(The issue text says "type=radio (2)"; that counts *files*. There are 2 literal radio `<input>`s in `NewDraftDialog` + 1 templated one in `SettingsAppearanceTab` that renders 3 radios at runtime — 5 radios total. `SettingsAppearanceTab.tsx:96` is a code *comment* containing `type="radio"`, not an input. The `index.css:273` `type="checkbox"` hit is likewise a CSS rule, not a component — addressed below, not a 9th checkbox site.)

Adding `6ze`'s controls to this pile would make it an 11th checkbox and a 5th radio. Extract the primitives and migrate.

---

## What we build

Three primitives in `frontend/src/design/primitives.tsx`, plus one small composition, following the house `forwardRef` + `InputHTMLAttributes` + `cx()` pattern already used by `Input`/`Textarea`:

### 1. `Checkbox` (bare)

```tsx
// `type` is Omit-ted so the primitive genuinely owns it — the base type is
// not overridable by a caller, and `{...rest}` cannot smuggle one back in.
export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {}

const CHECKBOX_BASE =
  'accent-accent w-4 h-4 shrink-0 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, ...rest },
  ref,
): JSX.Element {
  return <input ref={ref} type="checkbox" className={cx(CHECKBOX_BASE, className)} {...rest} />;
});
```

- **`type="checkbox"` is owned by the primitive** — `Omit<…, 'type'>` removes it from the accepted props, so `<Checkbox type="radio" />` is a *type error*, not a silent override. (An empty interface that `extends` is biome-clean — `noEmptyInterface` fires only on a truly-empty `interface Foo {}`, verified.)
- Everything else (`checked`, `onChange`, `disabled`, `id`, `data-testid`, `aria-describedby`, `name`, `value`) flows through `...rest` unchanged, so **every existing `checked`/`onChange` contract and every `data-testid`/role query is preserved verbatim**.
- `className` is merged last, so a caller can still add `mt-0.5` for alignment.

### 2. `Radio` (bare)

Identical shape, `type="radio"`:

```tsx
export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {}
const RADIO_BASE = 'accent-accent w-4 h-4 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed';
export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio(
  { className, ...rest }, ref,
): JSX.Element {
  return <input ref={ref} type="radio" className={cx(RADIO_BASE, className)} {...rest} />;
});
```

### 3. `RadioGroup` (composition)

A labelled `<fieldset>` that renders one `<label><Radio/> …</label>` row per option and drives selection from a single `value`. Models exactly what `NewDraftDialog` hand-rolls today.

```tsx
export interface RadioOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  testId?: string;
}

export interface RadioGroupProps<T extends string> {
  /** Radio group `name` — shared across the options. */
  name: string;
  /** Accessible group label; rendered as a <legend>. Pass `srOnlyLegend` to hide it visually. */
  legend: ReactNode;
  srOnlyLegend?: boolean;
  value: T;
  onChange: (value: T) => void;
  options: RadioOption<T>[];
  /** Optional disable of the whole group. */
  disabled?: boolean;
}

export function RadioGroup<T extends string>({ … }: RadioGroupProps<T>): JSX.Element { … }
```

- Generic over the value union so `mode: 'fork' | 'blank'` stays type-safe (no `string` widening).
- `onChange(value)` — the caller gets the selected value directly, not a DOM event. `NewDraftDialog`'s two `onChange={() => setMode('fork'/'blank')}` collapse to one `onChange={setMode}`.
- `legend` + `srOnlyLegend` reproduce `NewDraftDialog`'s `<legend className="sr-only">Starting point</legend>`.

### 4. `CheckboxField` (composition — the `ToggleRow` lift)

`SettingsWritingTab`'s local `ToggleRow` (label + optional hint, two-line, `mt-1`-aligned checkbox) is the exact "labelled checkbox with a description" shape that `Settings.tsx`'s Behaviour toggle also hand-rolls. Lift it into `design/` verbatim in behavior, retyped to compose `Checkbox`:

```tsx
export interface CheckboxFieldProps {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  testId?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}

export function CheckboxField({ id, label, hint, testId, checked, disabled, onChange }: CheckboxFieldProps): JSX.Element {
  return (
    <label htmlFor={id} className="flex items-start gap-2 text-[12px] py-1">
      <Checkbox
        id={id}
        data-testid={testId}
        checked={checked}
        disabled={disabled}
        onChange={(e) => { onChange(e.target.checked); }}
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

- `mt-1` → `mt-0.5`: the old inline checkbox had no `w-4 h-4`, so it was ~13px and needed `mt-1` (4px) to sit on the label's cap-height. The primitive is 16px, so `mt-0.5` (2px) matches the taller box. Verified by eye against the `items-start` label; no test asserts this.
- `onChange: (next: boolean) => void` — same adapter signature `ToggleRow` already exposes, so `SettingsWritingTab`'s five call sites need **zero** prop changes.

---

## Visual deltas (intentional — decided with the user)

The primitive ships **one** look — `accent-accent w-4 h-4` — so the drift the issue exists to fix actually goes away. Consequences, all accepted:

1. **The 4 browser-default checkboxes gain the accent color and a consistent 16px box** (RecoveryCodeCard, SettingsPromptsTab, SettingsDataTab, NewDraftDialog's radios). Visible.
2. **ChatComposer's checkbox grows 14px → 16px.** Visible, in the composer toolbar. Accepted — uniformity wins over that one site's tighter fit; if it looks wrong in Storybook/review we note it, we don't fork the primitive.
3. **The two-line rows' checkbox top-margin nudges `mt-1` → `mt-0.5`** (Settings Behaviour + SettingsWritingTab's five rows). The old inline checkbox had no `w-4 h-4`, so it rendered ~13px and used `mt-1` (4px) to sit on the label's cap-height; the 16px primitive sits right with `mt-0.5` (2px). Eyeball-verified against the `items-start` label; no test asserts it. Small, intentional, listed for completeness.
4. StoryModal and SettingsModelsTab are unchanged (already `accent-accent w-4 h-4`).

No test asserts a checkbox/radio size or classname (grep-verified), and all 18 `getByRole('checkbox'|'radio')` queries + every `data-testid` survive because the primitive stays a native input and forwards everything.

---

## Documented misfits (deliberate non-targets)

- **`SettingsAppearanceTab`'s theme tiles** (`type="radio" className="sr-only"`). The input is *visually hidden* and the tile is the affordance — this is a tile-picker, not an instance of the visible `Radio` primitive. Migrating it would make the primitive's entire visual base (`accent-accent w-4 h-4`) dead code defeated by `sr-only`. Left hand-rolled, recorded here so a future reader doesn't "finish the job." (Same treatment `AccountPrivacyModal` got in the ConfirmDialog spec.)

---

## CSS coupling to remove

`frontend/src/index.css:273`:

```css
.recovery-code-confirm input[type="checkbox"] { margin-top: 2px; }
```

This is the last global **element-selector** styling of a form control in the codebase. When `RecoveryCodeCard` migrates to `<Checkbox className="mt-0.5" />` (2px, identical rendering), this rule becomes redundant **and** starts silently double-styling the primitive. Delete it in the same task. The `.recovery-code-confirm` label rule (`gap`, `font-size`, `color`, `line-height` at `index.css:265-272`) stays — it styles the `<label>`, not the input.

---

## Testing

- Each primitive gets a `Primitives/Checkbox` and `Primitives/Radio` story (RadioGroup + CheckboxField as additional exports/stories in the same files, matching how `ConfirmDialog.stories.tsx` co-locates variants).
- New unit tests in `frontend/tests/design/` for: renders as the right input `type`; `checked`/`onChange` round-trip; `disabled` blocks change; `data-testid`/`id`/`aria-*` forwarded; `className` merged not replaced; `RadioGroup` selection + `onChange(value)`; `CheckboxField` `onChange(boolean)` + hint render.
- **Every existing regression suite must pass completely unmodified.** The suites that query these controls by `data-testid`: **`Settings.writing.test.tsx`** (the five `writing-*-toggle` ids — the most load-bearing suite here, since it guards the exact `ToggleRow` controls being lifted into `CheckboxField`), `Settings.models`, `Settings.prompts`, `SettingsDataTab`, `Settings.shell-venice`, plus any suite querying by `getByRole('checkbox'|'radio')` (18 such queries branch-wide). (`Settings.appearance` also queries `appearance-theme-*`, but those radios are a documented non-target, so it is not at migration risk.) If a migration needs a test edited, the migration is wrong — fix the component. (Same hard rule as `8hb`.)

---

## Out of scope

- `SettingsAppearanceTab` theme tiles (documented misfit above).
- Any switch/toggle-slider visual — these are checkboxes with a checkbox look, not iOS switches. Not a redesign.
- `6ze`'s own controls — this primitive unblocks them; it does not build them.
- Focus-ring styling changes — the codebase uses `focus:border-*`, no ring (lint-enforced); primitives inherit the browser's native focus outline on the input just as the hand-rolled ones do. Not changed here.

---

## Global constraints (bind every task)

- TypeScript strict, no `any`. `RadioGroup` is generic over the value union.
- Design tokens only; `lint:design` must stay green. `accent-accent` is a token utility (`--accent`), permitted.
- Storybook is the UI source of truth — new primitives get `Primitives/*` stories.
- Commit format `[story-editor-0x2] <desc>`; pre-commit `biome check --write` runs on staged files.
- The migration must preserve each call site's `checked`/`onChange`/`disabled`/`data-testid`/`id`/`aria-*` semantics **exactly**. This is a refactor, not a behavior change (the visual deltas above excepted, and those are pre-approved).
