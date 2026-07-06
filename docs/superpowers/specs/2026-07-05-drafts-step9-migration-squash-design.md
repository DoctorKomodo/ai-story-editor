# Drafts step 9 — migration squash + consolidation gate (story-editor-9wk.9)

**Parent spec:** `docs/superpowers/specs/2026-06-25-chapter-drafts-design.md` §5a/§5b/§5c, §11 step 9.
**bd issue:** story-editor-9wk.9 (last pre-merge step of the 9wk epic).

## Goal

Before `feature/chapter-drafts` merges to `main`, replace the five per-step scaffolding
migrations with **one consolidated pre-9wk → post-9wk migration**, and prove it correct
two ways: a one-time `prisma migrate diff` equivalence check against the staged chain,
and a committed baseline-fixture harness that runs the consolidated migration against a
populated pre-9wk database and asserts the full transform. Add the destructive-migration
release note to `SELF_HOSTING.md`.

No operator ever deploys an in-between 9wk version, so `main` ships a single one-shot
migration. The backfill logic was proven in step 2 (`8a3a13e`, test deleted in step 5
when its seeding path died); this task re-proves it end-to-end on populated pre-9wk data,
which after the step-5 drops can no longer be seeded through `db:test:reset`.

## Decisions (direction-gate, user-approved 2026-07-05)

- **D1 — Hand-assemble the consolidated SQL from the five proven files** (approach A).
  Reorder the already-reviewed statements; do not regenerate via `prisma migrate diff`
  (a one-shot generated diff orders for schema correctness, not data survival, and would
  need hand-reordering anyway). The equivalence check then proves the reordering sound.
- **D2 — The harness is opt-in**, not in the default suite (`tests/live` pattern:
  separate vitest config + npm script, excluded from the default run). Rationale:
  upgrades happen immediately after the merge, so there is no long-tail late-upgrader
  scenario to keep guarding; the harness's job ends at merge and nothing needs deleting
  later.
- **D3 — The `migrate diff` equivalence check is one-time**, executed during
  implementation and recorded (commands + output) in the plan step and progress ledger.
  Once the old chain is deleted there is nothing durable to diff against; keeping the old
  chain around would defeat the squash.
- **D4 — Baseline fixture = schema-only dump PLUS `_prisma_migrations` rows** (refines
  the parent spec's "schema-only" wording). `migrate deploy` decides what is pending by
  reading `_prisma_migrations`; a fixture without those rows would make deploy re-apply
  the whole chain from `init` and fail on existing tables. Checksums must match the real
  migration files, so the rows are captured from a real migrated scratch DB
  (`pg_dump --data-only --table=public._prisma_migrations`), never hand-written. Still
  zero narrative data; still regenerable from git.
- **D5 — Seeding is raw SQL with ciphertext-shaped strings.** The current Prisma client
  no longer knows the pre-9wk columns (`Chapter.bodyCiphertext` etc.), so repo-layer
  seeding is impossible by construction. The migration relocates bytes without
  decrypting, so byte-identity of arbitrary distinct strings is exactly the property
  under test. No DEK, no real crypto, no plaintext narrative content anywhere in the
  harness.

## 1. The consolidated migration

Delete the five scaffolding migration directories:

- `20260629185340_drafts_expand`
- `20260704161441_chat_draft_fk`
- `20260704165922_drafts_contract_chat`
- `20260704200816_drafts_resync_active`
- `20260705075257_drafts_contract_chapter`

Add one directory `20260705HHMMSS_drafts` (timestamp minted at creation time — it must
sort after the last pre-9wk migration, `20260616205230_drop_session_and_refresh_token`,
which any current timestamp does). `backend/prisma/schema.prisma` is already post-9wk
and does not change. The migration's `migration.sql` carries the proven statements in
this order:

1. **Create `Draft`**: `CREATE TABLE "Draft"` (exact column list from `drafts_expand`),
   `Draft_chapterId_idx`, unique `Draft_chapterId_orderIndex_key`, FK
   `Draft.chapterId → Chapter(id)` `ON DELETE CASCADE ON UPDATE CASCADE`.
2. **Expand `Chapter`**: `DROP COLUMN "status"`, `ADD COLUMN "activeDraftId" TEXT`,
   unique `Chapter_activeDraftId_key`, FK `Chapter.activeDraftId → Draft(id)`
   `ON DELETE SET NULL ON UPDATE CASCADE`.
3. **Expand `Chat`**: `ADD COLUMN "draftId" TEXT`.
4. **Backfill** — the three statements verbatim from `drafts_expand`, idempotency
   guards kept:
   - `INSERT INTO "Draft" … SELECT gen_random_uuid()::text, c."id", c.<ciphertext cols>,
     c."wordCount", NULL label, 0, c."createdAt", c."updatedAt" FROM "Chapter" c WHERE
     NOT EXISTS (…)` — one draft per chapter, ciphertext copied byte-for-byte. The
     guards stay because they make the migration safe to re-run after a partial failure
     (restore-free retry on statements already executed), not for a second pass —
     on pre-9wk data one pass is complete.
   - `UPDATE "Chapter" … SET "activeDraftId" = d."id" … WHERE … "activeDraftId" IS NULL`.
   - `UPDATE "Chat" … SET "draftId" = d."id" FROM "Draft" d WHERE d."chapterId" =
     ch."chapterId" AND ch."draftId" IS NULL`.
5. **Contract `Chat`**: drop FK `Chat_chapterId_fkey`; drop indexes `Chat_chapterId_idx`,
   `Chat_chapterId_kind_idx`, `Chat_chapterId_lastActivityAt_idx`;
   `DROP COLUMN "chapterId"`; `ALTER COLUMN "draftId" SET NOT NULL`; add FK
   `Chat.draftId → Draft(id)` `ON DELETE CASCADE ON UPDATE CASCADE`; create indexes
   `Chat_draftId_idx`, `Chat_draftId_kind_idx`, `Chat_draftId_lastActivityAt_idx`.
6. **Contract `Chapter`**: drop the 8 columns — `bodyCiphertext`, `bodyIv`,
   `bodyAuthTag`, `summaryJsonCiphertext`, `summaryJsonIv`, `summaryJsonAuthTag`,
   `summaryJsonUpdatedAt`, `wordCount`.

Dropped from the squash (correct by construction on pre-9wk data):

- `drafts_resync_active` — dev-only artifact: it repaired active drafts that went stale
  while 9wk.3/9wk.4 code wrote `Chapter.*` only. On pre-9wk data the backfill copy IS
  the first and only write, so there is nothing to resync.
- The step-3 re-backfill duplicate — same statements as step 4 above; a second pass on
  freshly backfilled data matches zero rows.

**Failure/rollback posture (per parent spec §5c):** rollback is restore-from-backup, not
a down-migration. The release note (section 5) mandates a `scripts/backup-db.sh`
snapshot before upgrading. If the migration fails partway on an operator DB, the
recovery path is restore + retry (Prisma's `migrate resolve --rolled-back` exists for
history bookkeeping after a manual restore). The design does not rely on
whole-migration atomicity guarantees from the migration engine.

## 2. One-time equivalence check (`prisma migrate diff`)

Executed during implementation, sequenced around the squash edit itself (the old and
new chains never need to coexist on disk):

1. Create two scratch databases (e.g. `squash_diff_old`, `squash_diff_new`) on the dev
   Postgres container.
2. **Before touching the migrations directory**, apply the **old** chain (all 22
   pre-squash dirs, still present in the working tree) to `squash_diff_old` via
   `prisma migrate deploy`.
3. Perform the squash (delete the five dirs, add the consolidated one), then apply the
   **new** chain (17 pre-9wk + the consolidated one) to `squash_diff_new` via
   `prisma migrate deploy`.
4. `prisma migrate diff --from-url <old-url> --to-url <new-url> --script` must output
   the empty-migration marker (`-- This is an empty migration.`), and the same check
   with `--from-url`/`--to-url` swapped must too (diff is directional).
5. Record the exact commands and output in the plan step and the progress ledger; drop
   both scratch DBs.

This proves the reordered consolidated DDL reaches a schema identical to the staged
per-step chain. (Data equivalence is the harness's job, section 4.)

## 3. Committed baseline fixture

`backend/tests/migrations/fixtures/pre-9wk-baseline.sql` — a plain-SQL dump of a scratch
database with **only the 17 pre-9wk migrations applied**, consisting of (per D4):

- `pg_dump --schema-only` output, plus
- `pg_dump --data-only --table=public._prisma_migrations` output appended.

No narrative rows, no user rows, no secrets — schema + migration bookkeeping only. A
header comment documents the regeneration recipe (checkout of the pre-9wk migrations
from git → scratch DB → `prisma migrate deploy` → the two `pg_dump` commands), so the
fixture is regenerable and auditable. Generated once during implementation from the
same scratch DB the equivalence check builds.

## 4. The opt-in harness

**Files:**

- `backend/tests/migrations/drafts-squash.test.ts` — the harness test.
- `backend/vitest.squash.config.ts` — dedicated config (include only
  `tests/migrations/**/*.test.ts`; no `globalSetup`, no `setupFiles` — the harness owns
  its own scratch DB and never touches the worker-template machinery or the app Prisma
  client).
- `backend/package.json` — new script `test:migration-squash` running vitest with that
  config (`test:live` pattern).
- `backend/vitest.config.ts` — add `tests/migrations/**` to `exclude` so the default
  suite never picks the harness up.

**Flow — two access paths, each with an existing precedent:**

- Host-side `pg` `Client` against the `postgres` maintenance DB for DROP/CREATE
  DATABASE and for the assertions — mirroring `backend/tests/globalSetup.ts` (works
  because `.env.test` points at `localhost:5432`).
- `docker exec -i <container> psql` for loading the dump — mirroring
  `scripts/db-test-reset.sh`, because the dump contains `COPY … FROM stdin`, which the
  `pg` client cannot execute. The container name resolves as
  `${POSTGRES_CONTAINER:-story-editor-postgres-1}`, same as `db-test-reset.sh:36`.

1. Read `.env.test` connection info. `DROP DATABASE IF EXISTS storyeditor_squash_test`
   / `CREATE DATABASE storyeditor_squash_test` via the postgres maintenance DB.
2. Load `pre-9wk-baseline.sql` into the scratch DB via `docker exec -i … psql`.
3. Seed representative pre-9wk data with raw SQL (per D5): 2 users; stories per user;
   ~4 chapters covering the shapes — body+summary ciphertext, body-only, NULL body
   (never-written chapter), plus one chapter carrying multiple chats including a
   `scene`-kind chat, with messages. Every ciphertext/iv/authTag column gets a distinct
   ciphertext-shaped marker string; `wordCount` gets distinct non-zero values (and 0 for
   the NULL-body chapter).
4. Run the consolidated migration exactly the way an operator's entrypoint does:
   `npx prisma migrate deploy` via `execSync` with `DATABASE_URL` pointed at the scratch
   DB (cwd `backend/`).
5. Assert with raw SQL:
   - exactly one `Draft` per chapter, `orderIndex` 0, label columns NULL;
   - every `body*`/`summaryJson*`/`summaryJsonUpdatedAt`/`wordCount` value on the draft
     byte-identical to what was seeded on its chapter;
   - `Chapter.activeDraftId` points at that draft, for every chapter;
   - every chat re-pointed to its chapter's draft (`Chat.draftId` correct and NOT NULL),
     messages intact (count + content columns unchanged);
   - dropped columns actually gone: `information_schema.columns` has no
     `Chapter.status`, no `Chapter.body*`/`summaryJson*`/`wordCount`, no
     `Chat.chapterId`;
   - no orphans: `Draft` count equals `Chapter` count; zero chats whose `draftId`
     doesn't resolve to a draft of their original chapter;
   - re-running `npx prisma migrate deploy` is a recorded no-op (deploy reports no
     pending migrations; row counts unchanged).
6. Teardown drops the scratch DB (in `afterAll`, best-effort on failure so a red run
   leaves the DB inspectable only until the next run recreates it).

The harness requires the compose stack up (Postgres container), same as the rest of the
backend suite — the verify line orders it after `make dev`.

**What the harness does NOT do:** no app code, no repo layer, no DEK, no decryption —
it validates the migration, not the application. The E12 leak test already covers
`Draft` (extended in step 2) and is unaffected.

## 5. Docs

- **`SELF_HOSTING.md`** — add an upgrade note (house style: the `APP_ENCRYPTION_KEY`
  retirement note): the first post-9wk release carries a **destructive migration** — it
  relocates each chapter's encrypted content into the new `Draft` table and then drops
  the old `Chapter` columns. Take a `scripts/backup-db.sh` snapshot before
  `docker compose pull && up -d`; the migration applies automatically and one-shot via
  the entrypoint's `prisma migrate deploy`; rollback is restore-from-backup.
- **Dev machines that already applied the five per-step migrations** (the maintainer's
  dev DB): after the squash, `prisma migrate deploy` sees the consolidated migration as
  pending, tries to apply it, and fails on `CREATE TABLE "Draft"`. Because
  `backend/docker-entrypoint.sh` runs `migrate deploy` on every boot and the service has
  `restart: unless-stopped`, the **backend container crash-loops** until fixed — and the
  first failure records the consolidated migration as *failed* in `_prisma_migrations`,
  so later deploys refuse with a failed-migration error. The one-time, data-preserving
  fix therefore runs **from the host** while Postgres stays up:
  `cd backend && DATABASE_URL=postgresql://…@localhost:5432/storyeditor npx prisma
  migrate resolve --applied <consolidated-name>` (clears the failed record and marks it
  applied — correct, since the dev schema already matches), then restart the backend.
  Alternative: `make reset-db` (destructive, fine for throwaway dev data). Documented in
  the plan and the task's final report (not in CLAUDE.md — one-time local step, not a
  durable gotcha). Test/CI databases rebuild from scratch every run and need nothing.

## 6. Verify line

```
verify: make dev && npm --prefix backend run typecheck && npm -w story-editor-backend run db:test:reset && npm -w story-editor-backend run test && npm -w story-editor-backend run test:migration-squash
```

The full backend suite proves the new chain builds the same template DB the entire suite
runs on (every existing test is implicitly a schema-equivalence check); the harness
proves the data transform on populated pre-9wk data. Frontend and shared are untouched
by this task.

## Out of scope

- No `schema.prisma` changes, no new columns, no data-model evolution.
- No down-migration (house style: restore-from-backup).
- No changes to `docker-entrypoint.sh`, `backup-db.sh`, or the restore drill.
- No release cut (`scripts/release.sh` runs when the user decides to release, after the
  merge).
