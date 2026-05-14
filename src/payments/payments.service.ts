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
  SubscriptionStatus,
} from '@prisma/client';
import { AsaasClientService } from '../asaas/asaas-client.service';
import type { AsaasPayment } from '../asaas/asaas-client.types';
import { AsaasCustomersService } from '../asaas/asaas-customers.service';
import { PIX_DISCOUNT_PERCENT } from '../common/constants';
import { computeCampaignDiscountCents } from '../common/discount';
import { PrismaService } from '../prisma/prisma.service';

export interface CreatePixPackResult {
  paymentId: string;
  asaasChargeId: string;
  amountCents: number;
  basePriceCents: number;
  /// Campaign (admin-configured) discount in cents — applied first.
  /// Zero when no active campaign on the offer.
  campaignDiscountCents: number;
  /// PIX off (system-wide constant after 2026-05). Applied AFTER the
  /// campaign discount on the already-discounted price.
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

    // Discount campaign on the pack offer (C3) compounds with the PIX
    // off (item-14): apply the campaign first, then the PIX 5% on the
    // already-discounted amount. PIX percent is now a system-wide
    // constant (no longer per-arena).
    const basePriceCents = offer.priceCents;
    const campaignDiscountCents = computeCampaignDiscountCents(offer);
    const priceAfterCampaign = basePriceCents - campaignDiscountCents;
    const pixDiscountPercent = PIX_DISCOUNT_PERCENT;

    this.logger.debug('Payment calculation:', {
      basePriceCents,
      campaignDiscountCents,
      pixDiscountPercent,
      packClasses: offer.classes,
    });

    // Round to whole cents so Asaas + accounting agree on the charge value.
    const discountCents = Math.round(
      (priceAfterCampaign * pixDiscountPercent) / 100,
    );
    const amountCents = priceAfterCampaign - discountCents;

    if (amountCents <= 0) {
      throw new BadRequestException({
        code: 'INVALID_AMOUNT',
        message: 'Valor inválido para o pacote. Contate o suporte.',
      });
    }

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 1);
    const dueDateStr = dueDate.toISOString().slice(0, 10); // YYYY-MM-DD

    const paymentPayload = {
      customer: customerId,
      billingType: 'PIX' as const,
      value: amountCents / 100,
      dueDate: dueDateStr,
      description:
        pixDiscountPercent > 0
          ? `Pacote ${offer.classes} aula${offer.classes > 1 ? 's' : ''} (PIX -${pixDiscountPercent}%)`
          : `Pacote ${offer.classes} aula${offer.classes > 1 ? 's' : ''}`,
    };

    this.logger.debug('Creating PIX payment with payload:', {
      customer: customerId,
      value: paymentPayload.value,
      dueDate: dueDateStr,
    });

    const charge = await this.asaas.createPayment(paymentPayload);
    
    this.logger.debug('Asaas payment created:', {
      id: charge.id,
      billingType: charge.billingType,
      status: charge.status,
    });

    if (charge.billingType !== 'PIX') {
      this.logger.error(
        `Payment was created with billingType=${charge.billingType}, but requested PIX. This may indicate the Asaas account does not have PIX enabled.`,
      );
    }

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

    let qr;
    try {
      qr = await this.asaas.getPixQrCode(charge.id);
    } catch (err) {
      // If PIX QR code generation fails, it's likely the payment wasn't actually
      // created as PIX. This usually means:
      // 1. The Asaas account doesn't have PIX enabled
      // 2. There's a mismatch in the API request/response
      // 3. Sandbox limitations
      this.logger.error('Failed to generate PIX QR code for payment:', {
        paymentId: charge.id,
        error: err instanceof Error ? err.message : String(err),
        billingType: charge.billingType,
      });
      
      // Delete the local payment record since we can't complete the PIX flow
      await this.prisma.payment.delete({ where: { id: payment.id } });
      
      throw new BadRequestException({
        code: 'PIX_UNAVAILABLE',
        message:
          'Não foi possível gerar QR code para PIX. Verifique se a conta está habilitada para PIX ou tente outro método de pagamento.',
      });
    }

    return {
      paymentId: payment.id,
      asaasChargeId: charge.id,
      amountCents,
      basePriceCents,
      campaignDiscountCents,
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
    let local = await this.prisma.payment.findUnique({
      where: { asaasChargeId: asaasPayment.id },
    });
    if (!local && asaasPayment.subscription) {
      await this.upsertSubscriptionCyclePayment(asaasPayment);
      local = await this.prisma.payment.findUnique({
        where: { asaasChargeId: asaasPayment.id },
      });
    }
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
        // Snapshot the share/transfer flags from the matching offer (by
        // `classes`). Falls back to defaults when the offer was deleted
        // between purchase and webhook delivery.
        const offer = await tx.packOffer.findUnique({
          where: { classes: local.packCredits },
        });
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
            isTransferable: offer?.isTransferable ?? false,
            maxSharedUsers: offer?.maxSharedUsers ?? 0,
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

        const paidAt = new Date();
        const isFirstPaidCycle =
          sub.status === SubscriptionStatus.PENDING_PAYMENT;
        const paidCycleStart = isFirstPaidCycle
          ? paidAt
          : sub.currentPeriodEnd;
        const paidCycleEnd = new Date(paidCycleStart);
        paidCycleEnd.setMonth(paidCycleEnd.getMonth() + 1);

        // Credits expire at the END of the cycle being paid for.
        await tx.creditPack.create({
          data: {
            userId: local.userId,
            source: CreditSource.SUBSCRIPTION_CYCLE,
            totalCredits: sub.plan.monthlyCredits,
            remainingCredits: sub.plan.monthlyCredits,
            subscriptionId: sub.id,
            paymentId: local.id,
            expiresAt: paidCycleEnd,
          },
        });

        await tx.subscription.update({
          where: { id: sub.id },
          data: {
            status: SubscriptionStatus.ACTIVE,
            currentPeriodStart: paidCycleStart,
            currentPeriodEnd: paidCycleEnd,
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

  async applyPaymentOverdue(asaasPayment: AsaasPayment): Promise<void> {
    if (!asaasPayment.subscription) return;

    await this.upsertSubscriptionCyclePayment(asaasPayment);

    const sub = await this.prisma.subscription.findUnique({
      where: { asaasSubscriptionId: asaasPayment.subscription },
    });
    if (!sub) return;

    await this.prisma.subscription.update({
      where: { id: sub.id },
      data: { status: SubscriptionStatus.PAST_DUE },
    });
  }

  async findMine(userId: string) {
    return this.prisma.payment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /// Owner-only single-payment lookup. Used by the checkout page to poll for
  /// `status: PAID` after the user finishes paying via Pix.
  async findOneForUser(id: string, userId: string) {
    let payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment) throw new NotFoundException('Pagamento não encontrado');
    if (payment.userId !== userId) {
      throw new NotFoundException('Pagamento não encontrado');
    }
    if (payment.status === PaymentStatus.PENDING) {
      await this.syncPendingPaymentFromAsaas(payment.asaasChargeId);
      payment = await this.prisma.payment.findUnique({ where: { id } });
    }

    return payment;
  }

  private async syncPendingPaymentFromAsaas(
    asaasChargeId: string,
  ): Promise<void> {
    try {
      const asaasPayment = await this.asaas.getPayment(asaasChargeId);
      if (
        asaasPayment.status === 'CONFIRMED' ||
        asaasPayment.status === 'RECEIVED'
      ) {
        await this.applyPaymentConfirmation(asaasPayment);
      }
    } catch (err) {
      this.logger.warn(
        `Could not sync pending payment ${asaasChargeId} from Asaas: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
