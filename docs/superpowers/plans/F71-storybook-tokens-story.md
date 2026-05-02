# [F71] Storybook Tokens Swatch Story Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author `frontend/src/design/Tokens.stories.tsx` — a Storybook surface that renders every design token from [frontend/src/index.css](../../frontend/src/index.css) as a swatch, with a runtime hex/font readout populated by `useLayoutEffect`. Replaces the visual reference currently in [mockups/archive/v1-2025-11/Design System Handoff.html](../Design%20System%20Handoff.html) § Tokens. After this lands, the HTML doc can be retired ([F74]).

**Architecture:**
- Single `Tokens.stories.tsx` file under `frontend/src/design/`. Story title `Tokens/Swatches` (top-level group sibling to `Primitives/`).
- Three sections: **Color tokens** (grouped by Surface / Ink / Lines / Accent / Backdrop), **Type tokens** (`--sans`, `--serif`, `--mono`), and **Radii / Shadow tokens** (`--radius`, `--radius-lg`, `--shadow-card`, `--shadow-pop`).
- The hex/font readout uses `useLayoutEffect` walking `[data-hex]` / `[data-font]` elements after mount. Reads via `getComputedStyle(document.documentElement).getPropertyValue(name).trim()` and writes into `textContent`. No dependency array — re-runs on every render so theme switches automatically refresh the readout.
- The token list is **derived from the actual `index.css`** via the audit step (Task 1). If `index.css` adds a token in the future, this story stays accurate only if a maintainer remembers to add it here — there's no automatic discovery. Ship a comment at the top of `TOKENS` reminding future authors to re-audit.

**Decision points pinned in the plan:**
1. **Token list lives in the story file**, not derived at runtime. Walking `getComputedStyle` for *every* `--*` property is technically possible but produces a wall of internal Tailwind variables. Curating the list keeps it scoped to the public surface.
2. **No spacing tokens.** Inkwell's `index.css` doesn't declare spacing scale tokens — Tailwind's defaults apply. Don't invent a section for tokens that don't exist.
3. **Type swatch shows a "The quick brown fox" line in the actual font** — not just the font-family string. Anyone reading the doc wants to see the rendering.
4. **Radius / shadow swatches are sized boxes** with the radius / shadow / padding applied. A bare CSS value text label is useless.
5. **`--selection` is included in the Color section even though it's a selection-highlight token**, not a fill — it's part of the theme palette and surprises designers if missing.
6. **`--prose-*` tokens are NOT included.** They're runtime-mutated by the Appearance settings tab, not part of the static design system.

**Tech Stack:** Storybook 9.x, React 19, TypeScript strict, Tailwind v4. No primitive imports needed — this story is self-contained.

**Source-of-truth references:**
- [frontend/src/index.css](../../frontend/src/index.css) — the `:root` + `[data-theme="..."]` blocks (lines 10–87) and the `@theme` block (lines 97–141). Audit both before populating the token arrays.
- [docs/HANDOFF.md](../HANDOFF.md) § "A token swatch story" — the source snippet (with the `useLayoutEffect` hex/font readout).
- [mockups/archive/v1-2025-11/Design System Handoff.html](../Design%20System%20Handoff.html) § Tokens — the visual reference this story replaces. Open it in a browser before authoring to confirm visual parity.

---

## File Structure

**Create (frontend):**
- `frontend/src/design/Tokens.stories.tsx` — single self-contained file (~150 lines).

**Not touched:**
- `frontend/src/index.css` — read-only here; no token additions.
- `frontend/src/design/primitives.tsx` — not imported (avoids the Storybook circular import risk; this is a pure visual story).

---

## Task 1: Audit the live token surface

**Files:**
- Read: `frontend/src/index.css`

- [ ] **Step 1: List every token declared in `:root`**

Run: `grep -nE '^\s+--' frontend/src/index.css | sort -u`
Expected output (paper theme; sepia / dark mirror this set):

```
  --bg, --bg-elevated, --bg-sunken, --surface-hover
  --ink, --ink-2, --ink-3, --ink-4, --ink-5
  --line, --line-2
  --accent, --accent-soft, --mark, --selection
  --danger, --ai, --ai-soft
  --serif, --sans, --mono
  --prose-font, --prose-size, --prose-line-height
```

Cross-check against the `@theme` block (lines 97–141) — it adds `--color-backdrop`, `--radius`, `--radius-lg`, `--shadow-card`, `--shadow-pop`, plus `--font-*` aliases.

- [ ] **Step 2: Decide the published surface**

Authoritative list for `Tokens.stories.tsx` (what the user-facing doc covers):

| Section | Tokens |
|---|---|
| Surface | `--bg`, `--bg-elevated`, `--bg-sunken`, `--surface-hover` |
| Ink | `--ink`, `--ink-2`, `--ink-3`, `--ink-4`, `--ink-5` |
| Lines | `--line`, `--line-2` |
| Accent | `--accent`, `--accent-soft`, `--mark`, `--selection`, `--ai`, `--ai-soft`, `--danger` |
| Backdrop | `--backdrop` |
| Type | `--sans`, `--serif`, `--mono` |
| Radius | `--radius` (3px), `--radius-lg` (6px) |
| Shadow | `--shadow-card`, `--shadow-pop` |

Excluded (with reason): `--prose-*` (runtime-mutated, not static); `--color-*` and `--font-*` aliases (Tailwind plumbing for the `@theme` mapping; the underlying tokens are what designers care about).

- [ ] **Step 3: (No commit — pure audit. Move to Task 2.)**

---

## Task 2: Tokens.stories.tsx

**Files:**
- Create: `frontend/src/design/Tokens.stories.tsx`

- [ ] **Step 1: Create the file**

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { useLayoutEffect, useRef } from 'react';

// Token list — keep in sync with frontend/src/index.css. If you add a
// token to the @theme block or :root, also add it here. There is no
// auto-discovery (intentional: the story is the public surface, not a
// dump of every CSS variable).

const COLOR_TOKENS: { group: string; names: string[] }[] = [
  { group: 'Surface', names: ['--bg', '--bg-elevated', '--bg-sunken', '--surface-hover'] },
  { group: 'Ink', names: ['--ink', '--ink-2', '--ink-3', '--ink-4', '--ink-5'] },
  { group: 'Lines', names: ['--line', '--line-2'] },
  {
    group: 'Accent',
    names: ['--accent', '--accent-soft', '--mark', '--selection', '--ai', '--ai-soft', '--danger'],
  },
  { group: 'Backdrop', names: ['--backdrop'] },
];

const TYPE_TOKENS = ['--sans', '--serif', '--mono'] as const;
const RADIUS_TOKENS = ['--radius', '--radius-lg'] as const;
const SHADOW_TOKENS = ['--shadow-card', '--shadow-pop'] as const;

function Swatches() {
  const root = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!root.current) return;
    const cs = getComputedStyle(document.documentElement);
    root.current.querySelectorAll<HTMLElement>('[data-hex]').forEach((el) => {
      el.textContent = cs.getPropertyValue(el.dataset.hex!).trim();
    });
    root.current.querySelectorAll<HTMLElement>('[data-font]').forEach((el) => {
      el.textContent = cs.getPropertyValue(el.dataset.font!).trim().split(',')[0];
    });
    root.current.querySelectorAll<HTMLElement>('[data-css]').forEach((el) => {
      el.textContent = cs.getPropertyValue(el.dataset.css!).trim();
    });
  });

  return (
    <div ref={root} style={{ display: 'grid', gap: 32, fontFamily: 'var(--mono)' }}>
      {COLOR_TOKENS.map(({ group, names }) => (
        <section key={group}>
          <h3 style={{ font: '600 12px var(--sans)', color: 'var(--ink-2)', marginBottom: 8 }}>
            {group}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {names.map((n) => (
              <div key={n} style={{ border: '1px solid var(--line)', borderRadius: 3 }}>
                <div
                  style={{ background: `var(${n})`, height: 60, borderRadius: '3px 3px 0 0' }}
                />
                <div style={{ padding: '6px 8px', fontSize: 11 }}>
                  <div style={{ color: 'var(--ink)' }}>{n}</div>
                  <div data-hex={n} style={{ color: 'var(--ink-3)' }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      <section>
        <h3 style={{ font: '600 12px var(--sans)', color: 'var(--ink-2)', marginBottom: 8 }}>
          Type
        </h3>
        <div style={{ display: 'grid', gap: 8 }}>
          {TYPE_TOKENS.map((n) => (
            <div
              key={n}
              style={{ border: '1px solid var(--line)', borderRadius: 3, padding: 12 }}
            >
              <div style={{ font: '600 11px var(--mono)', color: 'var(--ink-3)' }}>
                {n} — <span data-font={n} />
              </div>
              <div
                style={{
                  fontFamily: `var(${n})`,
                  fontSize: 18,
                  color: 'var(--ink)',
                  marginTop: 6,
                }}
              >
                The quick brown fox jumps over the lazy dog
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 style={{ font: '600 12px var(--sans)', color: 'var(--ink-2)', marginBottom: 8 }}>
          Radius
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {RADIUS_TOKENS.map((n) => (
            <div key={n} style={{ border: '1px solid var(--line)', borderRadius: 3, padding: 12 }}>
              <div
                style={{
                  background: 'var(--bg-sunken)',
                  border: '1px solid var(--line-2)',
                  height: 60,
                  borderRadius: `var(${n})`,
                }}
              />
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink)' }}>{n}</div>
              <div data-css={n} style={{ fontSize: 11, color: 'var(--ink-3)' }} />
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 style={{ font: '600 12px var(--sans)', color: 'var(--ink-2)', marginBottom: 8 }}>
          Shadow
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
          {SHADOW_TOKENS.map((n) => (
            <div key={n} style={{ padding: 12 }}>
              <div
                style={{
                  background: 'var(--bg-elevated)',
                  height: 80,
                  borderRadius: 'var(--radius-lg)',
                  boxShadow: `var(${n})`,
                }}
              />
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink)' }}>{n}</div>
              <div
                data-css={n}
                style={{
                  fontSize: 11,
                  color: 'var(--ink-3)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const meta = { title: 'Tokens/Swatches', component: Swatches } satisfies Meta<typeof Swatches>;
export default meta;
export const All: StoryObj<typeof meta> = {};
```

- [ ] **Step 2: Verify it builds**

Run: `cd frontend && npm run build-storybook -- --quiet`
Expected: PASS, no warnings.

- [ ] **Step 3: Manual three-theme verification**

Run: `cd frontend && npm run storybook`
Open: `http://localhost:6006`, navigate to `Tokens/Swatches/All`.

Confirm:
- Every colour swatch renders without an obvious "missing token" gap.
- Every hex readout shows a real `#xxxxxx` or `rgba(...)` value (not empty / not literally `var(--token-name)`).
- Type tokens render the "quick brown fox" line in three distinct fonts (serif, sans, mono).
- Radius tokens render boxes with visibly different corner radii (3px vs 6px).
- Shadow tokens render boxes with visibly different drop shadows.

Now flip the Theme toolbar to **sepia**. Confirm:
- Every hex readout updates instantly (e.g. `--bg` flips from `#faf8f3` to `#f4ecd8`).
- The visible swatch colours change correspondingly.

Flip to **dark**. Repeat the verification.

If any swatch fails to update on theme flip, the `useLayoutEffect` is bug — most likely a missing render (the effect deliberately has no dependency array; if you accidentally added one, theme switches won't re-trigger).

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/design/Tokens.stories.tsx
git commit -m "feat(storybook): Tokens.stories.tsx with colour / type / radius / shadow swatches"
```

---

## Self-review notes (run before merge)

1. **Spec coverage:** Audited token list from Task 1 maps 1:1 to the arrays in the story. Excluded surfaces (`--prose-*`, `--color-*` aliases, `--font-*` aliases) are documented with reason.
2. **Placeholder scan:** No TBDs. The hex/font readout effect ships, not deferred as an "exercise".
3. **Type consistency:** `data-hex` / `data-font` / `data-css` attributes match the three `querySelectorAll` calls in the effect. The `--backdrop` token is referenced as `--backdrop` consistently (the `@theme` block exposes it as `--color-backdrop` for Tailwind's `bg-backdrop` utility, but the raw CSS variable is `--backdrop`; verify by inspecting in DevTools after Step 3).
4. **Sequencing:** Independent of [F69] / [F70]; depends only on [F68] (Storybook installed). Can land in parallel with the others.
