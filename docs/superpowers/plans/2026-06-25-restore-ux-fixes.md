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
- Test: `frontend/tests/components/SettingsDataTab.test.tsx` (extended in Task 2)

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
- Test: `frontend/tests/components/SettingsDataTab.test.tsx` (**extend the existing file** — do not create a colocated one; this project keeps tests under `frontend/tests/`)

**Interfaces:**
- Consumes: `useExportBackup()` (`exporter.download`), `useImportBackup()` (`importer.mutateAsync`).
- Produces: a `safetyBackup` boolean state (default `true`); a checkbox with `data-testid="data-restore-safety"`; `onRestore` calls `exporter.download()` only when `safetyBackup` is true.

**Test-harness facts (verified against the existing file — match this style, do NOT introduce wholesale hook mocking):**
- The existing tests use **real hooks** and drive the component through the real `useExportBackup`/`useImportBackup`, asserting at the `@/lib/api` boundary. Mirror `frontend/tests/hooks/useBackup.test.tsx`: `vi.spyOn(apiModule, 'fetchExportBlob')` for the safety export and `vi.spyOn(apiModule, 'api')` for the import. (`import * as apiModule from '@/lib/api'`.) This avoids the native download path (`URL.createObjectURL` / anchor click) entirely.
- The valid backup fixture shape is exactly `{ formatVersion: 1, app: 'inkwell', exportedAt: '2026-06-24T12:00:00.000Z', stories: [] }` (see `importSchema` = `exportSchema` in `shared/src/schemas/transfer.ts`). A `File` made with `new File([JSON.stringify(fixture)], 'backup.json', { type: 'application/json' })` staged via `data-restore-file` works — the existing "enables Restore" test relies on `File.text()` resolving in jsdom.
- A valid `ImportResult` (what `apiModule.api` must resolve for the import) is `{ imported: { stories: 0, chapters: 0, characters: 0, outlineItems: 0, chats: 0, messages: 0 } }` (`importResultSchema`, `transfer.ts`). Returning anything else makes `importResultSchema.parse` throw and the restore reject.
- The component will gain `useNavigate()` in Task 3. Mock it once at the top of the test file using `vi.hoisted` so all `renderTab()` calls keep working without a router:
  ```tsx
  const { navigateSpy } = vi.hoisted(() => ({ navigateSpy: vi.fn() }));
  vi.mock('react-router-dom', async (orig) => ({
    ...(await orig<typeof import('react-router-dom')>()),
    useNavigate: () => navigateSpy,
  }));
  ```
  Adding this mock now (in Task 2) keeps the file green when Task 3 wires `useNavigate` into the component.

- [ ] **Step 1: Write the failing tests — safety export is gated on the checkbox**

Add to the existing `describe('SettingsDataTab', …)` in `frontend/tests/components/SettingsDataTab.test.tsx`. Add `import * as apiModule from '@/lib/api'` at the top, the `vi.hoisted`/`vi.mock('react-router-dom', …)` block above, and a small helper that stages the valid fixture + spies. Example new cases:

```tsx
const VALID_BACKUP = { formatVersion: 1, app: 'inkwell', exportedAt: '2026-06-24T12:00:00.000Z', stories: [] };
const IMPORT_RESULT = { imported: { stories: 0, chapters: 0, characters: 0, outlineItems: 0, chats: 0, messages: 0 } };

async function stageValidFile(): Promise<void> {
  const file = new File([JSON.stringify(VALID_BACKUP)], 'backup.json', { type: 'application/json' });
  fireEvent.change(screen.getByTestId('data-restore-file'), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByTestId('data-restore-summary')).toBeInTheDocument());
}

it('skips the safety export when the checkbox is unchecked', async () => {
  const exportSpy = vi.spyOn(apiModule, 'fetchExportBlob');
  vi.spyOn(apiModule, 'api').mockResolvedValue(IMPORT_RESULT);
  renderTab();
  await stageValidFile();
  fireEvent.click(screen.getByTestId('data-restore-safety')); // default on → uncheck
  fireEvent.change(screen.getByLabelText(/type .*replace everything/i), { target: { value: 'replace everything' } });
  fireEvent.click(screen.getByRole('button', { name: /restore/i }));
  await waitFor(() => expect(apiModule.api).toHaveBeenCalledWith('/users/me/import', expect.objectContaining({ method: 'POST' })));
  expect(exportSpy).not.toHaveBeenCalled();
});

it('runs the safety export when the checkbox is left checked', async () => {
  const exportSpy = vi
    .spyOn(apiModule, 'fetchExportBlob')
    .mockResolvedValue({ blob: new Blob(['{}']), filename: 'inkwell-backup.json' });
  vi.spyOn(apiModule, 'api').mockResolvedValue(IMPORT_RESULT);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  renderTab();
  await stageValidFile();
  fireEvent.change(screen.getByLabelText(/type .*replace everything/i), { target: { value: 'replace everything' } });
  fireEvent.click(screen.getByRole('button', { name: /restore/i }));
  await waitFor(() => expect(exportSpy).toHaveBeenCalledTimes(1));
});
```

> The existing `beforeEach` stubs global `fetch` to return `{}`; spying on `apiModule.api`/`fetchExportBlob` overrides that for these cases. Keep `vi.unstubAllGlobals()` / `vi.restoreAllMocks()` teardown consistent with the file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix frontend run test -- SettingsDataTab`
Expected: FAIL — `data-restore-safety` not found / export still runs when unchecked.

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
git add frontend/src/components/SettingsDataTab.tsx frontend/tests/components/SettingsDataTab.test.tsx
git commit -m "[<bd-id>] restore: make safety export an opt-in checkbox (default on)"
```

---

### Task 3: Navigate home after restore + give the EditorPage error a way out

After a successful import, `useImportBackup` invalidates all queries; the open story at `/stories/:id` no longer exists, so `EditorPage` refetches → 404 → bare "Could not load story" dead-end (`EditorPage.tsx:465-474`). Fix: navigate to the dashboard (`/`) after a successful restore (the restored library), and add a "Back to library" link on the error page as a safety net for any other 404 path.

**Files:**
- Modify: `frontend/src/components/SettingsDataTab.tsx` (navigate after restore)
- Modify: `frontend/src/pages/EditorPage.tsx:465-474` (error-state back link)
- Test: `frontend/tests/components/SettingsDataTab.test.tsx` (extend Task 2's additions)

**Interfaces:**
- Consumes: `useNavigate` from `react-router-dom`; the dashboard route is `/` (`router.tsx:95`).
- Produces: after a successful `mutateAsync`, `navigate('/')` is called; EditorPage error state renders a `<Link to="/">` to `/`.

- [ ] **Step 1: Write the failing test — restore navigates to `/`**

Add to `frontend/tests/components/SettingsDataTab.test.tsx` (the `vi.mock('react-router-dom', …)` + `navigateSpy` from Task 2 are already in place; reset `navigateSpy.mockClear()` in `beforeEach` or per-test):

```tsx
it('navigates to the library after a successful restore', async () => {
  vi.spyOn(apiModule, 'fetchExportBlob').mockResolvedValue({ blob: new Blob(['{}']), filename: 'b.json' });
  vi.spyOn(apiModule, 'api').mockResolvedValue(IMPORT_RESULT);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  renderTab();
  await stageValidFile();
  fireEvent.change(screen.getByLabelText(/type .*replace everything/i), { target: { value: 'replace everything' } });
  fireEvent.click(screen.getByRole('button', { name: /restore/i }));
  await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/'));
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
git add frontend/src/components/SettingsDataTab.tsx frontend/tests/components/SettingsDataTab.test.tsx frontend/src/pages/EditorPage.tsx
git commit -m "[<bd-id>] restore: navigate to library after restore; add back link to load-error page"
```

---

## Self-Review notes

- **Spec coverage:** Three reported defects → Task 1 (button), Task 2 (save-prompt opt-in), Task 3 (dead-end page). All covered.
- **Decision recorded:** safety export is opt-in via a default-on checkbox (user-approved direction). Default-on preserves the safety net; the visible labeled checkbox removes the surprise.
- **Type consistency:** `safetyBackup`/`setSafetyBackup`, `data-testid` values (`data-restore-safety`, `data-restore-browse`, `editor-page-error-home`), and `navigate('/')` are used consistently across tasks.
- **Test harness:** tests extend `frontend/tests/components/SettingsDataTab.test.tsx` using real hooks + `vi.spyOn(apiModule, …)` (matching `useBackup.test.tsx`), the verified `{ formatVersion, app, exportedAt, stories }` backup fixture, the `{ imported: {…} }` `ImportResult`, and a hoisted `useNavigate` mock. No wholesale hook mocking.
- **Open item for implementer:** confirm `Link` is imported from `react-router-dom` in `EditorPage.tsx` before using it in Task 3 Step 5 (add to the existing import if absent).
