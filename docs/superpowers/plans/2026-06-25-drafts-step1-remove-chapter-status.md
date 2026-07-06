# Drafts Step 1 — Remove dormant `Chapter.status` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the dormant `Chapter.status` field from the application layer and the export format, and bump the export format version — without any DB migration.

**Architecture:** `Chapter.status` is a `draft|revision|final` enum that the API accepts but no UI ever sets; it's dead weight. This step strips it from the shared Zod schemas, the backend repo shape + routes + serializer + export/import services, the export/import schema (bumping `EXPORT_FORMAT_VERSION` 1→2), the API-contract doc, and frontend/test fixtures. **The Prisma `status` column is intentionally left in place** (`schema.prisma` unchanged, no migration) — it becomes an orphaned column that Step 2's drafts migration drops. Raw-Prisma model tests that read the column directly stay valid until then.

**Tech Stack:** TypeScript (strict), Zod, Prisma, Express, Vitest, React/Storybook. Monorepo workspaces: `shared`, `backend`, `frontend`.

## Global Constraints

- TypeScript strict mode across all workspaces — no `any`. (CLAUDE.md)
- **Work from the worktree** `.worktrees/chapter-drafts` (branch `feature/chapter-drafts`). All paths below are repo-relative within it.
- bd issue: **story-editor-9wk.1**. Commit format: `[story-editor-9wk.1] <desc>`. (CLAUDE.md Git Rules)
- Backend vitest requires the docker stack up: run `make dev` (Postgres healthy) **before** any `npm -w story-editor-backend run test`. `backend/vitest.config.ts` globalSetup unconditionally resets the test DB. (bd memory: backend tests need the stack)
- Do **not** modify `backend/prisma/schema.prisma` or add a migration in this step — the column drop belongs to Step 2 (story-editor-9wk.2). (Spec §4, §11)
- Design spec: `docs/superpowers/specs/2026-06-25-chapter-drafts-design.md` (§4) — present on this branch.
- **OutlineItem also has a `status` field — never touch it.** Lines to LEAVE: `serialize.ts:102`, `export.service.ts:75`, `import.service.ts:124`, the `transfer.ts` outline schema, the `outline` Zod schemas, and `transfer.test.ts:39`.
- This step touches narrative-entity routes/serializer + export/import → `repo-boundary-reviewer` may fire at close; no auth/key surface touched.

---

### Task 1: Remove `status` from shared chapter schemas

**Files:**
- Modify: `shared/src/schemas/chapter.ts`
- Modify: `shared/src/index.ts`
- Modify: `shared/tests/chapter.schema.test.ts`  *(`shared/tsconfig.json` includes `tests/**`, so `tsc --noEmit` type-checks it — Step 3 fails if it isn't updated here)*

**Interfaces:**
- Consumes: nothing.
- Produces: `chapterMetaSchema`, `chapterSchema`, `chapterCreateSchema`, `chapterUpdateSchema` **without** a `status` field; `chapterStatusSchema` and `ChapterStatus` no longer exported. Every later task depends on this.

- [ ] **Step 1: Delete `chapterStatusSchema` and the `status` fields**

In `shared/src/schemas/chapter.ts`:
- Delete line 7: `export const chapterStatusSchema = z.enum(['draft', 'revision', 'final']);`
- In `chapterMetaBase` (line 63) delete: `status: chapterStatusSchema,`
- In `chapterCreateSchema` (line 87) delete: `status: chapterStatusSchema.optional(),`
- In `chapterUpdateSchema` (line 93) delete: `status: chapterStatusSchema.optional(),`
- Delete the type export (line 124): `export type ChapterStatus = z.infer<typeof chapterStatusSchema>;`

- [ ] **Step 2: Remove the re-exports from `shared/src/index.ts`**

Delete the `ChapterStatus,` line (8) and the `chapterStatusSchema,` line (23). Leave `chapterCreateSchema`, `chapterMetaSchema`, `chapterUpdateSchema` exports intact.

- [ ] **Step 3: Update `shared/tests/chapter.schema.test.ts`**

The schemas are `z.strictObject`, so a stray `status` key throws at runtime *and* the file imports the now-deleted export — both break the gate. Edit:
- Remove `chapterStatusSchema,` from the import block (line 13).
- Delete the entire `describe('chapterStatusSchema', () => { … })` block (lines 34–46).
- Delete the `status: 'draft' as const,` field from the `VALID_META` fixture (line 27).
- Delete `status: 'draft' as const` from the create-input object (line 116).
- Delete the update-status assertion (line 137): `expect(chapterUpdateSchema.parse({ status: 'final' })).toEqual({ status: 'final' });`.
- Delete the `status: 'draft',` keys at lines 259, 275, 292.
- Leave any outline-related lines untouched.

- [ ] **Step 4: Typecheck shared**

Run: `npm --prefix shared run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src/schemas/chapter.ts shared/src/index.ts shared/tests/chapter.schema.test.ts
git commit -m "[story-editor-9wk.1] remove status from shared chapter schemas + tests"
```

---

### Task 2: Remove `status` from the export/import schema, bump version, fix transfer test

**Files:**
- Modify: `shared/src/schemas/transfer.ts`
- Modify: `shared/src/schemas/transfer.test.ts`

**Interfaces:**
- Consumes: `chapterSummarySchema` (still imported), the now-statusless chapter schemas (Task 1).
- Produces: `EXPORT_FORMAT_VERSION = 2`; `chapterExportSchema` without `status`. Backend export/import (Task 3) and backup tests (Task 4) depend on this.

- [ ] **Step 1: Bump the format version + drop status from the schema**

In `shared/src/schemas/transfer.ts`:
- Line 10: `export const EXPORT_FORMAT_VERSION = 2 as const;`
- Line 2: change `import { chapterStatusSchema, chapterSummarySchema } from './chapter';` → `import { chapterSummarySchema } from './chapter';`
- In `chapterExportSchema` (line 32) delete: `status: chapterStatusSchema,`

- [ ] **Step 2: Fix `transfer.test.ts` (status fixture + inverted version assertion)**

In `shared/src/schemas/transfer.test.ts`:
- Line 14: delete `status: 'draft',` from the chapter fixture. (Line 39 `status: 'todo'` is the **outline** fixture — leave it.)
- Line 49: the negative test currently asserts version `2` is rejected — but `2` is now the *valid* version, so this assertion inverts and fails. Change the probe to an actually-invalid version:
  ```ts
  expect(exportSchema.safeParse({ ...minimal, formatVersion: 99 }).success).toBe(false);
  ```
  (Line 5's `minimal` uses `formatVersion: EXPORT_FORMAT_VERSION`, which now resolves to `2`, so the positive-parse tests stay valid.)

- [ ] **Step 3: Typecheck + run shared tests**

Run: `npm --prefix shared run typecheck && npm --prefix shared run test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add shared/src/schemas/transfer.ts shared/src/schemas/transfer.test.ts
git commit -m "[story-editor-9wk.1] drop status from export schema; bump version to 2; fix transfer test"
```

---

### Task 3: Remove `status` from backend repo, routes, serializer, and export/import services

**Files:**
- Modify: `backend/src/repos/chapter.repo.ts`
- Modify: `backend/src/routes/chapters.routes.ts`
- Modify: `backend/src/lib/serialize.ts`
- Modify: `backend/src/services/export.service.ts`
- Modify: `backend/src/services/import.service.ts`
- Modify: `docs/api-contract.md`

**Interfaces:**
- Consumes: statusless shared schemas (Tasks 1–2).
- Produces: `RepoChapter` / `RepoChapterMeta` / repo create+update inputs without `status`; chapter create/update routes no longer read `body.status`; serialized chapter (meta + full) has no `status`; export emits no chapter `status`; import ignores chapter `status`.

- [ ] **Step 1: Remove from `chapter.repo.ts`** (exact sites — `shape()`/`shapeMeta()` have **no** explicit status mapping; `status` flows via `projectDecrypted`, so the real write-sites are these)

- Line 24: in `RepoChapterCreateInput` delete `status?: string;`
- Line 36: in `RepoChapterUpdateInput` delete `status?: string;`
- Line 58: in the `RepoChapter` type delete `status: ChapterStatus;`
- Line ~6/9: remove the now-unused `type ChapterStatus` from the import block.
- Line 114: in the create `data` object delete `status: input.status ?? 'draft',`.
- Line 162: in the `findMany` `select` delete `status: true,`.
- Line 235: in `update` delete `if (input.status !== undefined) data.status = input.status;`.
- **Do not** touch `schema.prisma`; the column stays and applies its `@default("draft")` on insert (so create still works without the explicit `status` write).

- [ ] **Step 2: Remove from `chapters.routes.ts`**

- POST create call (line 102): delete `status: body.status,`.
- PATCH handler (line 204): delete `if (body.status !== undefined) input.status = body.status;`.

- [ ] **Step 3: Remove from the serializer — TWO deletions**

In `backend/src/lib/serialize.ts`, delete `status: row.status,` at **line 121 (`serializeChapter`)** and **line 141 (`serializeChapterMeta`)**. **LEAVE line 102** — that is `serializeOutlineItem` (OutlineItem.status).

- [ ] **Step 4: Remove from export/import services**

- `backend/src/services/export.service.ts` line 49: delete `status: meta.status,`. **LEAVE line 75** (outline).
- `backend/src/services/import.service.ts` line 61: delete `status: ch.status,`. **LEAVE line 124** (outline).

- [ ] **Step 5: Update the API-contract doc**

In `docs/api-contract.md`, remove the chapter `status` field from the chapter list/detail response shapes and the create/update request bodies (grep `status` in that file to find them; leave any outline/story status).

- [ ] **Step 6: Typecheck backend**

Run: `npm --prefix backend run typecheck`
Expected: PASS (no `ChapterStatus`/chapter-`status` references remain in repo/routes/serializer/services).

- [ ] **Step 7: Commit**

```bash
git add backend/src/repos/chapter.repo.ts backend/src/routes/chapters.routes.ts backend/src/lib/serialize.ts backend/src/services/export.service.ts backend/src/services/import.service.ts docs/api-contract.md
git commit -m "[story-editor-9wk.1] remove status from backend chapter repo/routes/serializer/export/import + doc"
```

---

### Task 4: Update backend tests that exercise `status` via the app layer

**Files (modify):**
- `backend/tests/repos/chapter.repo.test.ts`
- `backend/tests/lib/serialize.test.ts`
- `backend/tests/routes/chapters-body-json.test.ts`
- `backend/tests/routes/backup.test.ts`

**LEAVE UNCHANGED (read the raw Prisma column, still present until Step 2):**
`backend/tests/models/chapter.test.ts`, `backend/tests/models/chapter-body-json.test.ts`, `backend/tests/models/chapter-encrypted.test.ts` — these seed/assert the DB column directly via raw Prisma and remain valid; Step 2 removes them with the column drop. Do not "helpfully" edit them.

**Interfaces:** consumes statusless routes/serializer/services (Task 3) and export schema v2 (Task 2).

- [ ] **Step 1: Confirm current line numbers (test files may have drifted)**

Run: `grep -nE "status: 'draft'|status: 'revision'|\.status\)\.toBe|formatVersion" backend/tests/repos/chapter.repo.test.ts backend/tests/lib/serialize.test.ts backend/tests/routes/chapters-body-json.test.ts backend/tests/routes/backup.test.ts`
Expected: surfaces the lines edited below.

- [ ] **Step 2: `chapter.repo.test.ts`** — delete the `expect(ch.status).toBe('draft');` assertion (and any `status` key in the create input it asserts on).

- [ ] **Step 3: `serialize.test.ts`** — delete the four chapter `status: 'draft',` lines: 266 + 281 (input fixtures) and 297 + 338 (inside `.toEqual(...)` expected objects). (Outline lines 157/175 use `'active'`/`wire.status` and are not matched — leave them.)

- [ ] **Step 4: `chapters-body-json.test.ts`** — at line 238 remove `status: 'revision'` from the PATCH `.send({...})` and delete the `expect(...chapter.status).toBe('revision')` assertion (line 241). **Keep the `it(...)` block** — it's the B3 regression that a text-only PATCH leaves body/wordCount untouched, not a status-only test. Optionally rename the title at line 219 from "title + status" to "title only" (cosmetic; no gate impact).

- [ ] **Step 5: `backup.test.ts` — status fixtures AND formatVersion bumps**

- Delete the chapter `status: 'draft',` fixture lines (127, 135, 198).
- Line 65: `expect(res.body.formatVersion).toBe(2);` (the export endpoint now emits 2).
- Lines 118, 189, 261: change `formatVersion: 1,` → `formatVersion: 2,` (these import fixtures validate against `importSchema`, now `z.literal(2)`).
- **Leave line 248** (`formatVersion: 99` — the intentionally-invalid fixture in the "rejects an unknown formatVersion" test).

- [ ] **Step 6: Run the affected backend tests (stack must be up)**

Run:
```bash
make dev   # Postgres healthy first
npm -w story-editor-backend run test -- tests/repos/chapter.repo.test.ts tests/lib/serialize.test.ts tests/routes/chapters-body-json.test.ts tests/routes/backup.test.ts
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/tests/repos/chapter.repo.test.ts backend/tests/lib/serialize.test.ts backend/tests/routes/chapters-body-json.test.ts backend/tests/routes/backup.test.ts
git commit -m "[story-editor-9wk.1] update backend tests for status removal + format version 2"
```

---

### Task 5: Remove `status` from frontend fixtures/stories + bump backup fixtures

**Files (modify):**
- Stories: `frontend/src/components/ChapterList.stories.tsx` (lines 16, 28, 40, 52, 64, 76), `frontend/src/components/ChapterSummaryPopover.stories.tsx` (line 18)
- Typed test fixtures (each is typed `ChapterMeta`/`Chapter` or `as const` → frontend typecheck breaks if not edited):
  - `frontend/tests/fixtures/chapter.ts` (line 14)
  - `frontend/tests/pages/editor.test.tsx` (line 224)
  - `frontend/tests/pages/editor-paper.integration.test.tsx` (line 46)
  - `frontend/tests/pages/editor-ai.integration.test.tsx` (line 49)
  - `frontend/tests/components/ChapterSummaryPopover.test.tsx` (line 15, `as const`)
  - `frontend/tests/hooks/useChapter.test.tsx` (line 59, `as const`)
- Backup fixtures (formatVersion): `frontend/tests/components/SettingsDataTab.test.tsx` (lines 78, 100), `frontend/tests/hooks/useBackup.test.tsx` (line 59 — `mutateAsync({ formatVersion: 1, … })` is typed `ImportFile`, now `z.literal(2)`, so it's a TS error until bumped)

**Interfaces:** consumes statusless `ChapterMeta`/`Chapter` types (Task 1) and export schema v2 (Task 2).

- [ ] **Step 1: Confirm the full frontend reference set**

Run: `grep -rnE "status: 'draft'( as const)?|formatVersion: 1" frontend/src frontend/tests`
Expected: only the fixtures/stories above (real components don't read `chapter.status`; `ChapterList.tsx` `err.status` is unrelated).

- [ ] **Step 2: Delete the chapter `status` fixture fields**

Remove each `status: 'draft',` (and `status: 'draft' as const,`) line from the stories and the six typed test fixtures listed above.

- [ ] **Step 3: Bump the staged-backup fixtures to version 2**

- `frontend/tests/components/SettingsDataTab.test.tsx` lines 78 and 100: `formatVersion: 1,` → `formatVersion: 2,`.
- `frontend/tests/hooks/useBackup.test.tsx` line 59: `formatVersion: 1,` → `formatVersion: 2,` (the `mutateAsync` arg is typed `ImportFile`).

- [ ] **Step 4: Typecheck + test frontend**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ChapterList.stories.tsx frontend/src/components/ChapterSummaryPopover.stories.tsx frontend/tests/fixtures/chapter.ts frontend/tests/pages/editor.test.tsx frontend/tests/pages/editor-paper.integration.test.tsx frontend/tests/pages/editor-ai.integration.test.tsx frontend/tests/components/ChapterSummaryPopover.test.tsx frontend/tests/hooks/useChapter.test.tsx frontend/tests/components/SettingsDataTab.test.tsx frontend/tests/hooks/useBackup.test.tsx
git commit -m "[story-editor-9wk.1] remove status from frontend fixtures; bump backup fixtures to v2"
```

---

### Task 6: Full-suite verification

**Interfaces:** none — final gate.

- [ ] **Step 1: Confirm no stray chapter-status / v1 references remain**

Run: `grep -rnE "chapterStatusSchema|ChapterStatus|status: '(draft|revision|final)'|formatVersion: 1\b" shared/src shared/tests backend/src frontend/src docs/api-contract.md backend/tests frontend/tests | grep -viE "models/chapter|outline"`
Expected: no chapter-status / v1 references (only the deliberately-left `tests/models/chapter*` raw-column seeds and any outline status remain).

- [ ] **Step 2: Typecheck all workspaces**

Run: `make typecheck`
Expected: PASS.

- [ ] **Step 3: Run the affected suites end-to-end (stack up)**

Run:
```bash
make dev
npm -w story-editor-backend run test -- tests/lib/serialize.test.ts tests/routes/backup.test.ts tests/repos/chapter.repo.test.ts
npm --prefix shared run test
npm --prefix frontend run test
```
Expected: PASS.

- [ ] **Step 4: Close through the gate**

Do not `bd close` directly. Run `/bd-close-reviewed story-editor-9wk.1`. (The bd `verify:` line for this issue is strengthened to run typecheck + the export/serialize/backup backend tests — see the issue notes.)

---

## Self-Review

- **Spec coverage (§4):** status removed from shared (T1), export schema + version bump + transfer test (T2), backend repo/routes/serializer/export/import + api-contract doc (T3), backend tests incl. all `backup.test.ts` formatVersion lines (T4), frontend stories + six typed fixtures + SettingsDataTab (T5), closure grep + suites (T6). DB column drop deferred to Step 2 per §4/§11. ✓
- **Placeholder scan:** every edit names exact file + line + concrete change; grep-first steps guard test files whose lines may drift. ✓
- **Type consistency:** `chapterStatusSchema`/`ChapterStatus` removed in T1; every typed consumer (transfer, repo, routes, serializer, export/import services, six frontend fixtures, stories) updated in T2–T5; T6 grep proves closure. ✓
- **Verify-line sufficiency:** the original bd verify (shared+frontend typecheck) would miss backend runtime breakage (export/serialize/backup) and the inverted transfer assertion — T6 Step 3 runs those suites, and the bd verify line is strengthened to match. ✓
- **OutlineItem.status safety:** explicitly enumerated leave-lines (serialize 102, export 75, import 124, transfer outline + test:39, outline schemas). ✓
- **Leave-unchanged raw-Prisma tests:** `tests/models/chapter.test.ts`, `chapter-body-json.test.ts`, `chapter-encrypted.test.ts` left for Step 2 (column still present). ✓
- **Second-review fixes folded in (round 1):** export.service.ts:49 + import.service.ts:61 (were missing → backend typecheck breakers), six typed frontend fixtures (were missing → frontend typecheck breaker = the verify line itself), transfer.test.ts inverted assertion, backup.test.ts formatVersion lines 65/118/189/261, SettingsDataTab v2 bump, serializer two-deletions, api-contract doc. ✓
- **Third-review fixes folded in (round 2):** `shared/tests/chapter.schema.test.ts` added to Task 1 (import + `describe('chapterStatusSchema')` block + fixtures/assertions 27/116/137/259/275/292 — was a Task 1 typecheck + Task 2 shared-test breaker); `frontend/tests/hooks/useBackup.test.tsx:59` formatVersion bump added to Task 5 (was a Task 5/6 typecheck breaker); Task 3 Step 1 repo sites corrected to the real lines 24/36/58/114/162/235 (not `shape()`/`shapeMeta()`); serialize.test.ts noted as four lines (266/281/297/338); Task 6 grep extended to `shared/tests`. ✓
