import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CreditSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GrantCreditPackDto } from './dto/grant-credit-pack.dto';

@Injectable()
export class CreditPacksService {
  private readonly logger = new Logger(CreditPacksService.name);

  constructor(private readonly prisma: PrismaService) {}

  async grant(dto: GrantCreditPackDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });
    if (!user) throw new BadRequestException('Usuário não encontrado');

    return this.prisma.creditPack.create({
      data: {
        userId: dto.userId,
        source: CreditSource.ADMIN_GRANT,
        totalCredits: dto.credits,
        remainingCredits: dto.credits,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });
  }

  /// Active = has remaining credits AND not expired.
  /// Sorted oldest-expiring first (matches reservation consumption order).
  async findActiveForUser(userId: string) {
    return this.prisma.creditPack.findMany({
      where: {
        userId,
        remainingCredits: { gt: 0 },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { expiresAt: 'asc' },
    });
  }

  async findAllForUser(userId: string) {
    return this.prisma.creditPack.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /// Zeroes `remainingCredits` on every pack whose `expiresAt < now` and
  /// still has credits. Returns the number of packs touched.
  ///
  /// Note: expiration is ALSO enforced at lookup time (every active-credit
  /// query filters `expiresAt > now`), so this method is operationally
  /// cosmetic — its real value is observability ("X packs expired today")
  /// and admin dashboards that want a single `remainingCredits > 0` filter
  /// without joining on date math.
  async expireOverduePacks(): Promise<number> {
    const result = await this.prisma.creditPack.updateMany({
      where: {
        expiresAt: { lt: new Date() },
        remainingCredits: { gt: 0 },
      },
      data: { remainingCredits: 0 },
    });
    return result.count;
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async runDailyExpiryJob(): Promise<void> {
    const count = await this.expireOverduePacks();
    if (count > 0) {
      this.logger.log(`Expired ${count} overdue credit pack(s)`);
    }
  }
}
