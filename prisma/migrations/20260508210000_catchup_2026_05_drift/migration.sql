-- Catch-up migration covering schema drift accumulated 2026-05.
-- Many features (instructor multi-arena, friendships, class-kind colors,
-- bike row/col layout, ClassSlot start-confirm) were applied to dev DBs
-- via `prisma db push` and never had migrations generated. Production
-- (`prisma migrate deploy`) was therefore stuck at 20260506120100 and
-- the cron `autoConfirmStart` started crashing on the missing
-- `ClassSlot.confirmedStartedAt` column. This migration brings prod
-- in line with `prisma/schema.prisma`.
--
-- Destructive drops (confirmed safe by product owner — placeholders
-- with no real prod data):
--   - Bike.positionX / Bike.positionY  -> replaced by row + col
--   - ClassKind.displayOrder           -> replaced by colorToken sort
--   - Unit.pixDiscountPercent          -> replaced by per-pack discount

-- CreateEnum
CREATE TYPE "FriendRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ClassKindColor" AS ENUM ('CLAY', 'SUN', 'SEA', 'SAND', 'INK', 'GREEN');

-- AlterTable
ALTER TABLE "Bike" DROP COLUMN "positionX",
DROP COLUMN "positionY",
ADD COLUMN     "col" INTEGER,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "row" TEXT;

-- AlterTable
ALTER TABLE "ClassKind" DROP COLUMN "displayOrder",
ADD COLUMN     "colorToken" "ClassKindColor" NOT NULL DEFAULT 'SEA';

-- AlterTable
ALTER TABLE "ClassSlot" ADD COLUMN     "autoStartConfirmed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "confirmedStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PackOffer" ADD COLUMN     "discountEndsAt" TIMESTAMP(3),
ADD COLUMN     "discountPercent" INTEGER,
ADD COLUMN     "discountStartsAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "discountEndsAt" TIMESTAMP(3),
ADD COLUMN     "discountPercent" INTEGER,
ADD COLUMN     "discountStartsAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "cancellationReason" TEXT;

-- AlterTable
ALTER TABLE "Unit" DROP COLUMN "pixDiscountPercent",
ADD COLUMN     "description" TEXT,
ADD COLUMN     "maxCols" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "maxRows" INTEGER NOT NULL DEFAULT 4;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "bio" TEXT,
ADD COLUMN     "friendCode" TEXT,
ADD COLUMN     "hideReservationsFromFriends" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "primaryClassKindId" TEXT;

-- CreateTable
CREATE TABLE "InstructorArena" (
    "userId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstructorArena_pkey" PRIMARY KEY ("userId","unitId")
);

-- CreateTable
CREATE TABLE "InstructorSpecialty" (
    "userId" TEXT NOT NULL,
    "classKindId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstructorSpecialty_pkey" PRIMARY KEY ("userId","classKindId")
);

-- CreateTable
CREATE TABLE "FriendRequest" (
    "id" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "status" "FriendRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "FriendRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Friendship" (
    "id" TEXT NOT NULL,
    "userAId" TEXT NOT NULL,
    "userBId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Friendship_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InstructorArena_unitId_idx" ON "InstructorArena"("unitId");

-- CreateIndex
CREATE INDEX "InstructorSpecialty_classKindId_idx" ON "InstructorSpecialty"("classKindId");

-- CreateIndex
CREATE INDEX "FriendRequest_fromUserId_idx" ON "FriendRequest"("fromUserId");

-- CreateIndex
CREATE INDEX "FriendRequest_toUserId_idx" ON "FriendRequest"("toUserId");

-- CreateIndex
CREATE INDEX "FriendRequest_status_idx" ON "FriendRequest"("status");

-- CreateIndex
CREATE INDEX "Friendship_userAId_idx" ON "Friendship"("userAId");

-- CreateIndex
CREATE INDEX "Friendship_userBId_idx" ON "Friendship"("userBId");

-- CreateIndex
CREATE UNIQUE INDEX "Friendship_userAId_userBId_key" ON "Friendship"("userAId", "userBId");

-- CreateIndex
CREATE UNIQUE INDEX "Bike_unitId_row_col_key" ON "Bike"("unitId", "row", "col");

-- CreateIndex
CREATE UNIQUE INDEX "User_friendCode_key" ON "User"("friendCode");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_primaryClassKindId_fkey" FOREIGN KEY ("primaryClassKindId") REFERENCES "ClassKind"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorArena" ADD CONSTRAINT "InstructorArena_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorArena" ADD CONSTRAINT "InstructorArena_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorSpecialty" ADD CONSTRAINT "InstructorSpecialty_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorSpecialty" ADD CONSTRAINT "InstructorSpecialty_classKindId_fkey" FOREIGN KEY ("classKindId") REFERENCES "ClassKind"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendRequest" ADD CONSTRAINT "FriendRequest_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendRequest" ADD CONSTRAINT "FriendRequest_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
