# Drafts Step 9 — Migration Squash + Consolidation Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the five per-step drafts scaffolding migrations with one consolidated pre-9wk→post-9wk migration, proven equivalent by a one-time `prisma migrate diff` check and by an opt-in baseline-fixture harness that runs the migration against a populated pre-9wk database.

**Architecture:** The consolidated `migration.sql` is hand-assembled from the five already-reviewed files in dependency order (expand → backfill → contract); a committed pre-9wk baseline dump (schema + `_prisma_migrations` bookkeeping rows) lets an opt-in vitest harness rebuild a populated pre-9wk database and run `prisma migrate deploy` exactly like an operator's container entrypoint. Spec: `docs/superpowers/specs/2026-07-05-drafts-step9-migration-squash-design.md`.

**Tech Stack:** Prisma 7 migrations (`prisma.config.ts` resolves `DATABASE_URL` from the environment — an explicit `DATABASE_URL=… npx prisma migrate deploy` from `backend/` always wins over dotenv), Postgres 16 (compose container `story-editor-postgres-1`), vitest (dedicated config, `tests/live` opt-in pattern), `pg` Client + `docker exec psql`.

## Global Constraints

- **Never modify any of the 17 pre-9wk migration files** — their `_prisma_migrations` checksums must keep validating on existing databases. The squash touches ONLY the five 9wk dirs (delete) and adds one new dir.
- **`backend/prisma/schema.prisma` does not change.** It is already post-9wk.
- **No DEK, no decryption, no plaintext narrative content** anywhere in the fixture or harness — ciphertext columns get arbitrary marker strings (`ct:body:ch-1` etc.). Absolute security rules apply (no plaintext Venice keys / passwords / recovery codes / DEKs in any sink).
- **The committed fixture contains zero user/story/narrative rows** — schema + `_prisma_migrations` data only.
- **The harness is opt-in:** excluded from the default backend suite (`tests/migrations/**` in `backend/vitest.config.ts` `exclude`), run only via `npm run test:migration-squash` (spec D2).
- **No down-migration.** Rollback posture is restore-from-backup (spec §1).
- The five migrations being squashed: `20260629185340_drafts_expand`, `20260704161441_chat_draft_fk`, `20260704165922_drafts_contract_chat`, `20260704200816_drafts_resync_active`, `20260705075257_drafts_contract_chapter`. The last pre-9wk migration: `20260616205230_drop_session_and_refresh_token` (17 pre-9wk total).
- Scratch database names: `squash_diff_old`, `squash_diff_new`, `squash_baseline` (implementation-time, dropped when done), `storyeditor_squash_test` (harness-owned). None collide with `storyeditor_test` / `storyeditor_test_w*`.
- All commands assume the dev stack is up (`make dev`) and `.env.test` exists (`cp .env.test.example .env.test`). DB URL scheme: `postgresql://storyeditor:storyeditor@localhost:5432/<db>`.
- Commit messages: `[story-editor-9wk.9] <description>`. Commit with explicit pathspecs only — never `git add .`, never commit `.beads/*.jsonl`.

---

### Task 1: The consolidated migration + one-time equivalence check

**Files:**
- Create: `backend/prisma/migrations/<STAMP>_drafts/migration.sql` (`<STAMP>` = `date +%Y%m%d%H%M%S` minted in step 2 — any current timestamp sorts after `20260616205230`)
- Delete: the five migration dirs listed in Global Constraints
- Test: the equivalence check below (one-time, output recorded in the task report) + the full backend suite (the new chain builds the template DB every existing test runs on)

**Interfaces:**
- Produces: the consolidated migration directory name (`<STAMP>_drafts`) — Tasks 2 and 3 refer to it; discover it later with `ls backend/prisma/migrations | grep '_drafts$'`.

- [ ] **Step 1: Apply the OLD chain (still on disk) to a scratch DB**

```bash
docker exec story-editor-postgres-1 psql -U storyeditor -d postgres -v ON_ERROR_STOP=1 \
  -c 'DROP DATABASE IF EXISTS squash_diff_old' -c 'CREATE DATABASE squash_diff_old'
cd backend && DATABASE_URL=postgresql://storyeditor:storyeditor@localhost:5432/squash_diff_old \
  npx prisma migrate deploy
```

Expected: exit 0, "22 migrations found", all applied.

- [ ] **Step 2: Perform the squash**

```bash
cd backend/prisma/migrations
STAMP="$(date +%Y%m%d%H%M%S)"
mkdir "${STAMP}_drafts"
git rm -r 20260629185340_drafts_expand 20260704161441_chat_draft_fk \
  20260704165922_drafts_contract_chat 20260704200816_drafts_resync_active \
  20260705075257_drafts_contract_chapter
```

Write `backend/prisma/migrations/${STAMP}_drafts/migration.sql` with exactly this content:

```sql
-- [story-editor-9wk] Consolidated pre-9wk → post-9wk drafts migration.
-- Squash of the five feature-branch scaffolding migrations — see
-- docs/superpowers/specs/2026-07-05-drafts-step9-migration-squash-design.md.
-- Relocates each chapter's encrypted body/summary into a new Draft row
-- (ciphertext copied byte-for-byte — never decrypted), points
-- Chapter.activeDraftId and Chat.draftId at it, then drops the superseded
-- columns. DESTRUCTIVE on Chapter/Chat columns: operators take a
-- scripts/backup-db.sh snapshot first (SELF_HOSTING.md); rollback is
-- restore-from-backup.

-- 1. Create Draft.
CREATE TABLE "Draft" (
    "id" TEXT NOT NULL,
    "bodyCiphertext" TEXT,
    "bodyIv" TEXT,
    "bodyAuthTag" TEXT,
    "summaryJsonCiphertext" TEXT,
    "summaryJsonIv" TEXT,
    "summaryJsonAuthTag" TEXT,
    "summaryJsonUpdatedAt" TIMESTAMP(3),
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "labelCiphertext" TEXT,
    "labelIv" TEXT,
    "labelAuthTag" TEXT,
    "orderIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "chapterId" TEXT NOT NULL,

    CONSTRAINT "Draft_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Draft_chapterId_idx" ON "Draft"("chapterId");

CREATE UNIQUE INDEX "Draft_chapterId_orderIndex_key" ON "Draft"("chapterId", "orderIndex");

ALTER TABLE "Draft" ADD CONSTRAINT "Draft_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Expand Chapter: retire status, add the active-draft pointer.
ALTER TABLE "Chapter" DROP COLUMN "status",
ADD COLUMN     "activeDraftId" TEXT;

CREATE UNIQUE INDEX "Chapter_activeDraftId_key" ON "Chapter"("activeDraftId");

ALTER TABLE "Chapter" ADD CONSTRAINT "Chapter_activeDraftId_fkey" FOREIGN KEY ("activeDraftId") REFERENCES "Draft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Expand Chat.
ALTER TABLE "Chat" ADD COLUMN "draftId" TEXT;

-- 4. Backfill (decrypt-free): one Draft per existing Chapter, ciphertext
-- copied byte-for-byte (same user, same DEK — no decryption). The
-- NOT EXISTS / IS NULL guards make the statements safe to re-run after a
-- partial failure; on pre-9wk data a single pass is complete.
INSERT INTO "Draft" (
  "id", "chapterId",
  "bodyCiphertext", "bodyIv", "bodyAuthTag",
  "summaryJsonCiphertext", "summaryJsonIv", "summaryJsonAuthTag", "summaryJsonUpdatedAt",
  "wordCount",
  "labelCiphertext", "labelIv", "labelAuthTag",
  "orderIndex", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text, c."id",
  c."bodyCiphertext", c."bodyIv", c."bodyAuthTag",
  c."summaryJsonCiphertext", c."summaryJsonIv", c."summaryJsonAuthTag", c."summaryJsonUpdatedAt",
  c."wordCount",
  NULL, NULL, NULL,
  0, c."createdAt", c."updatedAt"
FROM "Chapter" c
WHERE NOT EXISTS (SELECT 1 FROM "Draft" d WHERE d."chapterId" = c."id");

-- Point each chapter at its (single) backfilled draft.
UPDATE "Chapter" c
SET "activeDraftId" = d."id"
FROM "Draft" d
WHERE d."chapterId" = c."id" AND c."activeDraftId" IS NULL;

-- Re-point each chat at its chapter's backfilled draft.
UPDATE "Chat" ch
SET "draftId" = d."id"
FROM "Draft" d
WHERE d."chapterId" = ch."chapterId" AND ch."draftId" IS NULL;

-- 5. Contract Chat: draftId becomes the FK spine.
ALTER TABLE "Chat" DROP CONSTRAINT "Chat_chapterId_fkey";

DROP INDEX "Chat_chapterId_idx";

DROP INDEX "Chat_chapterId_kind_idx";

DROP INDEX "Chat_chapterId_lastActivityAt_idx";

ALTER TABLE "Chat" DROP COLUMN "chapterId",
ALTER COLUMN "draftId" SET NOT NULL;

ALTER TABLE "Chat" ADD CONSTRAINT "Chat_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Chat_draftId_idx" ON "Chat"("draftId");

CREATE INDEX "Chat_draftId_kind_idx" ON "Chat"("draftId", "kind");

CREATE INDEX "Chat_draftId_lastActivityAt_idx" ON "Chat"("draftId", "lastActivityAt");

-- 6. Contract Chapter: body/summary/wordCount now live on the draft.
ALTER TABLE "Chapter" DROP COLUMN "bodyAuthTag",
DROP COLUMN "bodyCiphertext",
DROP COLUMN "bodyIv",
DROP COLUMN "summaryJsonAuthTag",
DROP COLUMN "summaryJsonCiphertext",
DROP COLUMN "summaryJsonIv",
DROP COLUMN "summaryJsonUpdatedAt",
DROP COLUMN "wordCount";
```

- [ ] **Step 3: Apply the NEW chain to a second scratch DB**

```bash
docker exec story-editor-postgres-1 psql -U storyeditor -d postgres -v ON_ERROR_STOP=1 \
  -c 'DROP DATABASE IF EXISTS squash_diff_new' -c 'CREATE DATABASE squash_diff_new'
cd backend && DATABASE_URL=postgresql://storyeditor:storyeditor@localhost:5432/squash_diff_new \
  npx prisma migrate deploy
```

Expected: exit 0, "18 migrations found", all applied.

- [ ] **Step 4: Prove schema equivalence, both directions**

```bash
# DATABASE_URL is required by prisma.config.ts even though diff only uses the
# explicit --from-url/--to-url pair — any valid URL satisfies the config load.
cd backend
DATABASE_URL=postgresql://storyeditor:storyeditor@localhost:5432/squash_diff_old \
  npx prisma migrate diff \
  --from-url postgresql://storyeditor:storyeditor@localhost:5432/squash_diff_old \
  --to-url   postgresql://storyeditor:storyeditor@localhost:5432/squash_diff_new \
  --script
DATABASE_URL=postgresql://storyeditor:storyeditor@localhost:5432/squash_diff_old \
  npx prisma migrate diff \
  --from-url postgresql://storyeditor:storyeditor@localhost:5432/squash_diff_new \
  --to-url   postgresql://storyeditor:storyeditor@localhost:5432/squash_diff_old \
  --script
```

Expected: each command prints exactly `-- This is an empty migration.` **Copy both commands and their outputs verbatim into the task report** — this is the one-time equivalence record (spec D3). If either diff is non-empty, the consolidated SQL is wrong: fix `migration.sql`, drop/recreate `squash_diff_new`, re-run steps 3–4. Do NOT touch the pre-9wk migrations.

- [ ] **Step 5: Full backend suite against the new chain**

```bash
npm -w story-editor-backend run db:test:reset && npm -w story-editor-backend run test
```

Expected: PASS (all tests; the suite's template DB is now built by the new chain, so every existing test doubles as a schema-equivalence check).

- [ ] **Step 6: Drop the scratch DBs**

```bash
docker exec story-editor-postgres-1 psql -U storyeditor -d postgres -v ON_ERROR_STOP=1 \
  -c 'DROP DATABASE squash_diff_old' -c 'DROP DATABASE squash_diff_new'
```

- [ ] **Step 7: Commit**

```bash
git add backend/prisma/migrations
git commit -m "[story-editor-9wk.9] SQUASH: one consolidated pre-9wk->post-9wk drafts migration (empty migrate-diff both ways vs staged chain)"
git show --stat HEAD   # confirm ONLY migration paths; no .beads files
```

---

### Task 2: Committed pre-9wk baseline fixture

**Files:**
- Create: `backend/tests/migrations/fixtures/pre-9wk-baseline.sql`

**Interfaces:**
- Consumes: the consolidated dir name from Task 1 (`ls backend/prisma/migrations | grep '_drafts$'`).
- Produces: the fixture file Task 3's harness loads. Format: header comment + `pg_dump --schema-only` + `pg_dump --data-only --table=public._prisma_migrations` (17 rows).

- [ ] **Step 1: Build a pre-9wk-only scratch DB**

Temporarily move the consolidated migration aside so `migrate deploy` applies only the 17 pre-9wk migrations (it is already committed — recoverable from git if anything goes wrong):

```bash
CONS="$(ls backend/prisma/migrations | grep '_drafts$')"
mkdir -p /tmp/squash-hold
mv "backend/prisma/migrations/$CONS" /tmp/squash-hold/
docker exec story-editor-postgres-1 psql -U storyeditor -d postgres -v ON_ERROR_STOP=1 \
  -c 'DROP DATABASE IF EXISTS squash_baseline' -c 'CREATE DATABASE squash_baseline'
cd backend && DATABASE_URL=postgresql://storyeditor:storyeditor@localhost:5432/squash_baseline \
  npx prisma migrate deploy
cd .. && mv "/tmp/squash-hold/$CONS" backend/prisma/migrations/
git status --short backend/prisma/migrations   # expected: clean (dir restored)
```

Expected: deploy reports "17 migrations found", all applied.

- [ ] **Step 2: Generate the fixture**

```bash
mkdir -p backend/tests/migrations/fixtures
{
  cat <<'HDR'
-- pre-9wk baseline for the migration-squash harness (story-editor-9wk.9).
-- Schema of a database with ONLY the 17 pre-9wk migrations applied, plus the
-- _prisma_migrations bookkeeping rows for those 17 (so `prisma migrate
-- deploy` treats only the consolidated drafts migration as pending).
-- Contains ZERO user/story/narrative rows.
--
-- Regenerate (dev stack up):
--   1. mv backend/prisma/migrations/<STAMP>_drafts /tmp/   (set aside the consolidated migration)
--   2. docker exec story-editor-postgres-1 psql -U storyeditor -d postgres \
--        -c 'DROP DATABASE IF EXISTS squash_baseline' -c 'CREATE DATABASE squash_baseline'
--   3. cd backend && DATABASE_URL=postgresql://storyeditor:storyeditor@localhost:5432/squash_baseline \
--        npx prisma migrate deploy
--   4. mv /tmp/<STAMP>_drafts backend/prisma/migrations/
--   5. Re-run the two pg_dump commands below (see plan
--      docs/superpowers/plans/2026-07-05-drafts-step9-migration-squash.md Task 2)
HDR
  docker exec story-editor-postgres-1 pg_dump -U storyeditor --schema-only squash_baseline
  docker exec story-editor-postgres-1 pg_dump -U storyeditor --data-only \
    --table=public._prisma_migrations squash_baseline
} > backend/tests/migrations/fixtures/pre-9wk-baseline.sql
```

- [ ] **Step 3: Sanity-check the fixture**

```bash
F=backend/tests/migrations/fixtures/pre-9wk-baseline.sql
grep -c 'CREATE TABLE' "$F"                          # expected: 8 (User, Story, Chapter, Character, OutlineItem, Chat, Message, _prisma_migrations)
awk '/^COPY public\._prisma_migrations/{f=1;next} /^\\\.$/{f=0} f' "$F" | wc -l   # expected: 17
grep -E 'COPY public\."(User|Story|Chapter|Chat|Message|Character|OutlineItem)"' "$F"   # expected: no output
grep -c 'bodyCiphertext' "$F"                        # expected: >=1 (pre-9wk Chapter column present)
grep -c '"Draft"' "$F"                               # expected: 0 (pre-9wk has no Draft table)
```

If the `CREATE TABLE` count differs, list them (`grep 'CREATE TABLE' "$F"`) and reconcile against `backend/prisma/schema.prisma` models before proceeding — do not hand-edit the dump body.

- [ ] **Step 4: Drop the scratch DB**

```bash
docker exec story-editor-postgres-1 psql -U storyeditor -d postgres -v ON_ERROR_STOP=1 \
  -c 'DROP DATABASE squash_baseline'
```

- [ ] **Step 5: Commit**

```bash
git add backend/tests/migrations/fixtures/pre-9wk-baseline.sql
git commit -m "[story-editor-9wk.9] commit pre-9wk baseline fixture (schema + _prisma_migrations rows, zero narrative data)"
git show --stat HEAD   # confirm only the fixture; no .beads files
```

---

### Task 3: The opt-in harness

**Files:**
- Create: `backend/vitest.squash.config.ts`
- Create: `backend/tests/migrations/drafts-squash.test.ts`
- Modify: `backend/package.json` (add `test:migration-squash` script, after `test:live`)
- Modify: `backend/vitest.config.ts` (add `tests/migrations/**` to `exclude`)
- Test: `npm -w story-editor-backend run test:migration-squash`

**Interfaces:**
- Consumes: `backend/tests/migrations/fixtures/pre-9wk-baseline.sql` (Task 2); the consolidated migration (Task 1) via `prisma migrate deploy`.
- Produces: the `test:migration-squash` npm script the verify line runs.

- [ ] **Step 1: Add the dedicated vitest config**

Create `backend/vitest.squash.config.ts`:

```ts
import path from 'node:path';
import { defineConfig } from 'vitest/config';

// story-editor-9wk.9 migration-squash harness. NEVER part of CI or the
// default backend suite (tests/migrations/** is excluded in vitest.config.ts).
// Run explicitly via `npm run test:migration-squash` with the compose stack
// up. No globalSetup / setupFiles: the harness owns its own scratch database
// and must not reset the worker-template DBs or construct the app Prisma
// client.
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/migrations/**/*.test.ts'],
    pool: 'forks',
    fileParallelism: false,
    sequence: { concurrent: false },
    // Fixture load + two `prisma migrate deploy` runs are slow; give the
    // whole pipeline room.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // vitest 4 defaults this to true — without the override, an include glob
    // that matches nothing exits 0 and the harness silently stops proving
    // anything (same defence as the main vitest.config.ts).
    passWithNoTests: false,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
```

- [ ] **Step 2: Wire the script and the default-suite exclusion**

In `backend/package.json`, after the `test:live` line, add:

```json
    "test:migration-squash": "vitest run --config vitest.squash.config.ts",
```

In `backend/vitest.config.ts`, change the exclude line:

```ts
    exclude: ['tests/live/**', 'tests/migrations/**', 'node_modules/**', 'dist/**'],
```

- [ ] **Step 3: Run the harness with no test file — verify it is wired but empty**

```bash
npm -w story-editor-backend run test:migration-squash
```

Expected: FAIL with "No test files found" (vitest exits non-zero when the include matches nothing — proves the script/config wiring before the test exists).

- [ ] **Step 4: Write the harness test**

Create `backend/tests/migrations/drafts-squash.test.ts`:

```ts
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config as dotenvConfig } from 'dotenv';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// [story-editor-9wk.9] Migration-squash harness. Validates the consolidated
// pre-9wk → post-9wk drafts migration against a POPULATED pre-9wk database,
// applied exactly the way an operator upgrade applies it (prisma migrate
// deploy). Opt-in: excluded from the default suite; run via
// `npm run test:migration-squash` with the compose stack up.
//
// Security posture: no DEK, no decryption, no plaintext narrative content.
// Every "ciphertext" below is an arbitrary marker string — the migration
// relocates bytes without decrypting, so byte-identity is the property under
// test.

const BACKEND_DIR = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(BACKEND_DIR, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'pre-9wk-baseline.sql');
const SCRATCH_DB = 'storyeditor_squash_test';
const CONTAINER = process.env.POSTGRES_CONTAINER ?? 'story-editor-postgres-1';

dotenvConfig({ path: path.join(REPO_ROOT, '.env.test') });
const templateUrl = process.env.DATABASE_URL;
if (!templateUrl) {
  throw new Error('DATABASE_URL missing — copy .env.test.example to .env.test first');
}

function dbUrl(dbName: string): string {
  const url = new URL(templateUrl as string);
  url.pathname = `/${dbName}`;
  return url.toString();
}

const scratchUrl = dbUrl(SCRATCH_DB);
const dbUser = new URL(templateUrl).username;

function loadFixture(): void {
  execFileSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', dbUser, '-d', SCRATCH_DB, '-v', 'ON_ERROR_STOP=1', '-f', '-'],
    { input: fs.readFileSync(FIXTURE) },
  );
}

function migrateDeploy(): string {
  return execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: BACKEND_DIR,
    env: { ...process.env, DATABASE_URL: scratchUrl },
    encoding: 'utf8',
  });
}

// ---- seed data (pre-9wk shapes; raw SQL — the current Prisma client no
// ---- longer knows these columns, by design) --------------------------------

interface ChapterSeed {
  storyId: string;
  orderIndex: number;
  body: [string, string, string] | null; // [ciphertext, iv, authTag]
  summary: [string, string, string] | null;
  summaryUpdatedAt: string | null; // 'YYYY-MM-DD HH:MM:SS' (timestamp literal)
  wordCount: number;
}

const CHAPTER_UPDATED_AT = '2026-06-15 12:00:00';

const CHAPTERS: Record<string, ChapterSeed> = {
  'ch-1': {
    storyId: 's-1',
    orderIndex: 0,
    body: ['ct:body:ch-1', 'iv:body:ch-1', 'tag:body:ch-1'],
    summary: ['ct:sum:ch-1', 'iv:sum:ch-1', 'tag:sum:ch-1'],
    summaryUpdatedAt: '2026-06-01 10:00:00',
    wordCount: 123,
  },
  'ch-2': {
    storyId: 's-1',
    orderIndex: 1,
    body: ['ct:body:ch-2', 'iv:body:ch-2', 'tag:body:ch-2'],
    summary: null,
    summaryUpdatedAt: null,
    wordCount: 45,
  },
  // Never-written chapter: NULL body, wordCount 0 — the backfill must still
  // mint its draft and point activeDraftId at it.
  'ch-3': {
    storyId: 's-2',
    orderIndex: 0,
    body: null,
    summary: null,
    summaryUpdatedAt: null,
    wordCount: 0,
  },
  'ch-4': {
    storyId: 's-2',
    orderIndex: 1,
    body: ['ct:body:ch-4', 'iv:body:ch-4', 'tag:body:ch-4'],
    summary: null,
    summaryUpdatedAt: null,
    wordCount: 7,
  },
};

const CHATS: Record<string, { chapterId: string; kind: 'ask' | 'scene' }> = {
  'chat-1': { chapterId: 'ch-1', kind: 'ask' },
  'chat-2': { chapterId: 'ch-4', kind: 'ask' },
  'chat-3': { chapterId: 'ch-4', kind: 'scene' },
};

const MESSAGES: Record<string, { chatId: string; role: string; content: string }> = {
  'msg-1': { chatId: 'chat-1', role: 'user', content: 'ct:msg-1' },
  'msg-2': { chatId: 'chat-1', role: 'assistant', content: 'ct:msg-2' },
  'msg-3': { chatId: 'chat-3', role: 'user', content: 'ct:msg-3' },
};

function lit(v: string | number | null): string {
  if (v === null) return 'NULL';
  if (typeof v === 'number') return String(v);
  return `'${v.replace(/'/g, "''")}'`;
}

function seedSql(): string {
  const stmts: string[] = [];
  stmts.push(
    `INSERT INTO "User" ("id","username","passwordHash","updatedAt") VALUES
      ('u-1','squash-user-1','not-a-real-hash','2026-06-01 00:00:00'),
      ('u-2','squash-user-2','not-a-real-hash','2026-06-01 00:00:00');`,
    `INSERT INTO "Story" ("id","userId","titleCiphertext","titleIv","titleAuthTag","updatedAt") VALUES
      ('s-1','u-1','ct:title:s-1','iv:title:s-1','tag:title:s-1','2026-06-01 00:00:00'),
      ('s-2','u-2','ct:title:s-2','iv:title:s-2','tag:title:s-2','2026-06-01 00:00:00');`,
  );
  for (const [id, c] of Object.entries(CHAPTERS)) {
    stmts.push(`INSERT INTO "Chapter"
      ("id","storyId","orderIndex","titleCiphertext","titleIv","titleAuthTag",
       "bodyCiphertext","bodyIv","bodyAuthTag",
       "summaryJsonCiphertext","summaryJsonIv","summaryJsonAuthTag","summaryJsonUpdatedAt",
       "wordCount","updatedAt")
      VALUES (${lit(id)},${lit(c.storyId)},${c.orderIndex},
        ${lit(`ct:title:${id}`)},${lit(`iv:title:${id}`)},${lit(`tag:title:${id}`)},
        ${lit(c.body?.[0] ?? null)},${lit(c.body?.[1] ?? null)},${lit(c.body?.[2] ?? null)},
        ${lit(c.summary?.[0] ?? null)},${lit(c.summary?.[1] ?? null)},${lit(c.summary?.[2] ?? null)},
        ${lit(c.summaryUpdatedAt)},
        ${c.wordCount},${lit(CHAPTER_UPDATED_AT)});`);
  }
  for (const [id, ch] of Object.entries(CHATS)) {
    stmts.push(`INSERT INTO "Chat"
      ("id","chapterId","kind","titleCiphertext","titleIv","titleAuthTag","updatedAt")
      VALUES (${lit(id)},${lit(ch.chapterId)},${lit(ch.kind)},
        ${lit(`ct:chat:${id}`)},${lit(`iv:chat:${id}`)},${lit(`tag:chat:${id}`)},
        '2026-06-01 00:00:00');`);
  }
  for (const [id, m] of Object.entries(MESSAGES)) {
    stmts.push(`INSERT INTO "Message"
      ("id","chatId","role","contentCiphertext","contentIv","contentAuthTag")
      VALUES (${lit(id)},${lit(m.chatId)},${lit(m.role)},
        ${lit(m.content)},${lit(`iv:${id}`)},${lit(`tag:${id}`)});`);
  }
  return stmts.join('\n');
}

// ---- harness ----------------------------------------------------------------

let maintenance: Client;
let scratch: Client;
let firstDeployOutput = '';

describe('[9wk.9] consolidated drafts migration on populated pre-9wk data', () => {
  beforeAll(async () => {
    maintenance = new Client({ connectionString: dbUrl('postgres') });
    await maintenance.connect();
    await maintenance.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
    await maintenance.query(`CREATE DATABASE ${SCRATCH_DB}`);

    loadFixture();

    scratch = new Client({ connectionString: scratchUrl });
    await scratch.connect();
    await scratch.query(seedSql());

    firstDeployOutput = migrateDeploy();
  });

  afterAll(async () => {
    await scratch?.end();
    // Best-effort: leave the DB inspectable if assertions failed mid-run
    // would be nice, but a deterministic re-run matters more — always drop.
    await maintenance?.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
    await maintenance?.end();
  });

  it('deploy applied exactly the consolidated migration', () => {
    expect(firstDeployOutput).toMatch(/\d{14}_drafts/);
    expect(firstDeployOutput).not.toMatch(/drafts_expand|drafts_contract|drafts_resync|chat_draft_fk/);
  });

  it('creates exactly one draft per chapter with byte-identical content', async () => {
    const res = await scratch.query(`
      SELECT "chapterId","bodyCiphertext","bodyIv","bodyAuthTag",
             "summaryJsonCiphertext","summaryJsonIv","summaryJsonAuthTag",
             "summaryJsonUpdatedAt"::text AS "summaryUpdatedAtText",
             "wordCount","labelCiphertext","labelIv","labelAuthTag",
             "orderIndex","updatedAt"::text AS "updatedAtText"
      FROM "Draft"`);
    expect(res.rows).toHaveLength(Object.keys(CHAPTERS).length);
    for (const [id, c] of Object.entries(CHAPTERS)) {
      const d = res.rows.find((r) => r.chapterId === id);
      expect(d, `draft for ${id}`).toBeDefined();
      expect(d.bodyCiphertext).toBe(c.body?.[0] ?? null);
      expect(d.bodyIv).toBe(c.body?.[1] ?? null);
      expect(d.bodyAuthTag).toBe(c.body?.[2] ?? null);
      expect(d.summaryJsonCiphertext).toBe(c.summary?.[0] ?? null);
      expect(d.summaryJsonIv).toBe(c.summary?.[1] ?? null);
      expect(d.summaryJsonAuthTag).toBe(c.summary?.[2] ?? null);
      expect(d.summaryUpdatedAtText).toBe(c.summaryUpdatedAt);
      expect(d.wordCount).toBe(c.wordCount);
      expect(d.labelCiphertext).toBeNull();
      expect(d.labelIv).toBeNull();
      expect(d.labelAuthTag).toBeNull();
      expect(d.orderIndex).toBe(0);
      expect(d.updatedAtText).toBe(CHAPTER_UPDATED_AT);
    }
  });

  it('points every chapter at its backfilled draft', async () => {
    const res = await scratch.query(`
      SELECT c."id", c."activeDraftId", d."chapterId" AS "draftChapterId"
      FROM "Chapter" c LEFT JOIN "Draft" d ON d."id" = c."activeDraftId"`);
    expect(res.rows).toHaveLength(Object.keys(CHAPTERS).length);
    for (const row of res.rows) {
      expect(row.activeDraftId, `activeDraftId for ${row.id}`).not.toBeNull();
      expect(row.draftChapterId).toBe(row.id);
    }
  });

  it('re-points every chat at its chapter draft, messages intact', async () => {
    const chats = await scratch.query(`
      SELECT ch."id", ch."kind", d."chapterId" AS "viaDraft"
      FROM "Chat" ch JOIN "Draft" d ON d."id" = ch."draftId"`);
    expect(chats.rows).toHaveLength(Object.keys(CHATS).length);
    for (const [id, seed] of Object.entries(CHATS)) {
      const row = chats.rows.find((r) => r.id === id);
      expect(row, `chat ${id}`).toBeDefined();
      expect(row.viaDraft).toBe(seed.chapterId);
      expect(row.kind).toBe(seed.kind);
    }
    const msgs = await scratch.query(
      `SELECT "id","chatId","role","contentCiphertext" FROM "Message"`,
    );
    expect(msgs.rows).toHaveLength(Object.keys(MESSAGES).length);
    for (const [id, seed] of Object.entries(MESSAGES)) {
      const row = msgs.rows.find((r) => r.id === id);
      expect(row, `message ${id}`).toBeDefined();
      expect(row.chatId).toBe(seed.chatId);
      expect(row.role).toBe(seed.role);
      expect(row.contentCiphertext).toBe(seed.content);
    }
  });

  it('drops the superseded columns and enforces NOT NULL on Chat.draftId', async () => {
    const gone = await scratch.query(`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND (
        (table_name = 'Chapter' AND column_name IN
          ('status','bodyCiphertext','bodyIv','bodyAuthTag',
           'summaryJsonCiphertext','summaryJsonIv','summaryJsonAuthTag',
           'summaryJsonUpdatedAt','wordCount'))
        OR (table_name = 'Chat' AND column_name = 'chapterId'))`);
    expect(gone.rows).toEqual([]);
    const draftIdCol = await scratch.query(`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Chat' AND column_name = 'draftId'`);
    expect(draftIdCol.rows).toEqual([{ is_nullable: 'NO' }]);
  });

  it('creates no orphans', async () => {
    const counts = await scratch.query(`
      SELECT (SELECT count(*)::int FROM "Draft") AS drafts,
             (SELECT count(*)::int FROM "Chapter") AS chapters,
             (SELECT count(*)::int FROM "Draft" dd
              WHERE NOT EXISTS (SELECT 1 FROM "Chapter" cc WHERE cc."id" = dd."chapterId")) AS orphan_drafts`);
    expect(counts.rows[0]).toEqual({
      drafts: Object.keys(CHAPTERS).length,
      chapters: Object.keys(CHAPTERS).length,
      orphan_drafts: 0,
    });
  });

  it('a second deploy is a recorded no-op', async () => {
    const secondOutput = migrateDeploy();
    expect(secondOutput).toMatch(/No pending migrations/);
    const drafts = await scratch.query(`SELECT count(*)::int AS n FROM "Draft"`);
    expect(drafts.rows[0].n).toBe(Object.keys(CHAPTERS).length);
  });
});
```

- [ ] **Step 5: Run the harness**

```bash
npm -w story-editor-backend run test:migration-squash
```

Expected: PASS, 7 tests. If the second-deploy assertion fails on the exact wording, run `cd backend && DATABASE_URL=postgresql://storyeditor:storyeditor@localhost:5432/storyeditor_test npx prisma migrate deploy` once against an up-to-date DB, read the actual "nothing to do" phrasing, and adjust the single regex — do not weaken any other assertion.

- [ ] **Step 6: Confirm the default suite still excludes the harness and everything typechecks/lints**

```bash
grep -n "tests/migrations" backend/vitest.config.ts        # expected: the exclude line
npm --prefix backend run typecheck                          # expected: clean (tsconfig.test.json covers tests/**)
# Format first (hand-authored code is rarely byte-perfect), then confirm clean:
npx biome check --write backend/tests/migrations backend/vitest.squash.config.ts
npx biome check backend/tests/migrations backend/vitest.squash.config.ts    # expected: clean
# If --write changed anything, re-run the harness (step 5) before committing.
```

- [ ] **Step 7: Commit**

```bash
git add backend/vitest.squash.config.ts backend/tests/migrations/drafts-squash.test.ts \
  backend/package.json backend/vitest.config.ts
git commit -m "[story-editor-9wk.9] opt-in migration-squash harness: populated pre-9wk baseline -> deploy -> full transform asserted"
git show --stat HEAD   # confirm only the four paths; no .beads files
```

---

### Task 4: SELF_HOSTING.md destructive-migration release note

**Files:**
- Modify: `SELF_HOSTING.md` (the "upgrades" prose around the existing "If the release notes say a migration is destructive…" paragraph, ~line 205)

**Interfaces:**
- Consumes: nothing from other tasks (text-only).
- Produces: the operator-facing release note the spec (§5) requires.

- [ ] **Step 1: Add the note**

Directly after the existing paragraph "If the release notes say a migration is destructive (e.g. dropping a plaintext column after an encryption rollout), take a `scripts/backup-db.sh` snapshot first and keep it until you've verified the new release end-to-end.", insert:

```markdown
> **Upgrade note (chapter drafts):** The first release containing the
> chapter-drafts feature ships a **destructive migration**. It relocates each
> chapter's encrypted body/summary byte-for-byte into the new `Draft` table
> (content is never decrypted — no keys are involved), re-points chats at the
> new draft, and then drops the superseded `Chapter`/`Chat` columns. Take a
> `scripts/backup-db.sh` snapshot before `docker compose pull && docker
> compose up -d`. The migration applies automatically on boot, in one shot;
> rollback is restore-from-backup. After the upgrade every chapter is simply a
> one-draft chapter — users see no change until they create a second draft.
```

- [ ] **Step 2: Verify and commit**

```bash
grep -n "chapter drafts" SELF_HOSTING.md   # expected: the new note
git add SELF_HOSTING.md
git commit -m "[story-editor-9wk.9] SELF_HOSTING: destructive-migration release note for the drafts upgrade"
git show --stat HEAD   # confirm only SELF_HOSTING.md; no .beads files
```

---

## Post-plan notes (controller, not tasks)

- **Verify line** to set on the bd issue before execution:
  `verify: make dev && npm --prefix backend run typecheck && npm -w story-editor-backend run db:test:reset && npm -w story-editor-backend run test && npm -w story-editor-backend run test:migration-squash`
- **Maintainer dev DB, one-time after this lands:** the backend container will crash-loop on boot (`migrate deploy` fails on `CREATE TABLE "Draft"`, and the first failure records the consolidated migration as *failed*). Fix from the **host** while Postgres is up:
  `cd backend && DATABASE_URL=postgresql://storyeditor:storyeditor@localhost:5432/storyeditor npx prisma migrate resolve --applied <STAMP>_drafts`, then restart the backend. (Or `make reset-db` if dev data is disposable.) Adjust the URL to the dev `.env`'s `DATABASE_URL` if it differs.
