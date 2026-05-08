import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FriendRequestStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import {
  formatCode,
  generateUniqueFriendCode,
  normalizeCode,
} from './friend-code';

/// Bidirectional pair stored with deterministic ordering. Helper makes the
/// caller pass the two ids in any order; we sort them so the unique
/// constraint on `(userAId, userBId)` does its job.
function orderPair(idA: string, idB: string): { userAId: string; userBId: string } {
  return idA < idB
    ? { userAId: idA, userBId: idB }
    : { userAId: idB, userBId: idA };
}

export interface FriendListItem {
  userId: string;
  name: string;
  hideReservationsFromFriends: boolean;
  friendsSince: Date;
}

export interface PendingRequestSummary {
  id: string;
  status: FriendRequestStatus;
  createdAt: Date;
  fromUser: { id: string; name: string };
  toUser: { id: string; name: string };
}

@Injectable()
export class FriendsService {
  constructor(private readonly prisma: PrismaService) {}

  /// Returns the user's code, generating one lazily if missing. Idempotent.
  async getMyCode(user: AuthenticatedUser): Promise<{ code: string }> {
    const row = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { friendCode: true },
    });
    if (!row) throw new NotFoundException('User not found');
    if (row.friendCode) return { code: formatCode(row.friendCode) };

    const fresh = await generateUniqueFriendCode(this.prisma);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { friendCode: fresh },
    });
    return { code: formatCode(fresh) };
  }

  /// Burn the current code and issue a new one — used when the user feels
  /// the code leaked (posted publicly, sent to wrong group, etc.). Returns
  /// the new code.
  async regenerateCode(user: AuthenticatedUser): Promise<{ code: string }> {
    const fresh = await generateUniqueFriendCode(this.prisma);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { friendCode: fresh },
    });
    return { code: formatCode(fresh) };
  }

  /// Send a friend request to the holder of `rawCode`. Smart cases:
  ///  - Code resolves to the caller themselves → 400.
  ///  - Already friends → 409.
  ///  - Caller already has a PENDING outgoing request to that user → 409.
  ///  - The OTHER user has a PENDING request to the caller → auto-accept.
  ///    (Avoids the awkward "we both sent at the same time" deadlock.)
  async sendRequest(rawCode: string, user: AuthenticatedUser) {
    const code = normalizeCode(rawCode);
    if (!code) throw new BadRequestException('Código inválido');

    const target = await this.prisma.user.findUnique({
      where: { friendCode: code },
      select: { id: true, name: true },
    });
    if (!target) throw new NotFoundException('Código não encontrado');
    if (target.id === user.id) {
      throw new BadRequestException('Esse é o seu próprio código');
    }

    // Already friends?
    const pair = orderPair(user.id, target.id);
    const existingFriendship = await this.prisma.friendship.findUnique({
      where: { userAId_userBId: pair },
    });
    if (existingFriendship) {
      throw new ConflictException('Você já é amigo dessa pessoa');
    }

    // Reciprocal pending → auto-accept.
    const reciprocal = await this.prisma.friendRequest.findFirst({
      where: {
        fromUserId: target.id,
        toUserId: user.id,
        status: FriendRequestStatus.PENDING,
      },
    });
    if (reciprocal) {
      const accepted = await this.acceptRequestById(reciprocal.id, user);
      return { ...accepted, autoAccepted: true };
    }

    // Already sent a PENDING ourselves?
    const alreadyOutgoing = await this.prisma.friendRequest.findFirst({
      where: {
        fromUserId: user.id,
        toUserId: target.id,
        status: FriendRequestStatus.PENDING,
      },
      select: { id: true },
    });
    if (alreadyOutgoing) {
      throw new ConflictException('Você já tem uma solicitação pendente');
    }

    const created = await this.prisma.friendRequest.create({
      data: {
        fromUserId: user.id,
        toUserId: target.id,
        status: FriendRequestStatus.PENDING,
      },
      include: {
        fromUser: { select: { id: true, name: true } },
        toUser: { select: { id: true, name: true } },
      },
    });
    return { ...created, autoAccepted: false };
  }

  /// List of incoming + outgoing PENDING requests for the user.
  async listPendingRequests(user: AuthenticatedUser): Promise<{
    incoming: PendingRequestSummary[];
    outgoing: PendingRequestSummary[];
  }> {
    const rows = await this.prisma.friendRequest.findMany({
      where: {
        status: FriendRequestStatus.PENDING,
        OR: [{ fromUserId: user.id }, { toUserId: user.id }],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        fromUser: { select: { id: true, name: true } },
        toUser: { select: { id: true, name: true } },
      },
    });

    const incoming: PendingRequestSummary[] = [];
    const outgoing: PendingRequestSummary[] = [];
    for (const r of rows) {
      const summary: PendingRequestSummary = {
        id: r.id,
        status: r.status,
        createdAt: r.createdAt,
        fromUser: r.fromUser,
        toUser: r.toUser,
      };
      if (r.fromUserId === user.id) outgoing.push(summary);
      else incoming.push(summary);
    }
    return { incoming, outgoing };
  }

  async acceptRequest(id: string, user: AuthenticatedUser) {
    return this.acceptRequestById(id, user);
  }

  /// Internal accept used both by the controller and by the
  /// auto-accept path inside `sendRequest`.
  private async acceptRequestById(id: string, user: AuthenticatedUser) {
    const request = await this.prisma.friendRequest.findUnique({
      where: { id },
    });
    if (!request) throw new NotFoundException('Solicitação não encontrada');
    if (request.toUserId !== user.id) {
      throw new ForbiddenException('Essa solicitação não é sua');
    }
    if (request.status !== FriendRequestStatus.PENDING) {
      throw new BadRequestException('Solicitação não está pendente');
    }

    const pair = orderPair(request.fromUserId, request.toUserId);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.friendRequest.update({
        where: { id },
        data: {
          status: FriendRequestStatus.ACCEPTED,
          respondedAt: new Date(),
        },
      });
      // Friendship may already exist if the same pair sent both directions
      // and one auto-accepted — guard with upsert.
      await tx.friendship.upsert({
        where: { userAId_userBId: pair },
        create: pair,
        update: {},
      });
      return updated;
    });
  }

  async declineRequest(id: string, user: AuthenticatedUser) {
    const request = await this.prisma.friendRequest.findUnique({
      where: { id },
    });
    if (!request) throw new NotFoundException('Solicitação não encontrada');
    if (request.toUserId !== user.id) {
      throw new ForbiddenException('Essa solicitação não é sua');
    }
    if (request.status !== FriendRequestStatus.PENDING) {
      throw new BadRequestException('Solicitação não está pendente');
    }
    return this.prisma.friendRequest.update({
      where: { id },
      data: {
        status: FriendRequestStatus.DECLINED,
        respondedAt: new Date(),
      },
    });
  }

  async cancelOutgoing(id: string, user: AuthenticatedUser) {
    const request = await this.prisma.friendRequest.findUnique({
      where: { id },
    });
    if (!request) throw new NotFoundException('Solicitação não encontrada');
    if (request.fromUserId !== user.id) {
      throw new ForbiddenException('Essa solicitação não foi enviada por você');
    }
    if (request.status !== FriendRequestStatus.PENDING) {
      throw new BadRequestException('Solicitação não está pendente');
    }
    return this.prisma.friendRequest.update({
      where: { id },
      data: {
        status: FriendRequestStatus.CANCELLED,
        respondedAt: new Date(),
      },
    });
  }

  /// List of accepted friends. Returns the OTHER user's id + name plus their
  /// `hideReservationsFromFriends` flag (so the friends-attending view can
  /// pre-filter on the client too if it wants).
  async listFriends(user: AuthenticatedUser): Promise<FriendListItem[]> {
    const rows = await this.prisma.friendship.findMany({
      where: {
        OR: [{ userAId: user.id }, { userBId: user.id }],
      },
      include: {
        userA: {
          select: {
            id: true,
            name: true,
            hideReservationsFromFriends: true,
          },
        },
        userB: {
          select: {
            id: true,
            name: true,
            hideReservationsFromFriends: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => {
      const other = r.userAId === user.id ? r.userB : r.userA;
      return {
        userId: other.id,
        name: other.name,
        hideReservationsFromFriends: other.hideReservationsFromFriends,
        friendsSince: r.createdAt,
      };
    });
  }

  /// Friend ids only — used by `class-slots.service.friendsAttending` and
  /// other internal flows where the name/avatar isn't needed.
  async listFriendIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.friendship.findMany({
      where: {
        OR: [{ userAId: userId }, { userBId: userId }],
      },
      select: { userAId: true, userBId: true },
    });
    return rows.map((r) => (r.userAId === userId ? r.userBId : r.userAId));
  }

  /// Hard-delete the friendship row. Bidirectional by definition. The
  /// historical `FriendRequest` rows are preserved — re-friending creates
  /// a fresh PENDING request normally.
  async removeFriend(friendUserId: string, user: AuthenticatedUser) {
    const pair = orderPair(user.id, friendUserId);
    const existing = await this.prisma.friendship.findUnique({
      where: { userAId_userBId: pair },
    });
    if (!existing) {
      throw new NotFoundException('Vocês não são amigos');
    }
    await this.prisma.friendship.delete({
      where: { userAId_userBId: pair },
    });
    return { removed: true };
  }

  async updateVisibility(
    user: AuthenticatedUser,
    hideReservationsFromFriends: boolean,
  ) {
    return this.prisma.user.update({
      where: { id: user.id },
      data: { hideReservationsFromFriends },
      select: {
        id: true,
        hideReservationsFromFriends: true,
      },
    });
  }
}
