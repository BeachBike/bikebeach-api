-- CreateEnum
CREATE TYPE "PersonalCancellationReason" AS ENUM ('SAUDE', 'PESSOAL', 'CLIMA', 'OUTRO');

-- CreateEnum
CREATE TYPE "StudioCancellationReason" AS ENUM ('CHUVA', 'VENTO', 'RAIO', 'TECNICO', 'MAR_ALTO', 'MANUTENCAO', 'SEGURANCA', 'BAIXA_ADESAO', 'OUTRO');

-- CreateEnum
CREATE TYPE "CancellationKind" AS ENUM ('PERSONAL', 'STUDIO');

-- CreateEnum
CREATE TYPE "BikeStatus" AS ENUM ('OPERATIONAL', 'MAINTENANCE', 'OUT_OF_SERVICE');

-- CreateEnum
CREATE TYPE "UserGoal" AS ENUM ('PERDER_PESO', 'GANHAR_CONDICIONAMENTO', 'MANTER_FORMA', 'COMPETIR', 'OUTRO');

-- CreateEnum
CREATE TYPE "FitnessLevel" AS ENUM ('INICIANTE', 'INTERMEDIARIO', 'AVANCADO');

-- DropIndex
DROP INDEX "Bike_unitId_isActive_idx";

-- AlterTable
ALTER TABLE "Bike" DROP COLUMN "isActive",
ADD COLUMN     "status" "BikeStatus" NOT NULL DEFAULT 'OPERATIONAL';

-- AlterTable
ALTER TABLE "ClassSlot" DROP COLUMN "cancellationReason",
ADD COLUMN     "cancellationKind" "CancellationKind",
ADD COLUMN     "classKindId" TEXT,
ADD COLUMN     "personalCancellationReason" "PersonalCancellationReason",
ADD COLUMN     "studioCancellationReason" "StudioCancellationReason";

-- AlterTable
ALTER TABLE "Unit" ADD COLUMN     "pixDiscountPercent" INTEGER NOT NULL DEFAULT 5;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "birthDate" TIMESTAMP(3),
ADD COLUMN     "fitnessLevel" "FitnessLevel",
ADD COLUMN     "goal" "UserGoal",
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- DropEnum
DROP TYPE "ClassCancellationReason";

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BikeMaintenance" (
    "id" TEXT NOT NULL,
    "bikeId" TEXT NOT NULL,
    "loggedById" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BikeMaintenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassKind" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultDurationMinutes" INTEGER NOT NULL,
    "intensity" INTEGER NOT NULL DEFAULT 3,
    "tone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassKind_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackOffer" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "classes" INTEGER NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "expirationDays" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- CreateIndex
CREATE INDEX "BikeMaintenance_bikeId_performedAt_idx" ON "BikeMaintenance"("bikeId", "performedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ClassKind_slug_key" ON "ClassKind"("slug");

-- CreateIndex
CREATE INDEX "PackOffer_unitId_isActive_idx" ON "PackOffer"("unitId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PackOffer_unitId_classes_key" ON "PackOffer"("unitId", "classes");

-- CreateIndex
CREATE INDEX "Bike_unitId_status_idx" ON "Bike"("unitId", "status");

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BikeMaintenance" ADD CONSTRAINT "BikeMaintenance_bikeId_fkey" FOREIGN KEY ("bikeId") REFERENCES "Bike"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BikeMaintenance" ADD CONSTRAINT "BikeMaintenance_loggedById_fkey" FOREIGN KEY ("loggedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackOffer" ADD CONSTRAINT "PackOffer_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSlot" ADD CONSTRAINT "ClassSlot_classKindId_fkey" FOREIGN KEY ("classKindId") REFERENCES "ClassKind"("id") ON DELETE SET NULL ON UPDATE CASCADE;
