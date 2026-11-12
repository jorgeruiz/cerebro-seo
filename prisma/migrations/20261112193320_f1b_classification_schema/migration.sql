-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PlanTaskStatus" ADD VALUE 'NEEDS_DEFINITION';
ALTER TYPE "PlanTaskStatus" ADD VALUE 'NEEDS_INPUT';
ALTER TYPE "PlanTaskStatus" ADD VALUE 'BLOCKED';

-- AlterTable
ALTER TABLE "PlanTask" ADD COLUMN     "blockedReason" TEXT,
ADD COLUMN     "classificationConfidence" DOUBLE PRECISION,
ADD COLUMN     "classificationMeta" JSONB,
ADD COLUMN     "remedy" TEXT;

-- CreateTable
CREATE TABLE "ClassificationEvent" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "originalType" TEXT,
    "finalType" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClassificationEvent_taskId_idx" ON "ClassificationEvent"("taskId");

-- AddForeignKey
ALTER TABLE "ClassificationEvent" ADD CONSTRAINT "ClassificationEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "PlanTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
