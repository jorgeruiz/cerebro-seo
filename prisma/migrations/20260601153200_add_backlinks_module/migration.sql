/*
  Warnings:

  - A unique constraint covering the columns `[clientId,sourceUrl,targetUrl]` on the table `Backlink` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `clientId` to the `Backlink` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Backlink` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Backlink" DROP CONSTRAINT "Backlink_siteId_fkey";

-- AlterTable
ALTER TABLE "Backlink" ADD COLUMN     "clientId" TEXT NOT NULL,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "lostAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "siteId" DROP NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "BacklinkSnapshot" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "totalBacklinks" INTEGER NOT NULL,
    "uniqueDomains" INTEGER NOT NULL,
    "avgDomainRank" DOUBLE PRECISION,
    "dofollowCount" INTEGER NOT NULL,
    "nofollowCount" INTEGER NOT NULL,
    "gainedThisWeek" INTEGER NOT NULL DEFAULT 0,
    "lostThisWeek" INTEGER NOT NULL DEFAULT 0,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BacklinkSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BacklinkSnapshot_clientId_capturedAt_idx" ON "BacklinkSnapshot"("clientId", "capturedAt");

-- CreateIndex
CREATE INDEX "Backlink_clientId_status_idx" ON "Backlink"("clientId", "status");

-- CreateIndex
CREATE INDEX "Backlink_clientId_sourceDomain_idx" ON "Backlink"("clientId", "sourceDomain");

-- CreateIndex
CREATE INDEX "Backlink_clientId_firstSeen_idx" ON "Backlink"("clientId", "firstSeen");

-- CreateIndex
CREATE UNIQUE INDEX "Backlink_clientId_sourceUrl_targetUrl_key" ON "Backlink"("clientId", "sourceUrl", "targetUrl");

-- AddForeignKey
ALTER TABLE "Backlink" ADD CONSTRAINT "Backlink_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Backlink" ADD CONSTRAINT "Backlink_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BacklinkSnapshot" ADD CONSTRAINT "BacklinkSnapshot_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
