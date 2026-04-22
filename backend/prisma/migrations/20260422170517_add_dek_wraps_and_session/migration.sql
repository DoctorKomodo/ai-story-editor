-- AlterTable
ALTER TABLE "User" ADD COLUMN     "contentDekPasswordAuthTag" TEXT,
ADD COLUMN     "contentDekPasswordEnc" TEXT,
ADD COLUMN     "contentDekPasswordIv" TEXT,
ADD COLUMN     "contentDekPasswordSalt" TEXT,
ADD COLUMN     "contentDekRecoveryAuthTag" TEXT,
ADD COLUMN     "contentDekRecoveryEnc" TEXT,
ADD COLUMN     "contentDekRecoveryIv" TEXT,
ADD COLUMN     "contentDekRecoverySalt" TEXT;

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
