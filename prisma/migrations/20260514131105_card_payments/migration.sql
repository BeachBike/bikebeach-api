-- CreateEnum
CREATE TYPE "CreditDebtReason" AS ENUM ('REFUND', 'CHARGEBACK');

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'IN_REVIEW';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "cardBrand" TEXT,
ADD COLUMN     "cardLast4" TEXT,
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "installments" INTEGER;

-- CreateTable
CREATE TABLE "CreditDebt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" "CreditDebtReason" NOT NULL,
    "amountCredits" INTEGER NOT NULL,
    "remainingCredits" INTEGER NOT NULL,
    "originPaymentId" TEXT NOT NULL,
    "settledByPaymentId" TEXT,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditDebt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreditDebt_userId_remainingCredits_idx" ON "CreditDebt"("userId", "remainingCredits");

-- AddForeignKey
ALTER TABLE "CreditDebt" ADD CONSTRAINT "CreditDebt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditDebt" ADD CONSTRAINT "CreditDebt_originPaymentId_fkey" FOREIGN KEY ("originPaymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditDebt" ADD CONSTRAINT "CreditDebt_settledByPaymentId_fkey" FOREIGN KEY ("settledByPaymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
