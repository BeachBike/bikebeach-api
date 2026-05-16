import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CreditDebtReason } from '@prisma/client';
import { timingSafeEqual } from 'crypto';
import type { AsaasWebhookPayload } from '../asaas/asaas-client.types';
import { PaymentsService } from '../payments/payments.service';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly expectedTokenBuffer: Buffer;

  constructor(
    config: ConfigService,
    private readonly payments: PaymentsService,
  ) {
    this.expectedTokenBuffer = Buffer.from(
      config.getOrThrow<string>('ASAAS_WEBHOOK_TOKEN'),
      'utf8',
    );
  }

  async handle(
    receivedToken: string | undefined,
    payload: AsaasWebhookPayload,
  ): Promise<void> {
    if (!this.isTokenValid(receivedToken)) {
      // Constant-message error — don't leak whether the header was missing or wrong
      throw new UnauthorizedException('Invalid webhook authentication');
    }

    switch (payload.event) {
      case 'PAYMENT_CREATED':
        // Asaas auto-generates payments for each subscription cycle. We
        // mirror them as PENDING so the subsequent confirmation has a row to
        // flip. One-off pack payments are created locally first via
        // POST /payments/pix-pack and don't need this branch.
        if (payload.payment?.subscription) {
          await this.payments.upsertSubscriptionCyclePayment(payload.payment);
        }
        break;
      case 'PAYMENT_CONFIRMED':
      case 'PAYMENT_RECEIVED':
        if (payload.payment) {
          await this.payments.applyPaymentConfirmation(payload.payment);
        }
        break;
      case 'PAYMENT_OVERDUE':
        if (payload.payment) {
          await this.payments.applyPaymentOverdue(payload.payment);
        }
        break;
      // Refund — admin-initiated or Asaas-initiated. Clawback policy is in
      // applyPaymentRefund: unused credits zeroed, consumed credits become
      // a CreditDebt that blocks new reservations until the user settles
      // it (typically by buying another pack).
      case 'PAYMENT_REFUNDED':
        if (payload.payment) {
          await this.payments.applyPaymentRefund(
            payload.payment,
            CreditDebtReason.REFUND,
          );
        }
        break;
      // Chargeback lifecycle — the issuer pulled the money back over a
      // dispute. Same clawback as a refund. We don't differentiate the
      // stages (requested vs dispute vs reversal) at the credit-ledger
      // level — the first event wins via the idempotent claim and
      // subsequent ones are no-ops.
      case 'PAYMENT_CHARGEBACK_REQUESTED':
      case 'PAYMENT_CHARGEBACK_DISPUTE':
      case 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL':
        if (payload.payment) {
          await this.payments.applyPaymentRefund(
            payload.payment,
            CreditDebtReason.CHARGEBACK,
          );
        }
        break;
      // Other events (SUBSCRIPTION_DELETED, etc.) are logged for
      // observability — wire them when product needs them.
      default:
        this.logger.log(`Ignored Asaas event: ${payload.event}`);
    }
  }

  /// Constant-time comparison so a remote attacker can't probe the secret
  /// one byte at a time via response timing. `timingSafeEqual` requires
  /// equal-length buffers — short-circuit length mismatch (and missing
  /// header) before falling through.
  private isTokenValid(received: string | undefined): boolean {
    if (!received) return false;
    const receivedBuffer = Buffer.from(received, 'utf8');
    if (receivedBuffer.length !== this.expectedTokenBuffer.length) return false;
    return timingSafeEqual(receivedBuffer, this.expectedTokenBuffer);
  }
}
