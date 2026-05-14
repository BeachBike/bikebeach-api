import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BikeStatus, Prisma } from '@prisma/client';
import { assertCanAccessUnit } from '../common/tenancy';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBikeDto } from './dto/create-bike.dto';
import { UpdateBikeDto } from './dto/update-bike.dto';

@Injectable()
export class BikesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateBikeDto, user: AuthenticatedUser) {
    assertCanAccessUnit(user, dto.unitId);

    const unit = await this.prisma.unit.findUnique({
      where: { id: dto.unitId },
    });
    if (!unit || !unit.isActive) {
      throw new BadRequestException('Unidade inválida ou inativa');
    }

    if (dto.row !== undefined || dto.col !== undefined) {
      this.assertWithinBounds(unit, dto.row, dto.col);
    }

    try {
      const deletedWithSameLabel = await this.prisma.bike.findFirst({
        where: {
          unitId: dto.unitId,
          label: dto.label,
          deletedAt: { not: null },
        },
      });

      if (deletedWithSameLabel) {
        return await this.prisma.bike.update({
          where: { id: deletedWithSameLabel.id },
          data: {
            ...dto,
            deletedAt: null,
            status: BikeStatus.OPERATIONAL,
          },
        });
      }

      return await this.prisma.bike.create({ data: dto });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Distinguish label collision vs (row,col) collision so the FE can
        // show a precise message.
        const target = err.meta?.target;
        if (Array.isArray(target) && target.includes('row')) {
          throw new ConflictException(
            'Já existe uma bike nessa posição da arena',
          );
        }
        throw new ConflictException(
          'Já existe uma bike com esse label nessa unidade',
        );
      }
      throw err;
    }
  }

  /// Public list. By default returns only OPERATIONAL bikes (the bookable
  /// set). When `includeAll=true`, admin sees every status (for the seat-map
  /// management UI). Soft-deleted bikes (`deletedAt != null`) are always
  /// hidden — they only exist so historical reservations resolve.
  async findByUnit(unitId: string, includeAll = false) {
    return this.prisma.bike.findMany({
      where: {
        unitId,
        deletedAt: null,
        ...(includeAll ? {} : { status: BikeStatus.OPERATIONAL }),
      },
      orderBy: [{ row: 'asc' }, { col: 'asc' }, { label: 'asc' }],
    });
  }

  async findOne(id: string) {
    const bike = await this.prisma.bike.findUnique({ where: { id } });
    if (!bike) throw new NotFoundException('Bike não encontrada');
    if (bike.deletedAt) throw new NotFoundException('Bike não encontrada');
    return bike;
  }

  async update(id: string, dto: UpdateBikeDto, user: AuthenticatedUser) {
    const bike = await this.findOne(id);
    assertCanAccessUnit(user, bike.unitId);

    if (dto.row !== undefined || dto.col !== undefined) {
      const unit = await this.prisma.unit.findUnique({
        where: { id: bike.unitId },
      });
      if (unit) this.assertWithinBounds(unit, dto.row, dto.col);
    }

    try {
      return await this.prisma.bike.update({ where: { id }, data: dto });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const target = err.meta?.target;
        if (Array.isArray(target) && target.includes('row')) {
          throw new ConflictException(
            'Já existe uma bike nessa posição da arena',
          );
        }
        throw new ConflictException(
          'Já existe uma bike com esse label nessa unidade',
        );
      }
      throw err;
    }
  }

  /// 2026-05 — soft-delete via `deletedAt`. The user-facing "excluir" button
  /// in the bike admin UI calls this. Hard-delete is intentionally NOT
  /// supported because historical reservations reference the row.
  ///
  /// Result is functionally a hide: the bike disappears from every list
  /// + the seat-map + counts toward capacity, but legacy reservations can
  /// still resolve `bike.label`. The arena layout slot (row, col) is
  /// freed (set to null) so a new bike can be cadastrada in the same
  /// physical spot.
  async softDelete(id: string, user: AuthenticatedUser): Promise<void> {
    const bike = await this.findOne(id);
    assertCanAccessUnit(user, bike.unitId);
    await this.prisma.bike.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        row: null,
        col: null,
        // Make doubly sure the bike isn't bookable anymore.
        status: BikeStatus.OUT_OF_SERVICE,
      },
    });
  }

  private assertWithinBounds(
    unit: { maxRows: number; maxCols: number },
    row: string | undefined,
    col: number | undefined,
  ) {
    if (row !== undefined) {
      const idx = row.charCodeAt(0) - 'A'.charCodeAt(0) + 1;
      if (idx < 1 || idx > unit.maxRows) {
        throw new BadRequestException(
          `Fileira fora dos limites da arena (max ${rowLabel(unit.maxRows)})`,
        );
      }
    }
    if (col !== undefined) {
      if (col < 1 || col > unit.maxCols) {
        throw new BadRequestException(
          `Coluna fora dos limites da arena (max ${unit.maxCols})`,
        );
      }
    }
  }
}

function rowLabel(n: number): string {
  return String.fromCharCode('A'.charCodeAt(0) + n - 1);
}
