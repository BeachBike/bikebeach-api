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
import { assertNoOpenCreditDebt } from '../common/credit-debt.guard';
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

  /// Joining the waitlist consumes 1 credit upfront (CLAUDE.md product
  /// rule, 2026-05). The credit goes back to the user's pack if:
  /// - the user leaves the queue (`leave`)
  /// - the studio cancels the slot (`clearForSlot`)
  /// - the slot starts without promoting this entry (`refundUnpromotedAtStart`)
  /// If the user is promoted, the same credit is inherited by the new
  /// reservation — no additional decrement happens.
  async join(slotId: string, user: AuthenticatedUser) {
    // Health gate must be valid — if not, the user couldn't be promoted anyway.
    await this.healthGate.assertValid(user.id);
    // Credit-debt gate — joining the waitlist consumes a credit upfront, so
    // a user with an open CreditDebt must settle it before queueing.
    await assertNoOpenCreditDebt(this.prisma, user.id);

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

    // Pre-check + decrement a credit. Same selection rule as the reservation
    // path: oldest-expiring valid pack first (so soon-to-expire credits get
    // used). Wrapped in a transaction so the entry insert + credit decrement
    // commit together.
    return this.prisma.$transaction(async (tx) => {
      const pack = await tx.creditPack.findFirst({
        where: {
          AND: [
            {
              OR: [
                { userId: user.id },
                { coOwners: { some: { userId: user.id } } },
              ],
            },
            { remainingCredits: { gt: 0 } },
            {
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
          ],
        },
        orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
      });
      if (!pack) {
        throw new BadRequestException({
          code: 'NO_CREDITS',
          message:
            'Você precisa de pelo menos 1 crédito pra entrar na fila.',
        });
      }

      // Atomic conditional decrement — bails if another concurrent op
      // drained the pack between findFirst and updateMany.
      const dec = await tx.creditPack.updateMany({
        where: { id: pack.id, remainingCredits: { gt: 0 } },
        data: { remainingCredits: { decrement: 1 } },
      });
      if (dec.count === 0) {
        throw new BadRequestException({
          code: 'NO_CREDITS',
          message: 'Sem crédito disponível.',
        });
      }

      try {
        const entry = await tx.waitlistEntry.create({
          data: {
            classSlotId: slotId,
            userId: user.id,
            creditPackId: pack.id,
          },
        });
        const position = await tx.waitlistEntry.count({
          where: {
            classSlotId: slotId,
            promotedAt: null,
            removedAt: null,
            joinedAt: { lte: entry.joinedAt },
          },
        });
        return { ...entry, position };
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          throw new ConflictException('Você já está na lista de espera');
        }
        throw err;
      }
    });
  }

  async leave(slotId: string, user: AuthenticatedUser) {
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

    // Refund the held credit before deleting the entry. We do both in a
    // single transaction so a crash mid-flow leaves no leaked credit nor
    // ghost waitlist row.
    await this.prisma.$transaction(async (tx) => {
      await this.refundEntryCredit(tx, entry);
      await tx.waitlistEntry.delete({ where: { id: entry.id } });
    });
  }

  /// Marks every still-pending entry on a slot as `removedAt = now` AND
  /// refunds the credit each entry was holding. Called from
  /// `ClassSlotsService.cancel()`. Runs inside a caller-provided transaction
  /// so the slot transition + waitlist refunds commit atomically.
  async clearForSlot(
    slotId: string,
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    const pending = await tx.waitlistEntry.findMany({
      where: {
        classSlotId: slotId,
        promotedAt: null,
        removedAt: null,
      },
    });
    for (const entry of pending) {
      await this.refundEntryCredit(tx, entry);
    }
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

  /// Called by the cron job that flips slots to `COMPLETED` (or by the
  /// "slot started" boundary): refunds every still-pending waitlist entry
  /// for a slot, marking each as `removedAt = now` and `refundedAt = now`.
  /// The user wasn't promoted in time → their credit goes back so they
  /// can try the next class. Idempotent.
  async refundUnpromotedAtStart(slotId: string): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const pending = await tx.waitlistEntry.findMany({
        where: {
          classSlotId: slotId,
          promotedAt: null,
          removedAt: null,
        },
      });
      if (pending.length === 0) return 0;
      for (const entry of pending) {
        await this.refundEntryCredit(tx, entry);
      }
      const now = new Date();
      const updated = await tx.waitlistEntry.updateMany({
        where: { id: { in: pending.map((p) => p.id) } },
        data: { removedAt: now, refundedAt: now },
      });
      return updated.count;
    });
  }

  /// Returns the held credit back to its original CreditPack. Caller is
  /// expected to also delete or mark the entry — we don't touch the entry
  /// row here, only the credit. No-op when the entry has no associated
  /// pack (legacy rows from before 2026-05) or when already refunded.
  private async refundEntryCredit(
    tx: Prisma.TransactionClient,
    entry: { id: string; creditPackId: string | null; refundedAt: Date | null; promotedAt: Date | null },
  ): Promise<void> {
    if (!entry.creditPackId) return; // legacy: nothing to refund
    if (entry.refundedAt) return; // already refunded — keep idempotent
    if (entry.promotedAt) return; // promoted: credit lives on in the reservation
    // Restore one credit to the original pack — even if it has expired the
    // refund is still safe (the user can see "X expirados, 1 ressarcido").
    await tx.creditPack.update({
      where: { id: entry.creditPackId },
      data: { remainingCredits: { increment: 1 } },
    });
    await tx.waitlistEntry.update({
      where: { id: entry.id },
      data: { refundedAt: new Date() },
    });
  }

  /// Returns every PENDING waitlist entry for the caller. Promoted/removed
  /// entries are excluded — the caller already has a reservation (or no
  /// longer needs the slot). Includes slot identity so the FE can render
  /// the entries inline on the dashboard / step-aula.
  async listMine(user: AuthenticatedUser) {
    const rows = await this.prisma.waitlistEntry.findMany({
      where: {
        userId: user.id,
        promotedAt: null,
        removedAt: null,
        classSlot: {
          startsAt: { gt: new Date() },
          status: ClassSlotStatus.SCHEDULED,
        },
      },
      orderBy: [{ classSlot: { startsAt: 'asc' } }, { joinedAt: 'asc' }],
      include: {
        classSlot: {
          select: {
            id: true,
            startsAt: true,
            unit: { select: { id: true, name: true, slug: true } },
            classKind: { select: { id: true, name: true, colorToken: true } },
          },
        },
      },
    });

    // Compute a 1-indexed position per slot — count of pending entries
    // that joined at or before this one.
    return Promise.all(
      rows.map(async (row) => {
        const position = await this.prisma.waitlistEntry.count({
          where: {
            classSlotId: row.classSlotId,
            promotedAt: null,
            removedAt: null,
            joinedAt: { lte: row.joinedAt },
          },
        });
        return {
          id: row.id,
          classSlotId: row.classSlotId,
          joinedAt: row.joinedAt,
          position,
          slot: row.classSlot,
        };
      }),
    );
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
  /// commits. Promotes the next eligible waitlist entry into a real
  /// reservation on the freed bike. Runs in its own short transaction.
  ///
  /// The promoted entry already paid its credit at `join` time — we
  /// reuse that same `creditPackId` for the new reservation instead of
  /// decrementing again. We DON'T throw on bike-collision (P2002) — if
  /// the freed bike got grabbed by a fresh /reservations call, nobody
  /// from the waitlist gets promoted (acceptable race window).
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
          // Refund the held credit before discarding the entry.
          await this.refundEntryCredit(tx, next);
          await tx.waitlistEntry.delete({ where: { id: next.id } });
          continue;
        }

        // Read-only health-gate check via the outer prisma client. Race risk
        // is nil — gate state isn't mutated by anything in this tx.
        const status = await this.healthGate.getStatus(next.userId);
        if (!status.ok) {
          await this.refundEntryCredit(tx, next);
          await tx.waitlistEntry.delete({ where: { id: next.id } });
          continue;
        }

        // The credit was already taken at join-time. Reuse the same pack id
        // when creating the reservation. If the entry has no pack (legacy
        // pre-2026-05 row), fall back to picking a fresh pack so existing
        // queues keep promoting.
        let packId = next.creditPackId;
        if (!packId) {
          const fresh = await tx.creditPack.findFirst({
            where: {
              AND: [
                {
                  OR: [
                    { userId: next.userId },
                    { coOwners: { some: { userId: next.userId } } },
                  ],
                },
                { remainingCredits: { gt: 0 } },
                {
                  OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
                },
              ],
            },
            orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
          });
          if (!fresh) {
            await tx.waitlistEntry.delete({ where: { id: next.id } });
            continue;
          }
          const dec = await tx.creditPack.updateMany({
            where: { id: fresh.id, remainingCredits: { gt: 0 } },
            data: { remainingCredits: { decrement: 1 } },
          });
          if (dec.count === 0) {
            await tx.waitlistEntry.delete({ where: { id: next.id } });
            continue;
          }
          packId = fresh.id;
        }

        try {
          const reservation = await tx.reservation.create({
            data: {
              classSlotId: slotId,
              bikeId: freedBikeId,
              userId: next.userId,
              creditPackId: packId,
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
            // entries stay intact for the next opening (their credit also
            // remains held — we'd lose money refunding twice on retry).
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

// Suppress unused import warning when ForbiddenException isn't referenced
// directly (we keep the import for future tenancy gates).
void ForbiddenException;
