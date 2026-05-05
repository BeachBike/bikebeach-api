import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ClassSlotStatus,
  Prisma,
  ReservationStatus,
} from '@prisma/client';
import { assertCanManageSlot } from '../common/tenancy';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { HealthGateService } from '../health-gate/health-gate.service';
import { PrismaService } from '../prisma/prisma.service';

export interface PromotionResult {
  reservationId: string;
  promotedUserId: string;
  waitlistEntryId: string;
}

@Injectable()
export class WaitlistService {
  private readonly logger = new Logger(WaitlistService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly healthGate: HealthGateService,
  ) {}

  async join(slotId: string, user: AuthenticatedUser) {
    // Health gate must be valid — if not, the user couldn't be promoted anyway.
    await this.healthGate.assertValid(user.id);

    const slot = await this.prisma.classSlot.findUnique({
      where: { id: slotId },
    });
    if (!slot) throw new NotFoundException('Aula não encontrada');
    if (slot.status !== ClassSlotStatus.SCHEDULED) {
      throw new BadRequestException('Aula não está aberta');
    }
    if (slot.startsAt.getTime() <= Date.now()) {
      throw new BadRequestException('Aula já começou ou está no passado');
    }

    // Waitlist only makes sense when the slot is full. If there's a free seat,
    // the user should make a direct reservation.
    const activeCount = await this.prisma.reservation.count({
      where: {
        classSlotId: slotId,
        status: {
          in: [ReservationStatus.ACTIVE, ReservationStatus.CHECKED_IN],
        },
      },
    });
    if (activeCount < slot.capacity) {
      throw new BadRequestException(
        'Aula ainda tem vagas — faça uma reserva direta',
      );
    }

    // Already has an active reservation for this slot?
    const existingReservation = await this.prisma.reservation.count({
      where: {
        classSlotId: slotId,
        userId: user.id,
        status: {
          in: [ReservationStatus.ACTIVE, ReservationStatus.CHECKED_IN],
        },
      },
    });
    if (existingReservation > 0) {
      throw new ConflictException('Você já tem uma reserva nessa aula');
    }

    try {
      return await this.prisma.waitlistEntry.create({
        data: { classSlotId: slotId, userId: user.id },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('Você já está na lista de espera');
      }
      throw err;
    }
  }

  async leave(slotId: string, user: AuthenticatedUser) {
    // Hard-delete: the unique (slotId, userId) constraint would otherwise
    // block re-joining later. Promoted entries are NOT deletable here
    // (they no longer represent a wait — the user has a reservation).
    const entry = await this.prisma.waitlistEntry.findUnique({
      where: {
        classSlotId_userId: { classSlotId: slotId, userId: user.id },
      },
    });
    if (!entry) {
      throw new NotFoundException('Você não está na lista de espera');
    }
    if (entry.promotedAt) {
      throw new BadRequestException(
        'Você já foi promovido — cancele a reserva',
      );
    }
    await this.prisma.waitlistEntry.delete({ where: { id: entry.id } });
  }

  /// Marks every still-pending entry on a slot as `removedAt = now`.
  /// Called from `ClassSlotsService.cancel()` (studio cancelled the class —
  /// no point promoting anyone). Ignores already-promoted/already-removed.
  /// Runs inside a caller-provided transaction.
  async clearForSlot(
    slotId: string,
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await tx.waitlistEntry.updateMany({
      where: {
        classSlotId: slotId,
        promotedAt: null,
        removedAt: null,
      },
      data: { removedAt: new Date() },
    });
    return result.count;
  }

  async listFor(slotId: string, requester: AuthenticatedUser) {
    const slot = await this.prisma.classSlot.findUnique({
      where: { id: slotId },
    });
    if (!slot) throw new NotFoundException('Aula não encontrada');
    assertCanManageSlot(requester, slot);

    return this.prisma.waitlistEntry.findMany({
      where: { classSlotId: slotId },
      orderBy: { joinedAt: 'asc' },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });
  }

  /// Called from `ReservationsService.cancelByUser` AFTER its transaction
  /// commits. Runs in its own short transaction. Returns the promotion
  /// result, or `null` if the waitlist is empty / no eligible entry.
  ///
  /// Skip semantics: an entry is hard-deleted when the user can't be
  /// promoted (inactive user, gate expired, no credits, pack drained mid-tx).
  /// The loop continues until it promotes someone or exhausts the queue.
  ///
  /// We DON'T throw on bike-collision (P2002) — if the freed bike got grabbed
  /// by a fresh /reservations call between our cancel commit and this tx,
  /// nobody from the waitlist gets promoted (acceptable: that's a tiny race
  /// window and the waitlist users stay queued for the next opening).
  async tryPromoteAfterCancellation(
    slotId: string,
    freedBikeId: string,
  ): Promise<PromotionResult | null> {
    return this.prisma.$transaction(async (tx) => {
      // Defense: if the slot itself was cancelled in the interim, don't promote.
      const slot = await tx.classSlot.findUnique({ where: { id: slotId } });
      if (!slot || slot.status !== ClassSlotStatus.SCHEDULED) return null;

      while (true) {
        const next = await tx.waitlistEntry.findFirst({
          where: {
            classSlotId: slotId,
            promotedAt: null,
            removedAt: null,
          },
          orderBy: { joinedAt: 'asc' },
        });
        if (!next) return null;

        const candidate = await tx.user.findUnique({
          where: { id: next.userId },
        });
        if (!candidate || !candidate.isActive) {
          await tx.waitlistEntry.delete({ where: { id: next.id } });
          continue;
        }

        // Read-only health-gate check via the outer prisma client. Race risk
        // is nil — gate state isn't mutated by anything in this tx.
        const status = await this.healthGate.getStatus(next.userId);
        if (!status.ok) {
          await tx.waitlistEntry.delete({ where: { id: next.id } });
          continue;
        }

        const pack = await tx.creditPack.findFirst({
          where: {
            userId: next.userId,
            remainingCredits: { gt: 0 },
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          orderBy: { expiresAt: 'asc' },
        });
        if (!pack) {
          await tx.waitlistEntry.delete({ where: { id: next.id } });
          continue;
        }

        const decremented = await tx.creditPack.updateMany({
          where: { id: pack.id, remainingCredits: { gt: 0 } },
          data: { remainingCredits: { decrement: 1 } },
        });
        if (decremented.count === 0) {
          await tx.waitlistEntry.delete({ where: { id: next.id } });
          continue;
        }

        try {
          const reservation = await tx.reservation.create({
            data: {
              classSlotId: slotId,
              bikeId: freedBikeId,
              userId: next.userId,
              creditPackId: pack.id,
              promotedFromWaitlist: true,
              activeKey: `${slotId}:${freedBikeId}`,
            },
          });
          await tx.waitlistEntry.update({
            where: { id: next.id },
            data: { promotedAt: new Date() },
          });
          return {
            reservationId: reservation.id,
            promotedUserId: next.userId,
            waitlistEntryId: next.id,
          };
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002'
          ) {
            // Bike was grabbed by a non-waitlist user. Roll back this tx
            // (throwing here exits) — caller catches and logs. Waitlist
            // entries stay intact for the next opening.
            this.logger.warn(
              `Promotion bike collision on slot ${slotId}, bike ${freedBikeId}`,
            );
            throw err;
          }
          throw err;
        }
      }
    });
  }
}
