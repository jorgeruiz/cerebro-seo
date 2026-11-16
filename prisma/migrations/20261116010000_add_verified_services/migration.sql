-- AlterTable
ALTER TABLE "Client" ADD COLUMN "verifiedServices" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Client" ADD COLUMN "excludedServices" TEXT[] DEFAULT ARRAY[]::TEXT[];
