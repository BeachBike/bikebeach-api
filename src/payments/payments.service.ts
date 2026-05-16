import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CreditDebtReason,
  CreditSource,
  PaymentKind,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  SubscriptionStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  AsaasApiError,
  AsaasClientService,
} from '../asaas/asaas-client.service';
import type {
  AsaasPayment,
  CreateCardPaymentPayload,
} from '../asaas/asaas-client.types';
import { AsaasCustomersService } from '../asaas/asaas-customers.service';
import {
  computeFinancedTotalCents,
  PIX_DISCOUNT_PERCENT,
} from '../common/constants';
import { ConfigService } from '@nestjs/config';
import { computeCampaignDiscountCents } from '../common/discount';
import { MailerService } from '../mailer/mailer.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCardPackDto } from './dto/create-card-pack.dto';

/// Prefix for the temporary `asaasChargeId` a card Payment carries between
/// being created locally and the real Asaas charge id being swapped in. The
/// reconciliation path detects it to look the charge up by externalReference.
const CARD_PLACEHOLDER_PREFIX = 'pending-card:';

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

export interface CreateCardPackResult {
  paymentId: string;
  asaasChargeId: string;
  /// PAID = aprovado e crédito já mintado; IN_REVIEW = em análise de risco
  /// (webhook/cron resolve depois). FAILED nunca vem por aqui — vira 400.
  status: 'PAID' | 'IN_REVIEW';
  /// Total actually charged in cents — `cashPriceCents + interestCents`.
  /// This is what the customer pays in their card statement.
  amountCents: number;
  basePriceCents: number;
  campaignDiscountCents: number;
  /// Preço à vista (após desconto de campanha, sem juros). FE usa pra
  /// mostrar "à vista R$ X · parcelado R$ Y".
  cashPriceCents: number;
  /// Juros aplicados (cents). Zero pra ≤ `CARD_INSTALLMENT_FREE_LIMIT` e
  /// pra débito. Acima disso = financed − cash.
  interestCents: number;
  installments: number;
  /// Crédito ou débito.
  billingType: 'CREDIT_CARD' | 'DEBIT_CARD';
  /// E.g. "VISA" / "MASTERCARD" — from Asaas.
  cardBrand: string | null;
  /// Last 4 digits — from Asaas. Never the full PAN.
  cardLast4: string | null;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly asaas: AsaasClientService,
    private readonly customers: AsaasCustomersService,
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
  ) {}

  private appUrl(): string {
    return (this.config.get<string>('APP_URL') ?? 'http://localhost:5173').replace(/\/$/, '');
  }

  /// Fires the PAYMENT_RECEIPT template for a Payment that just transitioned
  /// to PAID. Called from `applyPaymentConfirmation` AFTER the transaction
  /// commits — fire-and-forget so the webhook responds quickly. Skips
  /// SUBSCRIPTION_CYCLE for now (we'd want a different "renovação" copy).
  private async sendPaymentReceiptEmail(paymentId: string): Promise<void> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        creditPacks: { select: { totalCredits: true, expiresAt: true }, take: 1 },
      },
    });
    if (!payment || !payment.user) return;
    if (payment.kind !== PaymentKind.ONE_OFF_PACK) return;
    const pack = payment.creditPacks[0];
    if (!pack) return;
    const credits = pack.totalCredits;
    const expiresAt = pack.expiresAt ?? new Date(Date.now() + 30 * 86_400_000);
    const packLabel =
      credits === 1
        ? 'pacote 1 aula (avulsa)'
        : `pacote ${credits} aulas`;
    await this.mailer.send({
      template: 'PAYMENT_RECEIPT',
      to: payment.user.email,
      userId: payment.user.id,
      payload: {
        name: payment.user.name,
        packLabel,
        amountCents: payment.amountCents,
        method: payment.method,
        installments: payment.installments ?? null,
        paidAt: (payment.paidAt ?? new Date()).toISOString(),
        credits,
        expiresAt: expiresAt.toISOString(),
        dashboardUrl: `${this.appUrl()}/dashboard`,
      },
    });
  }

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

  /// Transparent credit-card pack purchase. The card data flows: FE form →
  /// this method (in-memory) → Asaas. It is never persisted and the Asaas
  /// client redacts it from every log. Synchronous: Asaas returns CONFIRMED
  /// (approved) or AWAITING_RISK_ANALYSIS (held) right in the response — we
  /// mint the CreditPack inline on approval and return IN_REVIEW on hold.
  /// `remoteIp` MUST be the end-user IP (controller pulls it from `req.ip`
  /// with `trust proxy` enabled) — Asaas anti-fraud weighs it heavily.
  async createCardPackCharge(
    userId: string,
    dto: CreateCardPackDto,
    remoteIp: string,
  ): Promise<CreateCardPackResult> {
    const offer = await this.prisma.packOffer.findUnique({
      where: { id: dto.packOfferId },
    });
    if (!offer || !offer.isActive) {
      throw new BadRequestException({
        code: 'INVALID_PACK_OFFER',
        message: 'Pacote inválido ou desativado',
      });
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    // Débito não suporta parcelamento — força 1x mesmo se a UI mandar mais.
    const billingType = dto.billingType ?? 'CREDIT_CARD';
    const installments =
      billingType === 'DEBIT_CARD' ? 1 : (dto.installmentCount ?? 1);
    const paymentMethod =
      billingType === 'DEBIT_CARD'
        ? PaymentMethod.DEBIT_CARD
        : PaymentMethod.CREDIT_CARD;

    // Dedup. Asaas `/payments` is not idempotent — a double submit
    // (double-click, retry-on-timeout, etc.) bills twice. Reject the second
    // attempt for the same user+pack inside a short window. PAID is included
    // so re-submitting after a success also blocks. The user can still
    // buy the same pack again after 90s. Crédito e débito não se sobrepõem
    // (debit fica fora do `in` set p/ não bloquear quando o user troca de
    // método propositalmente após uma tentativa).
    const recentDuplicate = await this.prisma.payment.findFirst({
      where: {
        userId,
        method: paymentMethod,
        packCredits: offer.classes,
        status: {
          in: [
            PaymentStatus.PENDING,
            PaymentStatus.IN_REVIEW,
            PaymentStatus.PAID,
          ],
        },
        createdAt: { gt: new Date(Date.now() - 90_000) },
      },
    });
    if (recentDuplicate) {
      throw new ConflictException({
        code: 'DUPLICATE_CHARGE',
        message:
          'Já recebemos uma cobrança desse pacote agora há pouco. Confira em "meus pagamentos" antes de tentar de novo.',
      });
    }

    const customerId = await this.customers.ensureCustomer(user);

    // Card pays the full price — the PIX 5% is PIX-only (item-14). The
    // admin campaign discount is method-agnostic, so it still compounds.
    const basePriceCents = offer.priceCents;
    const campaignDiscountCents = computeCampaignDiscountCents(offer);
    const cashPriceCents = basePriceCents - campaignDiscountCents;
    if (cashPriceCents <= 0) {
      throw new BadRequestException({
        code: 'INVALID_AMOUNT',
        message: 'Valor inválido para o pacote. Contate o suporte.',
      });
    }

    // Local interest math (sem juros até 3x, 2,99% a.m. composto acima).
    // Débito é sempre à vista. `interestCents` é o que o cliente paga a mais
    // que o preço à vista — informativo pra UI; o Asaas só vê `amountCents`.
    const amountCents = computeFinancedTotalCents(cashPriceCents, installments);
    const interestCents = amountCents - cashPriceCents;

    // Card charges are processed immediately — same-day due date.
    const dueDateStr = new Date().toISOString().slice(0, 10);

    // Create the local Payment FIRST with a placeholder charge id. This row
    // is the dedup claim, the webhook target, and the externalReference. It
    // must exist before we call Asaas so a fast webhook (cards confirm
    // synchronously — milliseconds) has something to find. The real
    // asaasChargeId is swapped in once Asaas responds.
    const payment = await this.prisma.payment.create({
      data: {
        userId: user.id,
        asaasChargeId: `${CARD_PLACEHOLDER_PREFIX}${randomUUID()}`,
        amountCents,
        method: paymentMethod,
        status: PaymentStatus.PENDING,
        kind: PaymentKind.ONE_OFF_PACK,
        packCredits: offer.classes,
        packExpirationDays: offer.expirationDays,
        installments,
      },
    });

    const cardPayload: CreateCardPaymentPayload = {
      customer: customerId,
      billingType,
      // `amountCents` is already the financed total (interest included
      // when parcelado > 3x). À vista: send `value`. Parcelado: send
      // `totalValue` + `installmentCount` and Asaas just divides — the
      // interest math is ours, not the Asaas dashboard's.
      ...(installments > 1
        ? {
            installmentCount: installments,
            totalValue: amountCents / 100,
          }
        : { value: amountCents / 100 }),
      dueDate: dueDateStr,
      description: `Pacote ${offer.classes} aula${offer.classes > 1 ? 's' : ''}${
        installments > 1 ? ` (${installments}x)` : ''
      }`,
      externalReference: payment.id,
      creditCard: {
        holderName: dto.creditCard.holderName,
        number: dto.creditCard.number,
        expiryMonth: dto.creditCard.expiryMonth,
        expiryYear: dto.creditCard.expiryYear,
        ccv: dto.creditCard.ccv,
      },
      creditCardHolderInfo: {
        name: dto.creditCardHolderInfo.name,
        email: dto.creditCardHolderInfo.email,
        cpfCnpj: dto.creditCardHolderInfo.cpfCnpj,
        postalCode: dto.creditCardHolderInfo.postalCode,
        addressNumber: dto.creditCardHolderInfo.addressNumber,
        addressComplement: dto.creditCardHolderInfo.addressComplement ?? null,
        phone: dto.creditCardHolderInfo.phone,
      },
      remoteIp,
    };

    let charge: AsaasPayment;
    try {
      charge = await this.asaas.createCardPayment(cardPayload);
    } catch (err) {
      if (err instanceof AsaasApiError && err.isClientError) {
        // 4xx — decline / invalid data. The charge did NOT go through. Mark
        // FAILED and surface a friendly message.
        const reason = err.errors[0]?.description ?? 'Cartão recusado';
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.FAILED,
            failureReason: reason.slice(0, 500),
          },
        });
        throw new BadRequestException({
          code: 'CARD_DECLINED',
          message: reason,
        });
      }
      // 5xx / network / timeout — the charge MIGHT have gone through.
      // Blindly failing invites a double charge on retry; reconcile by
      // externalReference before deciding.
      this.logger.error(
        `Card charge infra failure for payment ${payment.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      const reconciled = await this.asaas
        .getPaymentByExternalReference(payment.id)
        .catch(() => null);
      if (reconciled) {
        charge = reconciled;
      } else {
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.FAILED,
            failureReason: 'Falha de comunicação com o provedor de pagamento',
          },
        });
        throw new BadRequestException({
          code: 'PAYMENT_PROVIDER_UNAVAILABLE',
          message:
            'Não conseguimos falar com o provedor de pagamento agora. Nada foi cobrado — tenta de novo em instantes.',
        });
      }
    }

    // Swap the placeholder for the real charge id + persist card metadata
    // (brand + last 4 only — Asaas never returns the PAN/CVV).
    const cardBrand = charge.creditCard?.creditCardBrand ?? null;
    const cardLast4 = charge.creditCard?.creditCardNumber ?? null;
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { asaasChargeId: charge.id, cardBrand, cardLast4 },
    });

    // Map the Asaas card status into ours.
    if (charge.status === 'CONFIRMED' || charge.status === 'RECEIVED') {
      // applyPaymentConfirmation re-finds the row (now keyed by the real
      // asaasChargeId we just wrote) and mints the CreditPack atomically.
      // If a webhook for the same charge runs concurrently, only one wins.
      await this.applyPaymentConfirmation(charge);
      return {
        paymentId: payment.id,
        asaasChargeId: charge.id,
        status: 'PAID',
        amountCents,
        basePriceCents,
        campaignDiscountCents,
        cashPriceCents,
        interestCents,
        installments,
        billingType,
        cardBrand,
        cardLast4,
      };
    }
    if (
      charge.status === 'AWAITING_RISK_ANALYSIS' ||
      charge.status === 'PENDING'
    ) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.IN_REVIEW },
      });
      return {
        paymentId: payment.id,
        asaasChargeId: charge.id,
        status: 'IN_REVIEW',
        amountCents,
        basePriceCents,
        campaignDiscountCents,
        cashPriceCents,
        interestCents,
        installments,
        billingType,
        cardBrand,
        cardLast4,
      };
    }

    // REPROVED_BY_RISK_ANALYSIS or any unexpected terminal status.
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.FAILED,
        failureReason: `Status inesperado do Asaas: ${charge.status}`,
      },
    });
    throw new BadRequestException({
      code: 'CARD_DECLINED',
      message:
        'O cartão não foi aprovado. Tenta outro cartão ou outro método.',
    });
  }

  /// Settles open CreditDebt rows against a freshly-granted batch of credits.
  /// Iterates oldest-debt-first. Returns the credits left after debts are
  /// paid — that's what the new CreditPack's `remainingCredits` should be.
  /// `totalCredits` on the pack stays the full granted amount so the user's
  /// history shows the truth ("you bought 10, but 4 went to settle a debt").
  private async settleOpenDebts(
    tx: Prisma.TransactionClient,
    userId: string,
    grantedCredits: number,
    settlingPaymentId: string,
  ): Promise<number> {
    const debts = await tx.creditDebt.findMany({
      where: { userId, remainingCredits: { gt: 0 } },
      orderBy: { createdAt: 'asc' },
    });
    let available = grantedCredits;
    for (const debt of debts) {
      if (available <= 0) break;
      const applied = Math.min(available, debt.remainingCredits);
      const newRemaining = debt.remainingCredits - applied;
      await tx.creditDebt.update({
        where: { id: debt.id },
        data: {
          remainingCredits: newRemaining,
          ...(newRemaining === 0
            ? {
                settledAt: new Date(),
                settledByPaymentId: settlingPaymentId,
              }
            : {}),
        },
      });
      available -= applied;
    }
    return available;
  }

  /// Idempotent on atomic Payment row-claim + (optionally) externalReference.
  /// Called from the webhook for `PAYMENT_CONFIRMED` and `PAYMENT_RECEIVED`
  /// (Asaas may send both for a single payment) and from the synchronous
  /// card flow. Creates a CreditPack on the first transition to PAID —
  /// handles both `ONE_OFF_PACK` and `SUBSCRIPTION_CYCLE` payments.
  async applyPaymentConfirmation(asaasPayment: AsaasPayment): Promise<void> {
    let local = await this.prisma.payment.findUnique({
      where: { asaasChargeId: asaasPayment.id },
    });
    // Subscription cycles are auto-created by Asaas — mirror them first so
    // the confirmation has a row to flip.
    if (!local && asaasPayment.subscription) {
      await this.upsertSubscriptionCyclePayment(asaasPayment);
      local = await this.prisma.payment.findUnique({
        where: { asaasChargeId: asaasPayment.id },
      });
    }
    // Card one-off fallback. The synchronous card flow creates the local
    // Payment with a placeholder `asaasChargeId` and only swaps in the real
    // id after Asaas responds. If a webhook beats that swap, find the row
    // by our `externalReference` (= the local Payment id) and adopt the
    // real id here. Without this fallback, a fast webhook would be
    // ignored as "unknown asaasChargeId" and credits would stall.
    if (!local && asaasPayment.externalReference) {
      const byRef = await this.prisma.payment.findUnique({
        where: { id: asaasPayment.externalReference },
      });
      if (byRef && byRef.asaasChargeId.startsWith(CARD_PLACEHOLDER_PREFIX)) {
        await this.prisma.payment.update({
          where: { id: byRef.id },
          data: { asaasChargeId: asaasPayment.id },
        });
        local = { ...byRef, asaasChargeId: asaasPayment.id };
      }
    }
    if (!local) {
      this.logger.warn(
        `Webhook for unknown asaasChargeId=${asaasPayment.id}; ignoring`,
      );
      return;
    }
    const localRow = local;

    let mintedPackId: string | null = null;
    await this.prisma.$transaction(async (tx) => {
      // Atomic claim. updateMany row-locks: if a concurrent caller (e.g.
      // the synchronous card path + the webhook arriving within ms) is
      // racing us, exactly one wins. count === 0 ⇒ someone else already
      // processed this Payment → no-op. We accept PENDING and IN_REVIEW;
      // FAILED rows are NOT promotable (a declined sync charge that later
      // gets a stray webhook must stay failed).
      const claimed = await tx.payment.updateMany({
        where: {
          id: localRow.id,
          status: {
            in: [PaymentStatus.PENDING, PaymentStatus.IN_REVIEW],
          },
        },
        data: { status: PaymentStatus.PAID, paidAt: new Date() },
      });
      if (claimed.count === 0) return;

      if (
        localRow.kind === PaymentKind.ONE_OFF_PACK &&
        localRow.packCredits !== null &&
        localRow.packCredits > 0
      ) {
        // Snapshot taken at purchase — defaults to 30 days for any historical
        // row that pre-dates the column.
        const validityDays = localRow.packExpirationDays ?? 30;
        // Snapshot the share/transfer flags from the matching offer (by
        // `classes`). Falls back to defaults when the offer was deleted
        // between purchase and webhook delivery.
        const offer = await tx.packOffer.findUnique({
          where: { classes: localRow.packCredits },
        });
        // Settle any open CreditDebt (from a prior refund/chargeback)
        // BEFORE crediting the user. The pack's `totalCredits` is what they
        // bought, `remainingCredits` is what's left after debt absorbs its
        // share. When debt fully consumes the grant the pack mints at 0 —
        // accounting still shows the purchase, and the debt's `settledAt`
        // gets stamped.
        const remainingCredits = await this.settleOpenDebts(
          tx,
          localRow.userId,
          localRow.packCredits,
          localRow.id,
        );
        const pack = await tx.creditPack.create({
          data: {
            userId: localRow.userId,
            source: CreditSource.PURCHASE_PACK,
            totalCredits: localRow.packCredits,
            remainingCredits,
            paymentId: localRow.id,
            expiresAt: new Date(
              Date.now() + validityDays * 86_400_000,
            ),
            isTransferable: offer?.isTransferable ?? false,
            maxSharedUsers: offer?.maxSharedUsers ?? 0,
          },
        });
        mintedPackId = pack.id;
      } else if (
        localRow.kind === PaymentKind.SUBSCRIPTION_CYCLE &&
        localRow.subscriptionId
      ) {
        const sub = await tx.subscription.findUnique({
          where: { id: localRow.subscriptionId },
          include: { plan: true },
        });
        if (!sub) {
          this.logger.warn(
            `Subscription ${localRow.subscriptionId} vanished mid-tx`,
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

        // Subscription credits zero out at cycle end (CLAUDE.md product rule)
        // and intentionally do NOT settle CreditDebt — debts are paid by
        // pack purchases, not by recurring grants.
        await tx.creditPack.create({
          data: {
            userId: localRow.userId,
            source: CreditSource.SUBSCRIPTION_CYCLE,
            totalCredits: sub.plan.monthlyCredits,
            remainingCredits: sub.plan.monthlyCredits,
            subscriptionId: sub.id,
            paymentId: localRow.id,
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

    if (mintedPackId) {
      void this.sendPaymentReceiptEmail(localRow.id).catch((err) =>
        this.logger.warn(
          `payment-receipt email skipped for ${localRow.id}: ${(err as Error).message}`,
        ),
      );
    }
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

  /// Webhook handler for `PAYMENT_REFUNDED` and the chargeback events.
  /// Marks the Payment REFUNDED and claws back credits: the CreditPack
  /// minted from this payment has its unused credits zeroed, and whatever
  /// was already consumed becomes a `CreditDebt` the user must settle on
  /// their next pack purchase (and which blocks new reservations until
  /// settled — see ReservationsService). Idempotent: re-firing the same
  /// event after the first one is a no-op.
  async applyPaymentRefund(
    asaasPayment: AsaasPayment,
    reason: CreditDebtReason,
  ): Promise<void> {
    const local = await this.prisma.payment.findUnique({
      where: { asaasChargeId: asaasPayment.id },
      include: { creditPacks: true },
    });
    if (!local) {
      this.logger.warn(
        `Refund webhook for unknown asaasChargeId=${asaasPayment.id}; ignoring`,
      );
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      // Atomic flip — REFUNDED is terminal. count === 0 ⇒ already processed.
      const claimed = await tx.payment.updateMany({
        where: {
          id: local.id,
          status: { not: PaymentStatus.REFUNDED },
        },
        data: { status: PaymentStatus.REFUNDED },
      });
      if (claimed.count === 0) return;

      // For each pack minted from this payment, zero unused credits and
      // record what was consumed as debt. A payment that never minted (the
      // user got refunded before paying through, e.g. card declined late)
      // has an empty `creditPacks` array — the loop is a no-op.
      for (const pack of local.creditPacks) {
        const consumed = pack.totalCredits - pack.remainingCredits;
        if (pack.remainingCredits > 0) {
          await tx.creditPack.update({
            where: { id: pack.id },
            data: { remainingCredits: 0 },
          });
        }
        if (consumed > 0) {
          await tx.creditDebt.create({
            data: {
              userId: local.userId,
              reason,
              amountCredits: consumed,
              remainingCredits: consumed,
              originPaymentId: local.id,
            },
          });
        }
      }
    });
  }

  async findMine(userId: string) {
    return this.prisma.payment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /// Owner-only single-payment lookup. Used by the checkout page to poll for
  /// `status: PAID` after the user finishes paying. Pulls live status from
  /// Asaas for any still-pending row before returning so the UI doesn't have
  /// to wait for the next cron tick.
  async findOneForUser(id: string, userId: string) {
    let payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment) throw new NotFoundException('Pagamento não encontrado');
    if (payment.userId !== userId) {
      throw new NotFoundException('Pagamento não encontrado');
    }
    if (
      payment.status === PaymentStatus.PENDING ||
      payment.status === PaymentStatus.IN_REVIEW
    ) {
      await this.syncPendingPaymentFromAsaas({
        id: payment.id,
        asaasChargeId: payment.asaasChargeId,
      });
      payment = await this.prisma.payment.findUnique({ where: { id } });
    }

    return payment;
  }

  /// Pulls the live status of a single PENDING / IN_REVIEW charge from Asaas
  /// and reconciles the local row. Covers gaps the webhook alone can't:
  ///   1. user closed the checkout tab before paying — if the webhook is
  ///      missed/delayed the next read or the cron picks it up here;
  ///   2. PIX QR expired (Asaas → OVERDUE) — flip the row to EXPIRED;
  ///   3. card payment held for risk analysis is later reproved — flip
  ///      IN_REVIEW → FAILED;
  ///   4. a card row whose `asaasChargeId` is still the placeholder (we
  ///      crashed between the local insert and Asaas response) — look the
  ///      charge up by `externalReference`; if no charge exists, the row is
  ///      flipped to FAILED so it stops being polled.
  /// Returns the resulting status so the cron can log a summary.
  private async syncPendingPaymentFromAsaas(payment: {
    id: string;
    asaasChargeId: string;
  }): Promise<PaymentStatus | null> {
    try {
      const isPlaceholder = payment.asaasChargeId.startsWith(
        CARD_PLACEHOLDER_PREFIX,
      );
      const asaasPayment = isPlaceholder
        ? await this.asaas.getPaymentByExternalReference(payment.id)
        : await this.asaas.getPayment(payment.asaasChargeId);

      if (!asaasPayment) {
        // Placeholder id + no Asaas charge ⇒ charge was never actually
        // created. Safe to fail the row.
        if (isPlaceholder) {
          const updated = await this.prisma.payment.updateMany({
            where: {
              id: payment.id,
              status: {
                in: [PaymentStatus.PENDING, PaymentStatus.IN_REVIEW],
              },
            },
            data: {
              status: PaymentStatus.FAILED,
              failureReason: 'Cobrança não encontrada no Asaas',
            },
          });
          return updated.count > 0 ? PaymentStatus.FAILED : null;
        }
        return null;
      }

      if (
        asaasPayment.status === 'CONFIRMED' ||
        asaasPayment.status === 'RECEIVED'
      ) {
        await this.applyPaymentConfirmation(asaasPayment);
        return PaymentStatus.PAID;
      }
      if (asaasPayment.status === 'AWAITING_RISK_ANALYSIS') {
        // Still under review at Asaas — mirror it locally so the UI shows
        // "em análise" instead of a stale "pendente".
        const updated = await this.prisma.payment.updateMany({
          where: {
            id: payment.id,
            status: PaymentStatus.PENDING,
          },
          data: { status: PaymentStatus.IN_REVIEW },
        });
        return updated.count > 0 ? PaymentStatus.IN_REVIEW : null;
      }
      if (asaasPayment.status === 'OVERDUE') {
        // PIX charge past its due date — QR is dead.
        const updated = await this.prisma.payment.updateMany({
          where: {
            id: payment.id,
            status: PaymentStatus.PENDING,
          },
          data: { status: PaymentStatus.EXPIRED },
        });
        return updated.count > 0 ? PaymentStatus.EXPIRED : null;
      }
      if (asaasPayment.status === 'REPROVED_BY_RISK_ANALYSIS') {
        const updated = await this.prisma.payment.updateMany({
          where: {
            id: payment.id,
            status: {
              in: [PaymentStatus.PENDING, PaymentStatus.IN_REVIEW],
            },
          },
          data: {
            status: PaymentStatus.FAILED,
            failureReason: 'Pagamento reprovado na análise de risco',
          },
        });
        return updated.count > 0 ? PaymentStatus.FAILED : null;
      }
      return null;
    } catch (err) {
      this.logger.warn(
        `Could not sync pending payment ${payment.asaasChargeId} from Asaas: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  /// Reconciliation pass over every still-PENDING / IN_REVIEW payment.
  /// Driven by the cron in `PaymentReconciliationJob` (every 5 min). Each
  /// row is checked against Asaas and flipped to PAID / EXPIRED / FAILED as
  /// appropriate. Safety net for: closed-tab PIX confirmations, expired
  /// QRs, card payments held for risk analysis that resolve later, and
  /// card rows whose Asaas charge id never made it back to us.
  async reconcilePendingPayments(): Promise<{
    checked: number;
    paid: number;
    expired: number;
    failed: number;
  }> {
    const pending = await this.prisma.payment.findMany({
      where: {
        status: { in: [PaymentStatus.PENDING, PaymentStatus.IN_REVIEW] },
      },
      select: { id: true, asaasChargeId: true },
    });
    let paid = 0;
    let expired = 0;
    let failed = 0;
    for (const p of pending) {
      const result = await this.syncPendingPaymentFromAsaas(p);
      if (result === PaymentStatus.PAID) paid += 1;
      else if (result === PaymentStatus.EXPIRED) expired += 1;
      else if (result === PaymentStatus.FAILED) failed += 1;
    }
    return { checked: pending.length, paid, expired, failed };
  }
}
