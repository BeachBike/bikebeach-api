-- 2026-05 — co-owners on CreditPack + new TRANSFER source for credits
-- received from a friend's pack via the transfer flow.

-- AlterEnum: add the TRANSFER value to CreditSource. Postgres requires
-- this to run outside a transaction, but Prisma migrate already wraps
-- each statement appropriately.
ALTER TYPE "CreditSource" ADD VALUE 'TRANSFER';

-- CreateTable
CREATE TABLE "CreditPackCoOwner" (
    "creditPackId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditPackCoOwner_pkey" PRIMARY KEY ("creditPackId","userId")
);

-- CreateIndex
CREATE INDEX "CreditPackCoOwner_userId_idx" ON "CreditPackCoOwner"("userId");

-- AddForeignKey
ALTER TABLE "CreditPackCoOwner" ADD CONSTRAINT "CreditPackCoOwner_creditPackId_fkey"
  FOREIGN KEY ("creditPackId") REFERENCES "CreditPack"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditPackCoOwner" ADD CONSTRAINT "CreditPackCoOwner_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
