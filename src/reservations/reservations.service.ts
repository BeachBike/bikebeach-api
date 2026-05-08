import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BikeStatus,
  ClassSlotStatus,
  CreditSource,
  Prisma,
  ReservationStatus,
} from '@prisma/client';
import {
  BOOKING_WINDOW_DAYS,
  MIN_RESERVATION_LEAD_MINUTES,
  REFUND_PACK_VALIDITY_DAYS,
  STANDARD_CANCELLATION_WINDOW_HOURS,
  WAITLIST_PROTECTED_CANCELLATION_WINDOW_HOURS,
} from '../common/constants';
import { isGlobalAdmin } from '../common/tenancy';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { HealthGateService } from '../health-gate/health-gate.service';
import { PrismaService } from '../prisma/prisma.service';
import { WaitlistService } from '../waitlist/waitlist.service';
import { CreateReservationDto } from './dto/create-reservation.dto';

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly healthGate: HealthGateService,
    private readonly waitlist: WaitlistService,
  ) {}

  async create(dto: CreateReservationDto, user: AuthenticatedUser) {
    // 1. Health gate (LGPD-sensitive forms must be valid)
    await this.healthGate.assertValid(user.id);

    // 2. Validate class slot
    const slot = await this.prisma.classSlot.findUnique({
      where: { id: dto.classSlotId },
    });
    if (!slot) throw new NotFoundException('Aula não encontrada');
    if (slot.status !== ClassSlotStatus.SCHEDULED) {
      throw new BadRequestException('Aula não está aberta para reserva');
    }
    const now = Date.now();
    if (slot.startsAt.getTime() <= now) {
      throw new BadRequestException('Aula já começou ou está no passado');
    }
    if (
      slot.startsAt.getTime() - now <
      MIN_RESERVATION_LEAD_MINUTES * 60_000
    ) {
      throw new BadRequestException(
        `Reservas fecham ${MIN_RESERVATION_LEAD_MINUTES} min antes da aula`,
      );
    }
    if (slot.startsAt.getTime() - now > BOOKING_WINDOW_DAYS * 86_400_000) {
      throw new BadRequestException(
        `Reservas abrem ${BOOKING_WINDOW_DAYS} dias antes da aula`,
      );
    }

    // Block double-booking: one user can hold at most one ACTIVE/CHECKED_IN
    // reservation per slot, regardless of which bike. This is separate from
    // the (slot, bike) `activeKey` unique — two different users would still
    // be allowed on the same slot.
    const myExisting = await this.prisma.reservation.findFirst({
      where: {
        userId: user.id,
        classSlotId: slot.id,
        status: {
          in: [ReservationStatus.ACTIVE, ReservationStatus.CHECKED_IN],
        },
      },
      select: { id: true },
    });
    if (myExisting) {
      throw new ConflictException(
        'Você já tem uma reserva nessa aula. Use trocar bike pra mudar.',
      );
    }

    // 3. Validate bike
    const bike = await this.prisma.bike.findUnique({
      where: { id: dto.bikeId },
    });
    if (!bike || bike.status !== BikeStatus.OPERATIONAL) {
      throw new BadRequestException('Bike inválida ou indisponível');
    }
    if (bike.unitId !== slot.unitId) {
      throw new BadRequestException(
        'Bike não pertence à unidade dessa aula',
      );
    }

    // 4. Capacity check (counts ACTIVE + CHECKED_IN as occupying a seat)
    const activeCount = await this.prisma.reservation.count({
      where: {
        classSlotId: slot.id,
        status: {
          in: [ReservationStatus.ACTIVE, ReservationStatus.CHECKED_IN],
        },
      },
    });
    if (activeCount >= slot.capacity) {
      throw new ConflictException('Aula sem vagas');
    }

    // 5. Pick the credit pack expiring soonest with credits available.
    //    The atomic decrement inside the transaction guarantees safety even
    //    if the pack's state changes between this read and the write.
    const candidatePack = await this.prisma.creditPack.findFirst({
      where: {
        userId: user.id,
        remainingCredits: { gt: 0 },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { expiresAt: 'asc' },
    });
    if (!candidatePack) {
      throw new BadRequestException('Sem créditos disponíveis');
    }

    // 6. Transaction:
    //    - Decrement pack atomically (updateMany with `remaining > 0` filter
    //      so a concurrent request can't take the same credit twice).
    //    - Insert reservation with `activeKey = "${slotId}:${bikeId}"`.
    //      Two parallel inserts on the same (slot, bike) collide on the
    //      activeKey UNIQUE → P2002 → caller catches → 409.
    //    Any failure rolls back the credit decrement automatically.
    try {
      return await this.prisma.$transaction(async (tx) => {
        const decremented = await tx.creditPack.updateMany({
          where: { id: candidatePack.id, remainingCredits: { gt: 0 } },
          data: { remainingCredits: { decrement: 1 } },
        });
        if (decremented.count === 0) {
          throw new ConflictException(
            'Crédito esgotado, tente novamente',
          );
        }
        return tx.reservation.create({
          data: {
            classSlotId: dto.classSlotId,
            bikeId: dto.bikeId,
            userId: user.id,
            creditPackId: candidatePack.id,
            activeKey: this.activeKeyFor(dto.classSlotId, dto.bikeId),
          },
        });
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'Bike já reservada por outro usuário para essa aula',
        );
      }
      throw err;
    }
  }

  async cancelByUser(reservationId: string, user: AuthenticatedUser) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { classSlot: true },
    });
    if (!reservation) throw new NotFoundException('Reserva não encontrada');
    if (reservation.userId !== user.id && !isGlobalAdmin(user)) {
      throw new ForbiddenException('Você não pode cancelar essa reserva');
    }
    if (reservation.status !== ReservationStatus.ACTIVE) {
      throw new BadRequestException('Reserva não está ativa');
    }
    if (reservation.classSlot.status !== ClassSlotStatus.SCHEDULED) {
      throw new BadRequestException(
        'Aula já foi cancelada — sua reserva já refletirá isso',
      );
    }

    const now = Date.now();
    const hoursToClass =
      (reservation.classSlot.startsAt.getTime() - now) / 3_600_000;

    const minWindow = reservation.promotedFromWaitlist
      ? WAITLIST_PROTECTED_CANCELLATION_WINDOW_HOURS
      : STANDARD_CANCELLATION_WINDOW_HOURS;
    const creditReturned = hoursToClass >= minWindow;

    await this.prisma.$transaction(async (tx) => {
      await tx.reservation.update({
        where: { id: reservationId },
        data: {
          status: ReservationStatus.CANCELLED_BY_USER,
          activeKey: null, // releases the (slot, bike) seat for re-booking
          cancelledAt: new Date(),
          cancelledByUserId: user.id,
        },
      });

      if (!creditReturned) return;

      // Refund: prefer to add back to the original pack if it's still valid.
      // If it expired in the meantime, mint a fresh REFUND pack.
      const originalPack = await tx.creditPack.findUnique({
        where: { id: reservation.creditPackId },
      });
      const originalStillValid =
        originalPack !== null &&
        (originalPack.expiresAt === null ||
          originalPack.expiresAt.getTime() > now);

      if (originalStillValid) {
        await tx.creditPack.update({
          where: { id: reservation.creditPackId },
          data: { remainingCredits: { increment: 1 } },
        });
      } else {
        await tx.creditPack.create({
          data: {
            userId: reservation.userId,
            source: CreditSource.REFUND,
            totalCredits: 1,
            remainingCredits: 1,
            expiresAt: new Date(
              Date.now() + REFUND_PACK_VALIDITY_DAYS * 86_400_000,
            ),
          },
        });
      }
    });

    // After the cancel transaction commits, attempt to promote the next user
    // from the waitlist. Runs in its own short transaction. Failures are
    // logged, never propagated — the user's cancel must succeed regardless.
    let promoted = false;
    try {
      const result = await this.waitlist.tryPromoteAfterCancellation(
        reservation.classSlotId,
        reservation.bikeId,
      );
      promoted = result !== null;
    } catch (err) {
      this.logger.warn(
        `Waitlist promotion failed for slot ${reservation.classSlotId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return {
      id: reservationId,
      status: ReservationStatus.CANCELLED_BY_USER,
      creditReturned,
      waitlistPromoted: promoted,
    };
  }

  /// Change the bike of an existing reservation while keeping the credit
  /// already consumed. Allowed only outside the standard cancellation window
  /// (≥ 8h before class) — within the window a swap could be used to rotate
  /// between bikes and dodge the 8h rule entirely.
  ///
  /// Owner-only (admins use the cancel/recreate flow). Returns the updated
  /// reservation. Concurrency on the destination (slot, bike) returns 409
  /// just like the create flow does.
  async changeBike(
    reservationId: string,
    newBikeId: string,
    user: AuthenticatedUser,
  ) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { classSlot: true },
    });
    if (!reservation) throw new NotFoundException('Reserva não encontrada');
    if (reservation.userId !== user.id) {
      throw new ForbiddenException('Você não pode editar essa reserva');
    }
    if (reservation.status !== ReservationStatus.ACTIVE) {
      throw new BadRequestException('Reserva não está ativa');
    }
    if (reservation.classSlot.status !== ClassSlotStatus.SCHEDULED) {
      throw new BadRequestException('Aula não está aberta para edição');
    }

    const now = Date.now();
    const hoursToClass =
      (reservation.classSlot.startsAt.getTime() - now) / 3_600_000;
    if (hoursToClass < STANDARD_CANCELLATION_WINDOW_HOURS) {
      throw new BadRequestException(
        `Trocar bike só até ${STANDARD_CANCELLATION_WINDOW_HOURS}h antes da aula`,
      );
    }

    if (newBikeId === reservation.bikeId) {
      throw new BadRequestException('Essa já é a bike atual');
    }

    const newBike = await this.prisma.bike.findUnique({
      where: { id: newBikeId },
    });
    if (!newBike || newBike.status !== BikeStatus.OPERATIONAL) {
      throw new BadRequestException('Bike inválida ou indisponível');
    }
    if (newBike.unitId !== reservation.classSlot.unitId) {
      throw new BadRequestException(
        'Bike não pertence à unidade dessa aula',
      );
    }

    try {
      return await this.prisma.reservation.update({
        where: { id: reservationId },
        data: {
          bikeId: newBikeId,
          activeKey: this.activeKeyFor(reservation.classSlotId, newBikeId),
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'Bike já reservada por outro usuário para essa aula',
        );
      }
      throw err;
    }
  }

  /// User self-marks themselves as a no-show. Use case: they realised
  /// after the start that they can't make it; rather than ghost the slot,
  /// they record a reason. The credit is forfeit (the seat blocked someone
  /// else) — this mirrors the silent NO_SHOW the cron applies after the
  /// check-in window closes, but with an attached `cancellationReason`.
  ///
  /// Allowed only while the reservation is ACTIVE on a SCHEDULED slot
  /// inside its run window (between `startsAt` and `startsAt + duration`).
  /// Outside that window the cron has already moved the row, and there's
  /// nothing to set.
  async selfNoShow(
    reservationId: string,
    reason: string,
    user: AuthenticatedUser,
  ) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { classSlot: true },
    });
    if (!reservation) throw new NotFoundException('Reserva não encontrada');
    if (reservation.userId !== user.id) {
      throw new ForbiddenException('Você não pode marcar essa reserva');
    }
    if (reservation.status !== ReservationStatus.ACTIVE) {
      throw new BadRequestException(
        'Marca ausência só funciona em reservas ativas',
      );
    }
    if (reservation.classSlot.status !== ClassSlotStatus.SCHEDULED) {
      throw new BadRequestException('Aula não está em andamento');
    }

    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      throw new BadRequestException(
        'Justificativa muito curta (mín. 3 caracteres)',
      );
    }

    return this.prisma.reservation.update({
      where: { id: reservationId },
      data: {
        status: ReservationStatus.NO_SHOW,
        activeKey: null, // releases the (slot, bike) constraint slot
        cancellationReason: trimmed,
      },
    });
  }

  async checkIn(reservationId: string, user: AuthenticatedUser) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { classSlot: { include: { unit: true } } },
    });
    if (!reservation) throw new NotFoundException('Reserva não encontrada');
    if (reservation.userId !== user.id) {
      throw new ForbiddenException('Você não pode fazer check-in nessa reserva');
    }
    if (reservation.status !== ReservationStatus.ACTIVE) {
      throw new BadRequestException('Reserva não está ativa');
    }
    if (reservation.classSlot.status !== ClassSlotStatus.SCHEDULED) {
      throw new BadRequestException('Aula não está em andamento');
    }

    const now = new Date();
    const earliest = reservation.classSlot.startsAt;
    const tolerance =
      reservation.classSlot.unit.lateCheckinToleranceMinutes;
    const latest = new Date(earliest.getTime() + tolerance * 60_000);

    if (now < earliest) {
      throw new BadRequestException('Aula ainda não começou');
    }
    if (now > latest) {
      throw new BadRequestException(
        `Janela de check-in fechada (tolerância de ${tolerance} min)`,
      );
    }

    return this.prisma.reservation.update({
      where: { id: reservationId },
      data: {
        status: ReservationStatus.CHECKED_IN,
        checkedInAt: now,
      },
    });
  }

  /// Bulk-cancel every still-active reservation on a slot when the studio
  /// (instructor or admin) cancels the class. Refunds credits for ALL of
  /// them — studio cancellation always refunds, regardless of the 8h window
  /// (the user didn't choose this).
  ///
  /// Includes both ACTIVE and CHECKED_IN — if the studio cancels mid-class,
  /// even attendees who already showed up get refunded.
  ///
  /// Runs inside a caller-provided transaction so that the slot transition,
  /// the reservation transitions, the credit refunds, and the waitlist clear
  /// all commit-or-rollback together.
  async bulkCancelByStudio(
    slotId: string,
    /// `null` when triggered by an automated job (no human canceller).
    /// Schema column is nullable so we just store null.
    cancelledByUserId: string | null,
    tx: Prisma.TransactionClient,
  ): Promise<{ cancelled: number; refunded: number }> {
    const reservations = await tx.reservation.findMany({
      where: {
        classSlotId: slotId,
        status: {
          in: [ReservationStatus.ACTIVE, ReservationStatus.CHECKED_IN],
        },
      },
    });
    if (reservations.length === 0) return { cancelled: 0, refunded: 0 };

    const now = new Date();
    let refunded = 0;

    for (const r of reservations) {
      await tx.reservation.update({
        where: { id: r.id },
        data: {
          status: ReservationStatus.CANCELLED_BY_STUDIO,
          activeKey: null,
          cancelledAt: now,
          cancelledByUserId,
        },
      });

      const pack = await tx.creditPack.findUnique({
        where: { id: r.creditPackId },
      });
      const stillValid =
        pack !== null &&
        (pack.expiresAt === null || pack.expiresAt.getTime() > now.getTime());

      if (stillValid) {
        await tx.creditPack.update({
          where: { id: r.creditPackId },
          data: { remainingCredits: { increment: 1 } },
        });
      } else {
        await tx.creditPack.create({
          data: {
            userId: r.userId,
            source: CreditSource.REFUND,
            totalCredits: 1,
            remainingCredits: 1,
            expiresAt: new Date(
              now.getTime() + REFUND_PACK_VALIDITY_DAYS * 86_400_000,
            ),
          },
        });
      }
      refunded++;
    }

    return { cancelled: reservations.length, refunded };
  }

  async findMine(user: AuthenticatedUser) {
    return this.prisma.reservation.findMany({
      where: { userId: user.id },
      include: {
        classSlot: {
          include: {
            classKind: true,
            instructor: { select: { id: true, name: true } },
          },
        },
        bike: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, user: AuthenticatedUser) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      include: {
        classSlot: {
          include: {
            classKind: true,
            instructor: { select: { id: true, name: true } },
          },
        },
        bike: true,
      },
    });
    if (!reservation) throw new NotFoundException('Reserva não encontrada');
    if (reservation.userId !== user.id && !isGlobalAdmin(user)) {
      throw new ForbiddenException();
    }
    return reservation;
  }

  private activeKeyFor(classSlotId: string, bikeId: string): string {
    return `${classSlotId}:${bikeId}`;
  }
}
