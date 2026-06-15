-- CreateTable
CREATE TABLE "NextStepPlan" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cost" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "triggeredBy" TEXT,

    CONSTRAINT "NextStepPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NextStepPlan_clientId_generatedAt_idx" ON "NextStepPlan"("clientId", "generatedAt");

-- AddForeignKey
ALTER TABLE "NextStepPlan" ADD CONSTRAINT "NextStepPlan_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
