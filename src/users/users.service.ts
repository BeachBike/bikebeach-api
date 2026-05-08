import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { hash } from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStaffUserDto } from './dto/create-staff-user.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { UpdateStaffUserDto } from './dto/update-staff-user.dto';

const BCRYPT_ROUNDS = 12;

const STAFF_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  unitId: true,
  isActive: true,
  mustChangePassword: true,
  bio: true,
  primaryClassKindId: true,
  createdAt: true,
  primaryClassKind: {
    select: {
      id: true,
      slug: true,
      name: true,
      tone: true,
      colorToken: true,
    },
  },
  instructorSpecialties: {
    select: {
      classKind: {
        select: {
          id: true,
          slug: true,
          name: true,
          tone: true,
          colorToken: true,
        },
      },
    },
  },
  arenaAssignments: {
    select: {
      unit: {
        select: {
          id: true,
          slug: true,
          name: true,
        },
      },
    },
  },
  _count: {
    select: { instructedClassSlots: true },
  },
} as const;

function flattenSpecialties<
  T extends {
    instructorSpecialties: { classKind: unknown }[];
    arenaAssignments: { unit: unknown }[];
    _count?: { instructedClassSlots: number };
  },
>(row: T) {
  const { instructorSpecialties, arenaAssignments, _count, ...rest } = row;
  return {
    ...rest,
    classKinds: instructorSpecialties.map((s) => s.classKind),
    arenas: arenaAssignments.map((a) => a.unit),
    totalClasses: _count?.instructedClassSlots ?? 0,
  };
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async createStaff(dto: CreateStaffUserDto) {
    // 2026-05 — INSTRUCTOR multi-arena: prefer `unitIds` (1+ required).
    // Fall back to legacy single `unitId` for callers that haven't
    // migrated. ADMIN ignores `unitIds` and uses `unitId`.
    let arenaIds: string[] = [];
    if (dto.role === Role.INSTRUCTOR) {
      arenaIds =
        dto.unitIds && dto.unitIds.length > 0
          ? Array.from(new Set(dto.unitIds))
          : dto.unitId
            ? [dto.unitId]
            : [];
      if (arenaIds.length === 0) {
        throw new BadRequestException(
          'Instrutor precisa de pelo menos uma arena (unitIds)',
        );
      }
    }

    // 15.3 — bio is mandatory for INSTRUCTOR (drives the home-page card).
    if (
      dto.role === Role.INSTRUCTOR &&
      (!dto.bio || dto.bio.trim().length === 0)
    ) {
      throw new BadRequestException('Descrição é obrigatória para instrutor');
    }

    // Validate every referenced arena exists. For ADMIN that's `unitId`,
    // for INSTRUCTOR that's the full set.
    const arenaIdsToCheck =
      dto.role === Role.INSTRUCTOR
        ? arenaIds
        : dto.unitId
          ? [dto.unitId]
          : [];
    if (arenaIdsToCheck.length > 0) {
      const found = await this.prisma.unit.findMany({
        where: { id: { in: arenaIdsToCheck } },
        select: { id: true },
      });
      if (found.length !== arenaIdsToCheck.length) {
        throw new BadRequestException(
          'Uma ou mais arenas não foram encontradas',
        );
      }
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException('E-mail já cadastrado');

    // Specialties are only meaningful for INSTRUCTOR — silently drop for ADMIN.
    let specialtyIds =
      dto.role === Role.INSTRUCTOR ? (dto.classKindIds ?? []) : [];

    // 15.3 — INSTRUCTOR must have a primary kind (carro-chefe). For ADMIN
    // we ignore it.
    let primaryClassKindId: string | undefined;
    if (dto.role === Role.INSTRUCTOR) {
      if (!dto.primaryClassKindId) {
        throw new BadRequestException(
          'Carro-chefe (primaryClassKindId) é obrigatório para instrutor',
        );
      }
      primaryClassKindId = dto.primaryClassKindId;
      // Auto-add primary to the specialty list when missing — keeps the UX
      // simple (admin can just pick the kind once).
      if (!specialtyIds.includes(primaryClassKindId)) {
        specialtyIds = [...specialtyIds, primaryClassKindId];
      }
    }

    if (specialtyIds.length) {
      await this.assertClassKindsExist(specialtyIds);
    }

    const passwordHash = await hash(dto.password, BCRYPT_ROUNDS);

    // For INSTRUCTOR keep the legacy `User.unitId` populated with the
    // first arena so old code paths still resolve. Source of truth for
    // multi-arena is `arenaAssignments`.
    const legacyUnitId =
      dto.role === Role.INSTRUCTOR ? arenaIds[0] : dto.unitId;

    const created = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        name: dto.name,
        role: dto.role,
        unitId: legacyUnitId,
        bio: dto.bio,
        primaryClassKindId,
        // Admin sets a temporary password; the staff member is forced to
        // change it on first login. Cleared by /auth/change-password.
        mustChangePassword: true,
        instructorSpecialties: specialtyIds.length
          ? {
              create: specialtyIds.map((classKindId) => ({ classKindId })),
            }
          : undefined,
        arenaAssignments:
          dto.role === Role.INSTRUCTOR && arenaIds.length
            ? {
                create: arenaIds.map((unitId) => ({ unitId })),
              }
            : undefined,
      },
      select: STAFF_SELECT,
    });
    return flattenSpecialties(created);
  }

  async listStaff(filter: { role?: Role; unitId?: string }) {
    const where: Prisma.UserWhereInput = {
      role: filter.role ? filter.role : { in: [Role.INSTRUCTOR, Role.ADMIN] },
    };
    // 2026-05 — when filtering by `unitId`, an INSTRUCTOR matches if the
    // arena is in their `arenaAssignments` M2M. ADMIN keeps using the
    // legacy single-side `User.unitId` (admins are always single-tenant).
    if (filter.unitId) {
      where.OR = [
        { unitId: filter.unitId },
        { arenaAssignments: { some: { unitId: filter.unitId } } },
      ];
    }
    const rows = await this.prisma.user.findMany({
      where,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: STAFF_SELECT,
    });
    const flat = rows.map(flattenSpecialties);

    // Per-instructor "this week" count — drives the prototype's 3-stat card.
    const ids = flat.map((r) => r.id);
    const weekStart = startOfWeekMonday(new Date());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const weekRows = ids.length
      ? await this.prisma.classSlot.groupBy({
          by: ['instructorId'],
          where: {
            instructorId: { in: ids },
            startsAt: { gte: weekStart, lt: weekEnd },
          },
          _count: { _all: true },
        })
      : [];
    const weekMap = new Map(
      weekRows.map((r) => [r.instructorId, r._count._all]),
    );
    return flat.map((r) => ({
      ...r,
      weeklyClasses: weekMap.get(r.id) ?? 0,
    }));
  }

  async updateStaff(id: string, dto: UpdateStaffUserDto) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Usuário não encontrado');
    if (existing.role !== Role.INSTRUCTOR && existing.role !== Role.ADMIN) {
      throw new BadRequestException(
        'Só é possível editar usuários staff (INSTRUCTOR / ADMIN)',
      );
    }

    // 2026-05 — multi-arena patch:
    //   - INSTRUCTOR: prefer `unitIds` (replaces full arena set). When not
    //     supplied but legacy `unitId` is, treat as single-arena reset.
    //     Empty array (`[]`) is rejected (instructor must keep ≥1 arena).
    //   - ADMIN: only `unitId` matters; `unitIds` is silently ignored.
    let nextArenaIds: string[] | undefined;
    if (existing.role === Role.INSTRUCTOR) {
      if (dto.unitIds !== undefined) {
        if (dto.unitIds.length === 0) {
          throw new BadRequestException(
            'Instrutor precisa de pelo menos uma arena',
          );
        }
        nextArenaIds = Array.from(new Set(dto.unitIds));
      } else if (dto.unitId !== undefined) {
        if (!dto.unitId) {
          throw new BadRequestException(
            'Instrutor precisa de pelo menos uma arena',
          );
        }
        nextArenaIds = [dto.unitId];
      }
      if (nextArenaIds) {
        const found = await this.prisma.unit.findMany({
          where: { id: { in: nextArenaIds } },
          select: { id: true },
        });
        if (found.length !== nextArenaIds.length) {
          throw new BadRequestException(
            'Uma ou mais arenas não foram encontradas',
          );
        }
      }
    } else if (dto.unitId !== undefined && dto.unitId) {
      const unit = await this.prisma.unit.findUnique({
        where: { id: dto.unitId },
      });
      if (!unit) throw new BadRequestException('Unidade não encontrada');
    }

    if (
      existing.role === Role.INSTRUCTOR &&
      dto.bio !== undefined &&
      dto.bio.trim().length === 0
    ) {
      throw new BadRequestException('Descrição é obrigatória para instrutor');
    }

    // Compute the effective specialty set — needed both to validate and to
    // ensure the primary kind sits inside it after the update.
    let nextSpecialtyIds: string[] | undefined;
    if (dto.classKindIds && existing.role === Role.INSTRUCTOR) {
      nextSpecialtyIds = [...dto.classKindIds];
    }

    if (dto.primaryClassKindId !== undefined && existing.role === Role.INSTRUCTOR) {
      const ensure = nextSpecialtyIds;
      if (ensure && !ensure.includes(dto.primaryClassKindId)) {
        ensure.push(dto.primaryClassKindId);
      } else if (!ensure) {
        // Specialty set wasn't touched in this PATCH — make sure the new
        // primary lives in the existing specialty rows. If not, push it in.
        const current = await this.prisma.instructorSpecialty.findMany({
          where: { userId: id },
          select: { classKindId: true },
        });
        const ids = current.map((c) => c.classKindId);
        if (!ids.includes(dto.primaryClassKindId)) {
          nextSpecialtyIds = [...ids, dto.primaryClassKindId];
        }
      }
    }

    if (nextSpecialtyIds?.length) {
      await this.assertClassKindsExist(nextSpecialtyIds);
    }
    if (dto.primaryClassKindId) {
      await this.assertClassKindsExist([dto.primaryClassKindId]);
    }

    const data: Prisma.UserUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    // For INSTRUCTOR keep legacy `User.unitId` mirroring the first arena
    // in the new set so any old code path still resolves something. For
    // ADMIN, the legacy column IS the source of truth.
    if (existing.role === Role.INSTRUCTOR) {
      if (nextArenaIds) {
        data.unit = { connect: { id: nextArenaIds[0]! } };
      }
    } else if (dto.unitId !== undefined) {
      data.unit = dto.unitId
        ? { connect: { id: dto.unitId } }
        : { disconnect: true };
    }
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.bio !== undefined) data.bio = dto.bio;
    if (dto.primaryClassKindId !== undefined) {
      data.primaryClassKind = dto.primaryClassKindId
        ? { connect: { id: dto.primaryClassKindId } }
        : { disconnect: true };
    }
    if (dto.password) {
      data.passwordHash = await hash(dto.password, BCRYPT_ROUNDS);
      data.mustChangePassword = true;
    }

    return this.prisma.$transaction(async (tx) => {
      if (nextSpecialtyIds && existing.role === Role.INSTRUCTOR) {
        // Replace the m2m set: drop all current rows, then insert the new
        // ones (which already include the primary, see above).
        await tx.instructorSpecialty.deleteMany({ where: { userId: id } });
        if (nextSpecialtyIds.length) {
          await tx.instructorSpecialty.createMany({
            data: nextSpecialtyIds.map((classKindId) => ({
              userId: id,
              classKindId,
            })),
          });
        }
      }
      // 2026-05 — replace the InstructorArena set when supplied.
      if (nextArenaIds && existing.role === Role.INSTRUCTOR) {
        await tx.instructorArena.deleteMany({ where: { userId: id } });
        await tx.instructorArena.createMany({
          data: nextArenaIds.map((unitId) => ({ userId: id, unitId })),
        });
      }
      const updated = await tx.user.update({
        where: { id },
        data,
        select: STAFF_SELECT,
      });
      return flattenSpecialties(updated);
    });
  }

  /// Self-service update for /users/me (PATCH). The user can edit email,
  /// phone, CPF and birth date. Name and role are intentionally NOT here.
  /// Empty strings on `phone` / `cpf` clear the field; omitted keys leave
  /// the existing value untouched. Email + CPF uniqueness is enforced by
  /// the underlying Prisma constraints (P2002).
  async updateMe(userId: string, dto: UpdateMeDto) {
    const data: Prisma.UserUpdateInput = {};
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.phone !== undefined) data.phone = dto.phone === '' ? null : dto.phone;
    if (dto.cpf !== undefined) data.cpf = dto.cpf === '' ? null : dto.cpf;
    if (dto.birthDate !== undefined) data.birthDate = new Date(dto.birthDate);
    if (Object.keys(data).length === 0) {
      // Nothing to update — short-circuit and return the current snapshot
      // so the client can still refresh local state.
      return this.findById(userId);
    }
    try {
      await this.prisma.user.update({ where: { id: userId }, data });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const target = (err.meta?.target as string[] | undefined)?.[0];
        if (target === 'email') {
          throw new ConflictException('E-mail já cadastrado');
        }
        if (target === 'cpf') {
          throw new ConflictException('CPF já cadastrado');
        }
        throw new ConflictException('Valor já em uso');
      }
      throw err;
    }
    return this.findById(userId);
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        cpf: true,
        birthDate: true,
        goal: true,
        fitnessLevel: true,
        role: true,
        unitId: true,
        isActive: true,
        mustChangePassword: true,
        bio: true,
        primaryClassKindId: true,
        hideReservationsFromFriends: true,
        createdAt: true,
        // 2026-05 — every arena the user (typically INSTRUCTOR) can teach
        // at. Empty for ADMIN / USER. Surfaces multi-arena assignment to
        // the professor portal so its drawer can render an arena picker.
        arenaAssignments: {
          select: {
            unit: {
              select: { id: true, slug: true, name: true },
            },
          },
        },
      },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    const { arenaAssignments, ...rest } = user;
    return {
      ...rest,
      arenas: arenaAssignments.map((a) => a.unit),
    };
  }

  private async assertClassKindsExist(ids: string[]) {
    if (ids.length === 0) return;
    const found = await this.prisma.classKind.count({
      where: { id: { in: ids } },
    });
    if (found !== ids.length) {
      throw new BadRequestException('Tipo de aula inválido');
    }
  }
}

/// Mon at 00:00 of the week containing `d` (local). Mirrors the helper in
/// `admin.service.ts` — kept inline because both modules need it and the
/// dependency surface is one-line each.
function startOfWeekMonday(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}
