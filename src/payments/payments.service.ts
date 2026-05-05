import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CreditSource,
  PaymentKind,
  PaymentMethod,
  PaymentStatus,
} from '@prisma/client';
import { AsaasClientService } from '../asaas/asaas-client.service';
import type { AsaasPayment } from '../asaas/asaas-client.types';
import { AsaasCustomersService } from '../asaas/asaas-customers.service';
import { PrismaService } from '../prisma/prisma.service';

export interface CreatePixPackResult {
  paymentId: string;
  asaasChargeId: string;
  amountCents: number;
  basePriceCents: number;
  pixDiscountPercent: number;
  pix: {
    qrCodeImage: string;
    qrCodePayload: string;
    expiresAt: string;
  };
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly asaas: AsaasClientService,
    private readonly customers: AsaasCustomersService,
  ) {}

  async createPixPackCharge(
    userId: string,
    packOfferId: string,
  ): Promise<CreatePixPackResult> {
    const offer = await this.prisma.packOffer.findUnique({
      where: { id: packOfferId },
      include: { unit: true },
    });
    if (!offer || !offer.isActive) {
      throw new BadRequestException({
        code: 'INVALID_PACK_OFFER',
        message: 'Pacote inválido ou desativado',
      });
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    // ensureCustomer also throws 400 CPF_REQUIRED when missing.
    const customerId = await this.customers.ensureCustomer(user);

    const basePriceCents = offer.priceCents;
    const pixDiscountPercent = offer.unit.pixDiscountPercent;
    // Round to whole cents so Asaas + accounting agree on the charge value.
    const discountCents = Math.round(
      (basePriceCents * pixDiscountPercent) / 100,
    );
    const amountCents = basePriceCents - discountCents;

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 1);
    const dueDateStr = dueDate.toISOString().slice(0, 10); // YYYY-MM-DD

    const charge = await this.asaas.createPayment({
      customer: customerId,
      billingType: 'PIX',
      value: amountCents / 100,
      dueDate: dueDateStr,
      description:
        pixDiscountPercent > 0
          ? `Pacote ${offer.classes} aula${offer.classes > 1 ? 's' : ''} (PIX -${pixDiscountPercent}%)`
          : `Pacote ${offer.classes} aula${offer.classes > 1 ? 's' : ''}`,
    });

    const payment = await this.prisma.payment.create({
      data: {
        userId: user.id,
        asaasChargeId: charge.id,
        amountCents,
        method: PaymentMethod.PIX,
        status: PaymentStatus.PENDING,
        kind: PaymentKind.ONE_OFF_PACK,
        packCredits: offer.classes,
        packExpirationDays: offer.expirationDays,
      },
    });

    const qr = await this.asaas.getPixQrCode(charge.id);

    return {
      paymentId: payment.id,
      asaasChargeId: charge.id,
      amountCents,
      basePriceCents,
      pixDiscountPercent,
      pix: {
        qrCodeImage: qr.encodedImage,
        qrCodePayload: qr.payload,
        expiresAt: qr.expirationDate,
      },
    };
  }

  /// Idempotent on `asaasChargeId` UNIQUE + status guard.
  /// Called from the webhook for `PAYMENT_CONFIRMED` and `PAYMENT_RECEIVED`
  /// (Asaas may send both for a single payment). Creates a CreditPack on the
  /// first transition to PAID — handles both `ONE_OFF_PACK` and
  /// `SUBSCRIPTION_CYCLE` payments.
  async applyPaymentConfirmation(asaasPayment: AsaasPayment): Promise<void> {
    const local = await this.prisma.payment.findUnique({
      where: { asaasChargeId: asaasPayment.id },
    });
    if (!local) {
      this.logger.warn(
        `Webhook for unknown asaasChargeId=${asaasPayment.id}; ignoring`,
      );
      return;
    }
    if (local.status === PaymentStatus.PAID) return; // already processed

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: local.id },
        data: { status: PaymentStatus.PAID, paidAt: new Date() },
      });

      if (
        local.kind === PaymentKind.ONE_OFF_PACK &&
        local.packCredits !== null &&
        local.packCredits > 0
      ) {
        // Snapshot taken at purchase — defaults to 30 days for any historical
        // row that pre-dates the column.
        const validityDays = local.packExpirationDays ?? 30;
        await tx.creditPack.create({
          data: {
            userId: local.userId,
            source: CreditSource.PURCHASE_PACK,
            totalCredits: local.packCredits,
            remainingCredits: local.packCredits,
            paymentId: local.id,
            expiresAt: new Date(
              Date.now() + validityDays * 86_400_000,
            ),
          },
        });
      } else if (
        local.kind === PaymentKind.SUBSCRIPTION_CYCLE &&
        local.subscriptionId
      ) {
        const sub = await tx.subscription.findUnique({
          where: { id: local.subscriptionId },
          include: { plan: true },
        });
        if (!sub) {
          this.logger.warn(
            `Subscription ${local.subscriptionId} vanished mid-tx`,
          );
          return;
        }

        // Credits expire at the END of the cycle being paid for.
        await tx.creditPack.create({
          data: {
            userId: local.userId,
            source: CreditSource.SUBSCRIPTION_CYCLE,
            totalCredits: sub.plan.monthlyCredits,
            remainingCredits: sub.plan.monthlyCredits,
            subscriptionId: sub.id,
            paymentId: local.id,
            expiresAt: sub.currentPeriodEnd,
          },
        });

        // Advance cycle: anchor on the CURRENT period end so cadence is
        // preserved even when payment is delayed.
        const nextStart = sub.currentPeriodEnd;
        const nextEnd = new Date(nextStart);
        nextEnd.setMonth(nextEnd.getMonth() + 1);
        await tx.subscription.update({
          where: { id: sub.id },
          data: {
            currentPeriodStart: nextStart,
            currentPeriodEnd: nextEnd,
          },
        });
      }
    });
  }

  /// Called from the webhook on `PAYMENT_CREATED` for subscription cycle
  /// payments. Asaas auto-generates these — we mirror them as PENDING locally
  /// so the subsequent confirmation has something to flip. Idempotent via
  /// upsert on `asaasChargeId`.
  async upsertSubscriptionCyclePayment(
    asaasPayment: AsaasPayment,
  ): Promise<void> {
    if (!asaasPayment.subscription) return; // not a subscription payment

    const sub = await this.prisma.subscription.findUnique({
      where: { asaasSubscriptionId: asaasPayment.subscription },
    });
    if (!sub) {
      this.logger.warn(
        `Webhook PAYMENT_CREATED for unknown asaasSubscriptionId=${asaasPayment.subscription}; ignoring`,
      );
      return;
    }

    const amountCents = Math.round(asaasPayment.value * 100);
    const billing = asaasPayment.billingType;
    const method =
      billing === 'CREDIT_CARD'
        ? PaymentMethod.CREDIT_CARD
        : billing === 'DEBIT_CARD'
          ? PaymentMethod.DEBIT_CARD
          : PaymentMethod.PIX;

    await this.prisma.payment.upsert({
      where: { asaasChargeId: asaasPayment.id },
      create: {
        userId: sub.userId,
        asaasChargeId: asaasPayment.id,
        amountCents,
        method,
        status: PaymentStatus.PENDING,
        kind: PaymentKind.SUBSCRIPTION_CYCLE,
        subscriptionId: sub.id,
      },
      update: {}, // existing row wins; no overwrite
    });
  }

  async findMine(userId: string) {
    return this.prisma.payment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
