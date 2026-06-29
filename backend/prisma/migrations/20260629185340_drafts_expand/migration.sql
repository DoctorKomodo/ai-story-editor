-- AlterTable
ALTER TABLE "Chapter" DROP COLUMN "status",
ADD COLUMN     "activeDraftId" TEXT;

-- AlterTable
ALTER TABLE "Chat" ADD COLUMN     "draftId" TEXT;

-- CreateTable
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

-- CreateIndex
CREATE INDEX "Draft_chapterId_idx" ON "Draft"("chapterId");

-- CreateIndex
CREATE UNIQUE INDEX "Draft_chapterId_orderIndex_key" ON "Draft"("chapterId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Chapter_activeDraftId_key" ON "Chapter"("activeDraftId");

-- AddForeignKey
ALTER TABLE "Chapter" ADD CONSTRAINT "Chapter_activeDraftId_fkey" FOREIGN KEY ("activeDraftId") REFERENCES "Draft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- [9wk.2] EXPAND backfill (decrypt-free): one Draft per existing Chapter,
-- ciphertext copied byte-for-byte (same user, same DEK — no decryption).
-- Idempotent: NOT EXISTS / IS NULL guards make re-runs and test reuse safe.
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

-- Re-point each chat at its chapter's backfilled draft (chapterId stays until step 3).
UPDATE "Chat" ch
SET "draftId" = d."id"
FROM "Draft" d
WHERE d."chapterId" = ch."chapterId" AND ch."draftId" IS NULL;
