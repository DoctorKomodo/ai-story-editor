-- Rename the Message content ciphertext triple.
-- `contentJson*` was a misnomer — the column stores an encrypted plain string,
-- not a JSON payload. `attachmentJson*` and `citationsJson*` keep their suffix
-- (they do carry JSON payloads and the name is accurate).
-- Pre-deployment: no production users / rows exist, but RENAME COLUMN is
-- semantically correct and avoids a destructive DROP + ADD pair.
ALTER TABLE "Message" RENAME COLUMN "contentJsonCiphertext" TO "contentCiphertext";
ALTER TABLE "Message" RENAME COLUMN "contentJsonIv"         TO "contentIv";
ALTER TABLE "Message" RENAME COLUMN "contentJsonAuthTag"    TO "contentAuthTag";
