import { Injectable } from '@nestjs/common';
import {
  ClassKindColor,
  ClassSlotStatus,
  CreditSource,
  PaymentMethod,
  ReservationStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/// Reservations that "consumed" a credit (and therefore realized revenue):
/// — CHECKED_IN / COMPLETED / NO_SHOW: user came or lost the credit;
/// — CANCELLED_BY_USER inside the 8h window: same rule as no-show, credit lost.
/// CANCELLED_BY_STUDIO and CANCELLED_BY_USER outside the window refund the
/// credit and produce no revenue. ACTIVE rows for past slots are treated as
/// "still consumed" (the cron flips them to NO_SHOW shortly after) so the
/// dashboard doesn't drop revenue while that promotion is pending.
const CANCEL_WINDOW_MS = 8 * 60 * 60_000;

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

/// Financeiro tab payload. Every cents value is integer (no floats anywhere
/// in money math). Revenue is attributed per-reservation: unit cost = the
/// originating Payment's `amountCents / totalCredits` of the CreditPack the
/// credit came from. Pack sales (`topPacks`, `revenueByMethod`) are global
/// even when a `unitId` is supplied — PackOffers are global per CLAUDE.md.
export interface AdminFinanceReportDto {
  period: { from: string; to: string };
  unitId: string | null;
  kpis: {
    totalRevenueCents: number;
    /// Classes that had at least one revenue-realized reservation.
    classesWithRevenue: number;
    /// `totalRevenueCents / classesWithRevenue`, integer. Zero when no classes.
    avgRevenuePerClassCents: number;
    /// Distinct revenue-realized reservations.
    realizedReservations: number;
    bestSellingPack: {
      classes: number;
      label: string;
      soldCount: number;
      revenueCents: number;
    } | null;
  };
  /// Revenue split by the originating CreditPack source. Useful to see
  /// "quanto veio de avulsa vs mensalista" without joining payments again.
  revenueBySource: { source: CreditSource; revenueCents: number }[];
  /// Pack sales in the window — only PAID one-off packs. Sorted by soldCount
  /// desc. The label is `<n> aulas` so an admin can read it without joining
  /// PackOffer.
  topPacks: {
    classes: number;
    label: string;
    soldCount: number;
    revenueCents: number;
    avgPricePerClassCents: number;
  }[];
  /// Method breakdown across ALL paid charges in the window (one-off packs
  /// + subscription cycles).
  revenueByMethod: {
    method: PaymentMethod;
    revenueCents: number;
    count: number;
  }[];
  /// EVERY class with revenue in the window, sorted by revenue desc.
  /// Resumo view slices to top 10 for display; "Por aula" sub-tab walks the
  /// full list. Bounded by classes-in-window so a busy month is still well
  /// under a few hundred entries.
  classesByRevenue: {
    slotId: string;
    startsAt: string;
    kindName: string | null;
    instructorName: string;
    unitName: string;
    revenueCents: number;
    realizedReservations: number;
    /// Map keyed by CreditSource (only sources that contributed).
    sourceBreakdown: Partial<Record<CreditSource, number>>;
  }[];
  /// Receita por dia (UTC-day buckets keyed by the slot's startsAt date).
  /// Used to draw the sparkline / bar chart at the top of the tab.
  dailyRevenue: { date: string; revenueCents: number }[];
}

/// Per-class drill-down (the "Por aula" sub-tab). Lists every reservation
/// against this slot — even the ones that didn't generate revenue (cancelled
/// pelo estúdio, etc.) — so the admin sees the full picture, with each row
/// flagged as `isRevenue`.
export interface AdminFinanceClassDetailDto {
  slot: {
    id: string;
    startsAt: string;
    durationMinutes: number;
    capacity: number;
    status: string;
    kindName: string | null;
    instructorName: string;
    unitId: string;
    unitName: string;
  };
  reservations: {
    id: string;
    userName: string;
    userEmail: string;
    status: string;
    isRevenue: boolean;
    /// Where the credit came from (PURCHASE_PACK / SUBSCRIPTION_CYCLE / etc).
    source: CreditSource;
    /// Human label of the pack the credit came from ("pacote 10 aulas",
    /// "mensal 8 aulas", "cortesia", "estorno"). Helps the admin scan.
    packLabel: string;
    /// Original price paid for the WHOLE pack (the user's invoice line).
    /// Null for non-paid sources (ADMIN_GRANT / REFUND / TRANSFER).
    paidAmountCents: number | null;
    /// Total credits in the originating pack — anchor for the unit-cost math.
    packTotalCredits: number;
    /// Per-credit value attributed to this seat (0 when non-revenue).
    unitCostCents: number;
    /// How the user paid the originating Payment (null for non-paid sources).
    paymentMethod: PaymentMethod | null;
    /// When the user joined the class (or attempted to). Used for sorting.
    createdAt: string;
  }[];
  totals: {
    revenueCents: number;
    realizedReservations: number;
    bySource: { source: CreditSource; revenueCents: number }[];
    byMethod: { method: PaymentMethod; revenueCents: number }[];
  };
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
    const topInstructors: TopInstructor[] = sortedIds.flatMap(([id, count]) => {
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
    });

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

  /// Financial report — informational only (no money is moved by this
  /// endpoint). The shape is tuned for one screen: KPIs at the top,
  /// per-source / per-method breakdowns, top packs sold, and the per-class
  /// revenue list that answers "quanto essa aula gerou".
  async getFinanceReport(params: {
    from: Date;
    to: Date;
    unitId?: string | null;
  }): Promise<AdminFinanceReportDto> {
    const { from, to, unitId } = params;

    // ─── Reservations in the window (per-class revenue source) ──────────
    // We fetch every reservation in [from, to) and resolve revenue
    // attribution in JS. Volume is bounded by classes-per-window × capacity
    // (≤ a few thousand even in a busy month), so a single query is fine.
    const reservations = await this.prisma.reservation.findMany({
      where: {
        classSlot: {
          startsAt: { gte: from, lt: to },
          ...(unitId ? { unitId } : {}),
        },
      },
      select: {
        id: true,
        status: true,
        cancelledAt: true,
        classSlot: {
          select: {
            id: true,
            startsAt: true,
            unitId: true,
            title: true,
            classKind: { select: { name: true } },
            instructor: { select: { name: true } },
            unit: { select: { name: true } },
          },
        },
        creditPack: {
          select: {
            totalCredits: true,
            source: true,
            payment: {
              select: { amountCents: true, status: true },
            },
          },
        },
      },
    });

    // Per-class accumulator. Keyed by slotId so we can sort + project at end.
    const classMap = new Map<
      string,
      {
        slotId: string;
        startsAt: Date;
        kindName: string | null;
        instructorName: string;
        unitName: string;
        revenueCents: number;
        realizedReservations: number;
        sourceBreakdown: Partial<Record<CreditSource, number>>;
      }
    >();
    const sourceTotals = new Map<CreditSource, number>();
    const dailyTotals = new Map<string, number>();
    let totalRevenueCents = 0;
    let realizedReservations = 0;

    for (const r of reservations) {
      if (!isRevenueRealized(r.status, r.cancelledAt, r.classSlot.startsAt)) {
        continue;
      }
      const unitCost = unitCostCents(r.creditPack);
      if (unitCost <= 0) continue; // ADMIN_GRANT / TRANSFER / REFUND → no revenue
      realizedReservations++;
      totalRevenueCents += unitCost;

      // Per-class roll-up.
      const slotId = r.classSlot.id;
      let bucket = classMap.get(slotId);
      if (!bucket) {
        bucket = {
          slotId,
          startsAt: r.classSlot.startsAt,
          kindName: r.classSlot.classKind?.name ?? r.classSlot.title ?? null,
          instructorName: r.classSlot.instructor.name,
          unitName: r.classSlot.unit.name,
          revenueCents: 0,
          realizedReservations: 0,
          sourceBreakdown: {},
        };
        classMap.set(slotId, bucket);
      }
      bucket.revenueCents += unitCost;
      bucket.realizedReservations++;
      bucket.sourceBreakdown[r.creditPack.source] =
        (bucket.sourceBreakdown[r.creditPack.source] ?? 0) + unitCost;

      sourceTotals.set(
        r.creditPack.source,
        (sourceTotals.get(r.creditPack.source) ?? 0) + unitCost,
      );

      const dateKey = isoDateKey(r.classSlot.startsAt);
      dailyTotals.set(dateKey, (dailyTotals.get(dateKey) ?? 0) + unitCost);
    }

    const classesWithRevenue = classMap.size;
    const avgRevenuePerClassCents = classesWithRevenue
      ? Math.round(totalRevenueCents / classesWithRevenue)
      : 0;

    const classesByRevenue = [...classMap.values()]
      .sort((a, b) => b.revenueCents - a.revenueCents)
      .map((c) => ({
        slotId: c.slotId,
        startsAt: c.startsAt.toISOString(),
        kindName: c.kindName,
        instructorName: c.instructorName,
        unitName: c.unitName,
        revenueCents: c.revenueCents,
        realizedReservations: c.realizedReservations,
        sourceBreakdown: c.sourceBreakdown,
      }));

    // ─── Pack sales + method breakdown (PAID Payments in the window) ────
    // Pack sales are GLOBAL (no unit scope) — PackOffers are global rows.
    // Method breakdown counts every confirmed Payment in the window so the
    // admin sees how the customer paid, not just what got consumed.
    const payments = await this.prisma.payment.findMany({
      where: {
        status: 'PAID',
        paidAt: { gte: from, lt: to },
      },
      select: {
        amountCents: true,
        method: true,
        kind: true,
        packCredits: true,
      },
    });

    const packMap = new Map<
      number,
      { soldCount: number; revenueCents: number }
    >();
    const methodMap = new Map<
      PaymentMethod,
      { revenueCents: number; count: number }
    >();
    for (const p of payments) {
      const m = methodMap.get(p.method) ?? { revenueCents: 0, count: 0 };
      m.revenueCents += p.amountCents;
      m.count++;
      methodMap.set(p.method, m);
      if (p.kind === 'ONE_OFF_PACK' && p.packCredits) {
        const pk = packMap.get(p.packCredits) ?? {
          soldCount: 0,
          revenueCents: 0,
        };
        pk.soldCount++;
        pk.revenueCents += p.amountCents;
        packMap.set(p.packCredits, pk);
      }
    }

    const topPacks = [...packMap.entries()]
      .map(([classes, v]) => ({
        classes,
        label: classes === 1 ? 'avulsa' : `${classes} aulas`,
        soldCount: v.soldCount,
        revenueCents: v.revenueCents,
        avgPricePerClassCents: Math.round(
          v.revenueCents / (v.soldCount * classes),
        ),
      }))
      .sort((a, b) => b.soldCount - a.soldCount);

    const bestSellingPack = topPacks[0]
      ? {
          classes: topPacks[0].classes,
          label: topPacks[0].label,
          soldCount: topPacks[0].soldCount,
          revenueCents: topPacks[0].revenueCents,
        }
      : null;

    return {
      period: { from: from.toISOString(), to: to.toISOString() },
      unitId: unitId ?? null,
      kpis: {
        totalRevenueCents,
        classesWithRevenue,
        avgRevenuePerClassCents,
        realizedReservations,
        bestSellingPack,
      },
      revenueBySource: [...sourceTotals.entries()]
        .map(([source, revenueCents]) => ({ source, revenueCents }))
        .sort((a, b) => b.revenueCents - a.revenueCents),
      topPacks,
      revenueByMethod: [...methodMap.entries()]
        .map(([method, v]) => ({ method, ...v }))
        .sort((a, b) => b.revenueCents - a.revenueCents),
      classesByRevenue,
      dailyRevenue: [...dailyTotals.entries()]
        .map(([date, revenueCents]) => ({ date, revenueCents }))
        .sort((a, b) => (a.date < b.date ? -1 : 1)),
    };
  }

  /// Drill-down for the "Por aula" sub-tab. Returns every reservation for
  /// the slot — including those that didn't generate revenue — so the admin
  /// can see who was on the bike map and what each seat was worth.
  async getClassFinanceDetail(
    slotId: string,
  ): Promise<AdminFinanceClassDetailDto> {
    const slot = await this.prisma.classSlot.findUnique({
      where: { id: slotId },
      select: {
        id: true,
        startsAt: true,
        durationMinutes: true,
        capacity: true,
        status: true,
        title: true,
        unitId: true,
        unit: { select: { name: true } },
        classKind: { select: { name: true } },
        instructor: { select: { name: true } },
      },
    });
    if (!slot) {
      // Lazy-imported NestJS exception would force a dep at top — keep the
      // function pure and let the controller normalize this into a 404.
      throw new Error('CLASS_NOT_FOUND');
    }

    const reservations = await this.prisma.reservation.findMany({
      where: { classSlotId: slotId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        status: true,
        cancelledAt: true,
        createdAt: true,
        user: { select: { name: true, email: true } },
        creditPack: {
          select: {
            totalCredits: true,
            source: true,
            payment: {
              select: { amountCents: true, status: true, method: true },
            },
          },
        },
      },
    });

    const bySource = new Map<CreditSource, number>();
    const byMethod = new Map<PaymentMethod, number>();
    let revenueCents = 0;
    let realized = 0;

    const rows = reservations.map((r) => {
      const isRevenue = isRevenueRealized(
        r.status,
        r.cancelledAt,
        slot.startsAt,
      );
      const unit = isRevenue ? unitCostCents(r.creditPack) : 0;
      if (isRevenue && unit > 0) {
        revenueCents += unit;
        realized++;
        bySource.set(
          r.creditPack.source,
          (bySource.get(r.creditPack.source) ?? 0) + unit,
        );
        if (r.creditPack.payment?.method) {
          byMethod.set(
            r.creditPack.payment.method,
            (byMethod.get(r.creditPack.payment.method) ?? 0) + unit,
          );
        }
      }
      return {
        id: r.id,
        userName: r.user.name,
        userEmail: r.user.email,
        status: r.status,
        isRevenue: isRevenue && unit > 0,
        source: r.creditPack.source,
        packLabel: packLabelFor(r.creditPack.source, r.creditPack.totalCredits),
        paidAmountCents: r.creditPack.payment?.amountCents ?? null,
        packTotalCredits: r.creditPack.totalCredits,
        unitCostCents: unit,
        paymentMethod: r.creditPack.payment?.method ?? null,
        createdAt: r.createdAt.toISOString(),
      };
    });

    return {
      slot: {
        id: slot.id,
        startsAt: slot.startsAt.toISOString(),
        durationMinutes: slot.durationMinutes,
        capacity: slot.capacity,
        status: slot.status,
        kindName: slot.classKind?.name ?? slot.title ?? null,
        instructorName: slot.instructor.name,
        unitId: slot.unitId,
        unitName: slot.unit.name,
      },
      reservations: rows,
      totals: {
        revenueCents,
        realizedReservations: realized,
        bySource: [...bySource.entries()]
          .map(([source, revenueCents]) => ({ source, revenueCents }))
          .sort((a, b) => b.revenueCents - a.revenueCents),
        byMethod: [...byMethod.entries()]
          .map(([method, revenueCents]) => ({ method, revenueCents }))
          .sort((a, b) => b.revenueCents - a.revenueCents),
      },
    };
  }
}

/// Human label for the pack a credit came from. Drives the "pacote" column
/// in the per-class detail. Compact so it doesn't blow up the table.
function packLabelFor(source: CreditSource, totalCredits: number): string {
  switch (source) {
    case CreditSource.PURCHASE_PACK:
      return totalCredits === 1 ? 'avulsa' : `pacote ${totalCredits} aulas`;
    case CreditSource.SUBSCRIPTION_CYCLE:
      return `mensal ${totalCredits} aulas`;
    case CreditSource.ADMIN_GRANT:
      return 'cortesia';
    case CreditSource.REFUND:
      return 'estorno';
    case CreditSource.TRANSFER:
      return 'transferência';
    default:
      return 'crédito';
  }
}

/// `true` when this reservation consumed a credit and therefore generated
/// revenue. Centralizes the 8h-cancellation rule so the finance report and
/// any future "evasão" metric agree.
function isRevenueRealized(
  status: ReservationStatus,
  cancelledAt: Date | null,
  classStartsAt: Date,
): boolean {
  switch (status) {
    case 'CHECKED_IN':
    case 'COMPLETED':
    case 'NO_SHOW':
      return true;
    case 'ACTIVE':
      // ACTIVE on a past slot is a pre-NO_SHOW the cron hasn't promoted
      // yet — count it so the dashboard doesn't blink missing revenue.
      return classStartsAt.getTime() < Date.now();
    case 'CANCELLED_BY_USER': {
      if (!cancelledAt) return false;
      const window = classStartsAt.getTime() - CANCEL_WINDOW_MS;
      return cancelledAt.getTime() >= window;
    }
    case 'CANCELLED_BY_STUDIO':
      return false;
    default:
      return false;
  }
}

/// Returns the cents-per-credit cost of the originating Payment. ADMIN
/// grants, refunds and transfers produce 0 (no fresh money was paid for
/// this credit at this leg).
function unitCostCents(creditPack: {
  totalCredits: number;
  source: CreditSource;
  payment: { amountCents: number; status: string } | null;
}): number {
  if (
    creditPack.source !== CreditSource.PURCHASE_PACK &&
    creditPack.source !== CreditSource.SUBSCRIPTION_CYCLE
  ) {
    return 0;
  }
  if (!creditPack.payment || creditPack.payment.status !== 'PAID') return 0;
  if (creditPack.totalCredits <= 0) return 0;
  return Math.round(creditPack.payment.amountCents / creditPack.totalCredits);
}

/// `YYYY-MM-DD` in UTC. Stable bucket key for the daily-revenue chart.
function isoDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
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
