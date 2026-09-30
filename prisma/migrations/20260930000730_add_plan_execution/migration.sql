-- CreateEnum
CREATE TYPE "PlanExecutionStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "StepExecutionStatus" AS ENUM ('PENDING', 'QUEUED', 'RUNNING', 'APPLIED', 'FAILED', 'HUMAN_TASK');

-- CreateTable
CREATE TABLE "PlanExecution" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" "PlanExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "triggeredBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepExecution" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "changeType" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "StepExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "constructorId" TEXT,
    "constructorCode" TEXT,
    "reviewUrl" TEXT,
    "commitSha" TEXT,
    "error" TEXT,
    "prompt" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "StepExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanExecution_clientId_createdAt_idx" ON "PlanExecution"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "PlanExecution_planId_idx" ON "PlanExecution"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "StepExecution_idempotencyKey_key" ON "StepExecution"("idempotencyKey");

-- CreateIndex
CREATE INDEX "StepExecution_executionId_stepIndex_idx" ON "StepExecution"("executionId", "stepIndex");

-- AddForeignKey
ALTER TABLE "PlanExecution" ADD CONSTRAINT "PlanExecution_planId_fkey" FOREIGN KEY ("planId") REFERENCES "NextStepPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanExecution" ADD CONSTRAINT "PlanExecution_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepExecution" ADD CONSTRAINT "StepExecution_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "PlanExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
