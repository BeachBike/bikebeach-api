-- CreateEnum
CREATE TYPE "EmailTemplate" AS ENUM ('WELCOME', 'RESERVATION_CONFIRMED', 'RESERVATION_REMINDER', 'WAITLIST_PROMOTED', 'CLASS_CANCELLED', 'PASSWORD_RESET', 'HEALTH_GATE_EXPIRING', 'PAYMENT_RECEIPT');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "EmailVariant" AS ENUM ('LIGHT', 'DARK');

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
    "template" "EmailTemplate" NOT NULL,
    "variant" "EmailVariant" NOT NULL,
    "status" "EmailStatus" NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "userId" TEXT,
    "payload" JSONB NOT NULL,
    "externalId" TEXT,
    "errorMessage" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailLog_userId_createdAt_idx" ON "EmailLog"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "EmailLog_template_createdAt_idx" ON "EmailLog"("template", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "EmailLog_status_idx" ON "EmailLog"("status");

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
