import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { hash } from 'bcrypt';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AsaasClientService } from '../src/asaas/asaas-client.service';
import { PrismaService } from '../src/prisma/prisma.service';

// Phase 5e-1 (refreshed for PackOffer): Pix one-off purchase + webhook → CreditPack creation.
// AsaasClientService is overridden with a Jest mock so the suite never
// touches the real Asaas API.

const WEBHOOK_TOKEN = 'dev-webhook-token-change-in-prod-1234567890abcdef';

describe('Payments — Pix pack purchase (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: ReturnType<INestApplication['getHttpServer']>;

  const mockAsaas = {
    createCustomer: jest.fn(),
    createPayment: jest.fn(),
    getPayment: jest.fn(),
    getPixQrCode: jest.fn(),
  };

  const adminEmail = `e2e-pix-admin-${randomUUID()}@test.local`;
  const adminPassword = 'pix-admin-12345';
  const userEmail = `e2e-pix-u-${randomUUID()}@test.local`;
  const userNoCpfEmail = `e2e-pix-nocpf-${randomUUID()}@test.local`;
  const password = 'pix-pass-12345';
  const unitSlug = `e2e-pix-unit-${randomUUID().slice(0, 6)}`;

  let userToken: string;
  let userId: string;
  let userNoCpfToken: string;
  let unitId: string;
  let pack5OfferId: string;
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

    await prisma.user.create({
      data: {
        email: adminEmail,
        name: 'Pix Admin',
        role: Role.ADMIN,
        passwordHash: await hash(adminPassword, 10),
      },
    });

    // Provision the unit + pack offers the suite references. pixDiscountPercent
    // defaults to 5 so the discounted-amount assertions exercise the discount.
    const unit = await prisma.unit.create({
      data: {
        slug: unitSlug,
        name: 'Pix Test Unit',
        address: 'Faixa de areia, km 1',
      },
    });
    unitId = unit.id;
    const pack5 = await prisma.packOffer.create({
      data: {
        unitId,
        classes: 5,
        priceCents: 20_000,
        expirationDays: 60,
        displayOrder: 2,
      },
    });
    pack5OfferId = pack5.id;
    const pack10 = await prisma.packOffer.create({
      data: {
        unitId,
        classes: 10,
        priceCents: 35_000,
        expirationDays: 90,
        displayOrder: 3,
      },
    });
    pack10OfferId = pack10.id;

    // User with CPF (will be the happy-path test subject)
    const u = await request(server)
      .post('/auth/signup')
      .send({
        email: userEmail,
        password,
        name: 'Pix U',
        cpf: '12345678909',
      })
      .expect(201);
    userToken = u.body.accessToken;
    userId = u.body.user.id;

    // User WITHOUT CPF (for the negative test)
    const uNo = await request(server)
      .post('/auth/signup')
      .send({ email: userNoCpfEmail, password, name: 'NoCpf' })
      .expect(201);
    userNoCpfToken = uNo.body.accessToken;
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  beforeEach(() => {
    mockAsaas.createCustomer.mockReset();
    mockAsaas.createPayment.mockReset();
    mockAsaas.getPayment.mockReset();
    mockAsaas.getPixQrCode.mockReset();
  });

  async function cleanup() {
    await prisma.creditPack.deleteMany({
      where: { user: { email: { startsWith: 'e2e-pix-' } } },
    });
    await prisma.payment.deleteMany({
      where: { user: { email: { startsWith: 'e2e-pix-' } } },
    });
    await prisma.user.deleteMany({
      where: { email: { startsWith: 'e2e-pix-' } },
    });
    await prisma.packOffer.deleteMany({
      where: { unit: { slug: { startsWith: 'e2e-pix-' } } },
    });
    await prisma.unit.deleteMany({
      where: { slug: { startsWith: 'e2e-pix-' } },
    });
  }

  describe('GET /pack-offers (public)', () => {
    it('lists active offers for the unit, ordered by displayOrder', async () => {
      const res = await request(server)
        .get(`/pack-offers?unitId=${unitId}`)
        .expect(200);
      expect(res.body.length).toBeGreaterThanOrEqual(2);
      expect(res.body[0].classes).toBe(5);
      expect(res.body[1].classes).toBe(10);
    });
  });

  describe('POST /payments/pix-pack', () => {
    it('user without CPF → 400 with code CPF_REQUIRED', async () => {
      const res = await request(server)
        .post('/payments/pix-pack')
        .set('Authorization', `Bearer ${userNoCpfToken}`)
        .send({ packOfferId: pack5OfferId })
        .expect(400);
      expect(res.body.code).toBe('CPF_REQUIRED');
    });

    it('unknown packOfferId → 400 with code INVALID_PACK_OFFER', async () => {
      const res = await request(server)
        .post('/payments/pix-pack')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ packOfferId: 'cl-does-not-exist' })
        .expect(400);
      expect(res.body.code).toBe('INVALID_PACK_OFFER');
    });

    it('valid offer → creates Asaas customer + payment with PIX 5% discount applied', async () => {
      mockAsaas.createCustomer.mockResolvedValueOnce({
        id: 'cus_test_1',
        name: 'Pix U',
        email: userEmail,
        cpfCnpj: '12345678909',
      });
      mockAsaas.createPayment.mockResolvedValueOnce({
        id: 'pay_test_1',
        customer: 'cus_test_1',
        billingType: 'PIX',
        status: 'PENDING',
        value: 190,
      });
      mockAsaas.getPixQrCode.mockResolvedValueOnce({
        encodedImage: 'iVBORfake==',
        payload: '00020101pix-payload-fake',
        expirationDate: '2026-05-06 23:59:59',
      });

      const res = await request(server)
        .post('/payments/pix-pack')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ packOfferId: pack5OfferId })
        .expect(201);

      // R$ 200,00 base − 5% PIX = R$ 190,00 = 19_000 cents
      expect(res.body).toMatchObject({
        asaasChargeId: 'pay_test_1',
        amountCents: 19_000,
        basePriceCents: 20_000,
        pixDiscountPercent: 5,
        pix: {
          qrCodeImage: 'iVBORfake==',
          qrCodePayload: '00020101pix-payload-fake',
        },
      });
      expect(res.body.paymentId).toEqual(expect.any(String));

      // Asaas was billed the discounted value
      expect(mockAsaas.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({ value: 190 }),
      );

      // User got asaasCustomerId stored
      const u = await prisma.user.findUnique({ where: { id: userId } });
      expect(u?.asaasCustomerId).toBe('cus_test_1');

      // Payment row exists, PENDING, snapshot of pack data
      const payment = await prisma.payment.findUnique({
        where: { asaasChargeId: 'pay_test_1' },
      });
      expect(payment).toMatchObject({
        userId,
        status: 'PENDING',
        kind: 'ONE_OFF_PACK',
        packCredits: 5,
        packExpirationDays: 60,
        amountCents: 19_000,
        method: 'PIX',
      });

      expect(mockAsaas.createCustomer).toHaveBeenCalledTimes(1);
      expect(mockAsaas.createPayment).toHaveBeenCalledTimes(1);
      expect(mockAsaas.getPixQrCode).toHaveBeenCalledWith('pay_test_1');
    });

    it('second purchase REUSES the Asaas customer (no new createCustomer call)', async () => {
      mockAsaas.createPayment.mockResolvedValueOnce({
        id: 'pay_test_2',
        customer: 'cus_test_1',
        billingType: 'PIX',
        status: 'PENDING',
        value: 332.5,
      });
      mockAsaas.getPixQrCode.mockResolvedValueOnce({
        encodedImage: 'img2',
        payload: 'p2',
        expirationDate: '2026-05-07 23:59:59',
      });

      await request(server)
        .post('/payments/pix-pack')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ packOfferId: pack10OfferId })
        .expect(201);

      expect(mockAsaas.createCustomer).not.toHaveBeenCalled();
      expect(mockAsaas.createPayment).toHaveBeenCalledTimes(1);
    });
  });

  describe('POST /asaas/webhook', () => {
    it('without token → 401', async () => {
      await request(server)
        .post('/asaas/webhook')
        .send({ event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_test_1' } })
        .expect(401);
    });

    it('with wrong token → 401', async () => {
      await request(server)
        .post('/asaas/webhook')
        .set('asaas-access-token', 'wrong-token-blah-blah-blah')
        .send({ event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_test_1' } })
        .expect(401);
    });

    it('PAYMENT_CONFIRMED → Payment becomes PAID + CreditPack created with correct expiry', async () => {
      const before = await prisma.creditPack.count({
        where: { userId, source: 'PURCHASE_PACK' },
      });

      const res = await request(server)
        .post('/asaas/webhook')
        .set('asaas-access-token', WEBHOOK_TOKEN)
        .send({
          event: 'PAYMENT_CONFIRMED',
          payment: {
            id: 'pay_test_1',
            customer: 'cus_test_1',
            billingType: 'PIX',
            status: 'CONFIRMED',
            value: 190,
          },
        })
        .expect(200);
      expect(res.body).toEqual({ received: true });

      const payment = await prisma.payment.findUnique({
        where: { asaasChargeId: 'pay_test_1' },
      });
      expect(payment?.status).toBe('PAID');
      expect(payment?.paidAt).not.toBeNull();

      const after = await prisma.creditPack.findMany({
        where: { userId, source: 'PURCHASE_PACK', paymentId: payment!.id },
      });
      expect(after.length).toBe(before + 1);
      expect(after[0]).toMatchObject({
        totalCredits: 5,
        remainingCredits: 5,
      });
      // 5-credit pack offer → 60-day expiry (snapshotted on Payment.packExpirationDays)
      const expectedExpiry =
        new Date(payment!.paidAt!).getTime() + 60 * 86_400_000;
      const actualExpiry = after[0].expiresAt!.getTime();
      expect(Math.abs(actualExpiry - expectedExpiry)).toBeLessThan(60_000);
    });

    it('re-fired webhook is idempotent (no duplicate CreditPack)', async () => {
      const before = await prisma.creditPack.count({
        where: { userId, source: 'PURCHASE_PACK' },
      });

      await request(server)
        .post('/asaas/webhook')
        .set('asaas-access-token', WEBHOOK_TOKEN)
        .send({
          event: 'PAYMENT_RECEIVED',
          payment: { id: 'pay_test_1', status: 'RECEIVED', value: 190 },
        })
        .expect(200);

      const after = await prisma.creditPack.count({
        where: { userId, source: 'PURCHASE_PACK' },
      });
      expect(after).toBe(before);
    });

    it('webhook for unknown asaasChargeId → 200, silently ignored', async () => {
      const before = await prisma.creditPack.count({
        where: { userId, source: 'PURCHASE_PACK' },
      });

      await request(server)
        .post('/asaas/webhook')
        .set('asaas-access-token', WEBHOOK_TOKEN)
        .send({
          event: 'PAYMENT_CONFIRMED',
          payment: { id: 'pay_does_not_exist', status: 'CONFIRMED', value: 999 },
        })
        .expect(200);

      const after = await prisma.creditPack.count({
        where: { userId, source: 'PURCHASE_PACK' },
      });
      expect(after).toBe(before);
    });

    it('unknown event type is logged + 200 (no error)', async () => {
      await request(server)
        .post('/asaas/webhook')
        .set('asaas-access-token', WEBHOOK_TOKEN)
        .send({ event: 'SOMETHING_FUTURE', payment: { id: 'x' } })
        .expect(200);
    });
  });

  describe('GET /payments/me', () => {
    it('GET /payments/:id reconciles a paid Asaas charge when webhook was missed', async () => {
      const paymentBefore = await prisma.payment.findUnique({
        where: { asaasChargeId: 'pay_test_2' },
      });
      expect(paymentBefore?.status).toBe('PENDING');

      const packsBefore = await prisma.creditPack.count({
        where: { userId, source: 'PURCHASE_PACK' },
      });

      mockAsaas.getPayment.mockResolvedValueOnce({
        id: 'pay_test_2',
        customer: 'cus_test_1',
        billingType: 'PIX',
        status: 'RECEIVED',
        value: 332.5,
      });

      const res = await request(server)
        .get(`/payments/${paymentBefore!.id}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(mockAsaas.getPayment).toHaveBeenCalledWith('pay_test_2');
      expect(res.body.status).toBe('PAID');

      const packsAfterCount = await prisma.creditPack.count({
        where: { userId, source: 'PURCHASE_PACK' },
      });
      expect(packsAfterCount).toBe(packsBefore + 1);

      const packsAfter = await prisma.creditPack.findMany({
        where: { userId, source: 'PURCHASE_PACK', paymentId: paymentBefore!.id },
      });
      expect(packsAfter.length).toBe(1);
      expect(packsAfter[0]).toMatchObject({
        totalCredits: 10,
        remainingCredits: 10,
      });
    });

    it('lists the user\'s payments newest first', async () => {
      const res = await request(server)
        .get('/payments/me')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(2);
      expect(res.body[0].asaasChargeId).toBeDefined();
    });
  });
});
