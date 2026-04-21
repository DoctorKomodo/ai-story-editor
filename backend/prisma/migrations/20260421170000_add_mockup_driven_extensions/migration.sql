-- Mockup-driven schema extensions covering D9–D16 (TASKS.md).
-- Additive only — no column drops. `User.username` becomes the new primary
-- login identifier; `User.email` is relaxed to nullable metadata. Existing
-- rows (if any) get a username backfilled from the local-part of their email
-- with a numeric suffix to break collisions.

-- AlterTable: Story adds targetWords + systemPrompt
ALTER TABLE "Story"
    ADD COLUMN "targetWords"  INTEGER,
    ADD COLUMN "systemPrompt" TEXT;

-- AlterTable: Chapter adds bodyJson + status (default "draft")
ALTER TABLE "Chapter"
    ADD COLUMN "bodyJson" JSONB,
    ADD COLUMN "status"   TEXT NOT NULL DEFAULT 'draft';

-- AlterTable: Character adds mockup-card fields
ALTER TABLE "Character"
    ADD COLUMN "age"        TEXT,
    ADD COLUMN "appearance" TEXT,
    ADD COLUMN "voice"      TEXT,
    ADD COLUMN "arc"        TEXT,
    ADD COLUMN "initial"    TEXT,
    ADD COLUMN "color"      TEXT;

-- AlterTable: User adds name, settings, BYOK Venice columns, username.
-- Username is added nullable first so we can backfill, then made NOT NULL.
ALTER TABLE "User"
    ADD COLUMN "name"                TEXT,
    ADD COLUMN "settingsJson"        JSONB,
    ADD COLUMN "username"            TEXT,
    ADD COLUMN "veniceApiKeyEnc"     TEXT,
    ADD COLUMN "veniceApiKeyIv"      TEXT,
    ADD COLUMN "veniceApiKeyAuthTag" TEXT,
    ADD COLUMN "veniceEndpoint"      TEXT;

-- Backfill username from the local-part of email.
-- Non-alphanumeric / non-[-_] characters are stripped so the value matches
-- the /^[a-z0-9_-]{3,32}$/ shape the app will enforce. Collisions are resolved
-- with a numeric suffix via ROW_NUMBER() over the candidate key.
WITH normalized AS (
    SELECT
        "id",
        REGEXP_REPLACE(
            LOWER(SPLIT_PART(COALESCE("email", ''), '@', 1)),
            '[^a-z0-9_-]',
            '',
            'g'
        ) AS candidate
    FROM "User"
),
padded AS (
    SELECT
        "id",
        CASE
            WHEN LENGTH(candidate) >= 3 THEN candidate
            WHEN LENGTH(candidate) = 0  THEN 'user'
            ELSE candidate || 'user'
        END AS candidate
    FROM normalized
),
ranked AS (
    SELECT
        "id",
        candidate,
        ROW_NUMBER() OVER (PARTITION BY candidate ORDER BY "id") AS rn
    FROM padded
)
UPDATE "User" AS u
SET "username" = CASE
        WHEN r.rn = 1 THEN r.candidate
        ELSE r.candidate || (r.rn - 1)::text
    END
FROM ranked r
WHERE u."id" = r."id";

-- Now enforce NOT NULL on username and relax email to nullable.
ALTER TABLE "User"
    ALTER COLUMN "username" SET NOT NULL,
    ALTER COLUMN "email"    DROP NOT NULL;

-- Unique index on username (lowercase + constrained character set is
-- enforced in the application layer; storage is case-sensitive unique).
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateTable: OutlineItem
CREATE TABLE "OutlineItem" (
    "id"        TEXT NOT NULL,
    "order"     INTEGER NOT NULL,
    "title"     TEXT NOT NULL,
    "sub"       TEXT,
    "status"    TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "storyId"   TEXT NOT NULL,

    CONSTRAINT "OutlineItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OutlineItem_storyId_idx"       ON "OutlineItem"("storyId");
CREATE INDEX "OutlineItem_storyId_order_idx" ON "OutlineItem"("storyId", "order");

ALTER TABLE "OutlineItem"
    ADD CONSTRAINT "OutlineItem_storyId_fkey"
        FOREIGN KEY ("storyId") REFERENCES "Story"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: Chat
CREATE TABLE "Chat" (
    "id"        TEXT NOT NULL,
    "title"     TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "chapterId" TEXT NOT NULL,

    CONSTRAINT "Chat_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Chat_chapterId_idx" ON "Chat"("chapterId");

ALTER TABLE "Chat"
    ADD CONSTRAINT "Chat_chapterId_fkey"
        FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: Message
CREATE TABLE "Message" (
    "id"             TEXT NOT NULL,
    "role"           TEXT NOT NULL,
    "contentJson"    JSONB NOT NULL,
    "attachmentJson" JSONB,
    "model"          TEXT,
    "tokens"         INTEGER,
    "latencyMs"      INTEGER,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chatId"         TEXT NOT NULL,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Message_chatId_idx"           ON "Message"("chatId");
CREATE INDEX "Message_chatId_createdAt_idx" ON "Message"("chatId", "createdAt");

ALTER TABLE "Message"
    ADD CONSTRAINT "Message_chatId_fkey"
        FOREIGN KEY ("chatId") REFERENCES "Chat"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
