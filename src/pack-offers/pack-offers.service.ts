import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { validateDiscountWindow } from '../common/discount';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePackOfferDto } from './dto/create-pack-offer.dto';
import { UpdatePackOfferDto } from './dto/update-pack-offer.dto';

/// Pack offers are GLOBAL — there is one source of truth per `classes`
/// count, regardless of arena. Only ADMIN can mutate. The `isTransferable`
/// and `maxSharedUsers` flags expose the resulting CreditPack to the
/// transfer + share flows.
@Injectable()
export class PackOffersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePackOfferDto, user: AuthenticatedUser) {
    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('Apenas admin pode criar pacote');
    }

    const discount = validateDiscountWindow(dto);
    const data: Prisma.PackOfferCreateInput = {
      classes: dto.classes,
      priceCents: dto.priceCents,
      expirationDays: dto.expirationDays,
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      ...(dto.displayOrder !== undefined && {
        displayOrder: dto.displayOrder,
      }),
      ...(dto.isTransferable !== undefined && {
        isTransferable: dto.isTransferable,
      }),
      ...(dto.maxSharedUsers !== undefined && {
        maxSharedUsers: Math.max(0, dto.maxSharedUsers),
      }),
      ...(discount && {
        discountPercent: discount.discountPercent,
        discountStartsAt: discount.discountStartsAt,
        discountEndsAt: discount.discountEndsAt,
      }),
    };

    try {
      return await this.prisma.packOffer.create({ data });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'Já existe um pacote com esse número de aulas — edite o existente',
        );
      }
      throw err;
    }
  }

  /// Public listing for the customer-facing /planos page. Returns active
  /// offers, ordered by `displayOrder` then `classes`. The `unitId` arg
  /// is preserved for backward-compat in callers but ignored — packs are
  /// global as of 2026-05.
  async listPublic(_unitId?: string) {
    return this.prisma.packOffer.findMany({
      where: { isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { classes: 'asc' }],
    });
  }

  /// Admin listing — includes inactive so admin can re-enable. The
  /// `unitId` arg is also legacy / ignored.
  async listForAdmin(_unitId: string, _user: AuthenticatedUser) {
    return this.prisma.packOffer.findMany({
      orderBy: [{ displayOrder: 'asc' }, { classes: 'asc' }],
    });
  }

  async findOne(id: string) {
    const offer = await this.prisma.packOffer.findUnique({ where: { id } });
    if (!offer) throw new NotFoundException('Pacote não encontrado');
    return offer;
  }

  async update(id: string, dto: UpdatePackOfferDto, user: AuthenticatedUser) {
    const existing = await this.findOne(id);
    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('Apenas admin pode editar pacote');
    }
    const discount = validateDiscountWindow(dto);
    const data: Prisma.PackOfferUpdateInput = {};
    if (dto.priceCents !== undefined) data.priceCents = dto.priceCents;
    if (dto.expirationDays !== undefined)
      data.expirationDays = dto.expirationDays;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.displayOrder !== undefined) data.displayOrder = dto.displayOrder;
    if (dto.isTransferable !== undefined)
      data.isTransferable = dto.isTransferable;
    if (dto.maxSharedUsers !== undefined)
      data.maxSharedUsers = Math.max(0, dto.maxSharedUsers);
    if (discount) {
      data.discountPercent = discount.discountPercent;
      data.discountStartsAt = discount.discountStartsAt;
      data.discountEndsAt = discount.discountEndsAt;
    }
    void existing;
    return this.prisma.packOffer.update({ where: { id }, data });
  }

  async remove(id: string, user: AuthenticatedUser) {
    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('Apenas admin pode remover pacote');
    }
    await this.findOne(id);
    // Soft "remove" via deactivate so historical Payment / CreditPack rows
    // that implicitly reference this offer keep their context.
    await this.prisma.packOffer.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
