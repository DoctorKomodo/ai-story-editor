-- AlterTable
ALTER TABLE "Chat" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'ask';

-- CreateIndex
CREATE INDEX "Chat_chapterId_kind_idx" ON "Chat"("chapterId", "kind");
