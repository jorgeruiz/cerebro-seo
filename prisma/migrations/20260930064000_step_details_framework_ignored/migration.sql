-- AlterEnum: add IGNORED to StepExecutionStatus
ALTER TYPE "StepExecutionStatus" ADD VALUE 'IGNORED';

-- AlterTable: add yearMonth to PlanExecution
ALTER TABLE "PlanExecution" ADD COLUMN "yearMonth" TEXT NOT NULL DEFAULT '';

-- AlterTable: add resultUrl, detailedSteps to StepExecution
ALTER TABLE "StepExecution" ADD COLUMN "resultUrl" TEXT;
ALTER TABLE "StepExecution" ADD COLUMN "detailedSteps" JSONB;

-- AlterTable: add framework to Site
ALTER TABLE "Site" ADD COLUMN "framework" TEXT;

-- CreateIndex
CREATE INDEX "PlanExecution_clientId_yearMonth_idx" ON "PlanExecution"("clientId", "yearMonth");
