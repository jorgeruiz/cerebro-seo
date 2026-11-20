-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DENIED');

-- CreateTable
CREATE TABLE "ClaimCheck" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "taskId" TEXT,
    "url" TEXT,
    "claim" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'PENDING',
    "notionTaskId" TEXT,
    "notionTaskUrl" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClaimCheck_clientId_status_idx" ON "ClaimCheck"("clientId", "status");
CREATE INDEX "ClaimCheck_taskId_idx" ON "ClaimCheck"("taskId");

-- AddForeignKey
ALTER TABLE "ClaimCheck" ADD CONSTRAINT "ClaimCheck_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
