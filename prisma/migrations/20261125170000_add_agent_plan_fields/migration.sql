-- MonthlyPlan: agent source fields
ALTER TABLE "MonthlyPlan" ADD COLUMN "source" TEXT;
ALTER TABLE "MonthlyPlan" ADD COLUMN "focus" TEXT;
ALTER TABLE "MonthlyPlan" ADD COLUMN "summary" TEXT;

-- PlanTask: agent action fields
ALTER TABLE "PlanTask" ADD COLUMN "assignee" TEXT;
ALTER TABLE "PlanTask" ADD COLUMN "requiresApproval" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PlanTask" ADD COLUMN "dataSource" TEXT;
ALTER TABLE "PlanTask" ADD COLUMN "statusNote" TEXT;
ALTER TABLE "PlanTask" ADD COLUMN "statusChangedBy" TEXT;
ALTER TABLE "PlanTask" ADD COLUMN "statusChangedAt" TIMESTAMP(3);
