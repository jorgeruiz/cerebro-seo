-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "services" TEXT[] DEFAULT ARRAY[]::TEXT[];
