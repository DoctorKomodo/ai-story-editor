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
