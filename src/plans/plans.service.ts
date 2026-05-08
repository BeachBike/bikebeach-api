import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { validateDiscountWindow } from '../common/discount';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';

@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePlanDto) {
    const discount = validateDiscountWindow(dto);
    const data: Prisma.PlanCreateInput = {
      name: dto.name,
      monthlyCredits: dto.monthlyCredits,
      priceCents: dto.priceCents,
      ...(discount && {
        discountPercent: discount.discountPercent,
        discountStartsAt: discount.discountStartsAt,
        discountEndsAt: discount.discountEndsAt,
      }),
    };
    return this.prisma.plan.create({ data });
  }

  async findAll(includeInactive = false) {
    return this.prisma.plan.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { priceCents: 'asc' },
    });
  }

  async findOne(id: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('Plano não encontrado');
    return plan;
  }

  async update(id: string, dto: UpdatePlanDto) {
    await this.findOne(id);
    const discount = validateDiscountWindow(dto);
    const data: Prisma.PlanUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.monthlyCredits !== undefined) data.monthlyCredits = dto.monthlyCredits;
    if (dto.priceCents !== undefined) data.priceCents = dto.priceCents;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (discount) {
      data.discountPercent = discount.discountPercent;
      data.discountStartsAt = discount.discountStartsAt;
      data.discountEndsAt = discount.discountEndsAt;
    }
    return this.prisma.plan.update({ where: { id }, data });
  }

  /// Soft-delete via `isActive=false`. Hard delete is forbidden because of
  /// historical Subscription FKs (RESTRICT).
  async deactivate(id: string) {
    await this.findOne(id);
    await this.prisma.plan.update({ where: { id }, data: { isActive: false } });
  }
}
