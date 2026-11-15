-- CreateIndex
CREATE UNIQUE INDEX "PageMetric_siteId_url_date_source_key" ON "PageMetric"("siteId", "url", "date", "source");
