-- DropTable (cascade removes StepExecution first)
DROP TABLE IF EXISTS "StepExecution" CASCADE;
DROP TABLE IF EXISTS "PlanExecution" CASCADE;

-- DropEnum
DROP TYPE IF EXISTS "StepExecutionStatus";
DROP TYPE IF EXISTS "PlanExecutionStatus";

-- AlterTable: add repo fields to Site
ALTER TABLE "Site" ADD COLUMN "githubRepo" TEXT;
ALTER TABLE "Site" ADD COLUMN "vercelProjectId" TEXT;
ALTER TABLE "Site" ADD COLUMN "defaultBranch" TEXT NOT NULL DEFAULT 'main';

-- CreateEnum
CREATE TYPE "MonthlyPlanStatus" AS ENUM ('DRAFT', 'REVIEW', 'RUNNING', 'COMPLETED');
CREATE TYPE "TaskLane" AS ENUM ('AUTO', 'ASSISTED', 'MANUAL');
CREATE TYPE "PlanTaskStatus" AS ENUM ('PENDING', 'QUEUED', 'RUNNING', 'PREVIEW', 'MERGED', 'FAILED', 'DISCARDED');
CREATE TYPE "TaskRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
CREATE TYPE "TaskRunKind" AS ENUM ('AUTO', 'TERMINAL');

-- CreateTable
CREATE TABLE "MonthlyPlan" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "status" "MonthlyPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MonthlyPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanTask" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "acceptanceCriteria" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lane" "TaskLane" NOT NULL,
    "category" TEXT NOT NULL,
    "status" "PlanTaskStatus" NOT NULL DEFAULT 'PENDING',
    "branchName" TEXT,
    "prNumber" INTEGER,
    "prUrl" TEXT,
    "previewUrl" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlanTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskRun" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "kind" "TaskRunKind" NOT NULL,
    "status" "TaskRunStatus" NOT NULL DEFAULT 'RUNNING',
    "agentSessionId" TEXT,
    "commitSha" TEXT,
    "buildPassed" BOOLEAN,
    "memoryStatus" JSONB,
    "costUsd" DECIMAL(10,6),
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "error" TEXT,
    "logTail" TEXT,
    "triggeredById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "TaskRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyPlan_clientId_month_key" ON "MonthlyPlan"("clientId", "month");
CREATE INDEX "MonthlyPlan_clientId_month_idx" ON "MonthlyPlan"("clientId", "month");
CREATE INDEX "PlanTask_planId_order_idx" ON "PlanTask"("planId", "order");
CREATE INDEX "PlanTask_siteId_idx" ON "PlanTask"("siteId");
CREATE INDEX "TaskRun_taskId_startedAt_idx" ON "TaskRun"("taskId", "startedAt");

-- AddForeignKey
ALTER TABLE "MonthlyPlan" ADD CONSTRAINT "MonthlyPlan_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlanTask" ADD CONSTRAINT "PlanTask_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MonthlyPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlanTask" ADD CONSTRAINT "PlanTask_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaskRun" ADD CONSTRAINT "TaskRun_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "PlanTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
