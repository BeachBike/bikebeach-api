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

    try {
      return await this.prisma.bike.create({ data: dto });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'Já existe uma bike com esse label nessa unidade',
        );
      }
      throw err;
    }
  }

  /// Public list. By default returns only OPERATIONAL bikes (the bookable
  /// set). When `includeAll=true`, admin sees every status (for the seat-map
  /// management UI).
  async findByUnit(unitId: string, includeAll = false) {
    return this.prisma.bike.findMany({
      where: {
        unitId,
        ...(includeAll ? {} : { status: BikeStatus.OPERATIONAL }),
      },
      orderBy: { label: 'asc' },
    });
  }

  async findOne(id: string) {
    const bike = await this.prisma.bike.findUnique({ where: { id } });
    if (!bike) throw new NotFoundException('Bike não encontrada');
    return bike;
  }

  async update(id: string, dto: UpdateBikeDto, user: AuthenticatedUser) {
    const bike = await this.findOne(id);
    assertCanAccessUnit(user, bike.unitId);
    try {
      return await this.prisma.bike.update({ where: { id }, data: dto });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'Já existe uma bike com esse label nessa unidade',
        );
      }
      throw err;
    }
  }

  /// Soft "delete" — flips to OUT_OF_SERVICE so historical reservations stay
  /// referenceable. Admin can later re-enable by PATCHing status back.
  async deactivate(id: string, user: AuthenticatedUser) {
    const bike = await this.findOne(id);
    assertCanAccessUnit(user, bike.unitId);
    await this.prisma.bike.update({
      where: { id },
      data: { status: BikeStatus.OUT_OF_SERVICE },
    });
  }
}
