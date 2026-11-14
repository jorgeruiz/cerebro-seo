-- CreateEnum
CREATE TYPE "PackageStatus" AS ENUM ('PENDING', 'INSTALLING', 'INSTALLED', 'FAILED', 'ROLLBACK');

-- CreateTable
CREATE TABLE "SitePackage" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1',
    "status" "PackageStatus" NOT NULL DEFAULT 'PENDING',
    "installedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "installedBy" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SitePackage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SitePackage_siteId_idx" ON "SitePackage"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "SitePackage_siteId_packageId_key" ON "SitePackage"("siteId", "packageId");

-- AddForeignKey
ALTER TABLE "SitePackage" ADD CONSTRAINT "SitePackage_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
