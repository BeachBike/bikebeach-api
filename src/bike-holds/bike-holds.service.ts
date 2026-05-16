import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BikeStatus,
  ClassSlotStatus,
  Prisma,
  ReservationStatus,
} from '@prisma/client';
import { BIKE_HOLD_TTL_MINUTES } from '../common/constants';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

export interface HoldView {
  id: string;
  classSlotId: string;
  bikeId: string;
  expiresAt: string;
}

/// Temporary exclusive seat claim during the reservation flow. Not a
/// reservation — no credit consumed. The `@@unique([classSlotId, bikeId])`
/// makes acquire atomic (INSERT loser → P2002 → 409). Hard-deleted on
/// release / confirm / expiry. See the `BikeHold` model doc.
@Injectable()
export class BikeHoldsService {
  private readonly logger = new Logger(BikeHoldsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  private ttlDate(): Date {
    return new Date(Date.now() + BIKE_HOLD_TTL_MINUTES * 60_000);
  }

  /// Acquire (or move) a hold for `userId` on `(slotId, bikeId)`.
  /// - Validates the slot is SCHEDULED + in the future and the bike is
  ///   OPERATIONAL and belongs to the slot's unit.
  /// - Rejects if the bike already has an ACTIVE/CHECKED_IN reservation.
  /// - Rejects (409) if a *non-expired* hold by another user exists.
  /// - Idempotent if the caller already holds this exact bike (just
  ///   refreshes the TTL).
  /// - "Switching bikes" within the same slot deletes the caller's prior
  ///   hold and the destination's expired hold (if any) in one tx, then
  ///   inserts — the unique constraint catches a concurrent racer.
  async acquire(
    slotId: string,
    bikeId: string,
    userId: string,
  ): Promise<HoldView> {
    const slot = await this.prisma.classSlot.findUnique({
      where: { id: slotId },
      select: { id: true, status: true, startsAt: true, unitId: true },
    });
    if (!slot) throw new NotFoundException('Aula não encontrada');
    if (slot.status !== ClassSlotStatus.SCHEDULED) {
      throw new BadRequestException('Aula não está aberta para reserva');
    }
    if (slot.startsAt.getTime() <= Date.now()) {
      throw new BadRequestException('Aula já começou ou está no passado');
    }

    const bike = await this.prisma.bike.findUnique({
      where: { id: bikeId },
      select: { id: true, status: true, unitId: true, deletedAt: true },
    });
    if (
      !bike ||
      bike.deletedAt !== null ||
      bike.status !== BikeStatus.OPERATIONAL
    ) {
      throw new BadRequestException('Bike inválida ou indisponível');
    }
    if (bike.unitId !== slot.unitId) {
      throw new BadRequestException('Bike não pertence à unidade dessa aula');
    }

    // Already reserved for real?
    const reserved = await this.prisma.reservation.findFirst({
      where: {
        classSlotId: slotId,
        bikeId,
        status: {
          in: [ReservationStatus.ACTIVE, ReservationStatus.CHECKED_IN],
        },
      },
      select: { id: true },
    });
    if (reserved) {
      throw new ConflictException('Bike já reservada para essa aula');
    }

    const now = new Date();
    try {
      const hold = await this.prisma.$transaction(async (tx) => {
        // Lazy-clean any expired hold on the destination seat so the
        // unique constraint doesn't block a legit fresh claim.
        await tx.bikeHold.deleteMany({
          where: { classSlotId: slotId, bikeId, expiresAt: { lte: now } },
        });

        // A live hold by ANOTHER user blocks the seat.
        const blocking = await tx.bikeHold.findFirst({
          where: {
            classSlotId: slotId,
            bikeId,
            expiresAt: { gt: now },
            NOT: { userId },
          },
          select: { id: true },
        });
        if (blocking) {
          throw new ConflictException('Bike está em reserva por outra pessoa');
        }

        // Caller is switching bikes within the slot (or refreshing the
        // same one): drop their previous hold first. `@@unique([slot,
        // user])` would otherwise reject the insert.
        await tx.bikeHold.deleteMany({
          where: { classSlotId: slotId, userId },
        });

        return tx.bikeHold.create({
          data: {
            classSlotId: slotId,
            bikeId,
            userId,
            expiresAt: this.ttlDate(),
          },
          select: {
            id: true,
            classSlotId: true,
            bikeId: true,
            expiresAt: true,
          },
        });
      });

      this.realtime.seatMapChanged(slotId);
      return {
        id: hold.id,
        classSlotId: hold.classSlotId,
        bikeId: hold.bikeId,
        expiresAt: hold.expiresAt.toISOString(),
      };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Lost the atomic race on (slot, bike).
        throw new ConflictException('Bike está em reserva por outra pessoa');
      }
      throw err;
    }
  }

  /// Re-touch the caller's hold on a slot to a fresh full TTL. Used when
  /// the user advances to the confirmation step so they get the whole
  /// window there regardless of how long step 2 took. No-op (silent) if
  /// the hold already expired / never existed — the caller will hit a
  /// clean 409 on confirm instead.
  async refresh(slotId: string, userId: string): Promise<HoldView | null> {
    const updated = await this.prisma.bikeHold.updateMany({
      where: { classSlotId: slotId, userId, expiresAt: { gt: new Date() } },
      data: { expiresAt: this.ttlDate() },
    });
    if (updated.count === 0) return null;
    const hold = await this.prisma.bikeHold.findFirst({
      where: { classSlotId: slotId, userId },
      select: { id: true, classSlotId: true, bikeId: true, expiresAt: true },
    });
    if (!hold) return null;
    return {
      id: hold.id,
      classSlotId: hold.classSlotId,
      bikeId: hold.bikeId,
      expiresAt: hold.expiresAt.toISOString(),
    };
  }

  /// Release the caller's hold on a slot. Idempotent — deleting zero rows
  /// is success. Broadcasts so the seat frees for others immediately.
  async release(slotId: string, userId: string): Promise<void> {
    const deleted = await this.prisma.bikeHold.deleteMany({
      where: { classSlotId: slotId, userId },
    });
    if (deleted.count > 0) this.realtime.seatMapChanged(slotId);
  }

  /// Internal: drop the caller's hold once it became a real reservation.
  /// No broadcast — the reservation create already emits seatMapChanged.
  async consumeOnReservation(slotId: string, userId: string): Promise<void> {
    await this.prisma.bikeHold.deleteMany({
      where: { classSlotId: slotId, userId },
    });
  }

  /// Guard for the reservation create path: throws 409 if a *non-expired*
  /// hold by a DIFFERENT user covers this seat. The caller's own hold (or
  /// none) passes.
  async assertNotHeldByOther(
    slotId: string,
    bikeId: string,
    userId: string,
  ): Promise<void> {
    const blocking = await this.prisma.bikeHold.findFirst({
      where: {
        classSlotId: slotId,
        bikeId,
        expiresAt: { gt: new Date() },
        NOT: { userId },
      },
      select: { id: true },
    });
    if (blocking) {
      throw new ConflictException('Bike está em reserva por outra pessoa');
    }
  }

  /// The caller's own current (non-expired) hold on a slot, or null.
  /// Drives FE rehydration: when a user leaves the flow without an
  /// explicit "voltar" (tab close, refresh, phone lock, app switch) the
  /// hold persists by design — on return the FE asks this so it can
  /// restore the selection + countdown instead of treating the user's
  /// own seat as "held by someone else".
  async myHold(slotId: string, userId: string): Promise<HoldView | null> {
    const hold = await this.prisma.bikeHold.findFirst({
      where: { classSlotId: slotId, userId, expiresAt: { gt: new Date() } },
      select: { id: true, classSlotId: true, bikeId: true, expiresAt: true },
    });
    if (!hold) return null;
    return {
      id: hold.id,
      classSlotId: hold.classSlotId,
      bikeId: hold.bikeId,
      expiresAt: hold.expiresAt.toISOString(),
    };
  }

  /// Active (non-expired) hold bike ids for a slot — fed into the seat-map
  /// payload so the FE can paint "em reserva".
  async activeHeldBikeIds(slotId: string): Promise<string[]> {
    const holds = await this.prisma.bikeHold.findMany({
      where: { classSlotId: slotId, expiresAt: { gt: new Date() } },
      select: { bikeId: true },
    });
    return holds.map((h) => h.bikeId);
  }

  /// Cron entry point — delete every expired hold and broadcast a
  /// seat-map change per affected slot so seats free up visually even
  /// when nobody is actively interacting. Returns the count removed.
  async sweepExpired(): Promise<number> {
    const now = new Date();
    const expired = await this.prisma.bikeHold.findMany({
      where: { expiresAt: { lte: now } },
      select: { id: true, classSlotId: true },
    });
    if (expired.length === 0) return 0;
    await this.prisma.bikeHold.deleteMany({
      where: { id: { in: expired.map((e) => e.id) } },
    });
    const slotIds = [...new Set(expired.map((e) => e.classSlotId))];
    for (const slotId of slotIds) this.realtime.seatMapChanged(slotId);
    this.logger.log(
      `swept ${expired.length} expired bike hold(s) across ${slotIds.length} slot(s)`,
    );
    return expired.length;
  }
}
