import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
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
import { PrismaService } from '../prisma/prisma.service';
import { ReservationsService } from '../reservations/reservations.service';
import { WaitlistService } from '../waitlist/waitlist.service';
import { CancelClassSlotDto } from './dto/cancel-class-slot.dto';
import { CreateClassSlotDto } from './dto/create-class-slot.dto';
import { UpdateClassSlotDto } from './dto/update-class-slot.dto';

interface ListFilter {
  unitId: string;
  from?: string;
  to?: string;
  status?: ClassSlotStatus;
}

@Injectable()
export class ClassSlotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reservations: ReservationsService,
    private readonly waitlist: WaitlistService,
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

    const instructor = await this.prisma.user.findUnique({
      where: { id: dto.instructorId },
    });
    if (
      !instructor ||
      instructor.role !== Role.INSTRUCTOR ||
      instructor.unitId !== dto.unitId ||
      !instructor.isActive
    ) {
      throw new BadRequestException('Instrutor inválido para essa unidade');
    }

    // If a kind is supplied, validate + use its default duration as fallback.
    let durationMinutes = dto.durationMinutes;
    if (dto.classKindId) {
      const kind = await this.prisma.classKind.findUnique({
        where: { id: dto.classKindId },
      });
      if (!kind || !kind.isActive) {
        throw new BadRequestException('Tipo de aula inválido ou inativo');
      }
      durationMinutes ??= kind.defaultDurationMinutes;
    }
    if (!durationMinutes) {
      throw new BadRequestException(
        'Informe durationMinutes ou um classKindId válido',
      );
    }

    const startsAt = new Date(dto.startsAt);
    if (Number.isNaN(startsAt.getTime()) || startsAt <= new Date()) {
      throw new BadRequestException('A aula precisa começar no futuro');
    }

    return this.prisma.classSlot.create({
      data: {
        unitId: dto.unitId,
        instructorId: dto.instructorId,
        classKindId: dto.classKindId,
        title: dto.title,
        startsAt,
        durationMinutes,
        capacity: dto.capacity,
      },
    });
  }

  async list(filter: ListFilter) {
    const startsAtFilter: { gte?: Date; lte?: Date } = {};
    if (filter.from) startsAtFilter.gte = new Date(filter.from);
    if (filter.to) startsAtFilter.lte = new Date(filter.to);

    const slots = await this.prisma.classSlot.findMany({
      where: {
        unitId: filter.unitId,
        startsAt:
          Object.keys(startsAtFilter).length > 0 ? startsAtFilter : undefined,
        status: filter.status,
      },
      include: {
        classKind: true,
        instructor: { select: { id: true, name: true } },
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
    // Flatten the _count into a derived `freeSpots` so the home page doesn't
    // have to know about ReservationStatus internals.
    return slots.map(({ _count, ...s }) => ({
      ...s,
      reservedCount: _count.reservations,
      freeSpots: Math.max(0, s.capacity - _count.reservations),
    }));
  }

  async findOne(id: string) {
    const slot = await this.prisma.classSlot.findUnique({
      where: { id },
      include: {
        classKind: true,
        instructor: { select: { id: true, name: true } },
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
        instructor: { select: { id: true, name: true } },
      },
    });
    if (!slot) throw new NotFoundException('Aula não encontrada');

    const bikes = await this.prisma.bike.findMany({
      where: { unitId: slot.unitId, status: 'OPERATIONAL' },
      orderBy: { label: 'asc' },
      select: {
        id: true,
        label: true,
        positionX: true,
        positionY: true,
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
      bikes,
      occupiedBikeIds,
      freeSpots: Math.max(0, slot.capacity - reservations.length),
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

  async cancel(
    id: string,
    dto: CancelClassSlotDto,
    user: AuthenticatedUser,
  ) {
    const slot = await this.findOne(id);
    assertCanManageSlot(user, slot);

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
      const bulk = await this.reservations.bulkCancelByStudio(id, user.id, tx);
      const waitlistCleared = await this.waitlist.clearForSlot(id, tx);

      const updated = await tx.classSlot.update({
        where: { id },
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
          cancelledByUserId: user.id,
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
