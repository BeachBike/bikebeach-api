-- 2026-05 — Joining the waitlist now consumes 1 credit upfront, refunded
-- if the user leaves or the slot starts without promoting them. We track
-- which CreditPack the credit came from so refund hits the right bucket.

-- AlterTable
ALTER TABLE "WaitlistEntry" ADD COLUMN     "creditPackId" TEXT,
                            ADD COLUMN     "refundedAt"  TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "WaitlistEntry_creditPackId_idx" ON "WaitlistEntry"("creditPackId");

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_creditPackId_fkey"
  FOREIGN KEY ("creditPackId") REFERENCES "CreditPack"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
