import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PaymentsService } from '../payments/payments.service';

/// Safety-net cron for payments. The webhook is the happy path — when it
/// fires, `applyPaymentConfirmation` flips the row immediately. But two
/// real-world gaps slip through:
///   1. the user closes the checkout tab before paying — if the webhook
///      is missed/delayed the charge sits PENDING forever;
///   2. the Pix QR expires (Asaas → OVERDUE) — without this pass the row
///      would never leave PENDING.
/// Every 5 minutes we sweep all PENDING payments, ask Asaas for the live
/// status, and reconcile (→ PAID / → EXPIRED). Idempotent and cheap: the
/// PENDING set is tiny in steady state, so the tighter cadence just means
/// a confirmed payment reaches the dashboard faster when the webhook is
/// delayed or missed.
@Injectable()
export class PaymentReconciliationService {
  private readonly logger = new Logger(PaymentReconciliationService.name);

  constructor(private readonly payments: PaymentsService) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'payment-reconcile' })
  async tick() {
    if (process.env.NODE_ENV === 'test') return;
    if (process.env.JOBS_DISABLED === 'true') return;

    try {
      const { checked, paid, expired, failed } =
        await this.payments.reconcilePendingPayments();
      if (paid > 0 || expired > 0 || failed > 0) {
        this.logger.log(
          `Payment reconcile: ${checked} checked → ${paid} paid, ${expired} expired, ${failed} failed`,
        );
      }
    } catch (err) {
      this.logger.error('payment reconcile failed', err);
    }
  }
}
