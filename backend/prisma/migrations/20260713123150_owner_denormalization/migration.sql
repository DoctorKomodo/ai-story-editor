-- [story-editor-35u] Owner denormalization. Every narrative table gains a
-- direct `userId` FK to `User`, collapsing the transitive ownership chain
-- (message -> chat -> draft -> chapter -> story -> userId) to a flat
-- `{ id, userId }` scope. See
-- docs/superpowers/plans/2026-07-06-owner-denormalization.md.
--
-- Sequence: add each column NULLable -> backfill direct-to-Story (join
-- straight to the root, order-independent, no reliance on a sibling table's
-- freshly-populated userId) -> SET NOT NULL (provably safe: every chain FK
-- up every path is already NOT NULL, so no narrative row can be orphaned) ->
-- FK + index -> a terminal self-check that raises if any hop in the
-- (now fully denormalized) chain disagrees with its parent.
--
-- DESTRUCTIVE in the sense that it touches every row of six populated
-- tables (Chapter, Character, OutlineItem, Draft, Chat, Message) in one
-- transaction. Operators take a scripts/backup-db.sh snapshot before
-- upgrading (SELF_HOSTING.md); rollback is restore-from-backup.

-- 1. Add the column, nullable, to every narrative table.
ALTER TABLE "Chapter" ADD COLUMN "userId" TEXT;
ALTER TABLE "Character" ADD COLUMN "userId" TEXT;
ALTER TABLE "OutlineItem" ADD COLUMN "userId" TEXT;
ALTER TABLE "Draft" ADD COLUMN "userId" TEXT;
ALTER TABLE "Chat" ADD COLUMN "userId" TEXT;
ALTER TABLE "Message" ADD COLUMN "userId" TEXT;

-- 2. Backfill, direct-to-Story. Each join walks straight from the table's
-- own FK chain to Story.userId — no table relies on another narrative
-- table's userId having been populated first.
UPDATE "Chapter" c
SET "userId" = s."userId"
FROM "Story" s
WHERE s."id" = c."storyId";

UPDATE "Character" ch
SET "userId" = s."userId"
FROM "Story" s
WHERE s."id" = ch."storyId";

UPDATE "OutlineItem" o
SET "userId" = s."userId"
FROM "Story" s
WHERE s."id" = o."storyId";

UPDATE "Draft" d
SET "userId" = s."userId"
FROM "Chapter" c
JOIN "Story" s ON s."id" = c."storyId"
WHERE c."id" = d."chapterId";

UPDATE "Chat" ch
SET "userId" = s."userId"
FROM "Draft" d
JOIN "Chapter" c ON c."id" = d."chapterId"
JOIN "Story" s ON s."id" = c."storyId"
WHERE d."id" = ch."draftId";

UPDATE "Message" m
SET "userId" = s."userId"
FROM "Chat" ch
JOIN "Draft" d ON d."id" = ch."draftId"
JOIN "Chapter" c ON c."id" = d."chapterId"
JOIN "Story" s ON s."id" = c."storyId"
WHERE ch."id" = m."chatId";

-- 3. Every chain FK up every path is NOT NULL (Chapter.storyId,
-- Character.storyId, OutlineItem.storyId, Draft.chapterId, Chat.draftId,
-- Message.chatId, Story.userId), so step 2 left no row NULL. SET NOT NULL
-- is safe.
ALTER TABLE "Chapter" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "Character" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "OutlineItem" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "Draft" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "Chat" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "Message" ALTER COLUMN "userId" SET NOT NULL;

-- 4. Indexes (Prisma-conventional names).
CREATE INDEX "Chapter_userId_idx" ON "Chapter"("userId");
CREATE INDEX "Character_userId_idx" ON "Character"("userId");
CREATE INDEX "OutlineItem_userId_idx" ON "OutlineItem"("userId");
CREATE INDEX "Draft_userId_idx" ON "Draft"("userId");
CREATE INDEX "Chat_userId_idx" ON "Chat"("userId");
CREATE INDEX "Message_userId_idx" ON "Message"("userId");

-- 5. Foreign keys (Prisma-conventional names).
ALTER TABLE "Chapter" ADD CONSTRAINT "Chapter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Character" ADD CONSTRAINT "Character_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OutlineItem" ADD CONSTRAINT "OutlineItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 6. Self-check: every hop of the now-denormalized chain must agree with
-- its direct parent's userId. Belt-and-suspenders — the direct-to-Story
-- joins above make a mismatch structurally impossible on well-formed data,
-- but a mismatch here means a bug in this migration, not the data, and
-- must abort the transaction rather than silently ship inconsistent rows.
DO $$
DECLARE
  mismatches INTEGER;
BEGIN
  SELECT count(*) INTO mismatches
  FROM "Chapter" c JOIN "Story" s ON s."id" = c."storyId"
  WHERE c."userId" != s."userId";
  IF mismatches > 0 THEN
    RAISE EXCEPTION 'owner_denormalization: % Chapter row(s) disagree with their Story''s userId', mismatches;
  END IF;

  SELECT count(*) INTO mismatches
  FROM "Character" ch JOIN "Story" s ON s."id" = ch."storyId"
  WHERE ch."userId" != s."userId";
  IF mismatches > 0 THEN
    RAISE EXCEPTION 'owner_denormalization: % Character row(s) disagree with their Story''s userId', mismatches;
  END IF;

  SELECT count(*) INTO mismatches
  FROM "OutlineItem" o JOIN "Story" s ON s."id" = o."storyId"
  WHERE o."userId" != s."userId";
  IF mismatches > 0 THEN
    RAISE EXCEPTION 'owner_denormalization: % OutlineItem row(s) disagree with their Story''s userId', mismatches;
  END IF;

  SELECT count(*) INTO mismatches
  FROM "Draft" d JOIN "Chapter" c ON c."id" = d."chapterId"
  WHERE d."userId" != c."userId";
  IF mismatches > 0 THEN
    RAISE EXCEPTION 'owner_denormalization: % Draft row(s) disagree with their Chapter''s userId', mismatches;
  END IF;

  SELECT count(*) INTO mismatches
  FROM "Chat" ch JOIN "Draft" d ON d."id" = ch."draftId"
  WHERE ch."userId" != d."userId";
  IF mismatches > 0 THEN
    RAISE EXCEPTION 'owner_denormalization: % Chat row(s) disagree with their Draft''s userId', mismatches;
  END IF;

  SELECT count(*) INTO mismatches
  FROM "Message" m JOIN "Chat" ch ON ch."id" = m."chatId"
  WHERE m."userId" != ch."userId";
  IF mismatches > 0 THEN
    RAISE EXCEPTION 'owner_denormalization: % Message row(s) disagree with their Chat''s userId', mismatches;
  END IF;
END $$;
