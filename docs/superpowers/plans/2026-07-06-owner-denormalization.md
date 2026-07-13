# Denormalized Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**bd issues:** `story-editor-35u` (primary) — co-closes `story-editor-z7g` (its predicates / dispatch table / enumeration test land here, born trivial).
**Direction approval (2026-07-06):** user confirmed the app is a single-real-user hobby project; a breaking, snapshot-first migration is acceptable. Ownership enforcement **stays in the repo layer**; `requireOwnership` middleware remains as a thin HTTP adapter consuming repo-hosted predicates.
**Plan review:** adversarially reviewed 2026-07-06 (fresh-context Opus reviewer, against #155's actual patch); all blocking + should-fix findings incorporated below.

**Goal:** Every narrative row carries its owner directly. All transitive ownership chains (`message → chat → draft → chapter → story → userId`) collapse to `{ id, userId }`, making the chain-drift bug class unrepresentable. The middleware stops touching Prisma for narrative models; a structurally exhaustive enumeration test governs every `OwnedResource`.

## ⚠️ Sequencing precondition (hard gate)

**Implement only on top of merged PR #155** (chapter drafts): it adds the `Draft` table, re-parents `Chat` from `Chapter` to `Draft`, hoists shared guards into `_narrative.ts`, and ships its own destructive migration — this plan is written against that shape. PR #154's branch state must also be resolved per the designated-branch protocol. **Task 1's first checkbox is re-verifying the tables below against merged `main`.**

**Current-state facts (verified 2026-07-06 against #155 head `feature/chapter-drafts`):**
- `Story` already has `userId`. Six tables lack it: `Chapter`, `Character`, `OutlineItem`, `Draft`, `Chat`, `Message`. `User` currently has only the `stories Story[]` back-relation.
- **Guard topology (post-#155):** `backend/src/repos/_narrative.ts` exports the shared helpers `resolveUserId(req, repoTag)`, `ensureStoryOwned(client, storyId, userId, repoTag)` (used by chapter/character/outline creates), and `ensureChapterOwned(client, chapterId, userId, repoTag)` (used by draft create). Two guards are repo-local: `ensureDraftOwned` in `chat.repo.ts` (chat's parent is now a Draft) and `ensureChatOwned` in `message.repo.ts`.
- All chain FKs up every path are `NOT NULL` post-#155 (`Chapter.storyId`, `Character.storyId`, `OutlineItem.storyId`, `Draft.chapterId`, `Chat.draftId`, `Message.chatId`; `Story.userId`), so **no narrative row can be orphaned** — this is what makes the migration's `SET NOT NULL` provably safe on well-formed data (the `DO` block is a belt-and-suspenders check, not the primary argument).
- `ownership.middleware.ts`: `checkOwned` switch hand-rolls the chains via Prisma directly (`select: { id: true }`), 7 cases incl. `'draft'`; `requireOwnership(type, { idParam, client })` — `options.client` is load-bearing (middleware tests inject the per-worker test-DB client from `tests/setup.ts`); 401/400/403 paths with not-found/not-owned conflated 403 (id-enumeration defense, comment must survive).
- `story.repo.ts#contentUpdatedAtMax`: five nested owner scopes over the subtree aggregates (subtree shape changes under #155 — re-verify).
- Wire formats (`shared/`) carry no `userId`; `serialize.ts` uses explicit field picks (never spreads a repo row) and the wire schemas are `strictObject` — that discipline is what keeps the new column out of responses (see Task 2).
- Migration-test precedent exists: `backend/tests/migrations/` with a populated SQL fixture (#155's squash harness) — Task 1 reuses the pattern.
- The E12 encryption-leak sentinel covers every narrative table; `userId` is plaintext metadata (no crypto involvement anywhere in this plan).

## Design decisions (binding)

- **Enforcement placement:** the repo layer is the single authorization authority — repos stay safe-by-default for non-HTTP callers (import service inside transactions today; jobs/CLI/WebSockets under `story-editor-0uu` later). The middleware only *presents* the repo's decision over HTTP (early uniform 403 + conflation). It consumes repo-layer predicates and contains no narrative-model Prisma calls.
- **Predicates live in `_narrative.ts`** — all seven `xExistsForUser(id: string, userId: string, client: PrismaClient = defaultPrisma): Promise<boolean>`, implemented as `findFirst({ where: { id, userId }, select: { id: true } }) !== null`. Rationale: the shared guards (`ensureStoryOwned`, `ensureChapterOwned`) already live there and must call the predicates; putting predicates in per-entity repo files would force `_narrative.ts → story.repo.ts` imports while those repos already import from `_narrative.ts` — an import cycle. With denormalization the chains are gone, so the old co-location rationale (chain lives with its entity) no longer applies. The middleware dispatch table imports from `_narrative.ts`. The trailing `client` param preserves test-DB injection and transaction clients.
- **Create-time parent checks do not go away** — creating a child under someone else's parent id must still be rejected. All **five** guards survive and delegate to the matching predicate: `ensureStoryOwned` → `storyExistsForUser`, `ensureChapterOwned` → `chapterExistsForUser` (both in `_narrative.ts`, same file — trivial), `ensureDraftOwned` (chat.repo) → `draftExistsForUser`, `ensureChatOwned` (message.repo) → `chatExistsForUser` (one-directional repo → `_narrative` imports, no cycle).
- **Integrity of the denormalized column:** rows never change owner in this app (no transfer/share feature). `userId` is written once at create, from the session, never from client input. No composite-FK machinery — the enumeration test plus write-path review is proportionate governance for this project's scale.
- **Migration authoring:** `prisma migrate dev --create-only --name owner_denormalization`, then hand-replace the generated SQL (same hand-authored style as #155's `20260705233022_drafts`). Use Prisma-conventional constraint/index names (`Chapter_userId_fkey`, `Chapter_userId_idx`, …) so the shadow-DB diff reports no drift and future `migrate dev` doesn't try to "fix" it.
- **Backfill joins go direct-to-Story** (e.g. `UPDATE "Message" m SET "userId" = s."userId" FROM "Chat" c JOIN "Draft" d … JOIN "Story" s …`) — order-independent, no reliance on freshly-populated parent columns. The terminal `DO` block (raise on any parent/child `userId` mismatch) stays as an in-transaction sanity check.

## Entity table (post-#155)

| `OwnedResource` | Model | Gains `userId` | Backfill join | Create guard → predicate |
|---|---|---|---|---|
| `story` | `Story` | already has | — | — (root) |
| `chapter` | `Chapter` | ✅ | `story` | shared `ensureStoryOwned` → `storyExistsForUser` |
| `character` | `Character` | ✅ | `story` | shared `ensureStoryOwned` → `storyExistsForUser` |
| `outline` | `OutlineItem` | ✅ | `story` | shared `ensureStoryOwned` → `storyExistsForUser` |
| `draft` | `Draft` | ✅ | `chapter → story` | shared `ensureChapterOwned` → `chapterExistsForUser` |
| `chat` | `Chat` | ✅ | `draft → chapter → story` | local `ensureDraftOwned` (chat.repo) → `draftExistsForUser` |
| `message` | `Message` | ✅ | `chat → draft → chapter → story` | local `ensureChatOwned` (message.repo) → `chatExistsForUser` |

All seven predicates live in `_narrative.ts`.

## Global Constraints

- Backend-only: no `shared/` or frontend changes; wire formats unchanged. `userId` must never egress: this relies on `serialize.ts`'s explicit-pick discipline + `strictObject` wire schemas — no new code may spread a raw repo row into a response, and Task 2 includes verifying the existing egress points.
- TS strict, no `any`. Predicates and middleware select `{ id: true }` only — never a `*Ciphertext`/`*Iv`/`*AuthTag` column. E12 leak test must pass (schema change touching narrative tables → mandatory).
- Behavior-preserving at the HTTP surface: 401/400/403 semantics, conflation, `idParam` defaults, `options.client` — all unchanged; no route signature changes.
- This is a **breaking data-model change on populated data**: one consolidated migration (add nullable → backfill direct-to-Story joins → `SET NOT NULL` → FK + index → self-verify `DO` block). After a schema migration, restart the backend to refresh the Prisma client (dev-container drift gotcha).
- Backend tests need Postgres up (`sudo pg_ctlcluster 16 main start` in this container) and `CI=true`; `npm -w story-editor-backend run db:test:reset` before full-suite runs. **`db:test:reset` proves fresh-DB apply only** — backfill correctness on populated data is proven by the Task 1 fixture test, not by the template reset.
- Commit format `[story-editor-35u] …`.
- Verify (whole plan): `npm -w story-editor-backend run typecheck && CI=true npm -w story-editor-backend test`
- Close gate: diff touches `schema.prisma` + migrations on narrative tables + `backend/src/repos/**` + `backend/src/middleware/` → BOTH `security-reviewer` and `repo-boundary-reviewer` will path-match. Expected; plan for both. Close `story-editor-35u` AND `story-editor-z7g` through `/bd-close-reviewed`.

---

### Task 1: Schema + consolidated backfill migration + populated-fixture migration test

- [ ] **Re-verify the entity and guard tables above against merged `main`** (post-#155): model names, FK nullability, guard locations/signatures (`repoTag` params), `OwnedResource` members, `tests/migrations/` harness shape. If anything differs, stop and update this plan first.
- [ ] `schema.prisma`: add `userId String` + `user User @relation(fields: [userId], references: [id], onDelete: Cascade)` + `@@index([userId])` to the six tables; add the six back-relation arrays on `User` (`chapters Chapter[]`, `characters Character[]`, `outlineItems OutlineItem[]`, `drafts Draft[]`, `chats Chat[]`, `messages Message[]`). No `@relation` names needed — no model pair gains a second relation.
- [ ] Author the migration via `prisma migrate dev --create-only --name owner_denormalization`, hand-replacing the SQL: `ADD COLUMN "userId" TEXT` (nullable) → backfill each table with a direct-to-Story join → `SET NOT NULL` (provably safe: all chain FKs are NOT NULL — no orphans possible) → FKs + indexes with Prisma-conventional names → terminal `DO` block raising on any parent/child `userId` mismatch. Verify no shadow-DB drift (`prisma migrate diff` clean).
- [ ] Cascade audit: user deletion now reaches every narrative table by two paths (new direct FK + existing transitive cascade), and the Chapter↔Draft self-cycle (`Chapter.activeDraftId` SetNull / `Draft.chapterId` Cascade) coexists with the new cascades. Postgres permits overlapping/cyclic cascade paths — confirm against the generated SQL and record the check in the task report.
- [ ] **Populated-fixture migration test** following #155's `backend/tests/migrations/` pattern: load a multi-user pre-migration fixture (two users, full subtree each: story → chapter → draft → chat → message + character + outline item), apply the migration, assert (a) every row's `userId` equals its owning story's `userId` across all six tables, (b) the `DO` block passed, (c) all six columns are NOT NULL. Match the harness's opt-in/run conventions exactly.
- [ ] `SELF_HOSTING.md`: extend the #155 destructive-migration operator note (snapshot with `scripts/backup-db.sh` before upgrading; rollback = restore).
- [ ] `npx prisma generate`; `db:test:reset` regenerates the template through the full chain (fresh-DB apply proof).

**Verify:** `npm -w story-editor-backend run db:test:reset && npm -w story-editor-backend run typecheck && CI=true npm -w story-editor-backend test -- tests/migrations/`

### Task 2: Repo sweep — flatten every ownership scope to `{ id, userId }`

- [ ] All seven repos: every nested **ownership** scope in `where` clauses flattens to direct `userId` equality (reads, updates, deletes, list queries, aggregates). `contentUpdatedAtMax`'s subtree aggregates flatten. The five `ensure*` guards flatten their check bodies (Task 3 rewires them onto the predicates; flattening the body here is fine and expected to be byte-identical to the eventual predicate).
- [ ] **Do NOT touch draft.repo's intentionally-unscoped internals** — they are not ownership chains: `nextOrderIndex`'s `aggregate({ where: { chapterId } })`, `remove`'s `count`/re-pack loop, `setActive`'s `chapter.update({ where: { id: chapterId } })` (all run after an owner guard, some inside a tx), and the `chapter: { select: { activeDraftId: true } }` relation *reads*. Converting `setActive` to a "scoped" `updateMany` would be a regression. Leave them; note them in the task report so `repo-boundary-reviewer` doesn't flag them as residual chains.
- [ ] Every `create` path writes `userId` (from `resolveUserId(req, …)` — never from client input; no wire schema gains the field).
- [ ] Egress check: confirm `serialize.ts` picks (incl. `serializeDraft`/`serializeDraftMeta`), `export.service.ts`, and every route returning repo rows still explicit-pick — no spread of a raw repo row anywhere the new column could leak into a response or export file.
- [ ] Full backend suite green, including E12 leak test and #155's draft/chat repo tests. No test weakened; behavior identical (same rows visible/deniable as before).

**Verify:** `CI=true npm -w story-editor-backend test -- tests/repos/ tests/routes/ tests/security/`

### Task 3: Predicates + middleware dispatch table (the z7g payload)

- [ ] Add the seven `xExistsForUser` predicates to `_narrative.ts` (one-liners per the design decision).
- [ ] All five guards delegate: `ensureStoryOwned` → `storyExistsForUser`, `ensureChapterOwned` → `chapterExistsForUser` (same-file), `ensureDraftOwned` (chat.repo) → `draftExistsForUser`, `ensureChatOwned` (message.repo) → `chatExistsForUser` (repo → `_narrative` imports only; no cycle). Throw semantics and `repoTag` messages unchanged.
- [ ] `checkOwned` in `ownership.middleware.ts` becomes a dispatch table `Record<OwnedResource, (id, userId, client) => Promise<boolean>>` over the `_narrative.ts` predicates. No `client.<model>.findFirst` remains in the middleware; `requireOwnership` behavior (401/400/403, conflation comment, `idParam`, `options.client` forwarding) unchanged.
- [ ] Existing middleware + route tests green untouched.

**Verify:** `CI=true npm -w story-editor-backend test -- tests/middleware/ tests/routes/`

### Task 4: Ownership enumeration test (the drift gate)

- [ ] Extend `backend/tests/middleware/ownership.middleware.test.ts` (or sibling per naming conventions): cases driven from a fixture map typed `Record<OwnedResource, …>` — the compiler fails when a future resource joins the union without a fixture. No hardcoded list, no runtime exhaustiveness helper.
- [ ] Per resource: seed one owned + one not-owned row (second user) through the repo layer / existing factories (never raw Prisma for narrative rows).
- [ ] Assert `requireOwnership(type)` passes the owned id; 403s (`{ error: { code: 'forbidden' } }`) for the not-owned id AND a nonexistent id (conflation both ways). Existing 400/401 coverage stays untouched.
- [ ] E12 leak test green.

**Verify:** `CI=true npm -w story-editor-backend test -- tests/middleware/ tests/security/` — plus the whole-plan verify.

---

## Explicit non-goals

- No CryptoContext / `createXRepo(req)` re-plumbing (`story-editor-0uu`, separate and after).
- No Postgres RLS (denormalization makes it *available* later; adopting it is its own decision).
- No composite `(id, userId)` FK machinery — disproportionate at this project's scale.
- No change to 403 conflation, route shapes, wire formats, or export file format.
- No frontend or shared changes.

## Acceptance criteria

- All 7 narrative tables carry `userId NOT NULL` + FK + index; migration backfills correctly (proven by the populated-fixture test) and applies cleanly on a fresh DB; no shadow-DB drift.
- No transitive ownership chain remains in any repo `where` clause, any of the five `ensure*` guards, or the middleware. (draft.repo's documented intentionally-unscoped internals are not chains and remain.)
- `ownership.middleware.ts` contains no narrative-model Prisma calls; `checkOwned` is a dispatch table over the `_narrative.ts` predicates.
- Enumeration test is structurally exhaustive against `OwnedResource` (owned / not-owned / nonexistent per resource).
- Backend typecheck + full backend suite green; E12 leak test passes; no `userId` in any response body or export file.
- Both `story-editor-35u` and `story-editor-z7g` close through `/bd-close-reviewed`.
