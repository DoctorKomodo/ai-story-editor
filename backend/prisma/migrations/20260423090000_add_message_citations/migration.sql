-- [V26] Add encrypted-at-rest citations columns on Message.
--
-- Triples wrap the AES-256-GCM ciphertext of a serialised `Citation[]` JSON
-- payload produced by backend/src/lib/venice-citations.ts. Only populated on
-- assistant turns where Venice web search returned ≥1 valid citation;
-- otherwise all three columns are NULL (full-null triple → repo layer decodes
-- to `citationsJson: null` on read, matching the null-vs-empty semantics
-- described in docs/venice-integration.md § Citations).
--
-- No data migration, no dual-write, no backfill: pre-deployment there are no
-- existing rows to populate, consistent with CLAUDE.md's "migration handling
-- is deferred" rule. No index — citations are read only when a message is
-- read (via the chatId + createdAt index) and never a filter target.

ALTER TABLE "Message"
  ADD COLUMN "citationsJsonCiphertext" TEXT,
  ADD COLUMN "citationsJsonIv" TEXT,
  ADD COLUMN "citationsJsonAuthTag" TEXT;
