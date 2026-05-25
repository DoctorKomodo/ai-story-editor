-- AlterTable
ALTER TABLE "Chapter" ADD COLUMN     "summaryJsonAuthTag" TEXT,
ADD COLUMN     "summaryJsonCiphertext" TEXT,
ADD COLUMN     "summaryJsonIv" TEXT,
ADD COLUMN     "summaryJsonUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Story" ADD COLUMN     "includePreviousChaptersInPrompt" BOOLEAN NOT NULL DEFAULT true;
