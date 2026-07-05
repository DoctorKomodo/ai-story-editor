/*
  Warnings:

  - You are about to drop the column `bodyAuthTag` on the `Chapter` table. All the data in the column will be lost.
  - You are about to drop the column `bodyCiphertext` on the `Chapter` table. All the data in the column will be lost.
  - You are about to drop the column `bodyIv` on the `Chapter` table. All the data in the column will be lost.
  - You are about to drop the column `summaryJsonAuthTag` on the `Chapter` table. All the data in the column will be lost.
  - You are about to drop the column `summaryJsonCiphertext` on the `Chapter` table. All the data in the column will be lost.
  - You are about to drop the column `summaryJsonIv` on the `Chapter` table. All the data in the column will be lost.
  - You are about to drop the column `summaryJsonUpdatedAt` on the `Chapter` table. All the data in the column will be lost.
  - You are about to drop the column `wordCount` on the `Chapter` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Chapter" DROP COLUMN "bodyAuthTag",
DROP COLUMN "bodyCiphertext",
DROP COLUMN "bodyIv",
DROP COLUMN "summaryJsonAuthTag",
DROP COLUMN "summaryJsonCiphertext",
DROP COLUMN "summaryJsonIv",
DROP COLUMN "summaryJsonUpdatedAt",
DROP COLUMN "wordCount";
