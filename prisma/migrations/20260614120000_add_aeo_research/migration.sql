-- CreateTable AeoResearch
CREATE TABLE "AeoResearch" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "seeds" TEXT[],
    "clusters" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cost" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "questionCount" INTEGER NOT NULL DEFAULT 0,
    "triggeredBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AeoResearch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AeoResearch_clientId_createdAt_idx" ON "AeoResearch"("clientId", "createdAt");

-- AddForeignKey
ALTER TABLE "AeoResearch" ADD CONSTRAINT "AeoResearch_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
