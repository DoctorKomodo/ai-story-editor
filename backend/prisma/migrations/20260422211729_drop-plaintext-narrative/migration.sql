/*
  Warnings:

  - You are about to drop the column `bodyJson` on the `Chapter` table. All the data in the column will be lost.
  - You are about to drop the column `content` on the `Chapter` table. All the data in the column will be lost.
  - You are about to drop the column `title` on the `Chapter` table. All the data in the column will be lost.
  - You are about to drop the column `age` on the `Character` table. All the data in the column will be lost.
  - You are about to drop the column `appearance` on the `Character` table. All the data in the column will be lost.
  - You are about to drop the column `arc` on the `Character` table. All the data in the column will be lost.
  - You are about to drop the column `backstory` on the `Character` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `Character` table. All the data in the column will be lost.
  - You are about to drop the column `notes` on the `Character` table. All the data in the column will be lost.
  - You are about to drop the column `personality` on the `Character` table. All the data in the column will be lost.
  - You are about to drop the column `physicalDescription` on the `Character` table. All the data in the column will be lost.
  - You are about to drop the column `role` on the `Character` table. All the data in the column will be lost.
  - You are about to drop the column `voice` on the `Character` table. All the data in the column will be lost.
  - You are about to drop the column `title` on the `Chat` table. All the data in the column will be lost.
  - You are about to drop the column `attachmentJson` on the `Message` table. All the data in the column will be lost.
  - You are about to drop the column `contentJson` on the `Message` table. All the data in the column will be lost.
  - You are about to drop the column `sub` on the `OutlineItem` table. All the data in the column will be lost.
  - You are about to drop the column `title` on the `OutlineItem` table. All the data in the column will be lost.
  - You are about to drop the column `synopsis` on the `Story` table. All the data in the column will be lost.
  - You are about to drop the column `systemPrompt` on the `Story` table. All the data in the column will be lost.
  - You are about to drop the column `title` on the `Story` table. All the data in the column will be lost.
  - You are about to drop the column `worldNotes` on the `Story` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Chapter" DROP COLUMN "bodyJson",
DROP COLUMN "content",
DROP COLUMN "title";

-- AlterTable
ALTER TABLE "Character" DROP COLUMN "age",
DROP COLUMN "appearance",
DROP COLUMN "arc",
DROP COLUMN "backstory",
DROP COLUMN "name",
DROP COLUMN "notes",
DROP COLUMN "personality",
DROP COLUMN "physicalDescription",
DROP COLUMN "role",
DROP COLUMN "voice";

-- AlterTable
ALTER TABLE "Chat" DROP COLUMN "title";

-- AlterTable
ALTER TABLE "Message" DROP COLUMN "attachmentJson",
DROP COLUMN "contentJson";

-- AlterTable
ALTER TABLE "OutlineItem" DROP COLUMN "sub",
DROP COLUMN "title";

-- AlterTable
ALTER TABLE "Story" DROP COLUMN "synopsis",
DROP COLUMN "systemPrompt",
DROP COLUMN "title",
DROP COLUMN "worldNotes";
