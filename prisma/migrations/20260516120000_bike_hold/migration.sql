-- CreateTable
CREATE TABLE "BikeHold" (
    "id" TEXT NOT NULL,
    "classSlotId" TEXT NOT NULL,
    "bikeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BikeHold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BikeHold_expiresAt_idx" ON "BikeHold"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "BikeHold_classSlotId_bikeId_key" ON "BikeHold"("classSlotId", "bikeId");

-- CreateIndex
CREATE UNIQUE INDEX "BikeHold_classSlotId_userId_key" ON "BikeHold"("classSlotId", "userId");

-- AddForeignKey
ALTER TABLE "BikeHold" ADD CONSTRAINT "BikeHold_classSlotId_fkey" FOREIGN KEY ("classSlotId") REFERENCES "ClassSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BikeHold" ADD CONSTRAINT "BikeHold_bikeId_fkey" FOREIGN KEY ("bikeId") REFERENCES "Bike"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BikeHold" ADD CONSTRAINT "BikeHold_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
