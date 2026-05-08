import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CancellationKind,
  ClassSlotStatus,
  Prisma,
  StudioCancellationReason,
} from '@prisma/client';
import { ClassSlotsService } from '../class-slots/class-slots.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClassKindDto } from './dto/create-class-kind.dto';
import { UpdateClassKindDto } from './dto/update-class-kind.dto';

const CASCADE_DESCRIPTION = 'tipo de aula removido';

/// Adds `_count.classSlots` (filtered to SCHEDULED) so the admin UI can
/// render impact previews ("excluir cancela 12 aulas").
const KIND_WITH_COUNT = {
  include: {
    _count: {
      select: {
        classSlots: { where: { status: ClassSlotStatus.SCHEDULED } },
      },
    },
  },
} as const;

function flattenCount<T extends { _count: { classSlots: number } }>(row: T) {
  const { _count, ...rest } = row;
  return { ...rest, scheduledSlotsCount: _count.classSlots };
}

@Injectable()
export class ClassKindsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly classSlots: ClassSlotsService,
  ) {}

  async create(dto: CreateClassKindDto) {
    try {
      const created = await this.prisma.classKind.create({
        data: dto,
        ...KIND_WITH_COUNT,
      });
      return flattenCount(created);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('Já existe um tipo de aula com esse slug');
      }
      throw err;
    }
  }

  /// Public — used by the instructor-facing slot-creation form to populate
  /// the "kind" picker. Drops inactive ones. Order = creation time
  /// (oldest first); per-row "displayOrder" was removed in 2026-05.
  async listActive() {
    const rows = await this.prisma.classKind.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
      ...KIND_WITH_COUNT,
    });
    return rows.map(flattenCount);
  }

  /// Admin — includes inactive so admin can re-enable.
  async listAll() {
    const rows = await this.prisma.classKind.findMany({
      orderBy: { createdAt: 'asc' },
      ...KIND_WITH_COUNT,
    });
    return rows.map(flattenCount);
  }

  async findOne(id: string) {
    const kind = await this.prisma.classKind.findUnique({
      where: { id },
      ...KIND_WITH_COUNT,
    });
    if (!kind) throw new NotFoundException('Tipo de aula não encontrado');
    return flattenCount(kind);
  }

  async update(id: string, dto: UpdateClassKindDto) {
    await this.findOne(id);
    const updated = await this.prisma.classKind.update({
      where: { id },
      data: dto,
      ...KIND_WITH_COUNT,
    });
    return flattenCount(updated);
  }

  /// Soft-delete: flips `isActive` off. Existing ClassSlots are preserved
  /// (item 16.2). New slots can no longer be created with this kind because
  /// `class-slots.service` rejects inactive kinds.
  async deactivate(id: string) {
    await this.findOne(id);
    await this.prisma.classKind.update({
      where: { id },
      data: { isActive: false },
    });
  }

  /// Hard-delete with cascade (item 16.2). Cancels every SCHEDULED slot of
  /// this kind via `STUDIO / OUTRO + description="tipo de aula removido"`,
  /// then deletes the kind row. Returns the count of slots cancelled so the
  /// frontend can show a confirmation toast.
  ///
  /// Slots already in a terminal state (cancelled/completed) are untouched
  /// but get their `classKindId` nulled so the FK doesn't block the delete.
  async cascadeDelete(id: string): Promise<{ classSlotsCancelled: number }> {
    await this.findOne(id);

    const scheduled = await this.prisma.classSlot.findMany({
      where: { classKindId: id, status: ClassSlotStatus.SCHEDULED },
      select: { id: true },
    });

    let cancelled = 0;
    for (const slot of scheduled) {
      try {
        await this.classSlots.cancelByCron(slot.id, {
          kind: CancellationKind.STUDIO,
          studioReason: StudioCancellationReason.OUTRO,
          description: CASCADE_DESCRIPTION,
        });
        cancelled++;
      } catch {
        // Ignore — slot may have transitioned via another path between
        // findMany and cancel. We still want to delete the kind row.
      }
    }

    // Null the FK on remaining (terminal) slots so the hard-delete succeeds.
    // `ClassSlot.classKindId` is nullable, so this is safe.
    await this.prisma.classSlot.updateMany({
      where: { classKindId: id },
      data: { classKindId: null },
    });

    await this.prisma.classKind.delete({ where: { id } });
    return { classSlotsCancelled: cancelled };
  }
}
