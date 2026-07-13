import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CreditDebtReason } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import type { AsaasPayment } from '../src/asaas/asaas-client.types';
import { PaymentsService } from '../src/payments/payments.service';
import { PrismaService } from '../src/prisma/prisma.service';

/// P1 — refund / chargeback flow. A refund must: flip the Payment to
/// REFUNDED, zero the pack's UNUSED credits, and record what was already
/// CONSUMED as a CreditDebt the user has to settle on their next purchase.
/// The refund path is triggered by an Asaas webhook in prod; here we call
/// `applyPaymentRefund` directly so the test doesn't depend on the webhook
/// token (which isn't set in CI).
describe('Payments — refund / chargeback (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let payments: PaymentsService;

  const email = `e2e-refund-${randomUUID()}@test.local`;
  let userId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    payments = app.get(PaymentsService);

    await cleanup();
    const user = await prisma.user.create({
      data: { email, passwordHash: 'x', name: 'E2E Refund' },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  async function cleanup() {
    await prisma.creditDebt.deleteMany({
      where: { user: { email: { startsWith: 'e2e-refund-' } } },
    });
    await prisma.creditPack.deleteMany({
      where: { user: { email: { startsWith: 'e2e-refund-' } } },
    });
    await prisma.payment.deleteMany({
      where: { user: { email: { startsWith: 'e2e-refund-' } } },
    });
    await prisma.user.deleteMany({
      where: { email: { startsWith: 'e2e-refund-' } },
    });
  }

  const fakeAsaas = (id: string, valueReais: number): AsaasPayment =>
    ({ id, value: valueReais }) as AsaasPayment;

  let refundedPaymentId: string;

  it('refund zeroes unused credits and books consumed ones as debt', async () => {
    // A paid pack of 10, 4 already consumed (remaining 6).
    const chargeId = `pay_refund_${randomUUID()}`;
    const payment = await prisma.payment.create({
      data: {
        userId,
        asaasChargeId: chargeId,
        amountCents: 20000,
        method: 'PIX',
        status: 'PAID',
        kind: 'ONE_OFF_PACK',
        packCredits: 10,
        packExpirationDays: 90,
        paidAt: new Date(),
      },
    });
    refundedPaymentId = payment.id;
    await prisma.creditPack.create({
      data: {
        userId,
        source: 'PURCHASE_PACK',
        totalCredits: 10,
        remainingCredits: 6, // 4 consumed
        paymentId: payment.id,
      },
    });

    await payments.applyPaymentRefund(
      fakeAsaas(chargeId, 200),
      CreditDebtReason.REFUND,
    );

    const reloaded = await prisma.payment.findUnique({
      where: { id: payment.id },
    });
    expect(reloaded?.status).toBe('REFUNDED');

    const pack = await prisma.creditPack.findFirst({
      where: { paymentId: payment.id },
    });
    expect(pack?.remainingCredits).toBe(0); // unused credits clawed back

    const debts = await prisma.creditDebt.findMany({ where: { userId } });
    expect(debts).toHaveLength(1);
    expect(debts[0]).toMatchObject({
      reason: CreditDebtReason.REFUND,
      amountCredits: 4, // what was consumed before the refund
      remainingCredits: 4,
      originPaymentId: payment.id,
    });
  });

  it('a repeated refund event is idempotent (no second debt)', async () => {
    const payment = await prisma.payment.findUnique({
      where: { id: refundedPaymentId },
    });
    await payments.applyPaymentRefund(
      fakeAsaas(payment!.asaasChargeId, 200),
      CreditDebtReason.REFUND,
    );
    const debts = await prisma.creditDebt.findMany({ where: { userId } });
    expect(debts).toHaveLength(1); // still just the one
  });

  it('the next purchase settles the debt before crediting', async () => {
    // A fresh 10-credit purchase confirms → settleOpenDebts eats the 4-credit
    // debt first, so the new pack mints with 6 usable.
    const chargeId = `pay_settle_${randomUUID()}`;
    await prisma.payment.create({
      data: {
        userId,
        asaasChargeId: chargeId,
        amountCents: 20000,
        method: 'PIX',
        status: 'PENDING',
        kind: 'ONE_OFF_PACK',
        packCredits: 10,
        packExpirationDays: 90,
      },
    });

    await payments.applyPaymentConfirmation(fakeAsaas(chargeId, 200));

    const newPack = await prisma.creditPack.findFirst({
      where: { payment: { asaasChargeId: chargeId } },
    });
    expect(newPack?.totalCredits).toBe(10); // history shows the full purchase
    expect(newPack?.remainingCredits).toBe(6); // 10 − 4 settled debt

    const debt = await prisma.creditDebt.findFirst({ where: { userId } });
    expect(debt?.remainingCredits).toBe(0);
    expect(debt?.settledAt).not.toBeNull();
  });
});
