import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { hash } from 'bcrypt';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import {
  AsaasApiError,
  AsaasClientService,
} from '../src/asaas/asaas-client.service';
import { PrismaService } from '../src/prisma/prisma.service';

// Card payments e2e — covers the synchronous transparent-checkout flow:
// approval, decline, risk-analysis, dedup, installments, refund/CreditDebt,
// and the "debt settles on next purchase" loop. AsaasClientService is mocked
// so no real API is hit.

const WEBHOOK_TOKEN = 'dev-webhook-token-change-in-prod-1234567890abcdef';

// Test card (Asaas sandbox-style). All values pass class-validator's
// IsCreditCard (Luhn), the regex checks, and the holder-info validators.
const VALID_CARD = {
  holderName: 'JOAO TESTE',
  number: '4111111111111111', // Visa test number (passes Luhn)
  expiryMonth: '12',
  expiryYear: '2030',
  ccv: '123',
};

const VALID_HOLDER = {
  name: 'Joao Teste',
  email: 'joao@test.local',
  cpfCnpj: '12345678909',
  postalCode: '88210000',
  addressNumber: '100',
  phone: '47999990000',
};

describe('Payments — Card pack purchase (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: ReturnType<INestApplication['getHttpServer']>;

  const mockAsaas = {
    createCustomer: jest.fn(),
    createPayment: jest.fn(),
    createCardPayment: jest.fn(),
    getPayment: jest.fn(),
    getPaymentByExternalReference: jest.fn(),
    getPixQrCode: jest.fn(),
  };

  const userEmail = `e2e-card-u-${randomUUID()}@test.local`;
  const password = 'card-pass-12345';
  const unitSlug = `e2e-card-unit-${randomUUID().slice(0, 6)}`;

  let userToken: string;
  let userId: string;
  let pack10OfferId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AsaasClientService)
      .useValue(mockAsaas)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    await cleanup();

    await prisma.unit.create({
      data: {
        slug: unitSlug,
        name: 'Card Test Unit',
        address: 'Faixa de areia, km 1',
      },
    });

    // R$ 400 pack of 10 — chosen so amountCents (400_00) divides cleanly
    // across 1x / 2x / 4x installments for assertion clarity.
    const pack10 = await prisma.packOffer.create({
      data: {
        classes: 10,
        priceCents: 40_000,
        expirationDays: 90,
        displayOrder: 3,
      },
    });
    pack10OfferId = pack10.id;

    const u = await request(server)
      .post('/auth/signup')
      .send({
        email: userEmail,
        password,
        name: 'Card U',
        cpf: '12345678909',
      })
      .expect(201);
    userToken = u.body.accessToken;
    userId = u.body.user.id;

    // Set asaasCustomerId directly so we skip the createCustomer roundtrip
    // on every test (we test that path in payments-pix already).
    await prisma.user.update({
      where: { id: userId },
      data: { asaasCustomerId: 'cus_card_test' },
    });
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  beforeEach(async () => {
    Object.values(mockAsaas).forEach((m) => m.mockReset());
    // Wipe prior-test Payments + CreditPacks for the baseline user. The
    // dedup guard would otherwise block every test that follows an
    // approved one (same user + same packCredits within 90s). Refund
    // tests use a separate user so they're untouched here.
    await prisma.creditPack.deleteMany({ where: { userId } });
    await prisma.payment.deleteMany({ where: { userId } });
  });

  async function cleanup() {
    await prisma.creditDebt.deleteMany({
      where: { user: { email: { startsWith: 'e2e-card-' } } },
    });
    await prisma.creditPack.deleteMany({
      where: { user: { email: { startsWith: 'e2e-card-' } } },
    });
    await prisma.payment.deleteMany({
      where: { user: { email: { startsWith: 'e2e-card-' } } },
    });
    await prisma.user.deleteMany({
      where: { email: { startsWith: 'e2e-card-' } },
    });
    await prisma.packOffer.deleteMany({ where: { classes: 10 } });
    await prisma.unit.deleteMany({
      where: { slug: { startsWith: 'e2e-card-' } },
    });
  }

  describe('POST /payments/card-pack — happy path (à vista, approved)', () => {
    it('mints a CreditPack synchronously on CONFIRMED', async () => {
      mockAsaas.createCardPayment.mockResolvedValueOnce({
        id: 'pay_card_1',
        customer: 'cus_card_test',
        billingType: 'CREDIT_CARD',
        status: 'CONFIRMED',
        value: 400,
        creditCard: { creditCardNumber: '1111', creditCardBrand: 'VISA' },
      });

      const res = await request(server)
        .post('/payments/card-pack')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          packOfferId: pack10OfferId,
          installmentCount: 1,
          creditCard: VALID_CARD,
          creditCardHolderInfo: VALID_HOLDER,
        })
        .expect(201);

      expect(res.body).toMatchObject({
        asaasChargeId: 'pay_card_1',
        amountCents: 40_000,
        basePriceCents: 40_000,
        installments: 1,
        cardBrand: 'VISA',
        cardLast4: '1111',
        status: 'PAID',
      });

      // Asaas was billed `value` (à vista) — NOT totalValue.
      expect(mockAsaas.createCardPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          billingType: 'CREDIT_CARD',
          value: 400,
          remoteIp: expect.any(String),
        }),
      );
      // installmentCount/totalValue should NOT be in the à-vista payload.
      const payload = mockAsaas.createCardPayment.mock.calls[0][0];
      expect(payload).not.toHaveProperty('totalValue');
      expect(payload).not.toHaveProperty('installmentCount');

      const payment = await prisma.payment.findUnique({
        where: { asaasChargeId: 'pay_card_1' },
      });
      expect(payment).toMatchObject({
        status: 'PAID',
        method: 'CREDIT_CARD',
        kind: 'ONE_OFF_PACK',
        installments: 1,
        cardBrand: 'VISA',
        cardLast4: '1111',
      });

      const packs = await prisma.creditPack.findMany({
        where: { userId, paymentId: payment!.id },
      });
      expect(packs.length).toBe(1);
      expect(packs[0]).toMatchObject({
        totalCredits: 10,
        remainingCredits: 10,
      });
    });
  });

  describe('POST /payments/card-pack — parcelado', () => {
    it('3x is sem juros — totalValue = cash price', async () => {
      mockAsaas.createCardPayment.mockResolvedValueOnce({
        id: 'pay_card_3x',
        customer: 'cus_card_test',
        billingType: 'CREDIT_CARD',
        status: 'CONFIRMED',
        value: 400,
        installmentCount: 3,
        creditCard: { creditCardNumber: '1111', creditCardBrand: 'VISA' },
      });

      const res = await request(server)
        .post('/payments/card-pack')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          packOfferId: pack10OfferId,
          installmentCount: 3,
          creditCard: VALID_CARD,
          creditCardHolderInfo: VALID_HOLDER,
        })
        .expect(201);

      expect(res.body.installments).toBe(3);
      expect(res.body.amountCents).toBe(40_000); // sem juros
      expect(res.body.interestCents).toBe(0);

      const payload = mockAsaas.createCardPayment.mock.calls[0][0];
      expect(payload).toMatchObject({
        installmentCount: 3,
        totalValue: 400,
      });
    });

    it('4x applies 2,99% compound — totalValue = cash * 1.0299^4', async () => {
      mockAsaas.createCardPayment.mockResolvedValueOnce({
        id: 'pay_card_4x',
        customer: 'cus_card_test',
        billingType: 'CREDIT_CARD',
        status: 'CONFIRMED',
        value: 450.1,
        installmentCount: 4,
        creditCard: { creditCardNumber: '1111', creditCardBrand: 'VISA' },
      });

      const res = await request(server)
        .post('/payments/card-pack')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          packOfferId: pack10OfferId,
          installmentCount: 4,
          creditCard: VALID_CARD,
          creditCardHolderInfo: VALID_HOLDER,
        })
        .expect(201);

      expect(res.body.installments).toBe(4);
      expect(res.body.status).toBe('PAID');
      // 40000 * 1.0299^4 ≈ 45003 cents (rounded). Snapshot the exact
      // value — drift here would mean the rate / power formula changed.
      expect(res.body.amountCents).toBe(45_003);
      expect(res.body.cashPriceCents).toBe(40_000);
      expect(res.body.interestCents).toBe(5_003);

      const payload = mockAsaas.createCardPayment.mock.calls[0][0];
      expect(payload).toMatchObject({
        installmentCount: 4,
        totalValue: 450.03,
      });
      expect(payload).not.toHaveProperty('value');
    });

    it('rejects installmentCount > 6 at the DTO layer', async () => {
      const res = await request(server)
        .post('/payments/card-pack')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          packOfferId: pack10OfferId,
          installmentCount: 7,
          creditCard: VALID_CARD,
          creditCardHolderInfo: VALID_HOLDER,
        })
        .expect(400);
      // class-validator surfaces field-level messages
      expect(JSON.stringify(res.body)).toContain('installmentCount');
    });
  });

  describe('POST /payments/card-pack — débito', () => {
    it('billingType DEBIT_CARD → sends value (à vista), method DEBIT_CARD, no parcelas', async () => {
      mockAsaas.createCardPayment.mockResolvedValueOnce({
        id: 'pay_debit_1',
        customer: 'cus_card_test',
        billingType: 'DEBIT_CARD',
        status: 'CONFIRMED',
        value: 400,
        creditCard: { creditCardNumber: '1111', creditCardBrand: 'VISA' },
      });

      const res = await request(server)
        .post('/payments/card-pack')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          packOfferId: pack10OfferId,
          billingType: 'DEBIT_CARD',
          creditCard: VALID_CARD,
          creditCardHolderInfo: VALID_HOLDER,
        })
        .expect(201);

      expect(res.body).toMatchObject({
        status: 'PAID',
        installments: 1,
        billingType: 'DEBIT_CARD',
        amountCents: 40_000,
        interestCents: 0,
      });

      const payload = mockAsaas.createCardPayment.mock.calls[0][0];
      expect(payload).toMatchObject({
        billingType: 'DEBIT_CARD',
        value: 400,
      });
      expect(payload).not.toHaveProperty('installmentCount');
      expect(payload).not.toHaveProperty('totalValue');

      // Local Payment row reflects DEBIT_CARD method.
      const payment = await prisma.payment.findUnique({
        where: { asaasChargeId: 'pay_debit_1' },
      });
      expect(payment?.method).toBe('DEBIT_CARD');
      expect(payment?.installments).toBe(1);
    });

    it('DEBIT_CARD ignores any installmentCount > 1 and forces 1x', async () => {
      mockAsaas.createCardPayment.mockResolvedValueOnce({
        id: 'pay_debit_2',
        customer: 'cus_card_test',
        billingType: 'DEBIT_CARD',
        status: 'CONFIRMED',
        value: 400,
        creditCard: { creditCardNumber: '1111', creditCardBrand: 'VISA' },
      });

      const res = await request(server)
        .post('/payments/card-pack')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          packOfferId: pack10OfferId,
          billingType: 'DEBIT_CARD',
          installmentCount: 4, // ignored
          creditCard: VALID_CARD,
          creditCardHolderInfo: VALID_HOLDER,
        })
        .expect(201);

      expect(res.body.installments).toBe(1);
      const payload = mockAsaas.createCardPayment.mock.calls[0][0];
      expect(payload).not.toHaveProperty('installmentCount');
    });
  });

  describe('POST /payments/card-pack — declines', () => {
    it('4xx from Asaas → 400 CARD_DECLINED, Payment FAILED, no CreditPack', async () => {
      mockAsaas.createCardPayment.mockRejectedValueOnce(
        new AsaasApiError(
          400,
          JSON.stringify({
            errors: [
              { code: 'invalid_card', description: 'Cartão recusado pelo emissor' },
            ],
          }),
        ),
      );

      const res = await request(server)
        .post('/payments/card-pack')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          packOfferId: pack10OfferId,
          creditCard: VALID_CARD,
          creditCardHolderInfo: VALID_HOLDER,
        })
        .expect(400);

      expect(res.body.code).toBe('CARD_DECLINED');
      expect(res.body.message).toContain('Cartão recusado');

      // The local row exists and is FAILED — never minted a pack.
      const failed = await prisma.payment.findFirst({
        where: {
          userId,
          method: 'CREDIT_CARD',
          status: 'FAILED',
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(failed).not.toBeNull();
      expect(failed!.failureReason).toContain('Cartão recusado');
      const packs = await prisma.creditPack.count({
        where: { paymentId: failed!.id },
      });
      expect(packs).toBe(0);
    });

    it('REPROVED_BY_RISK_ANALYSIS in sync response → 400 + Payment FAILED', async () => {
      mockAsaas.createCardPayment.mockResolvedValueOnce({
        id: 'pay_card_reproved',
        customer: 'cus_card_test',
        billingType: 'CREDIT_CARD',
        status: 'REPROVED_BY_RISK_ANALYSIS',
        value: 400,
      });

      await request(server)
        .post('/payments/card-pack')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          packOfferId: pack10OfferId,
          creditCard: VALID_CARD,
          creditCardHolderInfo: VALID_HOLDER,
        })
        .expect(400);

      const failed = await prisma.payment.findUnique({
        where: { asaasChargeId: 'pay_card_reproved' },
      });
      expect(failed?.status).toBe('FAILED');
    });
  });

  describe('POST /payments/card-pack — AWAITING_RISK_ANALYSIS', () => {
    it('returns IN_REVIEW initially, then a later PAYMENT_CONFIRMED webhook mints the pack', async () => {
      mockAsaas.createCardPayment.mockResolvedValueOnce({
        id: 'pay_card_review',
        customer: 'cus_card_test',
        billingType: 'CREDIT_CARD',
        status: 'AWAITING_RISK_ANALYSIS',
        value: 400,
        creditCard: { creditCardNumber: '1111', creditCardBrand: 'VISA' },
      });

      const res = await request(server)
        .post('/payments/card-pack')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          packOfferId: pack10OfferId,
          creditCard: VALID_CARD,
          creditCardHolderInfo: VALID_HOLDER,
        })
        .expect(201);

      expect(res.body.status).toBe('IN_REVIEW');

      const initial = await prisma.payment.findUnique({
        where: { asaasChargeId: 'pay_card_review' },
      });
      expect(initial?.status).toBe('IN_REVIEW');
      expect(
        await prisma.creditPack.count({ where: { paymentId: initial!.id } }),
      ).toBe(0);

      const packsBefore = await prisma.creditPack.count({ where: { userId } });

      // Risk analysis approves → Asaas fires PAYMENT_CONFIRMED.
      await request(server)
        .post('/asaas/webhook')
        .set('asaas-access-token', WEBHOOK_TOKEN)
        .send({
          event: 'PAYMENT_CONFIRMED',
          payment: {
            id: 'pay_card_review',
            customer: 'cus_card_test',
            billingType: 'CREDIT_CARD',
            status: 'CONFIRMED',
            value: 400,
          },
        })
        .expect(200);

      const settled = await prisma.payment.findUnique({
        where: { asaasChargeId: 'pay_card_review' },
      });
      expect(settled?.status).toBe('PAID');
      const packsAfter = await prisma.creditPack.count({ where: { userId } });
      expect(packsAfter).toBe(packsBefore + 1);
    });
  });

  describe('POST /payments/card-pack — dedup', () => {
    it('blocks a second PENDING/IN_REVIEW/PAID card charge for the same pack within 90s', async () => {
      mockAsaas.createCardPayment.mockResolvedValueOnce({
        id: 'pay_card_dedup',
        customer: 'cus_card_test',
        billingType: 'CREDIT_CARD',
        status: 'CONFIRMED',
        value: 400,
        creditCard: { creditCardNumber: '1111', creditCardBrand: 'VISA' },
      });
      await request(server)
        .post('/payments/card-pack')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          packOfferId: pack10OfferId,
          creditCard: VALID_CARD,
          creditCardHolderInfo: VALID_HOLDER,
        })
        .expect(201);

      // Second submission within the dedup window → 409.
      const res = await request(server)
        .post('/payments/card-pack')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          packOfferId: pack10OfferId,
          creditCard: VALID_CARD,
          creditCardHolderInfo: VALID_HOLDER,
        })
        .expect(409);
      expect(res.body.code).toBe('DUPLICATE_CHARGE');
      // Asaas was NOT called a second time.
      expect(mockAsaas.createCardPayment).toHaveBeenCalledTimes(1);
    });
  });

  describe('Refund → CreditDebt + reservation block + settlement on next purchase', () => {
    let firstPaymentId: string;

    it('PAYMENT_REFUNDED with consumed credits creates a CreditDebt', async () => {
      // Fresh user — isolate this scenario from the dedup-window state.
      const debtUserEmail = `e2e-card-debt-${randomUUID()}@test.local`;
      const u = await request(server)
        .post('/auth/signup')
        .send({
          email: debtUserEmail,
          password,
          name: 'Card Debt',
          cpf: '11144477735',
        })
        .expect(201);
      const debtUserId = u.body.user.id;
      const debtUserToken = u.body.accessToken;
      await prisma.user.update({
        where: { id: debtUserId },
        data: { asaasCustomerId: 'cus_card_debt' },
      });

      mockAsaas.createCardPayment.mockResolvedValueOnce({
        id: 'pay_card_refund_origin',
        customer: 'cus_card_debt',
        billingType: 'CREDIT_CARD',
        status: 'CONFIRMED',
        value: 400,
        creditCard: { creditCardNumber: '1111', creditCardBrand: 'VISA' },
      });
      const buy = await request(server)
        .post('/payments/card-pack')
        .set('Authorization', `Bearer ${debtUserToken}`)
        .send({
          packOfferId: pack10OfferId,
          creditCard: VALID_CARD,
          creditCardHolderInfo: VALID_HOLDER,
        })
        .expect(201);
      firstPaymentId = buy.body.paymentId;

      // Simulate 4 of the 10 credits already consumed (e.g. reservations).
      const pack = await prisma.creditPack.findFirst({
        where: { paymentId: firstPaymentId },
      });
      await prisma.creditPack.update({
        where: { id: pack!.id },
        data: { remainingCredits: 6 },
      });

      // Refund webhook arrives.
      await request(server)
        .post('/asaas/webhook')
        .set('asaas-access-token', WEBHOOK_TOKEN)
        .send({
          event: 'PAYMENT_REFUNDED',
          payment: {
            id: 'pay_card_refund_origin',
            customer: 'cus_card_debt',
            billingType: 'CREDIT_CARD',
            status: 'REFUNDED',
            value: 400,
          },
        })
        .expect(200);

      const payment = await prisma.payment.findUnique({
        where: { id: firstPaymentId },
      });
      expect(payment?.status).toBe('REFUNDED');

      const packAfter = await prisma.creditPack.findUnique({
        where: { id: pack!.id },
      });
      // Unused 6 credits zeroed.
      expect(packAfter?.remainingCredits).toBe(0);

      // Consumed 4 credits became a debt.
      const debts = await prisma.creditDebt.findMany({
        where: { userId: debtUserId, remainingCredits: { gt: 0 } },
      });
      expect(debts.length).toBe(1);
      expect(debts[0]).toMatchObject({
        reason: 'REFUND',
        amountCredits: 4,
        remainingCredits: 4,
        originPaymentId: firstPaymentId,
      });
    });

    it('idempotent: re-firing PAYMENT_REFUNDED does NOT create a second debt', async () => {
      const before = await prisma.creditDebt.count();
      await request(server)
        .post('/asaas/webhook')
        .set('asaas-access-token', WEBHOOK_TOKEN)
        .send({
          event: 'PAYMENT_REFUNDED',
          payment: {
            id: 'pay_card_refund_origin',
            status: 'REFUNDED',
            value: 400,
          },
        })
        .expect(200);
      const after = await prisma.creditDebt.count();
      expect(after).toBe(before);
    });
  });
});
