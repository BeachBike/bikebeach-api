import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  CancellationKind,
  ClassSlotStatus,
  StudioCancellationReason,
} from '@prisma/client';
import { ClassSlotsService } from '../class-slots/class-slots.service';
import { PrismaService } from '../prisma/prisma.service';

/// Tolerance window for the "auto-cancel zero-attendance" job. We mark
/// slots as cancelled-baixa-adesao when the start time has passed AND
/// there were 0 active/checked-in reservations. This is the same window
/// the studio uses for late check-ins (5 min default per Unit), but we
/// hard-code 5 here for simplicity — refine if needed.
const ZERO_ATTENDANCE_GRACE_MS = 5 * 60_000;

/// F2 — grace given to the instructor to tap "confirmar início" before
/// the cron auto-confirms on their behalf. After this window, every
/// remaining ACTIVE reservation is swept into CHECKED_IN automatically.
const AUTO_CONFIRM_GRACE_MS = 10 * 60_000;

/// Cron jobs that drive ClassSlot lifecycle transitions automatically.
///
/// Runs every minute (`@Cron(CronExpression.EVERY_MINUTE)`):
///   1. **autoCancelEmpty** — slots that started >= 5 min ago with zero
///      `ACTIVE`/`CHECKED_IN` reservations get cancelled as
///      `STUDIO / BAIXA_ADESAO`. Excluded from metrics, reservations get
///      refunded (no-op since none exist), audit trail records the cancel.
///   2. **markCompleted** — slots whose `startsAt + durationMinutes` is in
///      the past transition `SCHEDULED → COMPLETED`. Their reservations
///      transition `ACTIVE → NO_SHOW` and `CHECKED_IN → COMPLETED`.
///
/// Order matters: autoCancel runs first so empty slots become CANCELLED
/// instead of COMPLETED. Both jobs are idempotent — re-running picks no-ops
/// because the WHERE clauses filter on `status = SCHEDULED`.
///
/// Disabled when NODE_ENV=test so e2e suites don't race against the cron.
@Injectable()
export class ClassSlotJobsService {
  private readonly logger = new Logger(ClassSlotJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly classSlots: ClassSlotsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'class-slot-tick' })
  async tick() {
    if (process.env.NODE_ENV === 'test') return;
    if (process.env.JOBS_DISABLED === 'true') return;

    try {
      await this.autoCancelEmpty();
    } catch (err) {
      this.logger.error('autoCancelEmpty failed', err);
    }
    try {
      await this.autoConfirmStart();
    } catch (err) {
      this.logger.error('autoConfirmStart failed', err);
    }
    try {
      await this.markCompleted();
    } catch (err) {
      this.logger.error('markCompleted failed', err);
    }
  }

  /// Slots that started >= GRACE_MS ago, are still SCHEDULED, and have zero
  /// effective reservations. Cancel as STUDIO / BAIXA_ADESAO.
  async autoCancelEmpty() {
    const now = new Date();
    const cutoff = new Date(now.getTime() - ZERO_ATTENDANCE_GRACE_MS);

    const candidates = await this.prisma.classSlot.findMany({
      where: {
        status: ClassSlotStatus.SCHEDULED,
        startsAt: { lte: cutoff },
      },
      select: {
        id: true,
        startsAt: true,
        durationMinutes: true,
        _count: {
          select: {
            reservations: {
              where: { status: { in: ['ACTIVE', 'CHECKED_IN'] } },
            },
          },
        },
      },
    });

    const empty = candidates.filter((c) => c._count.reservations === 0);
    if (empty.length === 0) return;

    for (const slot of empty) {
      // Don't auto-cancel slots already in their "should-be-completed"
      // window — let `markCompleted` claim them so we don't churn the audit
      // trail with cancellations for classes that already wrapped.
      const endsAt =
        slot.startsAt.getTime() + slot.durationMinutes * 60_000;
      if (endsAt < now.getTime()) continue;

      try {
        await this.classSlots.cancelByCron(slot.id, {
          kind: CancellationKind.STUDIO,
          studioReason: StudioCancellationReason.BAIXA_ADESAO,
          description: 'auto: sem alunos no início',
        });
        this.logger.log(`auto-cancelled empty slot ${slot.id}`);
      } catch (err) {
        // Most likely the slot transitioned via another path between the
        // findMany and the cancel — log and move on.
        this.logger.warn(
          `auto-cancel skipped slot ${slot.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  /// Slots whose `startsAt + GRACE` is in the past, are still SCHEDULED,
  /// have at least one ACTIVE reservation, and have NOT been manually
  /// confirmed yet. Promotes them via `autoConfirmStartFor()`. Logged so
  /// admin can see which instructors keep skipping the manual tap.
  async autoConfirmStart() {
    const now = new Date();
    const cutoff = new Date(now.getTime() - AUTO_CONFIRM_GRACE_MS);

    const candidates = await this.prisma.classSlot.findMany({
      where: {
        status: ClassSlotStatus.SCHEDULED,
        startsAt: { lte: cutoff },
        confirmedStartedAt: null,
      },
      select: {
        id: true,
        startsAt: true,
        durationMinutes: true,
        _count: {
          select: {
            reservations: { where: { status: 'ACTIVE' } },
          },
        },
      },
    });

    const ready = candidates.filter((c) => {
      // Skip slots that already finished — markCompleted will own them.
      const endsAt =
        c.startsAt.getTime() + c.durationMinutes * 60_000;
      return endsAt > now.getTime() && c._count.reservations > 0;
    });
    if (ready.length === 0) return;

    for (const slot of ready) {
      try {
        await this.classSlots.autoConfirmStartFor(slot.id);
        this.logger.log(`auto-confirmed start of slot ${slot.id}`);
      } catch (err) {
        this.logger.warn(
          `auto-confirm skipped slot ${slot.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  /// Slots whose end-time has passed and are still SCHEDULED → COMPLETED.
  async markCompleted() {
    const now = new Date();

    // Pull slots whose start is far enough in the past that
    // (start + duration) has definitely passed. We then recheck per-slot
    // because durationMinutes varies.
    const candidates = await this.prisma.classSlot.findMany({
      where: {
        status: ClassSlotStatus.SCHEDULED,
        startsAt: {
          // Anything that started more than 4h ago is past max duration
          // (capped at 180 min by the DTO). That's the broad sieve; the
          // precise check happens per-row.
          lte: new Date(now.getTime() - 15 * 60_000),
        },
      },
      select: { id: true, startsAt: true, durationMinutes: true },
    });

    if (candidates.length === 0) return;

    const ready = candidates.filter((c) => {
      const end = c.startsAt.getTime() + c.durationMinutes * 60_000;
      return end < now.getTime();
    });

    if (ready.length === 0) return;

    for (const slot of ready) {
      try {
        await this.classSlots.completeBySchedule(slot.id);
      } catch (err) {
        this.logger.warn(
          `complete skipped slot ${slot.id}: ${(err as Error).message}`,
        );
      }
    }
    this.logger.log(`marked ${ready.length} slot(s) COMPLETED`);
  }
}
