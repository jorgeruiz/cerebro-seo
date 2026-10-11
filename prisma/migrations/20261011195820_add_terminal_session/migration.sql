-- CreateTable
CREATE TABLE "TerminalSession" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "taskId" TEXT,
    "agentSessionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startedById" TEXT NOT NULL,
    "costUsd" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "log" JSONB,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TerminalSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TerminalSession_planId_status_idx" ON "TerminalSession"("planId", "status");

-- AddForeignKey
ALTER TABLE "TerminalSession" ADD CONSTRAINT "TerminalSession_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MonthlyPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
