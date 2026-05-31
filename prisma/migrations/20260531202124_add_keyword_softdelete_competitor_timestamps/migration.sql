-- AlterTable
ALTER TABLE "Competitor" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Keyword" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Keyword_clientId_isPriority_idx" ON "Keyword"("clientId", "isPriority");

-- CreateIndex
CREATE INDEX "Keyword_clientId_deletedAt_idx" ON "Keyword"("clientId", "deletedAt");
