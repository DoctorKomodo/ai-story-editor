-- AlterTable
ALTER TABLE "Chat" ADD COLUMN     "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "Chat_chapterId_lastActivityAt_idx" ON "Chat"("chapterId", "lastActivityAt");
