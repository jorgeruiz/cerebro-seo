-- CreateTable
CREATE TABLE "CompetitorSnapshot" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "domainRank" INTEGER,
    "totalBacklinks" INTEGER,
    "uniqueDomains" INTEGER,
    "rankedKeywords" INTEGER,
    "estimatedTraffic" INTEGER,
    "shareOfVoicePct" DOUBLE PRECISION,
    "sharedKeywordsCount" INTEGER,
    "gapsCount" INTEGER,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorKeywordGap" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "competitorPosition" INTEGER NOT NULL,
    "searchVolume" INTEGER,
    "keywordDifficulty" INTEGER,
    "intent" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorKeywordGap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompetitorSnapshot_clientId_capturedAt_idx" ON "CompetitorSnapshot"("clientId", "capturedAt");

-- CreateIndex
CREATE INDEX "CompetitorSnapshot_competitorId_capturedAt_idx" ON "CompetitorSnapshot"("competitorId", "capturedAt");

-- CreateIndex
CREATE INDEX "CompetitorKeywordGap_clientId_capturedAt_idx" ON "CompetitorKeywordGap"("clientId", "capturedAt");

-- CreateIndex
CREATE INDEX "CompetitorKeywordGap_competitorId_capturedAt_idx" ON "CompetitorKeywordGap"("competitorId", "capturedAt");

-- CreateIndex
CREATE INDEX "CompetitorKeywordGap_clientId_searchVolume_idx" ON "CompetitorKeywordGap"("clientId", "searchVolume");

-- AddForeignKey
ALTER TABLE "CompetitorSnapshot" ADD CONSTRAINT "CompetitorSnapshot_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorSnapshot" ADD CONSTRAINT "CompetitorSnapshot_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorKeywordGap" ADD CONSTRAINT "CompetitorKeywordGap_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorKeywordGap" ADD CONSTRAINT "CompetitorKeywordGap_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
