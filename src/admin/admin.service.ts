import { Injectable } from '@nestjs/common';
import { ClassKindColor, ClassSlotStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AdminStatsDto {
  todayClasses: number;
  todayReservations: number;
  todayCheckedIn: number;
  todayNoShows: number;
  totalBikes: number;
  operationalBikes: number;
  /// Weekly aggregates (Monday → Sunday containing today). Used by the
  /// "Visão Geral" admin tab to mirror the Claude Designer prototype.
  weeklyClasses: number;
  weeklyOccupationPercent: number;
  activeInstructors: number;
  totalInstructors: number;
  /// Per-day occupation for the current week (index 0=Mon … 6=Sun).
  weeklyOccupation: WeeklyDayOccupation[];
  /// Top instructors by classes scheduled this week.
  topInstructors: TopInstructor[];
}

export interface WeeklyDayOccupation {
  /// 0 = Monday, 6 = Sunday.
  dayIndex: number;
  /// Classes scheduled on this day (any status).
  classCount: number;
  /// Sum of capacity across the day's slots — denominator for occupation.
  totalCapacity: number;
  /// Sum of reservations counted against capacity.
  reservedCount: number;
  /// `reservedCount / totalCapacity` rounded to int %. Zero when no slots.
  occupationPercent: number;
}

export interface TopInstructor {
  id: string;
  name: string;
  classesThisWeek: number;
  primaryClassKindName: string | null;
}

export interface AdminLiveSlotDto {
  slotId: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  reservedCount: number;
  capacity: number;
  presentCount: number;
  title: string | null;
  kind: {
    id: string;
    slug: string;
    name: string;
    colorToken: ClassKindColor;
  } | null;
  instructor: { id: string; name: string };
  unit: { id: string; slug: string; name: string };
}

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  async getStats(unitId: string): Promise<AdminStatsDto> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Today's classes
    const todayClasses = await this.prisma.classSlot.count({
      where: {
        unitId,
        startsAt: {
          gte: today,
          lt: tomorrow,
        },
        status: 'SCHEDULED',
      },
    });

    // Today's reservations
    const todayReservations = await this.prisma.reservation.count({
      where: {
        classSlot: {
          unitId,
          startsAt: {
            gte: today,
            lt: tomorrow,
          },
        },
        status: { in: ['ACTIVE', 'CHECKED_IN'] },
      },
    });

    // Today's check-ins
    const todayCheckedIn = await this.prisma.reservation.count({
      where: {
        classSlot: {
          unitId,
          startsAt: {
            gte: today,
            lt: tomorrow,
          },
        },
        status: 'CHECKED_IN',
      },
    });

    // Today's no-shows
    const todayNoShows = await this.prisma.reservation.count({
      where: {
        classSlot: {
          unitId,
          startsAt: {
            gte: today,
            lt: tomorrow,
          },
        },
        status: 'NO_SHOW',
      },
    });

    // Total bikes (excludes soft-deleted rows from 2026-05).
    const totalBikes = await this.prisma.bike.count({
      where: { unitId, deletedAt: null },
    });

    // Operational bikes
    const operationalBikes = await this.prisma.bike.count({
      where: {
        unitId,
        status: 'OPERATIONAL',
        deletedAt: null,
      },
    });

    // ─── Weekly aggregates (Mon → Sun containing today) ──────────────────
    // Used by the Visão Geral redesign — KPIs, ocupação por dia, ranking.
    const weekStart = startOfWeekMonday(today);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const weekSlots = await this.prisma.classSlot.findMany({
      where: {
        unitId,
        startsAt: { gte: weekStart, lt: weekEnd },
      },
      select: {
        id: true,
        instructorId: true,
        startsAt: true,
        capacity: true,
        status: true,
      },
    });

    const slotIds = weekSlots.map((s) => s.id);
    const reservedRows = slotIds.length
      ? await this.prisma.reservation.groupBy({
          by: ['classSlotId'],
          where: {
            classSlotId: { in: slotIds },
            status: { in: ['ACTIVE', 'CHECKED_IN', 'COMPLETED'] },
          },
          _count: { _all: true },
        })
      : [];
    const reservedBySlot = new Map(
      reservedRows.map((r) => [r.classSlotId, r._count._all]),
    );

    const dayBuckets: WeeklyDayOccupation[] = Array.from(
      { length: 7 },
      (_, i) => ({
        dayIndex: i,
        classCount: 0,
        totalCapacity: 0,
        reservedCount: 0,
        occupationPercent: 0,
      }),
    );
    let weeklyTotalCapacity = 0;
    let weeklyTotalReserved = 0;
    for (const s of weekSlots) {
      const idx = mondayDayIndex(s.startsAt);
      const reserved = reservedBySlot.get(s.id) ?? 0;
      dayBuckets[idx].classCount++;
      dayBuckets[idx].totalCapacity += s.capacity;
      dayBuckets[idx].reservedCount += reserved;
      weeklyTotalCapacity += s.capacity;
      weeklyTotalReserved += reserved;
    }
    for (const d of dayBuckets) {
      d.occupationPercent = d.totalCapacity
        ? Math.round((d.reservedCount / d.totalCapacity) * 100)
        : 0;
    }
    const weeklyOccupationPercent = weeklyTotalCapacity
      ? Math.round((weeklyTotalReserved / weeklyTotalCapacity) * 100)
      : 0;

    // Instructor counts (active + total) for the unit.
    const [activeInstructors, totalInstructors] = await Promise.all([
      this.prisma.user.count({
        where: { unitId, role: 'INSTRUCTOR', isActive: true },
      }),
      this.prisma.user.count({
        where: { unitId, role: 'INSTRUCTOR' },
      }),
    ]);

    // Top instructors by class count this week (limit 5).
    const tally = new Map<string, number>();
    for (const s of weekSlots) {
      tally.set(s.instructorId, (tally.get(s.instructorId) ?? 0) + 1);
    }
    const sortedIds = [...tally.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    const instructorRows = sortedIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: sortedIds.map(([id]) => id) } },
          select: {
            id: true,
            name: true,
            primaryClassKind: { select: { name: true } },
          },
        })
      : [];
    const instructorMap = new Map(instructorRows.map((r) => [r.id, r]));
    const topInstructors: TopInstructor[] = sortedIds.flatMap(
      ([id, count]) => {
        const u = instructorMap.get(id);
        if (!u) return [];
        return [
          {
            id: u.id,
            name: u.name,
            classesThisWeek: count,
            primaryClassKindName: u.primaryClassKind?.name ?? null,
          },
        ];
      },
    );

    return {
      todayClasses,
      todayReservations,
      todayCheckedIn,
      todayNoShows,
      totalBikes,
      operationalBikes,
      weeklyClasses: weekSlots.length,
      weeklyOccupationPercent,
      activeInstructors,
      totalInstructors,
      weeklyOccupation: dayBuckets,
      topInstructors,
    };
  }

  /// Item 20 — return THE single live class to render in the AO VIVO sidebar
  /// widget. A slot is "live" when `now >= startsAt` AND `now <= startsAt +
  /// duration` AND `status = SCHEDULED`. When several are live at once we
  /// pick the one with most reserved seats; tiebreak by `unit.createdAt`
  /// ascending (older arena wins). Returns `null` when nothing is rolling.
  async getLiveClass(): Promise<AdminLiveSlotDto | null> {
    const now = new Date();

    // Coarse filter: scheduled slots whose startsAt is in the past 4 hours
    // (max DTO duration is 180 min). Then narrow per-row.
    const candidates = await this.prisma.classSlot.findMany({
      where: {
        status: ClassSlotStatus.SCHEDULED,
        startsAt: {
          lte: now,
          gte: new Date(now.getTime() - 4 * 60 * 60_000),
        },
      },
      include: {
        classKind: {
          select: { id: true, slug: true, name: true, colorToken: true },
        },
        instructor: { select: { id: true, name: true } },
        unit: {
          select: { id: true, slug: true, name: true, createdAt: true },
        },
        _count: {
          select: {
            reservations: {
              where: { status: { in: ['ACTIVE', 'CHECKED_IN'] } },
            },
          },
        },
      },
    });

    const live = candidates
      .filter((s) => {
        const ends = s.startsAt.getTime() + s.durationMinutes * 60_000;
        return now.getTime() <= ends;
      })
      .sort((a, b) => {
        if (a._count.reservations !== b._count.reservations) {
          // Most attended first.
          return b._count.reservations - a._count.reservations;
        }
        // Tiebreaker: older unit first.
        return a.unit.createdAt.getTime() - b.unit.createdAt.getTime();
      });

    if (live.length === 0) return null;
    const winner = live[0];

    // Cheap second query for presentCount (CHECKED_IN + COMPLETED) — same
    // shape we use in the calendar tab.
    const presentCount = await this.prisma.reservation.count({
      where: {
        classSlotId: winner.id,
        status: { in: ['CHECKED_IN', 'COMPLETED'] },
      },
    });

    return {
      slotId: winner.id,
      startsAt: winner.startsAt.toISOString(),
      endsAt: new Date(
        winner.startsAt.getTime() + winner.durationMinutes * 60_000,
      ).toISOString(),
      durationMinutes: winner.durationMinutes,
      reservedCount: winner._count.reservations,
      capacity: winner.capacity,
      presentCount,
      title: winner.title,
      kind: winner.classKind
        ? {
            id: winner.classKind.id,
            slug: winner.classKind.slug,
            name: winner.classKind.name,
            colorToken: winner.classKind.colorToken,
          }
        : null,
      instructor: {
        id: winner.instructor.id,
        name: winner.instructor.name,
      },
      unit: {
        id: winner.unit.id,
        slug: winner.unit.slug,
        name: winner.unit.name,
      },
    };
  }
}

/// Returns the Monday at 00:00 of the week containing `d` (local time).
function startOfWeekMonday(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  // JS getDay(): 0 = Sun … 6 = Sat. We want Mon as week start.
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}

/// `0 = Mon` … `6 = Sun` for the given Date.
function mondayDayIndex(d: Date): number {
  const day = d.getDay();
  return day === 0 ? 6 : day - 1;
}
