# Drafts Step 5 — Transfer Round-Trip + Aggregate + Chapter Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export/import round-trips ALL drafts (drafts[]-only v2 format), `aggregateForStories` totals active-draft word counts, and the dormant `Chapter.body*/summaryJson*/summaryJsonUpdatedAt/wordCount` columns are dropped.

**Architecture:** Prerequisite repo fix first (create-with-summary same-instant stamp); then the transfer cutover as one typecheck-atomic task (shared schema + export + import + full test sweep — the schema change breaks every consumer's compile simultaneously); then the aggregate rewrite retires the last reader of `Chapter.wordCount`; then the contract migration drops the columns and removes the create-time mirror write. Gate last.

**Tech Stack:** TypeScript (strict), Prisma 7 + Postgres 16, Vitest, Zod 4 (shared wire schemas), Express 5.

## Global Constraints

- TypeScript strict mode — no `any`. (CLAUDE.md)
- bd issue: **story-editor-9wk.5**. Commit format: `[story-editor-9wk.5] <desc>`. (CLAUDE.md Git Rules)
- Work from `/home/asg/projects/story-editor` on branch `feature/chapter-drafts`.
- Backend vitest requires the docker stack up: `make dev` before any `npm -w story-editor-backend run test`. (bd memory)
- Specs: `docs/superpowers/specs/2026-07-04-drafts-step5-transfer-aggregate-design.md` (user-approved, Opus-reviewed) + epic `docs/superpowers/specs/2026-06-25-chapter-drafts-design.md` §5a/§6/§10.
- **D1 (user-approved): drafts[]-only export.** Chapter entry = `{ title, orderIndex, drafts[] }`; chapter-level `bodyJson`/`summary`/`chats` are DELETED from the schema.
- **D2 (user-approved): hard-require `drafts[].min(1)`.** Interim-v2 draftless files reject at parse. No dual schema, no legacy mint path.
- **D3 (user-approved): mint-as-first-draft import.** Import keeps `chapter.repo.create`'s unconditional mint; the mint IS `drafts[0]`. Never add a mint opt-out flag.
- **D4: no format-version bump.** `EXPORT_FORMAT_VERSION` stays `2`.
- **Refine = whole-file gate.** A zero/two-active chapter 400s the WHOLE file at `validateBody` (parse-time), nothing imported. Do not attempt per-story isolation of parse failures.
- **Draft-0 label+summary patch is ONE combined `draftRepo.update` call** — two calls spuriously stale the summary (Opus finding #2).
- Typecheck and ALL test suites (shared + backend + frontend) stay green at every commit.
- Do NOT touch `aggregateForStories`'s wire shape (`chapterCount`/`totalWordCount` on the story list), the step-9 migration squash, or any frontend component/hook behavior (fixtures + compile fixes only).
- **No down-migration.** Never edit shipped migration files (`20260629185340_drafts_expand`, `20260704161441_chat_draft_fk`, `20260704165922_drafts_contract_chat`, `20260704200816_drafts_resync_active`).
- If `prisma migrate dev` prompts to RESET the database (drift), STOP and report NEEDS_CONTEXT. A destructive-drop confirmation for the intended column drop (Task 4) is expected — accept it.
- After any migration: `cd backend && npx prisma generate`, and note that the dev backend container needs `docker compose restart backend` (dev-container Prisma-client drift gotcha).
- The tree carries modified `.beads/*.jsonl` files (tracker exports, auto-staged by hooks). Commit with explicit pathspecs only, and verify with `git show --stat HEAD` after every commit that no `.beads/` file slipped in; if one did, `git reset HEAD~1` and recommit clean.
- Zod v4 note (verified): `.refine` on a `strictObject` preserves `.shape` — the parity guard's `.shape.drafts` derivation works. Do not chase the zod-v3 ZodEffects limitation.

---

### Task 1: `draft.repo.create` same-instant summary stamp

`create()` currently stamps `summaryJsonUpdatedAt: new Date()` while Prisma generates `@updatedAt` marginally later in the same insert — a draft created WITH a summary can read as spuriously stale (`summaryJsonUpdatedAt < updatedAt` by milliseconds). `update()` already handles this (one `now` written to both); port the trick to `create()`. Task 2's import path is the first real create-with-summary consumer.

**Files:**
- Modify: `backend/src/repos/draft.repo.ts` (the `create` function, ~line 100)
- Test: `backend/tests/repos/draft.repo.test.ts` (extend)

**Interfaces:**
- Consumes: existing `createDraftRepo(req).create(input: RepoDraftCreateInput)`.
- Produces: no signature change — behavior fix only. Task 2 relies on `create({ …, summaryJson })` yielding `summaryIsStale === false`.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/repos/draft.repo.test.ts` (reuse the file's existing helpers — `makeUserContext`/`createStoryRepo`/`createChapterRepo`/`createDraftRepo`; mirror the adjacent `[9wk.4]` tests' fixture style):

```ts
  it('[9wk.5] create with summaryJson stamps summaryUpdatedAt === updatedAt (same-instant, not stale)', async () => {
    // chapter (mints active draft at orderIndex 0), then a second draft
    // created WITH a summary in the same call:
    // const created = await draftRepo.create({
    //   chapterId, bodyJson: paragraphDoc('two words'), wordCount: 2,
    //   summaryJson: { events: 'e', stateAtEnd: 's', openThreads: 'o' },
    //   orderIndex: 1,
    // });
    // Assert on the returned shape AND a re-read via findById:
    //   summaryUpdatedAt !== null
    //   summaryUpdatedAt.getTime() === updatedAt.getTime()
    // And via findManyMetaForChapter: the new draft's summaryIsStale === false,
    // hasSummary === true.
  });
```

Write the body out fully using the file's real helpers (the sketch names the assertions; the exact `getTime() ===` equality is the point of the test).

- [ ] **Step 2: Run it to verify it fails**

Run: `npm -w story-editor-backend run test -- tests/repos/draft.repo.test.ts`
Expected: the new test FAILS on the `getTime() ===` equality (Prisma's `@updatedAt` lands ≥ the app-clock `summaryJsonUpdatedAt`). If it flakes PASS (same-millisecond race), the bug is still real — the fix below makes it deterministic; re-run to observe at least one failure before implementing.

- [ ] **Step 3: Implement**

In `backend/src/repos/draft.repo.ts` `create()`, replace the summary-timestamp spread:

```ts
    // BEFORE:
    //   ...(summaryPlaintext !== null ? { summaryJsonUpdatedAt: new Date() } : {}),
    // AFTER — same-instant trick, ported from update(): one `now` written to
    // BOTH columns so a draft created with a summary isn't born stale.
    const now = new Date();
    const row = await client.draft.create({
      data: {
        chapterId: input.chapterId,
        orderIndex: input.orderIndex,
        wordCount: input.wordCount ?? 0,
        ...(summaryPlaintext !== null ? { summaryJsonUpdatedAt: now, updatedAt: now } : {}),
        ...writeEncrypted(req, 'body', bodyPlaintext),
        ...writeEncrypted(req, 'summaryJson', summaryPlaintext),
        ...writeEncrypted(req, 'label', labelPlaintext),
      },
    });
```

(Setting `updatedAt` explicitly overrides Prisma's `@updatedAt` generation for this insert — same mechanism `update()` uses at its summary branch.)

- [ ] **Step 4: Run the draft repo suites + typecheck**

Run: `npm -w story-editor-backend run test -- tests/repos/draft.repo.test.ts tests/repos/draft.repo.concurrency.test.ts && npm --prefix backend run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/repos/draft.repo.ts backend/tests/repos/draft.repo.test.ts
git commit -m "[story-editor-9wk.5] draft.repo.create: same-instant summaryJsonUpdatedAt/updatedAt stamp"
git show --stat HEAD   # verify: exactly the 2 files above, no .beads/
```

---

### Task 2: Transfer cutover — drafts[]-only wire format + export + import + sweep

Everything in this task lands in ONE commit: the shared-schema change (chapter entry loses `bodyJson`/`summary`/`chats`, gains required `drafts[]`) breaks export.service, import.service, backend tests, shared tests, and frontend fixtures simultaneously at typecheck. Atomic or nothing.

**Files:**
- Modify: `shared/src/schemas/transfer.ts`
- Modify: `shared/src/schemas/transfer.test.ts` (the `minimal` fixture is REWRITTEN, not extended)
- Modify: `backend/src/services/export.service.ts`
- Modify: `backend/src/services/import.service.ts`
- Modify: `backend/tests/routes/backup.test.ts` (sweep + new cases; note: the bd issue's old verify line names `tests/routes/transfer.test.ts` — that file does not exist, `backup.test.ts` is the real one; Task 5 fixes the verify line)
- Modify: `backend/tests/services/backup-roundtrip.test.ts` (parity guard: draft layer)
- Modify: `frontend/tests/components/SettingsDataTab.test.tsx`, `frontend/tests/hooks/useBackup.test.tsx` (fixtures)
- Modify: `docs/api-contract.md` (Backup section)

**Interfaces:**
- Consumes: Task 1's fixed `draftRepo.create({ …, summaryJson })`; existing `draftRepo.findManyForChapter(chapterId): RepoDraft[]` (full decrypted drafts: `id/chapterId/label/wordCount/orderIndex/createdAt/updatedAt/bodyJson/summary/summaryUpdatedAt`), `draftRepo.update`, `draftRepo.setActive(chapterId, draftId): boolean`, `chatRepo.findManyForDraft(draftId)`, `chapterRepo.create` (mints; returns `activeDraftId`).
- Produces: final v2 wire format (`draftExportSchema`, chapter = `{title, orderIndex, drafts[]}` + refine), `importResultSchema.imported.drafts`. Task 5's verify line and the close gate consume the updated suites.

- [ ] **Step 1: Rewrite the shared schema**

In `shared/src/schemas/transfer.ts`, add the import (top of file, merged into the existing `./chapter` import block or alongside it):

```ts
import { DRAFT_LABEL_MAX } from './draft';
```

Below `chatExportSchema`, add `draftExportSchema` and replace `chapterExportSchema`:

```ts
const draftExportSchema = z.strictObject({
  label: z.string().min(1).max(DRAFT_LABEL_MAX).nullable().default(null),
  orderIndex: z.number().int().nonnegative(),
  isActive: z.boolean(),
  bodyJson: z.unknown().optional(),
  summary: chapterSummarySchema.nullable().default(null),
  chats: z.array(chatExportSchema).default([]),
});

// [9wk.5] drafts[]-only (user decision D1): the active draft IS the chapter's
// content downstream; chapter-level bodyJson/summary/chats are gone. min(1) is
// D2 (hard cutover — interim draftless files reject). The refine is a
// WHOLE-FILE parse gate: the import route validates the entire envelope via
// validateBody before runImport starts, so a malformed chapter 400s the file
// (the per-story transaction isolates runtime failures only).
const chapterExportSchema = z
  .strictObject({
    title: z.string().min(1).max(500),
    orderIndex: z.number().int().nonnegative(),
    drafts: z.array(draftExportSchema).min(1),
  })
  .refine((ch) => ch.drafts.filter((d) => d.isActive).length === 1, {
    message: 'exactly one draft per chapter must have isActive: true',
    path: ['drafts'],
  });
```

In `importResultSchema.imported`, add `drafts` after `chapters`:

```ts
    chapters: z.number().int().nonnegative(),
    drafts: z.number().int().nonnegative(),
```

- [ ] **Step 2: Rewrite `shared/src/schemas/transfer.test.ts`**

The `minimal` fixture's chapter entry becomes drafts[]-only (this is a REWRITE — the old chapter-level shape now fails parse):

```ts
      chapters: [
        {
          title: 'C',
          orderIndex: 0,
          drafts: [
            {
              label: null,
              orderIndex: 0,
              isActive: true,
              bodyJson: { type: 'doc', content: [] },
              summary: null,
              chats: [
                {
                  title: null,
                  kind: 'ask',
                  messages: [
                    {
                      role: 'user',
                      content: 'hi',
                      attachmentJson: null,
                      citationsJson: null,
                      model: null,
                      tokens: null,
                      latencyMs: null,
                      createdAt: '2026-06-24T12:00:00.000Z',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
```

Both `importResultSchema` fixtures gain `drafts:` counts (`drafts: 1` alongside `chapters: 1`; `drafts: 0` alongside `chapters: 0`). The v1-rejection test keeps working (its chapter carries `status`, still unknown-key-rejected). Add three new tests:

```ts
  it('[9wk.5] rejects a chapter with zero drafts (min 1)', () => {
    const noDrafts = structuredClone(minimal);
    noDrafts.stories[0]!.chapters[0]!.drafts = [];
    expect(importSchema.safeParse(noDrafts).success).toBe(false);
  });
  it('[9wk.5] rejects a chapter with zero or two active drafts (refine)', () => {
    const zeroActive = structuredClone(minimal);
    zeroActive.stories[0]!.chapters[0]!.drafts[0]!.isActive = false;
    expect(importSchema.safeParse(zeroActive).success).toBe(false);

    const twoActive = structuredClone(minimal);
    twoActive.stories[0]!.chapters[0]!.drafts.push({
      ...structuredClone(twoActive.stories[0]!.chapters[0]!.drafts[0]!),
      orderIndex: 1,
    }); // both isActive: true
    expect(importSchema.safeParse(twoActive).success).toBe(false);
  });
  it('[9wk.5] rejects an interim-v2 draftless chapter entry (chapter-level bodyJson/chats)', () => {
    const interim = structuredClone(minimal) as Record<string, unknown>;
    (interim as typeof minimal).stories[0]!.chapters[0] = {
      title: 'C',
      orderIndex: 0,
      bodyJson: { type: 'doc', content: [] },
      summary: null,
      chats: [],
    } as never;
    expect(importSchema.safeParse(interim).success).toBe(false);
  });
```

(`minimal` is typed by inference; if `structuredClone`'s typing fights the mutation, declare the fixture `const minimal = { … } satisfies Record<string, unknown>` — keep the runtime shape identical.)

Run: `npm --prefix shared run test` — expected: transfer tests PASS, everything else untouched.

- [ ] **Step 3: Rewrite the export chapter loop**

In `backend/src/services/export.service.ts`, add `import { createDraftRepo } from '../repos/draft.repo';` and instantiate `const draftRepo = createDraftRepo(req);` beside the other repos. Replace the whole per-chapter block (the `for (const meta of chapterMetas)` body — including the `findById` call and the `chatRows` loop) with:

```ts
    for (const meta of chapterMetas) {
      const draftRows = await draftRepo.findManyForChapter(meta.id);
      const drafts: ExportFile['stories'][number]['chapters'][number]['drafts'] = [];

      for (const d of draftRows) {
        const chats: (typeof drafts)[number]['chats'] = [];
        for (const c of await chatRepo.findManyForDraft(d.id)) {
          const messages = await messageRepo.findManyForChat(c.id);
          chats.push({
            title: c.title ?? null,
            kind: c.kind,
            messages: messages.map((m) => ({
              role: m.role,
              content: m.content,
              attachmentJson: m.attachmentJson ?? null,
              citationsJson: m.citationsJson?.length ? m.citationsJson : null,
              model: m.model ?? null,
              tokens: m.tokens ?? null,
              latencyMs: m.latencyMs ?? null,
              createdAt: m.createdAt.toISOString(),
            })),
          });
        }
        drafts.push({
          label: d.label ?? null,
          orderIndex: d.orderIndex,
          isActive: d.id === meta.activeDraftId,
          bodyJson: d.bodyJson,
          summary: d.summary ?? null,
          chats,
        });
      }

      chapters.push({ title: meta.title, orderIndex: meta.orderIndex, drafts });
    }
```

Delete the now-unused `chapterRepo.findById` call; `chapterRepo` itself stays (it still provides `findManyForStory`). `findManyForChapter` returns drafts ordered by `orderIndex` (its existing `orderBy`), so the emitted `drafts[]` is ordered.

- [ ] **Step 4: Rewrite the import chapter loop**

In `backend/src/services/import.service.ts`: `zeroCounts()` gains `drafts: 0` (after `chapters: 0`). Replace the chapter loop body (from `const created = await chapterRepo.create({…})` through the end of the chats loop) with:

```ts
        const drafts = [...ch.drafts].sort((a, b) => a.orderIndex - b.orderIndex);
        const first = drafts[0]!; // schema guarantees min(1)

        // [9wk.5] Mint-as-first-draft (design D3): chapter.repo.create's
        // unconditional mint IS drafts[0] — no repo path ever yields a
        // draft-less chapter, even mid-transaction.
        const created = await chapterRepo.create({
          storyId: story.id,
          title: ch.title,
          bodyJson: first.bodyJson,
          orderIndex: i,
          wordCount: computeWordCount(first.bodyJson),
        });
        counts.chapters++;

        if (created.activeDraftId === null) {
          throw new Error('import: minted chapter has no active draft');
        }
        counts.drafts++;
        const draftIds: string[] = [created.activeDraftId];

        if (first.label !== null || first.summary !== null) {
          // ONE combined call (spec §5): a later label-only update would bump
          // @updatedAt past summaryJsonUpdatedAt and spuriously stale the
          // just-written summary.
          await draftRepo.update(created.activeDraftId, {
            ...(first.label !== null ? { label: first.label } : {}),
            ...(first.summary !== null ? { summaryJson: first.summary } : {}),
          });
        }

        for (let j = 1; j < drafts.length; j++) {
          const d = drafts[j]!;
          const row = await draftRepo.create({
            chapterId: created.id,
            bodyJson: d.bodyJson,
            wordCount: computeWordCount(d.bodyJson),
            label: d.label,
            summaryJson: d.summary,
            // Densified from the loop index (same convention as chapters/
            // characters/outline) — a gappy hand-edited file can't violate
            // @@unique([chapterId, orderIndex]).
            orderIndex: j,
          });
          counts.drafts++;
          draftIds.push(row.id);
        }

        const activeIdx = drafts.findIndex((d) => d.isActive);
        if (activeIdx > 0) {
          // Refine guarantees exactly one isActive; idx 0 is already active
          // via the mint.
          const ok = await draftRepo.setActive(created.id, draftIds[activeIdx]!);
          if (!ok) throw new Error('import: could not set active draft');
        }

        for (let j = 0; j < drafts.length; j++) {
          for (const c of drafts[j]!.chats) {
            const chat = await chatRepo.create({
              draftId: draftIds[j]!,
              title: c.title ?? null,
              kind: c.kind,
            });
            counts.chats++;

            for (const m of c.messages) {
              await messageRepo.createWithin(tx, {
                chatId: chat.id,
                role: m.role,
                content: m.content,
                attachmentJson: m.attachmentJson,
                citationsJson: m.citationsJson,
                model: m.model,
                tokens: m.tokens,
                latencyMs: m.latencyMs,
              });
              counts.messages++;
            }
          }
        }
```

In `runImport`'s accumulation block, add `counts.drafts += storyCounts.drafts;` after the `chapters` line. Delete the now-stale `[9wk.4]` comments about "drafts[] in the export format is step 5".

- [ ] **Step 5: Typecheck the blast radius, then sweep the backend tests**

Run: `npm --prefix shared run typecheck && npm --prefix backend run typecheck` — fix compile errors ONLY in test files (production code is Steps 1–4).

`backend/tests/routes/backup.test.ts` sweep — discovery greps:

```bash
grep -n "chapters: \[" backend/tests/routes/backup.test.ts
grep -n "imported" backend/tests/routes/backup.test.ts
```

Mechanical transform for every file-fixture chapter entry:

```
{ title, orderIndex, bodyJson?, summary?, chats? }
  → { title, orderIndex, drafts: [{ label: null, orderIndex: 0, isActive: true,
      bodyJson?, summary?, chats? }] }
```

and every `imported` expectation gains its `drafts` count (= chapters count for single-draft fixtures). Response-shape assertions on exported chapters re-target `chapter.drafts[0].bodyJson` etc. Add new cases to the `POST /api/users/me/import` describe:

1. **Multi-draft round-trip:** a file chapter with three drafts (labels `null`/`'darker take'`/`null`, distinct bodies, a summary on draft 1, a chat+message on draft 2 — the NON-active one, `isActive: true` on draft 1) → import → `GET /api/chapters/:id/drafts` shows 3 drafts, labels/orderIndex/isActive restored, `activeDraftId` = the `isActive` entry; the non-active draft's chat survives (list via `GET /api/drafts/:draftId/chats`); `imported.drafts === 3`.
2. **Densification:** the same file with `drafts[].orderIndex` gapped `0/5/9` → imported drafts sit at `0/1/2`.
3. **Whole-file 400 on malformed actives:** a two-story file where story B has a zero-active chapter → response `400 validation_error`, and story A was NOT imported (`GET /api/stories` unchanged) — the refine is a parse-time gate, nothing runs.
4. **`imported.drafts` in the response envelope:** covered by case 1's assertion.

Use the file's existing app/auth/fixture helpers (read the file first; mirror its `registerAndLogin`/agent idioms).

- [ ] **Step 6: Extend the parity guard**

`backend/tests/services/backup-roundtrip.test.ts`:

Derivations — replace the `chatExportSchema` line and add the draft layer:

```ts
const chapterExportSchema = storyExportSchema.shape.chapters.unwrap().element;
const draftExportSchema = chapterExportSchema.shape.drafts.element;
const chatExportSchema = draftExportSchema.shape.chats.unwrap().element;
```

(`drafts` has `.min(1)` but no `.default`, so no `.unwrap()`; `chats` keeps its `.default([])` unwrap. The refine does not block `.shape` — zod v4, verified.)

Allowlists: `CHAPTER_EXCLUDE` becomes `['drafts'] as const`; add `const DRAFT_EXCLUDE = ['chats'] as const;`.

Fixture: after the existing summary write, add a second, labeled, non-active draft so draft coverage is maximal, and move the chat under it:

```ts
    const draft2 = await draftRepo.create({
      chapterId: chapter.id,
      bodyJson: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second draft body.' }] }],
      },
      wordCount: 3,
      label: 'roundtrip alternate',
      summaryJson: {
        events: 'An alternate telling.',
        stateAtEnd: 'Everything differs.',
        openThreads: 'Which draft is true?',
      },
      orderIndex: 1,
    });
```

Keep the existing chat on the ACTIVE draft (unchanged, `draftId: chapter.activeDraftId`) — the active draft then covers `chats`, and `draft2` covers `label`/`summary` non-null on a non-active entry.

Assertions: pull draft entries from each export (`chapter1!.drafts` sorted by `orderIndex`), then per draft index run `assertCoverage(draftExportSchema.shape, DRAFT_EXCLUDE, …)` and `assertFidelity(draftExportSchema.shape, DRAFT_EXCLUDE, …)`; `chat1`/`message1` re-point to `chapter1!.drafts[0]!.chats[0]` (the active draft's chat). Note: `assertCoverage` uses `.not.toBeUndefined()`, so `label: null` on the active mint passes coverage — assert coverage on BOTH drafts. The `importResult.imported` deep-equal becomes:

```ts
    expect(importResult.imported).toEqual({
      stories: 1,
      chapters: 1,
      drafts: 2,
      characters: 1,
      outlineItems: 1,
      chats: 1,
      messages: 1,
    });
```

- [ ] **Step 7: Frontend fixture sweep**

- `frontend/tests/components/SettingsDataTab.test.tsx` (lines ~34/301/450) and `frontend/tests/hooks/useBackup.test.tsx` (~49/75): every `imported: { … }` fixture gains a `drafts` count.
- Both files also build export-file fixtures for the file picker (`grep -n "chapters:" <file>`): apply the same mechanical chapter-entry transform as Step 5.
- NO component or hook changes. Run: `npm --prefix frontend run typecheck && npm --prefix frontend run test` — expected: PASS.

- [ ] **Step 8: docs**

`docs/api-contract.md` Backup section: `GET /export` response — chapter entries are `{ title, orderIndex, drafts: [{ label, orderIndex, isActive, bodyJson, summary, chats[] }] }` (exactly one `isActive` per chapter; chats live under their draft). `POST /import` — `imported` gains `"drafts"`; note the exactly-one-active refine rejects the whole file `400 validation_error` at parse. Follow the doc's terse per-endpoint style.

- [ ] **Step 9: Full verification**

```bash
npm --prefix shared run typecheck && npm --prefix backend run typecheck && npm --prefix frontend run typecheck
npm --prefix shared run test
npm -w story-editor-backend run test
npm --prefix frontend run test
```
Expected: ALL PASS, output pristine. (Backend needs `make dev` up.)

- [ ] **Step 10: Commit (ONE commit)**

```bash
git add shared/src backend/src/services backend/tests/routes/backup.test.ts backend/tests/services/backup-roundtrip.test.ts frontend/tests docs/api-contract.md
git commit -m "[story-editor-9wk.5] transfer cutover: drafts[]-only v2 format; export+import round-trip all drafts + per-draft chats"
git show --stat HEAD   # verify: no .beads/ file slipped in
```

---

### Task 3: `aggregateForStories` → active-draft word counts (+ prompt-context test)

**Files:**
- Modify: `backend/src/repos/chapter.repo.ts` (`aggregateForStories`, ~line 348)
- Test: `backend/tests/routes/stories.test.ts` (extend the aggregate test, ~line 161), `backend/tests/routes/chat.test.ts` (one new `[pcs]` case, describe at ~line 838)

**Interfaces:**
- Consumes: `Chapter.activeDraft` relation (join), `draftRepo.createBlank`/`create` + `setActive` (test fixtures).
- Produces: same signature `aggregateForStories(storyIds: string[]): Promise<Map<string, { chapterCount: number; totalWordCount: number }>>` — Task 4 relies on this function no longer touching `Chapter.wordCount`.

- [ ] **Step 1: Extend the failing aggregate test**

In `backend/tests/routes/stories.test.ts`, extend the existing `'GET /api/stories returns chapterCount and totalWordCount aggregated correctly'` test: after the three chapter creates (word counts 100/250/75), add a second draft to chapter 1 and make it active:

```ts
    // [9wk.5] totals must follow the ACTIVE draft, not the create-time value:
    // give Ch 1 a second draft with a different word count and activate it.
    const alt = await createDraftRepo(req).create({
      chapterId: ch1.id as string,
      // bodyJson deliberately omitted (optional) — only wordCount feeds the
      // aggregate under test; the file has no TipTap-doc helper to borrow.
      wordCount: 999,
      orderIndex: 1, // the mint sits at 0
    });
    await createDraftRepo(req).setActive(ch1.id as string, alt.id);
```

(Capture `ch1` from the first `create` call — currently unnamed; add the `createDraftRepo` import — the file imports neither it nor any TipTap helper today.) Update the assertions: `full.totalWordCount` becomes `999 + 250 + 75 = 1324`; `chapterCount` stays 3; the empty story stays 0/0.

Run: `npm -w story-editor-backend run test -- tests/routes/stories.test.ts`
Expected: FAIL — total still reports 425 (the dormant `Chapter.wordCount` doesn't move on setActive).

- [ ] **Step 2: Rewrite `aggregateForStories`**

Replace the `groupBy` implementation in `backend/src/repos/chapter.repo.ts`:

```ts
  async function aggregateForStories(
    storyIds: string[],
  ): Promise<Map<string, { chapterCount: number; totalWordCount: number }>> {
    const out = new Map<string, { chapterCount: number; totalWordCount: number }>();
    if (storyIds.length === 0) return out;
    const userId = resolveUserId(req, 'chapter.repo');
    // [9wk.5] Word totals follow the ACTIVE draft (Chapter.wordCount is
    // dropped by this step's contract migration). One owner-scoped query +
    // reduce; zero-chapter stories get no entry, matching the old groupBy —
    // the route's `?? 0` defaults cover them.
    const rows = await client.chapter.findMany({
      where: { storyId: { in: storyIds }, story: { userId } },
      select: { storyId: true, activeDraft: { select: { wordCount: true } } },
    });
    for (const r of rows) {
      if (r.activeDraft === null) {
        // Stricter than the old groupBy (which silently summed the dormant
        // column): consistent with shape()/shapeMeta()'s invariant throw. All
        // fixtures reaching this path mint or explicitly wire a draft
        // (verified: ownership.middleware / delete-account raw seeds build the
        // triangle), so no test relies on tolerating a draftless chapter.
        throw new Error('chapter.repo: chapter has no active draft (invariant violation)');
      }
      const agg = out.get(r.storyId) ?? { chapterCount: 0, totalWordCount: 0 };
      agg.chapterCount += 1;
      agg.totalWordCount += r.activeDraft.wordCount;
      out.set(r.storyId, agg);
    }
    return out;
  }
```

- [ ] **Step 3: Run to verify it passes**

Run: `npm -w story-editor-backend run test -- tests/routes/stories.test.ts && npm --prefix backend run typecheck`
Expected: PASS.

- [ ] **Step 4: Add the prompt-context negative test**

In `backend/tests/routes/chat.test.ts`, inside the `[pcs]` describe (~line 838), add one case mirroring the existing `setupTwoChaptersWithChat` fixture style (read the helper first and reuse its wiring — the sketch names the scenario, the implementer writes real code with the file's helpers):

```ts
  it('[9wk.5] a summary on a NON-active draft of a prior chapter does not enter <previous_chapters>', async () => {
    // Arrange like the toggle=true happy-path test, but instead of writing the
    // prior chapter's summary onto its ACTIVE draft, create a second draft on
    // the prior chapter (draftRepo.create with a summaryJson) and DO NOT
    // setActive it. Fire the chat message; capture the fetch spy's system
    // message; assert it does NOT contain '<previous_chapters>' (the active
    // draft is unsummarised → chapter skipped, spec §8).
  });
```

Run: `npm -w story-editor-backend run test -- tests/routes/chat.test.ts`
Expected: PASS (this pins behavior that already holds — the metadata join reads only `activeDraft`).

- [ ] **Step 5: Commit**

```bash
git add backend/src/repos/chapter.repo.ts backend/tests/routes/stories.test.ts backend/tests/routes/chat.test.ts
git commit -m "[story-editor-9wk.5] aggregateForStories totals active-draft word counts; pin non-active-summary prompt exclusion"
git show --stat HEAD   # verify: no .beads/
```

---

### Task 4: Chapter contract — drop the dormant columns + remove the create-time mirror

**Files:**
- Modify: `backend/prisma/schema.prisma` (Chapter model, lines ~78 + 87–93)
- Create: `backend/prisma/migrations/<timestamp>_drafts_contract_chapter/migration.sql` (generated)
- Modify: `backend/src/repos/chapter.repo.ts` (`create`, ~lines 100–125)
- Delete: `backend/tests/migrations/drafts-expand-backfill.test.ts` (see Step 4)
- Delete: `backend/tests/models/chapter-encrypted.test.ts` — its entire subject is Chapter body-ciphertext + wordCount shape (raw writes/reads of the dropped columns); superseded by `draft.repo.test.ts` round-trips + E12's Draft coverage
- Delete: `backend/tests/models/chapter-body-json.test.ts` — asserts `Chapter.bodyCiphertext` null-handling + plaintext `wordCount` on the dropped columns; same supersession
- Modify: `backend/tests/models/chapter.test.ts` — remove the `wordCount: 9` raw create + its assertions (~lines 39–48); the `createMany` at ~53 sets only orderIndex/storyId and stays
- Modify: `backend/tests/repos/chapter.repo.test.ts` — ~lines 37–40 raw-read the Chapter row's `bodyCiphertext` to assert body encryption; delete that assertion block (Step 1 stops writing chapter body ciphertext — the draft-side equivalent already exists in `draft.repo.test.ts`; the `summaryJsonCiphertext` read at ~205–212 is against the **Draft** row and STAYS)

**Interfaces:**
- Consumes: Task 3's aggregate (last `Chapter.wordCount` reader already retired).
- Produces: Chapter model = id/orderIndex/title-triple/timestamps/relations only. `RepoChapterCreateInput` unchanged (`bodyJson`/`wordCount` still accepted — they feed the mint).

- [ ] **Step 1: Remove the create-time mirror write**

In `backend/src/repos/chapter.repo.ts` `create()`: delete the `bodyPlaintext` derivation block entirely (draft.repo does its own stringify from `input.bodyJson`), and shrink the chapter insert to:

```ts
      const chapterRow = await tx.chapter.create({
        data: {
          storyId: input.storyId,
          orderIndex: input.orderIndex,
          ...writeEncrypted(req, 'title', input.title),
        },
      });
```

(The draft mint below it keeps receiving `bodyJson: input.bodyJson, wordCount: input.wordCount ?? 0` — unchanged.) Update the stale `[E5]`-era comment on the model fields if it references chapter body ciphertext as "the SOLE source of truth" — drafts are.

- [ ] **Step 2: Schema edit + migration**

In `backend/prisma/schema.prisma`, delete from `model Chapter`: `wordCount` (line ~78) and the `bodyCiphertext/bodyIv/bodyAuthTag/summaryJsonCiphertext/summaryJsonIv/summaryJsonAuthTag/summaryJsonUpdatedAt` block (~87–93). Keep the title triple, timestamps, relations, and the `[D16]` unique-constraint comment.

```bash
cd backend && npx prisma migrate dev --name drafts_contract_chapter && npx prisma generate && cd ..
```

Expected: the generated SQL is exactly eight `ALTER TABLE "Chapter" DROP COLUMN …` statements; prisma prompts a destructive-drop confirmation — accept it. If it prompts to RESET the database: STOP, report NEEDS_CONTEXT. Note in the report: dev backend container needs `docker compose restart backend`.

- [ ] **Step 3: Typecheck-driven straggler fix**

Run: `npm --prefix backend run typecheck` (it compiles `src + tests` — the dropped columns surface as test-file errors too).
Expected errors exactly in the files pre-decided in the **Files** list above; apply the listed delete/edit per file. Then verify nothing was missed:

```bash
grep -rn "bodyCiphertext\|summaryJsonCiphertext\|summaryJsonUpdatedAt" backend/src backend/tests | grep -vi draft
grep -n "wordCount" backend/src/repos/chapter.repo.ts
# expected: first grep no Chapter-model hits (Draft-row reads are excluded by
# the -vi draft filter; anything left is a straggler to fix); second grep only
# draft-sourced reads (shape/shapeMeta/aggregate activeDraft.wordCount) +
# RepoChapterCreateInput.
```

- [ ] **Step 4: Delete the expand-backfill migration test**

DELETE `backend/tests/migrations/drafts-expand-backfill.test.ts`. Rationale (mirror of the file's own `[9wk.3]` precedent comment, which already filtered out the `UPDATE "Chat"` statement after that contract): the backfill `INSERT INTO "Draft" … SELECT c."bodyCiphertext" … FROM "Chapter"` can no longer execute against the live schema once the columns drop. The backfill logic's end-to-end proof moves to the step-9 squash's baseline-fixture harness (epic spec §5b), which loads a schema-only pre-9wk baseline and re-proves the full transform on populated data — the per-step scaffolding test has reached the end of its designed life.

- [ ] **Step 5: Full backend suite + E12**

```bash
npm -w story-editor-backend run test
```
Expected: ALL PASS. E12 (`tests/security/encryption-leak.test.ts`) needs NO code change — its raw scan is `SELECT *` (dropped columns simply vanish from rows) and its sentinel body/summary writes already land on the Draft table; confirm both E12 tests pass and the per-table count guards still fire (Chapter rows exist via the title write).

- [ ] **Step 6: Commit**

```bash
git add backend/prisma backend/src/repos/chapter.repo.ts backend/tests
git commit -m "[story-editor-9wk.5] CONTRACT: drop Chapter.body*/summaryJson*/wordCount; create() writes title-only (draft mint owns content)"
git show --stat HEAD   # verify: no .beads/
```

---

### Task 5: Full-suite gate + tracker

**Interfaces:** none — final gate.

- [ ] **Step 1: Straggler greps**

```bash
# no production read/write of the dropped columns anywhere:
grep -rn "bodyCiphertext\|bodyIv\|bodyAuthTag\|summaryJsonCiphertext\|summaryJsonUpdatedAt" backend/src | grep -v "draft\|Draft"
# chapter-level export fields must be gone from the wire schema:
grep -n "bodyJson\|summary\|chats" shared/src/schemas/transfer.ts
# expected: hits only inside draftExportSchema + messageExport/chatExport blocks
```
Expected: first grep zero Chapter-model hits; second grep confirms chapter entry carries only title/orderIndex/drafts.

- [ ] **Step 2: `make verify`-equivalent**

```bash
make lint && make typecheck
make dev && make test
```
Expected: PASS across shared + backend + frontend (3 pre-existing biome warnings on main are accepted).

- [ ] **Step 3: Fix the issue's verify line, then close through the gate**

The current 9wk.5 verify line names `tests/routes/transfer.test.ts`, which does not exist. Rewrite the notes (keep `plan:` first; single `verify:` line):

```bash
bd update story-editor-9wk.5 --notes "plan: docs/superpowers/plans/2026-07-04-drafts-step5-transfer-aggregate.md
spec: docs/superpowers/specs/2026-07-04-drafts-step5-transfer-aggregate-design.md + docs/superpowers/specs/2026-06-25-chapter-drafts-design.md (§5a,§6,§10)
verify: make dev && npm --prefix shared run typecheck && npm --prefix backend run typecheck && npm --prefix frontend run typecheck && npm --prefix shared run test && npm -w story-editor-backend run test -- tests/routes/backup.test.ts tests/services/backup-roundtrip.test.ts tests/routes/stories.test.ts tests/routes/chat.test.ts tests/repos/draft.repo.test.ts tests/security/encryption-leak.test.ts && npm --prefix frontend run test
scope-note (2026-07-04, user-approved design): drafts[]-only v2 export (D1), hard-require drafts[].min(1) (D2), mint-as-first-draft import (D3), no version bump (D4); refine = whole-file 400 gate. Chapter.body*/summaryJson*/wordCount DROPPED + create-time mirror write removed (aggregateForStories now active-draft-sourced). drafts-expand-backfill.test.ts deleted (backfill proof moves to step-9 squash harness per §5b)."
```

Then: do NOT `bd close` — run `/bd-close-reviewed story-editor-9wk.5`. **Both reviewers in-lane:** `repo-boundary-reviewer` (export/import narrative flow, chapter.repo changes, migration on narrative columns) and `security-reviewer` (import surface + ownership on the new read paths).

---

## Self-Review

- **Spec coverage:** D1–D4 (T2 Step 1/4); refine whole-file gate + its test (T2 Steps 1/5); create() same-instant prerequisite (T1); one-call mint patch (T2 Step 4); export walks all drafts + per-draft chats (T2 Step 3); densification + setActive restore (T2 Step 4/5); imported.drafts (T2 Steps 1/2/4/6/7); parity-guard draft layer + allowlists (T2 Step 6); fixture-churn honesty incl. minimal rewrite (T2 Steps 2/7); aggregate rewrite w/ explicit null guard + zero-chapter parity (T3); prompt negative test (T3 Step 4); column drop + mirror removal + E12 verification (T4); api-contract (T2 Step 8). Out-of-scope respected: no step-9 squash, no frontend behavior change, no aggregate wire-shape change. ✓
- **Placeholder scan:** T1 Step 1, T2 Step 5's new backup cases, and T3 Step 4 name assertions and delegate fixture wiring to each file's existing helpers (this repo's established plan style — the implementer reads the file first); every production-code step shows the exact code. No TBDs. ✓
- **Type consistency:** `draftExportSchema` field set (T2 Step 1) matches export emission (T2 Step 3), import consumption (T2 Step 4), parity derivations (T2 Step 6), and the shared-test fixture (T2 Step 2). `counts.drafts` flows zeroCounts → per-chapter increments → runImport accumulation → importResultSchema. `aggregateForStories` signature unchanged (T3) and Chapter-column-free before T4 drops them. `RepoChapterCreateInput` retains bodyJson/wordCount through T4 (mint feed). ✓
- **Green-at-each-commit:** T1 additive fix; T2 atomic (schema + services + all fixtures in one commit — split would break typecheck); T3 self-contained rewrite + tests; T4 drop lands only after T3 retired the last reader, with ALL five affected test files (backfill + chapter-encrypted + chapter-body-json deletions, chapter.test + chapter.repo.test edits) handled in the same commit; T5 gate-only. ✓
- **Adversarial review (Opus, 2026-07-04):** 1 gating finding folded in — Task 4's Files list was missing four test files referencing the dropped Chapter columns (backend typecheck compiles tests; the Step-3 grep was src-scoped and would have false-cleared). Pre-decided: 2 deletions, 2 assertion strips; grep widened to backend/tests. NITs folded: stories.test extension omits bodyJson instead of inventing a helper; aggregate null-throw semantics-shift note added. Reviewer verified clean: all Task 1/2 signatures, zod-v4 shape-after-refine composition, whole-file 400 gate, no missed export-shape consumers, 8-column-only drop, E12 unaffected, commit pathspecs. ✓
