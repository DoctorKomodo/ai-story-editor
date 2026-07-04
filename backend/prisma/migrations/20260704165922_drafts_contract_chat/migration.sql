-- [9wk.3] Contract-phase re-backfill: cover rows created between the expand
-- migration and this one (dev DBs only — chapter-create mints drafts and
-- chat-create dual-writes draftId since 9wk.3, but rows from before those
-- code paths landed may exist). Same statements as the expand backfill.
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

UPDATE "Chapter" c
SET "activeDraftId" = d."id"
FROM "Draft" d
WHERE d."chapterId" = c."id" AND c."activeDraftId" IS NULL;

UPDATE "Chat" ch
SET "draftId" = d."id"
FROM "Draft" d, "Chapter" c
WHERE ch."chapterId" = c."id" AND d."chapterId" = c."id" AND ch."draftId" IS NULL;

/*
  Warnings:

  - You are about to drop the column `chapterId` on the `Chat` table. All the data in the column will be lost.
  - Made the column `draftId` on table `Chat` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "Chat" DROP CONSTRAINT "Chat_chapterId_fkey";

-- DropIndex
DROP INDEX "Chat_chapterId_idx";

-- DropIndex
DROP INDEX "Chat_chapterId_kind_idx";

-- DropIndex
DROP INDEX "Chat_chapterId_lastActivityAt_idx";

-- AlterTable
ALTER TABLE "Chat" DROP COLUMN "chapterId",
ALTER COLUMN "draftId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Chat_draftId_idx" ON "Chat"("draftId");

-- CreateIndex
CREATE INDEX "Chat_draftId_kind_idx" ON "Chat"("draftId", "kind");

-- CreateIndex
CREATE INDEX "Chat_draftId_lastActivityAt_idx" ON "Chat"("draftId", "lastActivityAt");
