-- [cast-ui] Add orderIndex Int column to Character and @@unique([storyId, orderIndex]).
-- The unique constraint is the only reliable guard against the aggregate(_max)+insert
-- race in the POST handler (see the same pattern on Chapter in
-- 20260423000000_add_chapter_outline_order_unique). The constraint also provides
-- the btree index Postgres uses for ORDER BY orderIndex ASC, making a separate
-- non-unique composite index redundant.
--
-- Pre-deployment there are no legacy rows; per CLAUDE.md no data-migration branch
-- is needed.

-- AlterTable: add orderIndex NOT NULL column.
ALTER TABLE "Character" ADD COLUMN "orderIndex" INTEGER NOT NULL DEFAULT 0;

-- Remove the temporary default so future inserts must supply orderIndex explicitly.
ALTER TABLE "Character" ALTER COLUMN "orderIndex" DROP DEFAULT;

-- CreateIndex: unique constraint on (storyId, orderIndex).
CREATE UNIQUE INDEX "Character_storyId_orderIndex_key" ON "Character"("storyId", "orderIndex");
