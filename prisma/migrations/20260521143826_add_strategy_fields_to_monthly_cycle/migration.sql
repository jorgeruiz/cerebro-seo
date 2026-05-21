-- AlterTable: campos de estrategia del mes en MonthlyCycle (sync con Cerebro web)
ALTER TABLE "MonthlyCycle" ADD COLUMN "focus" TEXT;
ALTER TABLE "MonthlyCycle" ADD COLUMN "goals" TEXT[] DEFAULT ARRAY[]::TEXT[];