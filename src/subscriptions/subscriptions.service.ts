import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { AsaasClientService } from '../asaas/asaas-client.service';
import { AsaasCustomersService } from '../asaas/asaas-customers.service';
import { isGlobalAdmin } from '../common/tenancy';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly asaas: AsaasClientService,
    private readonly customers: AsaasCustomersService,
  ) {}

  async create(userId: string, dto: CreateSubscriptionDto) {
    const plan = await this.prisma.plan.findUnique({
      where: { id: dto.planId },
    });
    if (!plan || !plan.isActive) {
      throw new BadRequestException('Plano inválido ou inativo');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    // One ACTIVE subscription per user — Asaas would let you have multiple
    // but for product clarity we enforce single-stream.
    const existingActive = await this.prisma.subscription.findFirst({
      where: { userId, status: SubscriptionStatus.ACTIVE },
    });
    if (existingActive) {
      throw new ConflictException('Você já tem uma assinatura ativa');
    }

    const customerId = await this.customers.ensureCustomer(user);

    const nextDueDate = new Date();
    nextDueDate.setDate(nextDueDate.getDate() + 1);
    const dueDateStr = nextDueDate.toISOString().slice(0, 10);

    const asaasSub = await this.asaas.createSubscription({
      customer: customerId,
      billingType: 'PIX',
      value: plan.priceCents / 100,
      nextDueDate: dueDateStr,
      cycle: 'MONTHLY',
      description: `Plano ${plan.name}`,
    });

    const now = new Date();
    const cycleEnd = new Date(now);
    cycleEnd.setMonth(cycleEnd.getMonth() + 1);

    return this.prisma.subscription.create({
      data: {
        userId,
        planId: plan.id,
        asaasSubscriptionId: asaasSub.id,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: now,
        currentPeriodEnd: cycleEnd,
      },
      include: { plan: true },
    });
  }

  async cancel(id: string, requester: AuthenticatedUser) {
    const sub = await this.prisma.subscription.findUnique({ where: { id } });
    if (!sub) throw new NotFoundException('Assinatura não encontrada');
    if (sub.userId !== requester.id && !isGlobalAdmin(requester)) {
      throw new ForbiddenException('Você não pode cancelar essa assinatura');
    }
    if (sub.status === SubscriptionStatus.CANCELLED) {
      throw new BadRequestException('Assinatura já cancelada');
    }

    if (sub.asaasSubscriptionId) {
      try {
        await this.asaas.cancelSubscription(sub.asaasSubscriptionId);
      } catch (err) {
        // If Asaas already considers it deleted (404 etc.), still cancel
        // locally — we don't want to leak Asaas state into our model.
        this.logger.warn(
          `Asaas cancel for ${sub.asaasSubscriptionId} failed: ${
            err instanceof Error ? err.message : String(err)
          } — proceeding with local cancellation`,
        );
      }
    }

    return this.prisma.subscription.update({
      where: { id },
      data: {
        status: SubscriptionStatus.CANCELLED,
        cancelledAt: new Date(),
      },
    });
  }

  async findMine(userId: string) {
    return this.prisma.subscription.findMany({
      where: { userId },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
