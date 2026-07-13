import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CreditSource, FriendRequestStatus } from '@prisma/client';
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
        note: dto.note?.trim() || null,
      },
    });
  }

  /// Recent admin gifts (source=ADMIN_GRANT), newest first — powers the
  /// "presentes" history in the admin. Global (packs aren't unit-scoped).
  async listGrants(limit = 50) {
    return this.prisma.creditPack.findMany({
      where: { source: CreditSource.ADMIN_GRANT },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
      select: {
        id: true,
        totalCredits: true,
        remainingCredits: true,
        note: true,
        expiresAt: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });
  }

  /// Returns "consumable" packs — both packs the user owns AND packs they
  /// were added to as a co-owner. Both pools count toward `me`'s credit.
  async findActiveForUser(userId: string) {
    return this.prisma.creditPack.findMany({
      where: {
        AND: [
          {
            OR: [
              { userId },
              { coOwners: { some: { userId } } },
            ],
          },
          { remainingCredits: { gt: 0 } },
          {
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
        ],
      },
      orderBy: { expiresAt: 'asc' },
      include: {
        coOwners: {
          select: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });
  }

  async findAllForUser(userId: string) {
    return this.prisma.creditPack.findMany({
      where: {
        OR: [
          { userId },
          { coOwners: { some: { userId } } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        coOwners: {
          select: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });
  }

  /// 2026-05 — transfer N credits from this user's pack to a friend.
  /// Validations:
  /// - Pack belongs to the caller (not co-owner — only the owner can move
  ///   credits out of the bucket).
  /// - `pack.isTransferable` is true.
  /// - Caller has an accepted Friendship with `toUserId`.
  /// - `count` <= `pack.remainingCredits`.
  /// Effect (single tx): decrement source pack, create new pack on the
  /// friend with source=TRANSFER and the SAME expiry. Friend now has a
  /// brand-new pack — they can't share it back further (default flags).
  async transferToFriend(
    packId: string,
    fromUserId: string,
    toUserId: string,
    count: number,
  ) {
    if (!Number.isInteger(count) || count <= 0) {
      throw new BadRequestException('Quantidade inválida');
    }
    if (fromUserId === toUserId) {
      throw new BadRequestException('Não dá pra transferir pra você mesmo');
    }
    await this.assertAcceptedFriendship(fromUserId, toUserId);

    return this.prisma.$transaction(async (tx) => {
      const pack = await tx.creditPack.findUnique({ where: { id: packId } });
      if (!pack) throw new NotFoundException('Pacote não encontrado');
      if (pack.userId !== fromUserId) {
        throw new ForbiddenException('Você não é dono desse pacote');
      }
      if (!pack.isTransferable) {
        throw new BadRequestException(
          'Esse pacote não pode ser transferido',
        );
      }
      if (pack.remainingCredits < count) {
        throw new BadRequestException(
          `Só ${pack.remainingCredits} crédito(s) disponíveis`,
        );
      }

      const dec = await tx.creditPack.updateMany({
        where: { id: pack.id, remainingCredits: { gte: count } },
        data: { remainingCredits: { decrement: count } },
      });
      if (dec.count === 0) {
        // Concurrent consumer drained the pack between findUnique and
        // updateMany. Surface a 409-ish so the FE can refresh.
        throw new BadRequestException(
          'Saldo do pacote mudou — atualiza e tenta de novo',
        );
      }

      // Friend gets a fresh pack. Inherits the source pack's expiry so
      // gifting an expired-soon pack doesn't extend its life.
      return tx.creditPack.create({
        data: {
          userId: toUserId,
          source: CreditSource.TRANSFER,
          totalCredits: count,
          remainingCredits: count,
          expiresAt: pack.expiresAt,
          // Transferred packs default to non-transferable / non-shareable
          // so the chain doesn't go infinite.
          isTransferable: false,
          maxSharedUsers: 0,
        },
      });
    });
  }

  /// 2026-05 — add friends as co-owners of a CreditPack. Co-owners
  /// consume from the same `remainingCredits` pool. Buyer counts as the
  /// implicit owner; co-owner count is bounded by `pack.maxSharedUsers`.
  async addCoOwners(
    packId: string,
    fromUserId: string,
    friendUserIds: string[],
  ) {
    if (!Array.isArray(friendUserIds) || friendUserIds.length === 0) {
      throw new BadRequestException('Escolha pelo menos um amigo');
    }
    const unique = Array.from(new Set(friendUserIds));
    if (unique.includes(fromUserId)) {
      throw new BadRequestException(
        'Você é o dono — não precisa se adicionar',
      );
    }
    // Friendship check happens up-front for every candidate so we either
    // commit all or none.
    for (const fid of unique) {
      await this.assertAcceptedFriendship(fromUserId, fid);
    }

    return this.prisma.$transaction(async (tx) => {
      const pack = await tx.creditPack.findUnique({
        where: { id: packId },
        include: { coOwners: true },
      });
      if (!pack) throw new NotFoundException('Pacote não encontrado');
      if (pack.userId !== fromUserId) {
        throw new ForbiddenException('Você não é dono desse pacote');
      }
      if (pack.maxSharedUsers <= 0) {
        throw new BadRequestException(
          'Esse pacote não pode ser compartilhado',
        );
      }
      const currentCount = pack.coOwners.length;
      const newCount = currentCount + unique.length;
      if (newCount > pack.maxSharedUsers) {
        throw new BadRequestException(
          `Esse pacote permite até ${pack.maxSharedUsers} amigo(s); você já tem ${currentCount}`,
        );
      }

      // createMany skipDuplicates so re-adding an existing co-owner is a no-op.
      await tx.creditPackCoOwner.createMany({
        data: unique.map((userId) => ({
          creditPackId: pack.id,
          userId,
        })),
        skipDuplicates: true,
      });

      return tx.creditPack.findUnique({
        where: { id: pack.id },
        include: {
          coOwners: {
            include: {
              user: { select: { id: true, name: true, email: true } },
            },
          },
        },
      });
    });
  }

  async removeCoOwner(
    packId: string,
    fromUserId: string,
    coOwnerUserId: string,
  ) {
    const pack = await this.prisma.creditPack.findUnique({
      where: { id: packId },
    });
    if (!pack) throw new NotFoundException('Pacote não encontrado');
    if (pack.userId !== fromUserId) {
      throw new ForbiddenException('Você não é dono desse pacote');
    }
    await this.prisma.creditPackCoOwner.deleteMany({
      where: { creditPackId: packId, userId: coOwnerUserId },
    });
  }

  /// Throws ForbiddenException unless `a` and `b` have an ACCEPTED Friendship.
  /// (FriendRequest in PENDING is not enough — need the live friendship row.)
  private async assertAcceptedFriendship(a: string, b: string) {
    const [low, high] = a < b ? [a, b] : [b, a];
    const friendship = await this.prisma.friendship.findUnique({
      where: { userAId_userBId: { userAId: low, userBId: high } },
    });
    if (!friendship) {
      throw new ForbiddenException({
        code: 'NOT_FRIENDS',
        message: 'Vocês precisam ser amigos antes — peça pra adicionar.',
      });
    }
    void FriendRequestStatus; // keeps the import alive when nothing else uses it
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
