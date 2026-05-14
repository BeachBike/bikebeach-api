import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BikeStatus,
  CancellationKind,
  ClassSlotStatus,
  PersonalCancellationReason,
  Role,
  StudioCancellationReason,
} from '@prisma/client';
import {
  assertCanAccessUnit,
  assertCanManageSlot,
} from '../common/tenancy';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { FriendsService } from '../friends/friends.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationsService } from '../reservations/reservations.service';
import { WaitlistService } from '../waitlist/waitlist.service';
import { CancelClassSlotDto } from './dto/cancel-class-slot.dto';
import { CreateClassSlotDto } from './dto/create-class-slot.dto';
import { UpdateClassSlotDto } from './dto/update-class-slot.dto';

interface ListFilter {
  /// Optional — when omitted, returns slots from every active unit
  /// (multi-arena home / dashboard with "todas as arenas" selected).
  unitId?: string;
  from?: string;
  to?: string;
  status?: ClassSlotStatus;
}

/// Marker stored in `Reservation.cancellationReason` when the instructor
/// (not the user themselves) marked the reservation as NO_SHOW via the
/// check-in drawer. Used to distinguish from `selfNoShow` so we can let
/// the instructor undo their own marks but not override the user's.
export const INSTRUCTOR_NO_SHOW_REASON = 'ausência marcada pelo professor';

function isInstructorMarkedNoShowReason(
  reason: string | null | undefined,
): boolean {
  if (!reason) return false;
  return reason.toLowerCase().startsWith('ausência marcada pelo professor');
}

@Injectable()
export class ClassSlotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reservations: ReservationsService,
    private readonly waitlist: WaitlistService,
    private readonly friends: FriendsService,
  ) {}

  async create(dto: CreateClassSlotDto, user: AuthenticatedUser) {
    assertCanAccessUnit(user, dto.unitId);

    // Instructors can only schedule themselves; admins can schedule any
    // instructor of the unit.
    if (user.role === Role.INSTRUCTOR && dto.instructorId !== user.id) {
      throw new ForbiddenException(
        'Instrutor só pode agendar as próprias aulas',
      );
    }

    const unit = await this.prisma.unit.findUnique({
      where: { id: dto.unitId },
    });
    if (!unit || !unit.isActive) {
      throw new BadRequestException('Unidade inválida ou inativa');
    }

    // Instructor membership: validated via the InstructorArena M2M
    // (2026-05). The legacy `User.unitId` field is no longer the source
    // of truth for instructor scoping.
    const instructor = await this.prisma.user.findUnique({
      where: { id: dto.instructorId },
      include: {
        arenaAssignments: {
          where: { unitId: dto.unitId },
          select: { unitId: true },
        },
      },
    });
    if (
      !instructor ||
      instructor.role !== Role.INSTRUCTOR ||
      !instructor.isActive ||
      instructor.arenaAssignments.length === 0
    ) {
      throw new BadRequestException('Instrutor inválido para essa unidade');
    }

    // 2026-05 — duration is now driven entirely by the picked ClassKind.
    // Per item-10 the admin/instructor can't override it. If no kind is
    // supplied we still accept an explicit `durationMinutes` for backwards
    // compat with the prior contract.
    let durationMinutes = dto.durationMinutes;
    if (dto.classKindId) {
      const kind = await this.prisma.classKind.findUnique({
        where: { id: dto.classKindId },
      });
      if (!kind || !kind.isActive) {
        throw new BadRequestException('Tipo de aula inválido ou inativo');
      }
      durationMinutes = kind.defaultDurationMinutes;
    }
    if (!durationMinutes) {
      throw new BadRequestException(
        'Informe um classKindId válido (duração herda do tipo)',
      );
    }

    const startsAt = new Date(dto.startsAt);
    if (Number.isNaN(startsAt.getTime()) || startsAt <= new Date()) {
      throw new BadRequestException('A aula precisa começar no futuro');
    }

    // 14.2 — block overlap with another SCHEDULED slot in the same arena.
    await this.assertNoTimeOverlap(dto.unitId, startsAt, durationMinutes);

    // 2026-05 — capacity always equals the count of OPERATIONAL bikes in
    // the arena at creation time (item-10 / item-15). DTO `capacity` is
    // ignored. If the arena has no bikes, refuse with a clear message.
    const operationalBikeCount = await this.prisma.bike.count({
      where: {
        unitId: dto.unitId,
        status: BikeStatus.OPERATIONAL,
        deletedAt: null,
      },
    });
    if (operationalBikeCount === 0) {
      throw new BadRequestException(
        'Arena não tem bikes operacionais — não dá pra criar aula',
      );
    }
    const capacity = operationalBikeCount;

    return this.prisma.classSlot.create({
      data: {
        unitId: dto.unitId,
        instructorId: dto.instructorId,
        classKindId: dto.classKindId,
        title: dto.title,
        startsAt,
        durationMinutes,
        capacity,
      },
    });
  }

  async list(filter: ListFilter) {
    const startsAtFilter: { gte?: Date; lte?: Date } = {};
    if (filter.from) startsAtFilter.gte = new Date(filter.from);
    if (filter.to) startsAtFilter.lte = new Date(filter.to);

    const slots = await this.prisma.classSlot.findMany({
      where: {
        // When unitId is omitted, only restrict by active arenas. We don't want
        // slots leaking from soft-deleted units when the caller asked for "all".
        ...(filter.unitId
          ? { unitId: filter.unitId }
          : { unit: { isActive: true } }),
        startsAt:
          Object.keys(startsAtFilter).length > 0 ? startsAtFilter : undefined,
        status: filter.status,
      },
      include: {
        classKind: true,
        instructor: { select: { id: true, name: true, photoUrl: true } },
        // Surfaces the arena identity so the frontend can render a badge on
        // each card when the user is viewing "todas as arenas".
        unit: { select: { id: true, slug: true, name: true } },
        _count: {
          select: {
            reservations: {
              where: {
                status: { in: ['ACTIVE', 'CHECKED_IN'] },
              },
            },
          },
        },
      },
      orderBy: { startsAt: 'asc' },
    });

    // 14.6 — second pass to count "presentes" (CHECKED_IN + COMPLETED) for
    // every slot, used by the calendar to render "concluída · n presentes"
    // on COMPLETED slots. Cheap second query — Prisma can't alias multiple
    // _count.reservations on the same relation.
    const slotIds = slots.map((s) => s.id);
    const presentRows = slotIds.length
      ? await this.prisma.reservation.groupBy({
          by: ['classSlotId'],
          where: {
            classSlotId: { in: slotIds },
            status: { in: ['CHECKED_IN', 'COMPLETED'] },
          },
          _count: { _all: true },
        })
      : [];
    const presentByslot = new Map(
      presentRows.map((r) => [r.classSlotId, r._count._all]),
    );

    return slots.map(({ _count, ...s }) => ({
      ...s,
      reservedCount: _count.reservations,
      presentCount: presentByslot.get(s.id) ?? 0,
      freeSpots: Math.max(0, s.capacity - _count.reservations),
    }));
  }

  async findOne(id: string) {
    const slot = await this.prisma.classSlot.findUnique({
      where: { id },
      include: {
        classKind: true,
        instructor: { select: { id: true, name: true, photoUrl: true } },
      },
    });
    if (!slot) throw new NotFoundException('Aula não encontrada');
    return slot;
  }

  /// Single-call payload for the seat-map UI: slot + all operational bikes
  /// at the unit + which bike IDs are currently occupied. Public so the
  /// page can render without forcing a login first; per-user info (mine /
  /// usual) is computed client-side from /reservations/me.
  async seatMap(id: string) {
    const slot = await this.prisma.classSlot.findUnique({
      where: { id },
      include: {
        classKind: true,
        instructor: { select: { id: true, name: true, photoUrl: true } },
        unit: {
          select: {
            id: true,
            slug: true,
            name: true,
            maxRows: true,
            maxCols: true,
          },
        },
      },
    });
    if (!slot) throw new NotFoundException('Aula não encontrada');

    const bikes = await this.prisma.bike.findMany({
      where: {
        unitId: slot.unitId,
        status: 'OPERATIONAL',
        deletedAt: null,
      },
      orderBy: [{ row: 'asc' }, { col: 'asc' }, { label: 'asc' }],
      select: {
        id: true,
        label: true,
        row: true,
        col: true,
        status: true,
      },
    });

    const reservations = await this.prisma.reservation.findMany({
      where: {
        classSlotId: id,
        status: { in: ['ACTIVE', 'CHECKED_IN'] },
      },
      select: { bikeId: true },
    });
    const occupiedBikeIds = reservations.map((r) => r.bikeId);

    return {
      slot,
      unit: slot.unit,
      bikes,
      occupiedBikeIds,
      freeSpots: Math.max(0, slot.capacity - reservations.length),
    };
  }

  /// G1 — friends-attending overlay. Given a list of slotIds and the
  /// caller, returns a map `slotId → [{ userId, name, bikeId, isWaitlisted }]`
  /// of the caller's friends who have ACTIVE/CHECKED_IN reservations OR
  /// pending waitlist entries on those slots.
  ///
  /// Friends who have `hideReservationsFromFriends=true` are silently
  /// dropped so the caller can't tell whether they're hidden or just absent.
  ///
  /// Returns `{}` when the caller has no friends — saves the inner queries.
  async friendsAttendingBatch(
    slotIds: string[],
    user: AuthenticatedUser,
  ): Promise<
    Record<
      string,
      Array<{
        userId: string;
        name: string;
        bikeId: string | null;
        isWaitlisted: boolean;
      }>
    >
  > {
    // Always pre-fill the response so every requested slotId comes back
    // with `[]`, never undefined. Saves the client from defensive checks.
    const out: Record<
      string,
      Array<{
        userId: string;
        name: string;
        bikeId: string | null;
        isWaitlisted: boolean;
      }>
    > = {};
    for (const slotId of slotIds) out[slotId] = [];

    if (slotIds.length === 0) return out;
    const friendIds = await this.friends.listFriendIds(user.id);
    if (friendIds.length === 0) return out;

    // Filter out friends who are in invisibility mode. Cheap second query;
    // keeps the friend-id list clean for downstream WHERE clauses.
    const visibleFriends = await this.prisma.user.findMany({
      where: {
        id: { in: friendIds },
        hideReservationsFromFriends: false,
      },
      select: { id: true, name: true },
    });
    if (visibleFriends.length === 0) return out;
    const visibleIds = visibleFriends.map((u) => u.id);
    const nameById = new Map(visibleFriends.map((u) => [u.id, u.name]));

    // Two parallel queries: live reservations + pending waitlist entries.
    const [reservations, waitlist] = await Promise.all([
      this.prisma.reservation.findMany({
        where: {
          classSlotId: { in: slotIds },
          userId: { in: visibleIds },
          status: { in: ['ACTIVE', 'CHECKED_IN'] },
        },
        select: {
          classSlotId: true,
          userId: true,
          bikeId: true,
        },
      }),
      this.prisma.waitlistEntry.findMany({
        where: {
          classSlotId: { in: slotIds },
          userId: { in: visibleIds },
          removedAt: null,
          promotedAt: null,
        },
        select: {
          classSlotId: true,
          userId: true,
        },
      }),
    ]);

    for (const r of reservations) {
      const list = out[r.classSlotId];
      if (!list) continue;
      list.push({
        userId: r.userId,
        name: nameById.get(r.userId) ?? '',
        bikeId: r.bikeId,
        isWaitlisted: false,
      });
    }
    // Skip waitlist rows for friends already in `reservations` — they got
    // promoted between the two reads.
    for (const w of waitlist) {
      const list = out[w.classSlotId];
      if (!list) continue;
      if (list.some((entry) => entry.userId === w.userId)) continue;
      list.push({
        userId: w.userId,
        name: nameById.get(w.userId) ?? '',
        bikeId: null,
        isWaitlisted: true,
      });
    }

    return out;
  }

  /// Roster of students for a slot — used by the instructor portal "alunos" tab.
  /// Returns enriched per-student info: bike label, attendance count to date,
  /// "first class ever" flag. Caller must be the slot's instructor or an admin
  /// of the unit (enforced via `assertCanManageSlot`).
  async roster(id: string, user: AuthenticatedUser) {
    const slot = await this.findOne(id);
    assertCanManageSlot(user, slot);

    const reservations = await this.prisma.reservation.findMany({
      where: {
        classSlotId: id,
        // Include NO_SHOW so the instructor's check-in board can show
        // user-marked absences (locked) and instructor-marked absences
        // (toggleable back to CHECKED_IN). See `bulkCheckIn` rules.
        status: { in: ['ACTIVE', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW'] },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        status: true,
        promotedFromWaitlist: true,
        checkedInAt: true,
        cancellationReason: true,
        userId: true,
        user: { select: { id: true, name: true, email: true } },
        bike: { select: { id: true, label: true } },
      },
    });

    const userIds = reservations.map((r) => r.userId);
    const presencaCounts = await this.prisma.reservation.groupBy({
      by: ['userId'],
      where: {
        userId: { in: userIds },
        status: { in: ['CHECKED_IN', 'COMPLETED'] },
      },
      _count: { _all: true },
    });
    const byUser = new Map(
      presencaCounts.map((p) => [p.userId, p._count._all]),
    );

    const waitlist = await this.prisma.waitlistEntry.count({
      where: { classSlotId: id, removedAt: null, promotedAt: null },
    });

    return {
      slotId: id,
      capacity: slot.capacity,
      reservedCount: reservations.length,
      waitlistCount: waitlist,
      students: reservations.map((r) => {
        const presencaCount = byUser.get(r.userId) ?? 0;
        return {
          reservationId: r.id,
          status: r.status,
          checkedInAt: r.checkedInAt,
          promotedFromWaitlist: r.promotedFromWaitlist,
          /// Surfaces who marked the row absent — the FE uses this to lock
          /// the toggles for user-marked NO_SHOW per item-8/18.
          cancellationReason: r.cancellationReason,
          user: r.user,
          bikeLabel: r.bike.label,
          presencaCount,
          // "first class ever" = this is their first attendance (presencaCount === 0
          // and they're still ACTIVE) OR (presencaCount === 1 and they just CHECKED_IN/COMPLETED here).
          isFirstClass:
            presencaCount === 0 ||
            (presencaCount === 1 &&
              (r.status === 'CHECKED_IN' || r.status === 'COMPLETED')),
        };
      }),
    };
  }

  async update(id: string, dto: UpdateClassSlotDto, user: AuthenticatedUser) {
    const slot = await this.findOne(id);
    assertCanManageSlot(user, slot);

    if (slot.status !== ClassSlotStatus.SCHEDULED) {
      throw new BadRequestException(
        'Não é possível editar uma aula cancelada ou finalizada',
      );
    }

    const startsAt = dto.startsAt ? new Date(dto.startsAt) : undefined;
    if (startsAt && (Number.isNaN(startsAt.getTime()) || startsAt <= new Date())) {
      throw new BadRequestException('A aula precisa começar no futuro');
    }

    if (dto.classKindId) {
      const kind = await this.prisma.classKind.findUnique({
        where: { id: dto.classKindId },
      });
      if (!kind || !kind.isActive) {
        throw new BadRequestException('Tipo de aula inválido ou inativo');
      }
    }

    // 14.2 — re-check overlap when timing changes. Use whichever fields the
    // DTO touched falling back to the current slot values.
    const effectiveStart = startsAt ?? slot.startsAt;
    const effectiveDuration = dto.durationMinutes ?? slot.durationMinutes;
    if (startsAt || dto.durationMinutes !== undefined) {
      await this.assertNoTimeOverlap(
        slot.unitId,
        effectiveStart,
        effectiveDuration,
        id,
      );
    }

    return this.prisma.classSlot.update({
      where: { id },
      data: {
        classKindId: dto.classKindId,
        title: dto.title,
        startsAt,
        durationMinutes: dto.durationMinutes,
        capacity: dto.capacity,
      },
    });
  }

  /// 14.2 — fail if another SCHEDULED slot in this arena overlaps with the
  /// proposed `[startsAt, startsAt + durationMinutes]` window. Excludes the
  /// edited slot when `excludeSlotId` is provided.
  private async assertNoTimeOverlap(
    unitId: string,
    startsAt: Date,
    durationMinutes: number,
    excludeSlotId?: string,
  ): Promise<void> {
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
    // Pre-filter by `startsAt < endsAt` then check the second condition in
    // memory because Prisma can't express `existing.startsAt + duration > X`
    // without raw SQL.
    const candidates = await this.prisma.classSlot.findMany({
      where: {
        unitId,
        status: ClassSlotStatus.SCHEDULED,
        ...(excludeSlotId && { id: { not: excludeSlotId } }),
        startsAt: { lt: endsAt },
      },
      select: {
        id: true,
        startsAt: true,
        durationMinutes: true,
      },
    });
    const overlap = candidates.find((s) => {
      const sEnd = s.startsAt.getTime() + s.durationMinutes * 60_000;
      return sEnd > startsAt.getTime();
    });
    if (overlap) {
      throw new ConflictException(
        'Conflito de horário: já existe uma aula agendada nesta arena nesse intervalo',
      );
    }
  }

  async cancel(
    id: string,
    dto: CancelClassSlotDto,
    user: AuthenticatedUser,
  ) {
    const slot = await this.findOne(id);
    assertCanManageSlot(user, slot);
    return this.executeCancel(slot, dto, user.id);
  }

  /// Instructor (or admin) confirms the class actually started — typed as
  /// a wall-clock instant on the slot. Required after `startsAt`; rejected
  /// before. Once set, stays set (idempotent re-calls return 400 to surface
  /// double-tap mistakes). Manual confirm leaves `autoStartConfirmed=false`,
  /// distinguishing it from cron-promoted slots.
  async confirmStart(id: string, user: AuthenticatedUser) {
    const slot = await this.findOne(id);
    assertCanManageSlot(user, slot);

    if (slot.status !== ClassSlotStatus.SCHEDULED) {
      throw new BadRequestException(
        'Só é possível confirmar início de aulas agendadas',
      );
    }
    const now = new Date();
    if (now < slot.startsAt) {
      throw new BadRequestException('Aula ainda não começou');
    }
    if (slot.confirmedStartedAt) {
      throw new BadRequestException('Início já foi confirmado');
    }

    return this.prisma.classSlot.update({
      where: { id },
      data: {
        confirmedStartedAt: now,
        autoStartConfirmed: false,
      },
    });
  }

  /// Cron-driven version of `confirmStart`. Runs `autoConfirmStartFor()`
  /// from the jobs service when a SCHEDULED slot crossed `startsAt + 10min`
  /// without a manual confirm. Sweeps every ACTIVE reservation into
  /// CHECKED_IN so attendance metrics aren't blank when the instructor
  /// forgot to tap.
  async autoConfirmStartFor(slotId: string) {
    const slot = await this.prisma.classSlot.findUnique({
      where: { id: slotId },
    });
    if (!slot) return null;
    if (slot.status !== ClassSlotStatus.SCHEDULED) return slot;
    if (slot.confirmedStartedAt) return slot;

    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await tx.reservation.updateMany({
        where: { classSlotId: slotId, status: 'ACTIVE' },
        data: { status: 'CHECKED_IN', checkedInAt: now },
      });
      return tx.classSlot.update({
        where: { id: slotId },
        data: {
          confirmedStartedAt: now,
          autoStartConfirmed: true,
        },
      });
    });
  }

  /// Bulk presence pass invoked by the instructor's check-in UI (F3).
  ///
  /// Transition rules (item-18 / item-8):
  ///   - **ACTIVE** → CHECKED_IN if id ∈ present, else NO_SHOW (instructor-marked).
  ///   - **CHECKED_IN** → stays CHECKED_IN. Once a presence is confirmed
  ///     it can't be downgraded to NO_SHOW (this protects the user from
  ///     an accidental tap by the instructor).
  ///   - **NO_SHOW (instructor-marked)** → CHECKED_IN if id ∈ present, else
  ///     stays. Lets the instructor undo a mis-tap up until the cron freezes
  ///     the slot.
  ///   - **NO_SHOW (user-marked)** → silently ignored. The user explicitly
  ///     said they wouldn't show; the instructor can't override that.
  ///
  /// Idempotent: rerunning with the same `presentReservationIds` lands on
  /// the same final state. Doesn't move the slot's status — that's the job
  /// of the cron's `markCompleted` after the slot ends.
  async bulkCheckIn(
    id: string,
    presentReservationIds: string[],
    user: AuthenticatedUser,
  ): Promise<{ checkedIn: number; noShow: number; ignored: number }> {
    const slot = await this.findOne(id);
    assertCanManageSlot(user, slot);

    if (slot.status !== ClassSlotStatus.SCHEDULED) {
      throw new BadRequestException(
        'Só é possível registrar presença em aulas agendadas',
      );
    }

    const presentSet = new Set(presentReservationIds);
    // Pull every reservation in scope of the check-in board: ACTIVE,
    // CHECKED_IN and NO_SHOW. The transition rules above decide what to
    // do with each.
    const reservations = await this.prisma.reservation.findMany({
      where: {
        classSlotId: id,
        status: { in: ['ACTIVE', 'CHECKED_IN', 'NO_SHOW'] },
      },
      select: { id: true, status: true, cancellationReason: true },
    });

    // Sanity-check that every id in the input belongs to this slot — guards
    // against mass-mutating other slots through a forged payload.
    const validIds = new Set(reservations.map((r) => r.id));
    const stranger = presentReservationIds.find((rid) => !validIds.has(rid));
    if (stranger) {
      throw new BadRequestException(
        'Reserva não pertence a essa aula',
      );
    }

    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      let checkedIn = 0;
      let noShow = 0;
      let ignored = 0;
      for (const r of reservations) {
        const isUserMarkedAbsent =
          r.status === 'NO_SHOW' &&
          !isInstructorMarkedNoShowReason(r.cancellationReason);

        if (isUserMarkedAbsent) {
          // Locked — instructor can't override the user's explicit absence.
          ignored++;
          continue;
        }

        if (r.status === 'CHECKED_IN') {
          // Locked — confirmed presence is final.
          checkedIn++;
          continue;
        }

        if (presentSet.has(r.id)) {
          await tx.reservation.update({
            where: { id: r.id },
            data: {
              status: 'CHECKED_IN',
              checkedInAt: now,
              // Clear any prior NO_SHOW reason so the row reads clean
              // when the prof flips back from "absent → present".
              cancellationReason: null,
            },
          });
          checkedIn++;
        } else if (r.status === 'ACTIVE') {
          await tx.reservation.update({
            where: { id: r.id },
            data: {
              status: 'NO_SHOW',
              activeKey: null,
              cancellationReason: INSTRUCTOR_NO_SHOW_REASON,
            },
          });
          noShow++;
        } else {
          // Already NO_SHOW (instructor-marked) and not in present — stays.
          noShow++;
        }
      }
      return { checkedIn, noShow, ignored };
    });

    return result;
  }

  /// Cron-triggered cancellation. No auth check — the caller is the system
  /// itself (`ClassSlotJobsService`). Stored as `cancelledByUserId = null`
  /// so it's distinguishable from human cancellations in the audit trail.
  async cancelByCron(id: string, dto: CancelClassSlotDto) {
    const slot = await this.findOne(id);
    return this.executeCancel(slot, dto, null);
  }

  /// Mark a slot COMPLETED — only valid transition from SCHEDULED.
  /// ACTIVE reservations become NO_SHOW (user reserved but never checked in,
  /// credit is already consumed). CHECKED_IN reservations become COMPLETED.
  /// Idempotent: re-calling on an already-COMPLETED slot is a no-op.
  async completeBySchedule(id: string) {
    const slot = await this.prisma.classSlot.findUnique({ where: { id } });
    if (!slot) return null;
    if (slot.status !== ClassSlotStatus.SCHEDULED) return slot;

    return this.prisma.$transaction(async (tx) => {
      await tx.reservation.updateMany({
        where: { classSlotId: id, status: 'ACTIVE' },
        data: {
          status: 'NO_SHOW',
          activeKey: null,
        },
      });
      await tx.reservation.updateMany({
        where: { classSlotId: id, status: 'CHECKED_IN' },
        data: {
          status: 'COMPLETED',
          activeKey: null,
        },
      });
      return tx.classSlot.update({
        where: { id },
        data: { status: ClassSlotStatus.COMPLETED },
      });
    });
  }

  /// Internal cancel core shared by HTTP `cancel()` and cron `cancelByCron()`.
  /// `cancelledByUserId === null` indicates an automated cancellation.
  private async executeCancel(
    slot: { id: string; status: ClassSlotStatus; startsAt: Date },
    dto: CancelClassSlotDto,
    cancelledByUserId: string | null,
  ) {
    if (slot.status !== ClassSlotStatus.SCHEDULED) {
      throw new BadRequestException('Aula já está em estado final');
    }

    // Validate the discriminator: exactly one of personalReason / studioReason
    // must be present, matching `kind`. The DTO's ValidateIf already enforces
    // presence, but service double-checks consistency.
    const isOutro =
      (dto.kind === CancellationKind.PERSONAL &&
        dto.personalReason === PersonalCancellationReason.OUTRO) ||
      (dto.kind === CancellationKind.STUDIO &&
        dto.studioReason === StudioCancellationReason.OUTRO);
    if (isOutro && (!dto.description || dto.description.trim().length < 3)) {
      throw new BadRequestException(
        'Descrição obrigatória quando motivo é OUTRO',
      );
    }

    const now = new Date();
    const newStatus =
      now < slot.startsAt
        ? ClassSlotStatus.CANCELLED_BEFORE
        : ClassSlotStatus.CANCELLED_DURING;

    return this.prisma.$transaction(async (tx) => {
      const bulk = await this.reservations.bulkCancelByStudio(
        slot.id,
        cancelledByUserId,
        tx,
      );
      const waitlistCleared = await this.waitlist.clearForSlot(slot.id, tx);

      const updated = await tx.classSlot.update({
        where: { id: slot.id },
        data: {
          status: newStatus,
          cancellationKind: dto.kind,
          personalCancellationReason:
            dto.kind === CancellationKind.PERSONAL
              ? dto.personalReason
              : null,
          studioCancellationReason:
            dto.kind === CancellationKind.STUDIO ? dto.studioReason : null,
          cancellationDescription: dto.description ?? null,
          cancelledByUserId,
          cancelledAt: now,
        },
      });

      return {
        ...updated,
        reservationsCancelled: bulk.cancelled,
        creditsRefunded: bulk.refunded,
        waitlistCleared,
      };
    });
  }

}
