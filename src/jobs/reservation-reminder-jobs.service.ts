import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { ClassSlotStatus, ReservationStatus } from '@prisma/client';
import { MailerService } from '../mailer/mailer.service';
import { PrismaService } from '../prisma/prisma.service';

/// Window around the "2h before" mark. The cron ticks every 15 min, so we
/// cover a 30-min window centered on `now + 2h` to catch every reservation
/// at least once (with overlap on the boundaries). Dedup happens by
/// checking EmailLog for a previous RESERVATION_REMINDER row keyed on the
/// reservation id.
const REMINDER_TARGET_MINUTES = 120;
const REMINDER_WINDOW_HALF_MINUTES = 15;

@Injectable()
export class ReservationReminderJobsService {
  private readonly logger = new Logger(ReservationReminderJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
  ) {}

  private appUrl(): string {
    return (this.config.get<string>('APP_URL') ?? 'http://localhost:5173').replace(/\/$/, '');
  }

  @Cron('*/15 * * * *', { name: 'reservation-reminder-2h' })
  async tick(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    if (process.env.JOBS_DISABLED === 'true') return;
    try {
      const sent = await this.sendDueReminders();
      if (sent > 0) this.logger.log(`sent ${sent} 2h-reminder e-mail(s)`);
    } catch (err) {
      this.logger.error('reservation-reminder-2h tick failed', err);
    }
  }

  async sendDueReminders(): Promise<number> {
    const now = Date.now();
    const windowStart = new Date(
      now + (REMINDER_TARGET_MINUTES - REMINDER_WINDOW_HALF_MINUTES) * 60_000,
    );
    const windowEnd = new Date(
      now + (REMINDER_TARGET_MINUTES + REMINDER_WINDOW_HALF_MINUTES) * 60_000,
    );

    const candidates = await this.prisma.reservation.findMany({
      where: {
        status: { in: [ReservationStatus.ACTIVE, ReservationStatus.CHECKED_IN] },
        classSlot: {
          status: ClassSlotStatus.SCHEDULED,
          startsAt: { gte: windowStart, lte: windowEnd },
        },
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        bike: { select: { label: true } },
        classSlot: {
          include: {
            classKind: { select: { name: true } },
            instructor: { select: { name: true } },
          },
        },
      },
    });

    let sent = 0;
    for (const reservation of candidates) {
      if (!reservation.user) continue;
      const already = await this.prisma.emailLog.findFirst({
        where: {
          template: 'RESERVATION_REMINDER',
          userId: reservation.userId,
          payload: { path: ['reservationId'], equals: reservation.id },
        },
        select: { id: true },
      });
      if (already) continue;
      try {
        await this.mailer.send({
          template: 'RESERVATION_REMINDER',
          to: reservation.user.email,
          userId: reservation.user.id,
          payload: {
            name: reservation.user.name,
            classKind:
              reservation.classSlot.classKind?.name ?? reservation.classSlot.title ?? 'aula',
            instructorName: reservation.classSlot.instructor?.name ?? 'instrutor',
            startsAt: reservation.classSlot.startsAt.toISOString(),
            bikeLabel: reservation.bike.label,
            reservationUrl: `${this.appUrl()}/dashboard`,
            reservationId: reservation.id,
          },
        });
        sent++;
      } catch (err) {
        this.logger.warn(
          `reminder send failed for reservation ${reservation.id}: ${(err as Error).message}`,
        );
      }
    }
    return sent;
  }
}
