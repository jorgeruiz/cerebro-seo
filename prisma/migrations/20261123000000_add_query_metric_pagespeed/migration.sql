-- QueryMetric: GSC per-query data
CREATE TABLE "QueryMetric" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "page" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION,
    "position" DOUBLE PRECISION,

    CONSTRAINT "QueryMetric_pkey" PRIMARY KEY ("id")
);

-- PageSpeedMetric: PSI scores
CREATE TABLE "PageSpeedMetric" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "device" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "score" DOUBLE PRECISION,
    "lcp" DOUBLE PRECISION,
    "inp" DOUBLE PRECISION,
    "cls" DOUBLE PRECISION,
    "fcp" DOUBLE PRECISION,
    "ttfb" DOUBLE PRECISION,
    "fieldData" JSONB,

    CONSTRAINT "PageSpeedMetric_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "QueryMetric_siteId_query_page_date_key" ON "QueryMetric"("siteId", "query", "page", "date");
CREATE INDEX "QueryMetric_siteId_date_idx" ON "QueryMetric"("siteId", "date");
CREATE INDEX "QueryMetric_siteId_query_idx" ON "QueryMetric"("siteId", "query");

CREATE UNIQUE INDEX "PageSpeedMetric_siteId_url_device_date_key" ON "PageSpeedMetric"("siteId", "url", "device", "date");
CREATE INDEX "PageSpeedMetric_siteId_date_idx" ON "PageSpeedMetric"("siteId", "date");

-- Foreign keys
ALTER TABLE "QueryMetric" ADD CONSTRAINT "QueryMetric_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PageSpeedMetric" ADD CONSTRAINT "PageSpeedMetric_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
