import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AsaasWebhookPayload } from '../asaas/asaas-client.types';
import { PaymentsService } from '../payments/payments.service';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly expectedToken: string;

  constructor(
    config: ConfigService,
    private readonly payments: PaymentsService,
  ) {
    this.expectedToken = config.getOrThrow<string>('ASAAS_WEBHOOK_TOKEN');
  }

  async handle(
    receivedToken: string | undefined,
    payload: AsaasWebhookPayload,
  ): Promise<void> {
    if (!receivedToken || receivedToken !== this.expectedToken) {
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
      // Other events (PAYMENT_REFUNDED, SUBSCRIPTION_DELETED)
      // are logged for observability — wire them when product needs them.
      default:
        this.logger.log(`Ignored Asaas event: ${payload.event}`);
    }
  }
}
