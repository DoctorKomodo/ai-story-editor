# Story-Switch Staleness + Login Version Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two reported defects: (1) switching stories shows the previous story's chat/scene content until a hard refresh; (2) the auth pages show a hardcoded, wrong version string `Self-hosted · v0.4.2 · inkwell-01`.

**Architecture:** Frontend-only. Fix (1): the `activeChapterId` Zustand store persists across `/stories/:id` navigation (EditorPage never remounts), so the editor/chat keep pointing at the previous story's chapter id. Add an effect in EditorPage that auto-selects the current story's first chapter whenever the loaded chapter list doesn't contain the active selection — driven by a small pure, unit-tested helper. Fix (2): plumb the real version from `frontend/package.json` through a Vite/Vitest `define` into a single `APP_VERSION` constant, and replace the hardcoded footer in the three auth components.

**Tech Stack:** React + TypeScript + Vite + Vitest/jsdom + TailwindCSS (token-only) + Zustand + TanStack Query + react-router.

## Global Constraints

- TypeScript strict mode — no `any`.
- Design-lint guard (`frontend/scripts/lint-design.mjs`) enforces token-only styling in `frontend/src/` — theme tokens only, never raw hex.
- Frontend component files are PascalCase; hooks/lib/store files are camelCase. Tests live under `frontend/tests/` (mirroring source path), run under jsdom (vitest); assert via `data-testid` / text and React Testing Library.
- Do NOT hardcode the version number anywhere in `frontend/src/` — it must derive from `package.json` (this defect exists *because* it was hardcoded and drifted). The only literal version source is `frontend/package.json`.
- Verify: `npm --prefix frontend run typecheck && npm --prefix frontend run test -- activeChapter AuthForm && node frontend/scripts/lint-design.mjs`

---

### Task 1: Auto-select the first chapter on story load / switch

**Root cause:** `useActiveChapterStore` ([frontend/src/store/activeChapter.ts](../../../frontend/src/store/activeChapter.ts)) is a module-level store. `EditorPage` stays mounted across `/stories/:id` navigation (no `key={id}` on the route), and nothing resets `activeChapterId` when the story changes. After selecting a chapter in story A and switching to story B, the store still holds story A's chapter id; `Paper` (`EditorPage.tsx:567`) and `ChatTab` (`EditorPage.tsx:629`) read that stale id and the per-chapter query cache (keyed by chapter id only) returns story A's content. There is no existing auto-select, even on first load.

**Fix:** A pure helper decides the correct active chapter for a given chapter list + current selection; an effect in EditorPage applies it whenever the list (or selection) changes. This auto-opens the first chapter on first load AND replaces a stale cross-story selection on switch.

**Files:**
- Modify: `frontend/src/store/activeChapter.ts` (add `resolveActiveChapterId` helper)
- Modify: `frontend/src/pages/EditorPage.tsx` (add the auto-select effect)
- Test: `frontend/tests/store/activeChapter.test.ts` (create)

**Interfaces:**
- Produces: `resolveActiveChapterId(chapters: { id: string; orderIndex: number }[], currentId: string | null): string | null` — returns `currentId` if it is present in `chapters`; otherwise the id of the lowest-`orderIndex` chapter; otherwise `null` (empty list).
- Consumes (in EditorPage): existing `chaptersQuery.data` (`ChapterMeta[] | undefined`), `activeChapterId`, `setActiveChapterId` from the store.

- [ ] **Step 1: Write the failing test for `resolveActiveChapterId`**

Create `frontend/tests/store/activeChapter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveActiveChapterId } from '@/store/activeChapter';

const chapters = [
  { id: 'b', orderIndex: 1 },
  { id: 'a', orderIndex: 0 },
  { id: 'c', orderIndex: 2 },
];

describe('resolveActiveChapterId', () => {
  it('keeps the current selection when it belongs to the list', () => {
    expect(resolveActiveChapterId(chapters, 'c')).toBe('c');
  });

  it('selects the lowest-orderIndex chapter when current is null', () => {
    expect(resolveActiveChapterId(chapters, null)).toBe('a');
  });

  it('replaces a stale selection (not in the list) with the first chapter', () => {
    expect(resolveActiveChapterId(chapters, 'from-another-story')).toBe('a');
  });

  it('returns null for an empty chapter list', () => {
    expect(resolveActiveChapterId([], 'anything')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix frontend run test -- activeChapter`
Expected: FAIL — `resolveActiveChapterId` is not exported.

- [ ] **Step 3: Implement the helper**

In `frontend/src/store/activeChapter.ts`, add (after the store definition):

```ts
/**
 * Decide which chapter should be active for a given chapter list. Keeps the
 * current selection if it still belongs to the list; otherwise falls back to
 * the first chapter (lowest orderIndex). Used to recover from a selection that
 * outlived its story — the store persists across /stories/:id navigation.
 */
export function resolveActiveChapterId(
  chapters: { id: string; orderIndex: number }[],
  currentId: string | null,
): string | null {
  if (currentId !== null && chapters.some((c) => c.id === currentId)) return currentId;
  const first = [...chapters].sort((a, b) => a.orderIndex - b.orderIndex)[0];
  return first?.id ?? null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --prefix frontend run test -- activeChapter`
Expected: PASS (4/4).

- [ ] **Step 5: Wire the effect into EditorPage**

In `frontend/src/pages/EditorPage.tsx`, add `resolveActiveChapterId` to the existing import from `@/store/activeChapter` (the store hook is already imported there). Then add this effect near the other top-level effects (e.g. just after the cast-selection effect at lines 125-127). It must run after `chaptersQuery` and the `activeChapterId` / `setActiveChapterId` bindings are declared (they are, by line 117):

```tsx
  // Auto-select the current story's first chapter when the loaded chapter list
  // doesn't contain the active selection. Covers first load (nothing selected)
  // and story switches — the activeChapterId store persists across
  // /stories/:id navigation, so without this the editor + chat keep showing the
  // previous story's chapter.
  useEffect(() => {
    const chapters = chaptersQuery.data;
    if (!chapters) return;
    const next = resolveActiveChapterId(chapters, activeChapterId);
    if (next !== activeChapterId) setActiveChapterId(next);
  }, [chaptersQuery.data, activeChapterId, setActiveChapterId]);
```

> Note for implementer: `useEffect` is already imported in EditorPage. The effect is intentionally thin glue over the unit-tested helper — do not add an EditorPage-level integration test (the page is heavy in jsdom); the helper test is the behavioral gate. Confirm there is no self-reselect loop: once `next === activeChapterId`, the guard makes the effect a no-op.

- [ ] **Step 6: Verify typecheck + design-lint + tests**

Run: `npm --prefix frontend run typecheck && node frontend/scripts/lint-design.mjs && npm --prefix frontend run test -- activeChapter`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/store/activeChapter.ts frontend/src/pages/EditorPage.tsx frontend/tests/store/activeChapter.test.ts
git commit -m "[<bd-id>] editor: auto-select first chapter on story load/switch (fix stale chat/scene)"
```

---

### Task 2: Show the real app version on the auth pages

**Files:**
- Modify: `frontend/vite.config.ts` (inject `__APP_VERSION__` from package.json)
- Modify: `frontend/vitest.config.ts` (same `define`, so tests resolve the global)
- Create: `frontend/src/lib/version.ts` (single `APP_VERSION` constant)
- Modify: `frontend/src/components/AuthForm.tsx` (footer at lines 237-241)
- Modify: `frontend/src/components/ResetPasswordForm.tsx` (footer at lines 146-148)
- Modify: `frontend/src/components/RecoveryCodeHandoff.tsx` (footer at lines 54-58)
- Test: `frontend/tests/components/AuthForm.test.tsx` (extend)

**Interfaces:**
- Produces: build-time global `__APP_VERSION__: string` (the raw package.json version, e.g. `"0.1.0"`), and `APP_VERSION` from `@/lib/version` — the display string, e.g. `"v0.1.0"`.
- Consumes: the three auth components render `{APP_VERSION}` in place of the hardcoded `Self-hosted · v0.4.2 [· inkwell-01]` spans.

- [ ] **Step 1: Inject the version via Vite `define` (build)**

In `frontend/vite.config.ts`, read the package version with `createRequire` (ESM-safe in a TS config) and add a `define`. Add near the top imports:

```ts
import { createRequire } from 'node:module';
```

and inside `defineConfig({ ... })`, add a top-level `define` key (sibling of `plugins`):

```ts
  define: {
    __APP_VERSION__: JSON.stringify(
      (createRequire(import.meta.url)('./package.json') as { version: string }).version,
    ),
  },
```

- [ ] **Step 2: Mirror the `define` in the Vitest config**

In `frontend/vitest.config.ts`, add the same import and a top-level `define` (sibling of `plugins` / `test`) so `__APP_VERSION__` resolves under vitest:

```ts
import { createRequire } from 'node:module';
```

```ts
  define: {
    __APP_VERSION__: JSON.stringify(
      (createRequire(import.meta.url)('./package.json') as { version: string }).version,
    ),
  },
```

- [ ] **Step 3: Write the failing test (extend AuthForm.test.tsx)**

Add to `frontend/tests/components/AuthForm.test.tsx` a case asserting the real version shows and the old hardcoded strings are gone. The version under test is `frontend/package.json`'s version (currently `0.1.0` → `v0.1.0`); assert by pattern so it doesn't break on a version bump:

```tsx
it('shows the real app version and not the old hardcoded footer', () => {
  // <render AuthForm exactly as the other tests in this file do — reuse the
  // existing render helper / wrapper already defined at the top of the file>
  expect(screen.getByText(/^v\d+\.\d+\.\d+/)).toBeInTheDocument();
  expect(screen.queryByText(/Self-hosted/)).not.toBeInTheDocument();
  expect(screen.queryByText(/inkwell-01/)).not.toBeInTheDocument();
});
```

> Note for implementer: match the existing render pattern in this test file (it already renders `AuthForm` for other cases — reuse that setup rather than introducing a new one). If `AuthForm` needs props/router/query context, copy them from a sibling test in the same file.

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm --prefix frontend run test -- AuthForm`
Expected: FAIL — `Self-hosted` / `inkwell-01` still present, no `vX.Y.Z` text.

- [ ] **Step 5: Create the version module**

Create `frontend/src/lib/version.ts`:

```ts
// `__APP_VERSION__` is injected at build time by Vite (and under Vitest) from
// frontend/package.json — see vite.config.ts / vitest.config.ts `define`.
declare const __APP_VERSION__: string;

/** App version for display on the auth pages, e.g. "v0.1.0". */
export const APP_VERSION = `v${__APP_VERSION__}`;
```

- [ ] **Step 6: Replace the hardcoded footer in all three auth components**

In `frontend/src/components/AuthForm.tsx`, add the import (alongside the other `@/` imports):

```tsx
import { APP_VERSION } from '@/lib/version';
```

Replace the three footer spans (lines 237-241):

```tsx
        <div className="flex gap-2 font-mono text-[11px] text-[var(--ink-4)]">
          <span>Self-hosted · v0.4.2</span>
          <span>·</span>
          <span>inkwell-01</span>
        </div>
```

with:

```tsx
        <div className="flex gap-2 font-mono text-[11px] text-[var(--ink-4)]">
          <span>{APP_VERSION}</span>
        </div>
```

Do the same in `frontend/src/components/RecoveryCodeHandoff.tsx` (lines 54-58 have the identical three-span block — replace with the single `{APP_VERSION}` span and add the `import { APP_VERSION } from '@/lib/version';`).

In `frontend/src/components/ResetPasswordForm.tsx` (lines 146-148, a single span), add the import and replace:

```tsx
        <div className="flex gap-2 font-mono text-[11px] text-[var(--ink-4)]">
          <span>Self-hosted · v0.4.2</span>
        </div>
```

with:

```tsx
        <div className="flex gap-2 font-mono text-[11px] text-[var(--ink-4)]">
          <span>{APP_VERSION}</span>
        </div>
```

- [ ] **Step 7: Run tests + typecheck + design-lint**

Run: `npm --prefix frontend run test -- AuthForm && npm --prefix frontend run typecheck && node frontend/scripts/lint-design.mjs`
Expected: all PASS; AuthForm shows `v0.1.0`, no `Self-hosted` / `inkwell-01`.

- [ ] **Step 8: Commit**

```bash
git add frontend/vite.config.ts frontend/vitest.config.ts frontend/src/lib/version.ts \
  frontend/src/components/AuthForm.tsx frontend/src/components/ResetPasswordForm.tsx \
  frontend/src/components/RecoveryCodeHandoff.tsx frontend/tests/components/AuthForm.test.tsx
git commit -m "[<bd-id>] auth: show real app version from package.json, drop hardcoded footer"
```

---

## Self-Review notes

- **Spec coverage:** defect 1 → Task 1 (auto-select first chapter, fixes both stale chat and stale scene since both read `activeChapterId`); defect 2 → Task 2 (real version, three components). Covered.
- **Decision recorded:** user chose "auto-open first chapter" over "reset to empty state" — Task 1 implements auto-select, which also changes first-load to land on chapter 1 (intended).
- **Type consistency:** `resolveActiveChapterId(chapters, currentId)` signature is identical in the helper, its test, and the EditorPage effect. `__APP_VERSION__` (raw) vs `APP_VERSION` (`v`-prefixed display) are used consistently across config, module, and components.
- **No-hardcode constraint:** the only version literal is `frontend/package.json`; `vX.Y.Z` is derived. The test asserts by regex so a version bump doesn't break it.
- **Open item for implementer:** reuse the existing `AuthForm` render setup in `AuthForm.test.tsx` (Task 2 Step 3) rather than inventing a new harness.
