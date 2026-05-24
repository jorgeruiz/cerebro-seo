-- AlterTable
ALTER TABLE "Audit" ADD COLUMN     "accessibilityScore" INTEGER,
ADD COLUMN     "brokenPages" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "error" TEXT,
ADD COLUMN     "pagesIndexable" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "redirectPages" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "seoScore" INTEGER,
ADD COLUMN     "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'completed',
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'complete',
ALTER COLUMN "scoreOverall" SET DEFAULT 0,
ALTER COLUMN "scoreTechnical" SET DEFAULT 0,
ALTER COLUMN "scorePerformance" SET DEFAULT 0,
ALTER COLUMN "scoreContent" SET DEFAULT 0,
ALTER COLUMN "issues" SET DEFAULT '[]',
ALTER COLUMN "pagesCrawled" SET DEFAULT 0;

-- CreateTable
CREATE TABLE "AuditIssue" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "affectedUrl" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "data" JSONB,

    CONSTRAINT "AuditIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditIssue_auditId_severity_idx" ON "AuditIssue"("auditId", "severity");

-- CreateIndex
CREATE INDEX "Audit_clientId_date_idx" ON "Audit"("clientId", "date");

-- CreateIndex
CREATE INDEX "Audit_siteId_date_idx" ON "Audit"("siteId", "date");

-- AddForeignKey
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditIssue" ADD CONSTRAINT "AuditIssue_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
