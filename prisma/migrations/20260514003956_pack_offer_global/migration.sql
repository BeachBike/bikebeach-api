-- 2026-05 — PackOffer goes from per-arena to global-by-default.
-- Existing per-arena rows keep working (kept for localised pricing).
-- New offers are created with `unitId = NULL` and apply to every arena.

-- DropForeignKey
ALTER TABLE "PackOffer" DROP CONSTRAINT "PackOffer_unitId_fkey";

-- AlterTable: drop the NOT NULL constraint on unitId
ALTER TABLE "PackOffer" ALTER COLUMN "unitId" DROP NOT NULL;

-- AddForeignKey: re-add with ON DELETE SET NULL so removing an arena
-- demotes its offers to global instead of cascade-deleting them.
ALTER TABLE "PackOffer" ADD CONSTRAINT "PackOffer_unitId_fkey"
  FOREIGN KEY ("unitId") REFERENCES "Unit"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Partial unique index so we can't end up with two global offers for the
-- same `classes` count. Postgres treats NULLs as distinct in regular
-- unique constraints, so the per-arena `(unitId, classes)` unique above
-- doesn't catch this case on its own.
CREATE UNIQUE INDEX "PackOffer_classes_global_unique"
  ON "PackOffer" ("classes")
  WHERE "unitId" IS NULL;
