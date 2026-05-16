import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  LIABILITY_VALIDITY_DAYS,
  PARQ_VALIDITY_DAYS,
} from '../common/constants';
import { MailerService } from '../mailer/mailer.service';
import { PrismaService } from '../prisma/prisma.service';

/// We warn the user a few days before each gate expires. Liability renews
/// monthly so the warn window is short (7 days). PAR-Q renews quarterly so
/// the window is wider (14 days). One warning per acceptance — dedup is
/// done by checking EmailLog for the same `dedupKey` (which embeds the
/// latest acceptance row id).
const LIABILITY_WARN_DAYS = 7;
const PARQ_WARN_DAYS = 14;

@Injectable()
export class HealthGateExpiringJobsService {
  private readonly logger = new Logger(HealthGateExpiringJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
  ) {}

  private appUrl(): string {
    return (this.config.get<string>('APP_URL') ?? 'http://localhost:5173').replace(/\/$/, '');
  }

  /// Runs once a day at ~09:00 server time. Cheap query — only touches the
  /// latest acceptance per user.
  @Cron('0 9 * * *', { name: 'health-gate-expiring' })
  async tick(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    if (process.env.JOBS_DISABLED === 'true') return;
    try {
      const sent = await this.sendExpiringWarnings();
      if (sent > 0) this.logger.log(`sent ${sent} health-gate-expiring e-mail(s)`);
    } catch (err) {
      this.logger.error('health-gate-expiring tick failed', err);
    }
  }

  async sendExpiringWarnings(): Promise<number> {
    return (
      (await this.sendLiabilityWarnings()) +
      (await this.sendParqWarnings())
    );
  }

  private async sendLiabilityWarnings(): Promise<number> {
    const cutoff = new Date(
      Date.now() - (LIABILITY_VALIDITY_DAYS - LIABILITY_WARN_DAYS) * 86_400_000,
    );
    // The expiry sits at `acceptedAt + 30d`. We want users whose latest
    // acceptance is between [30-7, 30] days old → acceptedAt in (lower, cutoff].
    const lower = new Date(Date.now() - LIABILITY_VALIDITY_DAYS * 86_400_000);

    const rows = await this.prisma.liabilityAcceptance.findMany({
      where: { acceptedAt: { gt: lower, lte: cutoff } },
      orderBy: { acceptedAt: 'desc' },
      include: { user: { select: { id: true, name: true, email: true, isActive: true } } },
    });
    // Keep only the *latest* row per user (the user may have multiple
    // acceptances historically; we only warn about the freshest one).
    const seen = new Set<string>();
    const latestPerUser = rows.filter((r) => {
      if (seen.has(r.userId)) return false;
      seen.add(r.userId);
      return true;
    });

    let sent = 0;
    for (const row of latestPerUser) {
      if (!row.user?.isActive) continue;
      const dedupKey = `LIABILITY:${row.id}`;
      const already = await this.prisma.emailLog.findFirst({
        where: {
          template: 'HEALTH_GATE_EXPIRING',
          userId: row.userId,
          payload: { path: ['dedupKey'], equals: dedupKey },
        },
        select: { id: true },
      });
      if (already) continue;
      const expiresAt = new Date(
        row.acceptedAt.getTime() + LIABILITY_VALIDITY_DAYS * 86_400_000,
      );
      try {
        await this.mailer.send({
          template: 'HEALTH_GATE_EXPIRING',
          to: row.user.email,
          userId: row.user.id,
          payload: {
            name: row.user.name,
            kind: 'LIABILITY',
            expiresAt: expiresAt.toISOString(),
            renewUrl: `${this.appUrl()}/saude`,
            lastAcceptedAt: row.acceptedAt.toISOString(),
            dedupKey,
          },
        });
        sent++;
      } catch (err) {
        this.logger.warn(
          `liability-expiring email failed for ${row.userId}: ${(err as Error).message}`,
        );
      }
    }
    return sent;
  }

  private async sendParqWarnings(): Promise<number> {
    const cutoff = new Date(
      Date.now() - (PARQ_VALIDITY_DAYS - PARQ_WARN_DAYS) * 86_400_000,
    );
    const lower = new Date(Date.now() - PARQ_VALIDITY_DAYS * 86_400_000);

    const rows = await this.prisma.parqResponse.findMany({
      where: { acceptedAt: { gt: lower, lte: cutoff } },
      orderBy: { acceptedAt: 'desc' },
      include: { user: { select: { id: true, name: true, email: true, isActive: true } } },
    });
    const seen = new Set<string>();
    const latestPerUser = rows.filter((r) => {
      if (seen.has(r.userId)) return false;
      seen.add(r.userId);
      return true;
    });

    let sent = 0;
    for (const row of latestPerUser) {
      if (!row.user?.isActive) continue;
      const dedupKey = `PARQ:${row.id}`;
      const already = await this.prisma.emailLog.findFirst({
        where: {
          template: 'HEALTH_GATE_EXPIRING',
          userId: row.userId,
          payload: { path: ['dedupKey'], equals: dedupKey },
        },
        select: { id: true },
      });
      if (already) continue;
      const expiresAt = new Date(
        row.acceptedAt.getTime() + PARQ_VALIDITY_DAYS * 86_400_000,
      );
      try {
        await this.mailer.send({
          template: 'HEALTH_GATE_EXPIRING',
          to: row.user.email,
          userId: row.user.id,
          payload: {
            name: row.user.name,
            kind: 'PARQ',
            expiresAt: expiresAt.toISOString(),
            renewUrl: `${this.appUrl()}/saude`,
            lastAcceptedAt: row.acceptedAt.toISOString(),
            dedupKey,
          },
        });
        sent++;
      } catch (err) {
        this.logger.warn(
          `parq-expiring email failed for ${row.userId}: ${(err as Error).message}`,
        );
      }
    }
    return sent;
  }
}
