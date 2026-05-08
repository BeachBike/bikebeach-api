import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { validateDiscountWindow } from '../common/discount';
import { assertCanAccessUnit } from '../common/tenancy';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePackOfferDto } from './dto/create-pack-offer.dto';
import { UpdatePackOfferDto } from './dto/update-pack-offer.dto';

@Injectable()
export class PackOffersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePackOfferDto, user: AuthenticatedUser) {
    assertCanAccessUnit(user, dto.unitId);

    const unit = await this.prisma.unit.findUnique({
      where: { id: dto.unitId },
    });
    if (!unit || !unit.isActive) {
      throw new BadRequestException('Unidade inválida ou inativa');
    }

    const discount = validateDiscountWindow(dto);
    const data: Prisma.PackOfferCreateInput = {
      unit: { connect: { id: dto.unitId } },
      classes: dto.classes,
      priceCents: dto.priceCents,
      expirationDays: dto.expirationDays,
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      ...(dto.displayOrder !== undefined && { displayOrder: dto.displayOrder }),
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
          'Já existe um pacote com esse número de aulas nessa unidade — edite o existente',
        );
      }
      throw err;
    }
  }

  /// Public listing for the customer-facing /planos page. Filters out inactive
  /// offers; ordered by displayOrder then classes.
  async listPublic(unitId: string) {
    return this.prisma.packOffer.findMany({
      where: { unitId, isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { classes: 'asc' }],
    });
  }

  /// Admin listing — includes inactive so admin can re-enable.
  async listForAdmin(unitId: string, user: AuthenticatedUser) {
    assertCanAccessUnit(user, unitId);
    return this.prisma.packOffer.findMany({
      where: { unitId },
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
    assertCanAccessUnit(user, existing.unitId);
    const discount = validateDiscountWindow(dto);
    const data: Prisma.PackOfferUpdateInput = {};
    if (dto.priceCents !== undefined) data.priceCents = dto.priceCents;
    if (dto.expirationDays !== undefined) data.expirationDays = dto.expirationDays;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.displayOrder !== undefined) data.displayOrder = dto.displayOrder;
    if (discount) {
      data.discountPercent = discount.discountPercent;
      data.discountStartsAt = discount.discountStartsAt;
      data.discountEndsAt = discount.discountEndsAt;
    }
    return this.prisma.packOffer.update({ where: { id }, data });
  }

  async remove(id: string, user: AuthenticatedUser) {
    const existing = await this.findOne(id);
    assertCanAccessUnit(user, existing.unitId);
    // Soft "remove" via deactivate so historical Payment / CreditPack rows that
    // implicitly reference this offer keep their context.
    await this.prisma.packOffer.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
