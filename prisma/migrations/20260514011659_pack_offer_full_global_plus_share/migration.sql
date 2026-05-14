-- 2026-05 — PackOffer goes fully global. The `unitId` column is removed
-- entirely. Per-arena duplicates are deduped: for each `classes` count,
-- we keep the global row when it exists (unitId IS NULL); otherwise the
-- most recently updated per-arena row wins. Everything else is deleted
-- so the new `UNIQUE(classes)` constraint can be added.
--
-- Same migration also lands the `isTransferable` and `maxSharedUsers`
-- flags that drive the new transferable/shareable pack flows.

-- 1) Dedup. We use a CTE that ranks rows per `classes`, preferring NULL
--    unitId, then most recently updated, then most recently created.
WITH ranked AS (
  SELECT
    id,
    classes,
    ROW_NUMBER() OVER (
      PARTITION BY classes
      ORDER BY
        CASE WHEN "unitId" IS NULL THEN 0 ELSE 1 END,
        "updatedAt" DESC,
        "createdAt" DESC
    ) AS rn
  FROM "PackOffer"
)
DELETE FROM "PackOffer"
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 2) Drop the per-arena artifacts.
ALTER TABLE "PackOffer" DROP CONSTRAINT IF EXISTS "PackOffer_unitId_fkey";
DROP INDEX IF EXISTS "PackOffer_unitId_classes_key";
DROP INDEX IF EXISTS "PackOffer_unitId_isActive_idx";
DROP INDEX IF EXISTS "PackOffer_classes_global_unique";

-- 3) Drop the column itself + add the new flags.
ALTER TABLE "PackOffer" DROP COLUMN "unitId";
ALTER TABLE "PackOffer" ADD COLUMN "isTransferable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PackOffer" ADD COLUMN "maxSharedUsers" INTEGER NOT NULL DEFAULT 0;

-- 4) New global uniqueness + index.
CREATE UNIQUE INDEX "PackOffer_classes_key" ON "PackOffer"("classes");
CREATE INDEX "PackOffer_isActive_idx" ON "PackOffer"("isActive");
