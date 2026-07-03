# Non-Destructive Backup Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**bd issues:** `story-editor-50k` (import safety) + `story-editor-046` (round-trip parity test) · **Assessment refs:** items 3 & 16 of `docs/superpowers/specs/2026-07-02-quality-assessment.md`

**Goal:** Importing a backup must stop being a silent full-library replace. Today `import.service.ts` opens one 120s transaction, runs `tx.story.deleteMany({ where: { userId } })`, and rebuilds from the file — importing an old export irreversibly destroys everything written since, and the only guard is frontend confirmation UX (`SettingsDataTab.tsx`: typed phrase + forced safety export — good, but the server enforces none of it; any authenticated POST wipes). Replace it with: **additive by default, per-story conflict detection, explicit per-story replace, per-story transactions.** And make backups provably lossless with a schema-driven round-trip parity test.

**Current-state facts (verified 2026-07-03):**
- Export format v1 (`shared/src/schemas/transfer.ts`) is content-only `strictObject`s — **no story/chapter IDs, no updatedAt** — so existing backup files cannot be matched against live data. `importSchema` is an alias of `exportSchema`.
- `backend/src/routes/backup.routes.ts`: `GET /users/me/export` (Content-Disposition download), `POST /users/me/import` (per-user 5/min limiter, `validateBody(importSchema)`, `respond(importResultSchema)`).
- `backend/src/services/import.service.ts`: global wipe at :20, whole-file transaction `{ maxWait: 5_000, timeout: 120_000 }`, repos driven through a documented `tx as unknown as PrismaClient` cast, messages via `messageRepo.createWithin(tx, …)`.
- `backend/src/services/export.service.ts`: pure repo-layer reads; already loops per story.
- Frontend: `hooks/useBackup.ts` (`useImportBackup` posts the whole file), `components/SettingsDataTab.tsx` (restore section, `CONFIRM_PHRASE = 'replace everything'`, safety export aborts restore on failure).

**Design (approved in discussion 2026-07-03):**
1. Exports gain optional per-story `id` + `snapshotUpdatedAt` (the max `updatedAt` across the story's subtree at export time — story/chapters/characters/outline/chats/messages; plaintext timestamp columns, no decryption involved).
2. Import becomes two steps: a **preflight plan** (match file stories by `id` against the user's live stories, compare `snapshotUpdatedAt` vs live subtree max) bucketing each story as `new` / `unchanged` / `conflict`, then an **execute** call carrying a per-story resolution: `create` (import as a new copy — the default), `replace` (delete the matched live story and recreate from the file, one atomic transaction per story), or `skip`.
3. Legacy files (no `id`s) plan every story as `new` — always safe, never destructive.
4. The global wipe is deleted. **Behavior change (accepted):** "restore" no longer deletes live stories that are absent from the backup file — leftovers survive and the user deletes them manually. Strictly safer; the frontend copy must say so.

## Decision points already made (flag at plan review if you disagree)

- **`formatVersion` stays 1** with optional fields. New importer accepts old files (fields absent). Old app versions reject *new* files with a strict-schema error rather than a clean "unsupported version" — acceptable for a self-hosted app; not worth a v1/v2 union.
- **Preflight is metadata-only**: the plan request sends `[{ id, snapshotUpdatedAt }]`, not the file. Titles for the picker come from the file (client-side) and the live stories cache (frontend already has both).
- **`unchanged` stories default to `skip`** in the UI (importing them would only mint pointless duplicates); user can still override to `create`/`replace`.
- **The `tx as unknown as PrismaClient` cast idiom stays** (per-story tx still needs it). Redesigning repo transaction typing is out of scope (adjacent to `story-editor-0uu`).

## Global Constraints

- **Repo layer only** for every narrative read/write, including the new subtree-max aggregate — an `updatedAt` aggregate over Chapter/Chat/Message is still a narrative-model Prisma query and belongs in `story.repo.ts`, not in a service. `repo-boundary-reviewer` is in-lane and will be dispatched by the close gate; `security-reviewer` is not expected to match (no auth/key/crypto-primitive surface) — don't route around whatever `--phase=affected` decides.
- **Replace is ownership-scoped and explicit**: a story is deleted only when (a) the request's resolutions explicitly say `replace` for that file-story `id`, and (b) a live story with that `id` exists **and belongs to `req.user`**. Resolution keys that match no live story fall back to `create`, never to a delete.
- **Per-story atomicity**: each `create`/`replace` runs in its own `$transaction` (replace's delete and recreate inside the same one — a failed recreate must roll back the delete). Whole-file atomicity is explicitly given up; the result reports per-story outcomes honestly, including `failed` with the remaining stories aborted.
- The E12 leak test must stay green; no plaintext narrative content, passwords, or keys in logs or error messages (import errors carry story *index*, not title).
- Wire I/O only via shared Zod schemas + `respond()`; the import rate limiter stays on both new endpoints.
- No Prisma schema change, no migration (timestamps and IDs already exist).
- Tests through the repo layer / HTTP routes per Testing Rules; suite currently 109 files / 1099 tests — no test weakened.
- Commit format `[story-editor-50k] …` (parity-test task: `[story-editor-046] …`).
- Verify (whole plan): `CI=true npm -w story-editor-backend run test && ! grep -n "story.deleteMany({ where: { userId } })" backend/src/services/import.service.ts && npm --prefix frontend run typecheck && npm --prefix shared run typecheck`

---

### Task 1: Wire schemas — export metadata + plan/execute contracts (`shared/src/schemas/transfer.ts`)

- [ ] Add to `storyExportSchema`: `id: z.string().optional()` and `snapshotUpdatedAt: z.string().datetime().optional()` (document: subtree max at export time; absent in legacy files).
- [ ] New `importPlanRequestSchema`: `{ stories: [{ id: string, snapshotUpdatedAt: string.datetime() }] }` (bounded array, e.g. `.max(1000)`).
- [ ] New `importPlanResponseSchema`: `{ stories: [{ id, status: 'new' | 'unchanged' | 'conflict' }] }`.
- [ ] New `importRequestSchema`: `{ file: importFileSchema, resolutions: z.record(z.string(), z.enum(['create','replace','skip'])).optional() }` — keyed by file-story `id`; stories without an `id` or without an entry default to `create`.
- [ ] Extend `importResultSchema`: keep `imported` counts; add `outcomes: [{ index: number, action: 'created' | 'replaced' | 'skipped' | 'failed' }]` (index into `file.stories`; no titles — see logging constraint).
- [ ] Update `shared/src/schemas/transfer.test.ts`: old v1 file (no new fields) still validates; new fields round-trip; resolutions enum rejects unknown values.

**Verify:** `npm --prefix shared run typecheck && npx vitest run --root shared`

### Task 2: Export emits `id` + `snapshotUpdatedAt`

- [ ] New repo method `storyRepo.contentUpdatedAtMax(storyId)` in `backend/src/repos/story.repo.ts`: max `updatedAt` across the story row and its chapters/characters/outline items/chats/messages (ownership-scoped like every repo method; returns `Date`). Timestamps only — no narrative column is read, nothing to decrypt.
- [ ] `export.service.ts`: include `id: s.id` and `snapshotUpdatedAt` from the new method in each exported story.
- [ ] Tests (`backend/tests/services/` or extend the existing export coverage): exported story carries its live id; editing a deep child (e.g. a message) after a first export bumps `snapshotUpdatedAt` in the next export.

**Verify:** `CI=true npx vitest run --root backend tests/routes/backup.test.ts tests/services` (adjust to the actual file set)

### Task 3: Preflight plan endpoint

- [ ] `POST /users/me/import/plan` in `backup.routes.ts` (same `requireAuth` + `importLimiter`), body `importPlanRequestSchema`.
- [ ] Service logic (`import.service.ts` or a sibling): for each `{ id, snapshotUpdatedAt }` — no live story with that id owned by the user → `new`; live subtree max (`contentUpdatedAtMax`) `<= snapshotUpdatedAt` → `unchanged`; otherwise `conflict`.
- [ ] Route tests: ownership (user B's story id reports `new` for user A — existence of other users' ids must not leak as `unchanged`/`conflict`); the three buckets; limiter applies.
- [ ] Document both endpoints in `docs/api-contract.md`.

**Verify:** the new route tests green.

### Task 4: Import execution rewrite — additive, per-story transactions

- [ ] `runImport(req, { file, resolutions })`: delete the global wipe; loop stories, resolve each to `create` (default), `replace` (only under the Global-Constraints conditions), or `skip`.
- [ ] One `$transaction` per non-skipped story (`timeout: 120_000` per story is now generous); `replace` = `storyRepo.delete(liveId)` + recreate inside that same tx. Recreation logic is today's per-story body, unchanged (including the `includePreviousChaptersInPrompt` post-set and `messageRepo.createWithin`).
- [ ] Per-story failure: roll back that story's tx, record `failed` for it, abort remaining stories (report them neither created nor skipped — absent from outcomes beyond the failure index), keep already-committed outcomes. No compensating deletes.
- [ ] Rewrite/extend `backend/tests/routes/backup.test.ts` (or wherever import is covered): additive default duplicates nothing and deletes nothing; explicit replace swaps exactly the matched story; skip skips; legacy file (no ids) imports as all-new with the live library untouched; resolution for a non-existent id falls back to create; user B's story id in resolutions cannot delete user B's data; mid-file failure leaves prior stories committed and the failed story fully rolled back.
- [ ] Frontend `useImportBackup` compile-compat: update the mutation body shape in the same commit so the workspace typechecks (full UX lands in Task 5).

**Verify:** `CI=true npm -w story-editor-backend run test` (E12 leak test included).

### Task 5: Frontend import flow (`SettingsDataTab.tsx` + `useBackup.ts`)

- [ ] Flow: pick file → client-side `importSchema.parse` → if any story has `id`+`snapshotUpdatedAt`, call the plan endpoint → per-story list: title (from file), bucket badge, resolution control (defaults: `new`/legacy → *import as new*; `unchanged` → *skip*; `conflict` → *keep both*).
- [ ] `replace` anywhere in the resolutions keeps the existing typed-phrase + forced-safety-export gate (reuse `CONFIRM_PHRASE` machinery; safety-export failure still aborts). No replace selected → no typed phrase needed (nothing destructive left).
- [ ] Copy update: state explicitly that import never deletes stories that aren't in the file.
- [ ] Result rendering from `outcomes` (created/replaced/skipped/failed counts; failure names the story by *its position/title client-side* — the wire carries only the index).
- [ ] Component tests (`frontend/tests/`): defaults per bucket; typed-phrase gate appears iff a replace is selected; legacy file path skips the plan call.

**Verify:** `npm --prefix frontend run typecheck && npx vitest run --root frontend tests/components/SettingsDataTab.test.tsx` (adjust to actual test path) — plus the whole-plan verify.

### Task 6 (`story-editor-046`): Round-trip parity test

- [ ] New `backend/tests/services/backup-roundtrip.test.ts`: build a maximal library through the repo layer — every narrative entity, **every exportable field set to a non-default value** (incl. `includePreviousChaptersInPrompt: false`, chapter summary, message attachment/citations/model/tokens/latency, character full sheet, outline `sub`/`status`) → `buildExport` → `runImport` as all-`create` → `buildExport` again → deep-compare the two files' story subtrees, field by field, ignoring only a documented allowlist: `id`, `snapshotUpdatedAt`, message `createdAt` (spec'd lossiness).
- [ ] Drive the compared keys from the export schemas' own key sets (`Object.keys(schema.shape)`-style), so a future field added to the schema **fails this test until the export and import mappings both handle it** — that is the lossy-backup tripwire this issue exists for.
- [ ] Assert imported copies received fresh ids (a `create` must never adopt the file's id).

**Verify:** `CI=true npx vitest run --root backend tests/services/backup-roundtrip.test.ts` — then the whole-plan verify, and close both issues through `/bd-close-reviewed`.

---

## Explicit non-goals

- No merge of story *content* — conflicts resolve to duplicate-or-replace, chosen by a human.
- No deletion of live stories absent from the backup (the old restore's only removed capability; deliberate).
- No repo-transaction typing redesign, no `CryptoContext` (`story-editor-0uu`), no export streaming/size caps (`story-editor-1xt`).
- No format-version bump, no migration of existing backup files.
