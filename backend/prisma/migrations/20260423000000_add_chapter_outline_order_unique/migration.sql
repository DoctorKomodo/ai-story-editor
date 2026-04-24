-- [D16] Add @@unique([storyId, orderIndex]) on Chapter and @@unique([storyId, order])
-- on OutlineItem. These are the only reliable guard against the aggregate(_max)+insert
-- race in the POST handlers (see backend/src/routes/chapters.routes.ts and
-- outline.routes.ts). The unique constraint creates a btree index Postgres uses
-- for ORDER BY on the same columns, so the pre-existing non-unique composite
-- indexes become redundant and are dropped.
--
-- Pre-deployment there is no legacy data to back up or deduplicate; per CLAUDE.md
-- the migration-handling rule is deferred under [X10], so this file makes no
-- attempt to clean up duplicate rows before adding the constraint.

-- Chapter: drop the redundant non-unique index, add the unique constraint.
DROP INDEX "Chapter_storyId_orderIndex_idx";
CREATE UNIQUE INDEX "Chapter_storyId_orderIndex_key" ON "Chapter"("storyId", "orderIndex");

-- OutlineItem: same pattern.
DROP INDEX "OutlineItem_storyId_order_idx";
CREATE UNIQUE INDEX "OutlineItem_storyId_order_key" ON "OutlineItem"("storyId", "order");
