-- S2a: Plan mensual schema + platform detection

-- ══════════════════════════════════════════════════════════════════════════════
-- New enums
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TYPE "SitePlatform" AS ENUM ('NEXTJS', 'WORDPRESS', 'MIGRACION', 'OTRO');
CREATE TYPE "TaskMode" AS ENUM ('AI', 'HYBRID', 'HUMAN');
CREATE TYPE "TaskKind" AS ENUM ('CONTENT', 'CODE');
CREATE TYPE "TaskEffort" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "PlanStepStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'WAITING_HUMAN', 'SKIPPED');

-- ══════════════════════════════════════════════════════════════════════════════
-- Site: add platform
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE "Site" ADD COLUMN "platform" "SitePlatform";
ALTER TABLE "Site" ADD COLUMN "platformDetectedAt" TIMESTAMP(3);

-- ══════════════════════════════════════════════════════════════════════════════
-- MonthlyPlan: update status enum + add fields
-- ══════════════════════════════════════════════════════════════════════════════

-- Replace status enum values (safe: tables are empty or near-empty in dev/prod)
ALTER TYPE "MonthlyPlanStatus" RENAME TO "MonthlyPlanStatus_old";
CREATE TYPE "MonthlyPlanStatus" AS ENUM ('PLANNING', 'ACTIVE', 'IN_REVIEW', 'PUBLISHED');
ALTER TABLE "MonthlyPlan" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "MonthlyPlan" ALTER COLUMN "status" TYPE "MonthlyPlanStatus" USING (
  CASE "status"::text
    WHEN 'DRAFT' THEN 'PLANNING'::"MonthlyPlanStatus"
    WHEN 'RUNNING' THEN 'ACTIVE'::"MonthlyPlanStatus"
    WHEN 'REVIEW' THEN 'IN_REVIEW'::"MonthlyPlanStatus"
    WHEN 'COMPLETED' THEN 'PUBLISHED'::"MonthlyPlanStatus"
  END
);
ALTER TABLE "MonthlyPlan" ALTER COLUMN "status" SET DEFAULT 'PLANNING';
DROP TYPE "MonthlyPlanStatus_old";

ALTER TABLE "MonthlyPlan" ADD COLUMN "cycleId" TEXT;
ALTER TABLE "MonthlyPlan" ADD COLUMN "analysisId" TEXT;
ALTER TABLE "MonthlyPlan" ADD COLUMN "branchName" TEXT;
ALTER TABLE "MonthlyPlan" ADD COLUMN "prNumber" INTEGER;
ALTER TABLE "MonthlyPlan" ADD COLUMN "prUrl" TEXT;
ALTER TABLE "MonthlyPlan" ADD COLUMN "previewUrl" TEXT;
ALTER TABLE "MonthlyPlan" ADD COLUMN "mergedAt" TIMESTAMP(3);
ALTER TABLE "MonthlyPlan" ADD COLUMN "mergedById" TEXT;
ALTER TABLE "MonthlyPlan" ADD COLUMN "completedAt" TIMESTAMP(3);

ALTER TABLE "MonthlyPlan" ADD CONSTRAINT "MonthlyPlan_cycleId_fkey"
  FOREIGN KEY ("cycleId") REFERENCES "MonthlyCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ══════════════════════════════════════════════════════════════════════════════
-- PlanTask: lane → mode, new fields, update status enum
-- ══════════════════════════════════════════════════════════════════════════════

-- Replace status enum
ALTER TYPE "PlanTaskStatus" RENAME TO "PlanTaskStatus_old";
CREATE TYPE "PlanTaskStatus" AS ENUM ('PLANNING', 'READY', 'RUNNING', 'WAITING_HUMAN', 'DONE', 'FAILED', 'VOIDED');
ALTER TABLE "PlanTask" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "PlanTask" ALTER COLUMN "status" TYPE "PlanTaskStatus" USING (
  CASE "status"::text
    WHEN 'PENDING' THEN 'PLANNING'::"PlanTaskStatus"
    WHEN 'QUEUED' THEN 'READY'::"PlanTaskStatus"
    WHEN 'RUNNING' THEN 'RUNNING'::"PlanTaskStatus"
    WHEN 'PREVIEW' THEN 'DONE'::"PlanTaskStatus"
    WHEN 'MERGED' THEN 'DONE'::"PlanTaskStatus"
    WHEN 'FAILED' THEN 'FAILED'::"PlanTaskStatus"
    WHEN 'DISCARDED' THEN 'VOIDED'::"PlanTaskStatus"
  END
);
ALTER TABLE "PlanTask" ALTER COLUMN "status" SET DEFAULT 'PLANNING';
DROP TYPE "PlanTaskStatus_old";

-- Add mode column, migrate from lane, drop lane
ALTER TABLE "PlanTask" ADD COLUMN "mode" "TaskMode";
UPDATE "PlanTask" SET "mode" = CASE
  WHEN "lane"::text = 'AUTO' THEN 'AI'::"TaskMode"
  WHEN "lane"::text = 'ASSISTED' THEN 'HYBRID'::"TaskMode"
  WHEN "lane"::text = 'MANUAL' THEN 'HUMAN'::"TaskMode"
  ELSE 'AI'::"TaskMode"
END;
ALTER TABLE "PlanTask" ALTER COLUMN "mode" SET NOT NULL;
ALTER TABLE "PlanTask" DROP COLUMN "lane";
DROP TYPE "TaskLane";

-- Add new fields
ALTER TABLE "PlanTask" ADD COLUMN "kind" "TaskKind" NOT NULL DEFAULT 'CODE'; -- temp default for existing rows
-- Remove default after backfill
ALTER TABLE "PlanTask" ALTER COLUMN "kind" DROP DEFAULT;
ALTER TABLE "PlanTask" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "PlanTask" ADD COLUMN "effort" "TaskEffort" NOT NULL DEFAULT 'MEDIUM';
ALTER TABLE "PlanTask" ADD COLUMN "sourceCandidateId" TEXT;
ALTER TABLE "PlanTask" ADD COLUMN "commitShas" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "PlanTask" ADD COLUMN "resultUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "PlanTask" ADD COLUMN "voidReason" TEXT;
ALTER TABLE "PlanTask" ADD COLUMN "completedById" TEXT;
ALTER TABLE "PlanTask" ADD COLUMN "completedAt" TIMESTAMP(3);

-- Drop fields that move to MonthlyPlan
ALTER TABLE "PlanTask" DROP COLUMN IF EXISTS "branchName";
ALTER TABLE "PlanTask" DROP COLUMN IF EXISTS "prNumber";
ALTER TABLE "PlanTask" DROP COLUMN IF EXISTS "prUrl";
ALTER TABLE "PlanTask" DROP COLUMN IF EXISTS "previewUrl";

-- ══════════════════════════════════════════════════════════════════════════════
-- PlanStep: new table
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE "PlanStep" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "type" "TaskMode" NOT NULL,
    "prompt" TEXT,
    "acceptanceCriteria" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "PlanStepStatus" NOT NULL DEFAULT 'PENDING',
    "completedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlanStep_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlanStep_taskId_order_idx" ON "PlanStep"("taskId", "order");

ALTER TABLE "PlanStep" ADD CONSTRAINT "PlanStep_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "PlanTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ══════════════════════════════════════════════════════════════════════════════
-- TaskRun: add stepId and changedRoutes
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE "TaskRun" ADD COLUMN "stepId" TEXT;
ALTER TABLE "TaskRun" ADD COLUMN "changedRoutes" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "TaskRun_stepId_idx" ON "TaskRun"("stepId");

ALTER TABLE "TaskRun" ADD CONSTRAINT "TaskRun_stepId_fkey"
  FOREIGN KEY ("stepId") REFERENCES "PlanStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;
