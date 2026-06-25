# Backup/Restore UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three reported UX defects in the Settings → Data (backup/restore) tab: the native file-input "browse" button (unstyled browser chrome that doesn't read as a real button), a surprise auto-download save prompt on restore, and a "Could not load story" dead-end page after a restore wipes the open story.

**Architecture:** Frontend-only changes. All three fixes live in `SettingsDataTab.tsx`, with one defensive addition to the `EditorPage` error state. No backend, repo, auth, or crypto surface is touched — restore wipes the open story's id, so the fix is navigation + a non-dead-end error page, not a data change.

**Tech Stack:** React + TypeScript + TailwindCSS (v4 CSS-first `@theme` tokens) + react-router + Zustand + TanStack Query + Vitest/jsdom.

## Global Constraints

- TypeScript strict mode — no `any`.
- Design-lint guard (`frontend/scripts/lint-design.mjs`) enforces token-only styling in `frontend/src/` — use theme tokens (`--ink-*`, `--bg-*`, `--danger`, `--surface-hover`, `--radius`), never raw hex.
- Frontend component files are PascalCase; the file under change is `frontend/src/components/SettingsDataTab.tsx`.
- Frontend tests run under jsdom (vitest) — no real browser; assert via `data-testid` and React Testing Library.
- Verify: `npm --prefix frontend run typecheck && npm --prefix frontend run test -- SettingsDataTab && npx --prefix frontend biome check frontend/src/components/SettingsDataTab.tsx frontend/src/pages/EditorPage.tsx`

---

### Task 1: Replace the native file-input "browse" button with a styled button

The backup-file picker at `SettingsDataTab.tsx:88-97` is a raw `<input type="file">`, so the browser renders its default unstyled "Choose File" / "Browse" chrome — it doesn't read as a real, project-styled button. Visually hide the native input (keep it functional and keep `data-testid` for tests), trigger it from a styled button, and show the chosen filename next to it. The actual Restore button (`data-restore-btn`) is left unchanged.

**Files:**
- Modify: `frontend/src/components/SettingsDataTab.tsx` (file-input block at lines 86-98; add a `fileName` state)
- Test: `frontend/src/components/SettingsDataTab.test.tsx` (created/extended in Task 2)

**Interfaces:**
- Consumes: existing `fileRef`, `onFileChange`.
- Produces: a `fileName` state (string `''` when none); a styled `<button data-testid="data-restore-browse">` that calls `fileRef.current?.click()`; the native input stays in the DOM (visually hidden) with `data-testid="data-restore-file"` preserved so existing/Task-2 tests can `fireEvent.change` it directly.

- [ ] **Step 1: Add a `fileName` state and set it in `onFileChange`**

Add state after line 14 (`const fileRef = ...`):

```tsx
  const [fileName, setFileName] = useState('');
```

In `onFileChange`, capture the name when a file is chosen and clear it on the no-file / reset paths. After `const f = e.target.files?.[0];` (line 20):

```tsx
    if (!f) {
      setFileName('');
      return;
    }
    setFileName(f.name);
```

(Replace the existing `if (!f) return;` line.) Also clear it where the input is reset in `onRestore` — add `setFileName('');` next to `setStaged(null)` so a completed restore clears the displayed name.

- [ ] **Step 2: Replace the native input block with a hidden input + styled button**

Replace the file-input block (lines 86-98, the `<div className="flex flex-col gap-1">` wrapping the `<span>Backup file</span>` and `<input type="file">`):

```tsx
          <div className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-ink-2">Backup file</span>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              data-testid="data-restore-file"
              onChange={(e) => {
                void onFileChange(e);
              }}
              className="sr-only"
            />
            <div className="flex items-center gap-3">
              <button
                type="button"
                data-testid="data-restore-browse"
                onClick={() => fileRef.current?.click()}
                className="w-fit px-3 py-1.5 text-[12px] rounded-[var(--radius)] border border-line text-ink-2 bg-bg hover:bg-[color:var(--surface-hover)] transition-colors"
              >
                Choose file…
              </button>
              <span className="text-[12px] font-sans text-ink-4 truncate">
                {fileName || 'No file selected'}
              </span>
            </div>
          </div>
```

> Note: `sr-only` keeps the native input in the accessibility tree and focusable/clickable programmatically while hiding its default chrome — this is why tests can still `fireEvent.change(getByTestId('data-restore-file'))`. Confirm `sr-only` is available (Tailwind ships it by default; `frontend/scripts/lint-design.mjs` does not flag utility class names).

- [ ] **Step 3: Run design-lint + typecheck**

Run: `node frontend/scripts/lint-design.mjs && npm --prefix frontend run typecheck`
Expected: PASS (token-only `var(--surface-hover)` / `border-line`; no raw hex).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/SettingsDataTab.tsx
git commit -m "[<bd-id>] restore: styled 'Choose file' button replaces native file-input chrome"
```

---

### Task 2: Make the safety export opt-in via a checkbox

`onRestore` unconditionally calls `await exporter.download()` before importing (`SettingsDataTab.tsx:36`), which surprises the user with a browser save dialog. Gate it behind a visible, default-on checkbox so the safety net is preserved but never a surprise. Update the warning copy to match.

**Files:**
- Modify: `frontend/src/components/SettingsDataTab.tsx`
- Test: `frontend/src/components/SettingsDataTab.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `useExportBackup()` (`exporter.download`), `useImportBackup()` (`importer.mutateAsync`).
- Produces: a `safetyBackup` boolean state (default `true`); a checkbox with `data-testid="data-restore-safety"`; `onRestore` calls `exporter.download()` only when `safetyBackup` is true.

- [ ] **Step 1: Write the failing test — unchecked safety box skips the export download**

Create `frontend/src/components/SettingsDataTab.test.tsx`. Mock both hooks so we can assert the export is/isn't called. Stage a valid file by mocking `importSchema` parse path is not needed — instead drive the component by mocking the hooks and firing the file input with a valid backup JSON. Use a minimal valid `ImportFile` shape (empty `stories: []`).

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsDataTab } from './SettingsDataTab';

const download = vi.fn().mockResolvedValue(undefined);
const mutateAsync = vi.fn().mockResolvedValue({ stories: 0, chapters: 0 });
const navigate = vi.fn();

vi.mock('@/hooks/useBackup', () => ({
  useExportBackup: () => ({ download, isPending: false }),
  useImportBackup: () => ({ mutateAsync, isPending: false }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

const validBackup = JSON.stringify({ version: 1, exportedAt: '2026-06-25T00:00:00.000Z', stories: [] });

async function stageFile(): Promise<void> {
  const input = screen.getByTestId('data-restore-file') as HTMLInputElement;
  const file = new File([validBackup], 'backup.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(validBackup) });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(screen.getByTestId('data-restore-summary')).toBeInTheDocument());
}

describe('SettingsDataTab restore', () => {
  beforeEach(() => {
    download.mockClear();
    mutateAsync.mockClear();
    navigate.mockClear();
  });

  it('skips the safety export when the checkbox is unchecked', async () => {
    render(<SettingsDataTab />);
    await stageFile();
    fireEvent.click(screen.getByTestId('data-restore-safety')); // default on → uncheck
    fireEvent.change(screen.getByTestId('data-restore-phrase'), { target: { value: 'replace everything' } });
    fireEvent.click(screen.getByTestId('data-restore-btn'));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(download).not.toHaveBeenCalled();
  });

  it('runs the safety export when the checkbox is left checked', async () => {
    render(<SettingsDataTab />);
    await stageFile();
    fireEvent.change(screen.getByTestId('data-restore-phrase'), { target: { value: 'replace everything' } });
    fireEvent.click(screen.getByTestId('data-restore-btn'));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(download).toHaveBeenCalledTimes(1);
  });
});
```

> Note for implementer: confirm the real `importSchema` (in `story-editor-shared`) accepts `{ version, exportedAt, stories: [] }`. If its required fields differ, adjust `validBackup` to a minimal valid instance rather than mocking the schema — the file-staging path must exercise the real parse.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix frontend run test -- SettingsDataTab`
Expected: FAIL — `data-restore-safety` not found / `download` called when it shouldn't be.

- [ ] **Step 3: Add the `safetyBackup` state and checkbox**

In `SettingsDataTab.tsx`, add state near the other `useState` calls (after line 13):

```tsx
  const [safetyBackup, setSafetyBackup] = useState(true);
```

Render a checkbox inside the restore `<div className="flex flex-col gap-3">`, immediately before the confirm-phrase block (before line 133). Use the existing `useId` pattern for the label association:

```tsx
          <label className="flex items-center gap-2 text-[12px] text-ink-2 font-sans">
            <input
              type="checkbox"
              data-testid="data-restore-safety"
              checked={safetyBackup}
              onChange={(e) => {
                setSafetyBackup(e.target.checked);
              }}
            />
            Download a safety backup of my current content first
          </label>
```

- [ ] **Step 4: Gate the export in `onRestore`**

Change `onRestore` (line 36) so the export only runs when opted in:

```tsx
  async function onRestore(): Promise<void> {
    if (!staged) return;
    if (safetyBackup) await exporter.download();
    await importer.mutateAsync(staged);
    setStaged(null);
    setPhrase('');
    if (fileRef.current) fileRef.current.value = '';
  }
```

- [ ] **Step 5: Update the warning copy to be conditional**

The summary box (line 126-129) hard-codes "A safety export will be downloaded automatically…". Make it reflect the checkbox:

```tsx
              <p className="text-[12px] font-sans text-[color:var(--danger)]">
                Restoring will permanently delete all current content.
                {safetyBackup
                  ? ' A safety backup of your current content will be downloaded first.'
                  : ''}
              </p>
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm --prefix frontend run test -- SettingsDataTab`
Expected: PASS (both checked and unchecked cases).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/SettingsDataTab.tsx frontend/src/components/SettingsDataTab.test.tsx
git commit -m "[<bd-id>] restore: make safety export an opt-in checkbox (default on)"
```

---

### Task 3: Navigate home after restore + give the EditorPage error a way out

After a successful import, `useImportBackup` invalidates all queries; the open story at `/stories/:id` no longer exists, so `EditorPage` refetches → 404 → bare "Could not load story" dead-end (`EditorPage.tsx:465-474`). Fix: navigate to the dashboard (`/`) after a successful restore (the restored library), and add a "Back to library" link on the error page as a safety net for any other 404 path.

**Files:**
- Modify: `frontend/src/components/SettingsDataTab.tsx` (navigate after restore)
- Modify: `frontend/src/pages/EditorPage.tsx:465-474` (error-state back link)
- Test: `frontend/src/components/SettingsDataTab.test.tsx` (extend Task 2's file)

**Interfaces:**
- Consumes: `useNavigate` from `react-router-dom`; the dashboard route is `/` (`router.tsx:95`).
- Produces: after a successful `mutateAsync`, `navigate('/')` is called; EditorPage error state renders a `<Link to="/">` / button to `/`.

- [ ] **Step 1: Write the failing test — restore navigates to `/`**

Add to `SettingsDataTab.test.tsx` (the `react-router-dom` mock and `navigate` spy from Task 2 are already in place):

```tsx
  it('navigates to the library after a successful restore', async () => {
    render(<SettingsDataTab />);
    await stageFile();
    fireEvent.change(screen.getByTestId('data-restore-phrase'), { target: { value: 'replace everything' } });
    fireEvent.click(screen.getByTestId('data-restore-btn'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'));
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix frontend run test -- SettingsDataTab`
Expected: FAIL — `navigate` not called with `'/'`.

- [ ] **Step 3: Wire `useNavigate` into the restore flow**

In `SettingsDataTab.tsx`, import and use the navigator:

```tsx
import { useNavigate } from 'react-router-dom';
```

Inside the component (near the other hooks, after line 10):

```tsx
  const navigate = useNavigate();
```

Append the navigation to the end of a successful `onRestore` (after clearing the file input at line 40):

```tsx
    if (fileRef.current) fileRef.current.value = '';
    navigate('/');
```

> Note: `mutateAsync` rejects on failure, so the lines after it (including `navigate('/')`) only run on success. The settings modal is mounted inside `EditorPage`; navigating to `/` unmounts `EditorPage`, whose cleanup (`EditorPage.tsx:446-450`) already closes the modal — no explicit `close()` needed.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --prefix frontend run test -- SettingsDataTab`
Expected: PASS.

- [ ] **Step 5: Add a "Back to library" link to the EditorPage error state**

Confirm `Link` is imported in `EditorPage.tsx` (it imports from `react-router-dom` already — add `Link` to that import if missing). Replace the error-state block (`EditorPage.tsx:465-474`) so it is no longer a dead-end:

```tsx
  if (storyQuery.isError || !story) {
    return (
      <div
        role="alert"
        data-testid="editor-page-error"
        className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center font-sans text-[13px] text-ink-3"
      >
        <p className="m-0">Could not load story</p>
        <Link
          to="/"
          data-testid="editor-page-error-home"
          className="px-3 py-1.5 text-[12px] rounded-[var(--radius)] bg-ink text-bg hover:bg-ink-2 transition-colors"
        >
          Back to library
        </Link>
      </div>
    );
  }
```

- [ ] **Step 6: Run typecheck + design-lint + the test file**

Run: `npm --prefix frontend run typecheck && node frontend/scripts/lint-design.mjs && npm --prefix frontend run test -- SettingsDataTab`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/SettingsDataTab.tsx frontend/src/components/SettingsDataTab.test.tsx frontend/src/pages/EditorPage.tsx
git commit -m "[<bd-id>] restore: navigate to library after restore; add back link to load-error page"
```

---

## Self-Review notes

- **Spec coverage:** Three reported defects → Task 1 (button), Task 2 (save-prompt opt-in), Task 3 (dead-end page). All covered.
- **Decision recorded:** safety export is opt-in via a default-on checkbox (user-approved direction). Default-on preserves the safety net; the visible labeled checkbox removes the surprise.
- **Type consistency:** `safetyBackup`/`setSafetyBackup`, `data-testid` values (`data-restore-safety`, `editor-page-error-home`), and `navigate('/')` are used consistently across tasks.
- **Open item for implementer:** verify the real `importSchema` shape for the test fixture (Step 1 note in Task 2) rather than mocking the schema.
