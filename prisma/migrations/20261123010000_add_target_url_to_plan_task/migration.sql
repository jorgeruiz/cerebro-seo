-- Add targetUrl to PlanTask (from candidate.urlObjetivo)
ALTER TABLE "PlanTask" ADD COLUMN "targetUrl" TEXT;

-- Backfill from sourceRef.targetUrl where available
UPDATE "PlanTask"
SET "targetUrl" = "sourceRef"->>'targetUrl'
WHERE "sourceRef" IS NOT NULL
  AND "sourceRef"->>'targetUrl' IS NOT NULL
  AND "sourceRef"->>'targetUrl' != ''
  AND "targetUrl" IS NULL;
