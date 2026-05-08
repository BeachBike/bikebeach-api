import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BikeStatus, Prisma, Role } from '@prisma/client';
import { assertCanAccessUnit, isGlobalAdmin } from '../common/tenancy';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';

@Injectable()
export class UnitsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateUnitDto, user: AuthenticatedUser) {
    if (!isGlobalAdmin(user)) {
      throw new ForbiddenException(
        'Apenas admin global pode criar unidades',
      );
    }
    try {
      return await this.prisma.unit.create({ data: dto });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('Slug já em uso');
      }
      throw err;
    }
  }

  /// Public endpoint feeds the marketing home — include the operational bike
  /// count so the landing can render "32 bikes por turma" dynamically.
  async findAll(includeInactive = false) {
    const units = await this.prisma.unit.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: { bikes: { where: { status: BikeStatus.OPERATIONAL } } },
        },
      },
    });
    return units.map(({ _count, ...u }) => ({
      ...u,
      operationalBikeCount: _count.bikes,
    }));
  }

  async findOne(id: string) {
    const unit = await this.prisma.unit.findUnique({
      where: { id },
      include: {
        _count: {
          select: { bikes: { where: { status: BikeStatus.OPERATIONAL } } },
        },
      },
    });
    if (!unit) throw new NotFoundException('Unidade não encontrada');
    const { _count, ...rest } = unit;
    return { ...rest, operationalBikeCount: _count.bikes };
  }

  async update(id: string, dto: UpdateUnitDto, user: AuthenticatedUser) {
    const unit = await this.findOne(id);
    assertCanAccessUnit(user, unit.id);
    return this.prisma.unit.update({ where: { id }, data: dto });
  }

  async deactivate(id: string, user: AuthenticatedUser) {
    if (!isGlobalAdmin(user)) {
      throw new ForbiddenException(
        'Apenas admin global pode desativar unidades',
      );
    }
    await this.findOne(id);
    await this.prisma.unit.update({
      where: { id },
      data: { isActive: false },
    });
  }

  /// Public — top-N active instructors of the unit, ordered by createdAt asc
  /// (longest tenure first). Returns only the public-safe fields used on
  /// the home page card. Hides email, role, status etc. (D2 / item 2).
  ///
  /// 2026-05 — multi-arena: filters via the new `InstructorArena` M2M so
  /// the same instructor can show up under multiple arenas.
  async listFeaturedInstructors(unitId: string, limit = 4) {
    const safeLimit = Math.min(Math.max(1, limit), 12);
    const rows = await this.prisma.user.findMany({
      where: {
        arenaAssignments: { some: { unitId } },
        role: Role.INSTRUCTOR,
        isActive: true,
      },
      orderBy: { createdAt: 'asc' },
      take: safeLimit,
      select: {
        id: true,
        name: true,
        bio: true,
        primaryClassKind: {
          select: {
            id: true,
            slug: true,
            name: true,
            colorToken: true,
          },
        },
      },
    });
    return rows;
  }
}
