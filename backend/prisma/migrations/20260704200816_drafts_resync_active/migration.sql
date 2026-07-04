-- [9wk.4] Dev-only re-sync: since 9wk.3, body/summary edits updated
-- Chapter.* only, so a chapter's ACTIVE draft can be stale. Before chapter
-- reads flip to the active draft (this step), copy the chapter's ciphertext
-- verbatim onto its active draft wherever the chapter row is newer.
-- Idempotent: the copied updatedAt equals the chapter's, so a second run
-- matches no rows. Fresh DBs and prod (squashed step-9 migration) no-op.
UPDATE "Draft" d
SET "bodyCiphertext"        = c."bodyCiphertext",
    "bodyIv"                = c."bodyIv",
    "bodyAuthTag"           = c."bodyAuthTag",
    "summaryJsonCiphertext" = c."summaryJsonCiphertext",
    "summaryJsonIv"         = c."summaryJsonIv",
    "summaryJsonAuthTag"    = c."summaryJsonAuthTag",
    "summaryJsonUpdatedAt"  = c."summaryJsonUpdatedAt",
    "wordCount"             = c."wordCount",
    "updatedAt"             = c."updatedAt"
FROM "Chapter" c
WHERE c."activeDraftId" = d."id"
  AND c."updatedAt" > d."updatedAt";
