-- Add fetchStatus and related fields to KeywordRanking
ALTER TABLE "KeywordRanking" ADD COLUMN "fetchStatus" TEXT;
ALTER TABLE "KeywordRanking" ADD COLUMN "fetchError" TEXT;
ALTER TABLE "KeywordRanking" ADD COLUMN "depth" INTEGER;
ALTER TABLE "KeywordRanking" ADD COLUMN "locationCode" INTEGER;
ALTER TABLE "KeywordRanking" ADD COLUMN "checkedAt" TIMESTAMP(3);

-- Index for querying by fetchStatus
CREATE INDEX "KeywordRanking_keywordId_fetchStatus_idx" ON "KeywordRanking"("keywordId", "fetchStatus");

-- DataSourceRun table for health/sources tracking
CREATE TABLE "DataSourceRun" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rows" INTEGER NOT NULL DEFAULT 0,
    "lastDataDate" TIMESTAMP(3),
    "error" TEXT,
    "cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "DataSourceRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DataSourceRun_clientId_source_idx" ON "DataSourceRun"("clientId", "source");
CREATE INDEX "DataSourceRun_source_startedAt_idx" ON "DataSourceRun"("source", "startedAt");

-- Index for JobLog by clientId
CREATE INDEX "JobLog_clientId_jobName_idx" ON "JobLog"("clientId", "jobName");
