/*
  Warnings:

  - You are about to drop the `NextStepPlan` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "NextStepPlan" DROP CONSTRAINT "NextStepPlan_clientId_fkey";

-- DropTable
DROP TABLE "NextStepPlan";
