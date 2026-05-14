-- 2026-05 — snapshot the PackOffer's `isTransferable` and
-- `maxSharedUsers` flags into the CreditPack at creation time. Decouples
-- post-purchase admin edits from already-bought packs.

ALTER TABLE "CreditPack" ADD COLUMN     "isTransferable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CreditPack" ADD COLUMN     "maxSharedUsers" INTEGER NOT NULL DEFAULT 0;
