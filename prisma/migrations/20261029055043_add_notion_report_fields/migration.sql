-- AlterTable
ALTER TABLE "MonthlyPlan" ADD COLUMN     "notionBitacoraIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "notionEstrategiaId" TEXT,
ADD COLUMN     "notionReport" JSONB,
ADD COLUMN     "notionUploadedAt" TIMESTAMP(3);
