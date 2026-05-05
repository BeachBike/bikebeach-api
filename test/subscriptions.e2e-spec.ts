import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { hash } from 'bcrypt';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AsaasClientService } from '../src/asaas/asaas-client.service';
import { PrismaService } from '../src/prisma/prisma.service';

// Phase 5e-2: monthly recurring subscription via Asaas + per-cycle CreditPack.
// AsaasClient is mocked.

const WEBHOOK_TOKEN = 'dev-webhook-token-change-in-prod-1234567890abcdef';

describe('Subscriptions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: ReturnType<INestApplication['getHttpServer']>;

  const mockAsaas = {
    createCustomer: jest.fn(),
    createPayment: jest.fn(),
    getPixQrCode: jest.fn(),
    createSubscription: jest.fn(),
    cancelSubscription: jest.fn(),
  };

  const adminEmail = `e2e-sub-admin-${randomUUID()}@test.local`;
  const adminPassword = 'sub-admin-12345';
  const password = 'sub-pass-12345';
  const userEmail = `e2e-sub-u-${randomUUID()}@test.local`;
  const noCpfEmail = `e2e-sub-nocpf-${randomUUID()}@test.local`;

  let adminToken: string;
  let userToken: string;
  let userId: string;
  let noCpfToken: string;

  let activePlanId: string;
  let inactivePlanId: string;

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

    // Admin
    await prisma.user.create({
      data: {
        email: adminEmail,
        name: 'Sub Admin',
        role: Role.ADMIN,
        passwordHash: await hash(adminPassword, 10),
      },
    });
    adminToken = (
      await request(server)
        .post('/auth/login')
        .send({ email: adminEmail, password: adminPassword })
        .expect(200)
    ).body.accessToken;

    // User with CPF
    const u = await request(server)
      .post('/auth/signup')
      .send({
        email: userEmail,
        password,
        name: 'Sub U',
        cpf: '12345678909',
      })
      .expect(201);
    userToken = u.body.accessToken;
    userId = u.body.user.id;

    // User without CPF (negative test)
    const noCpf = await request(server)
      .post('/auth/signup')
      .send({ email: noCpfEmail, password, name: 'NoCpf' })
      .expect(201);
    noCpfToken = noCpf.body.accessToken;

    // Active plan via API
    const activePlan = await request(server)
      .post('/plans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `e2e-sub-plan-active-${randomUUID().slice(0, 6)}`,
        monthlyCredits: 8,
        priceCents: 19900,
      })
      .expect(201);
    activePlanId = activePlan.body.id;

    // Inactive plan via Prisma direct
    const inactive = await prisma.plan.create({
      data: {
        name: `e2e-sub-plan-inactive-${randomUUID().slice(0, 6)}`,
        monthlyCredits: 4,
        priceCents: 9900,
        isActive: false,
      },
    });
    inactivePlanId = inactive.id;
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  beforeEach(() => {
    Object.values(mockAsaas).forEach((fn) => fn.mockReset());
  });

  async function cleanup() {
    await prisma.creditPack.deleteMany({
      where: { user: { email: { startsWith: 'e2e-sub-' } } },
    });
    await prisma.payment.deleteMany({
      where: { user: { email: { startsWith: 'e2e-sub-' } } },
    });
    await prisma.subscription.deleteMany({
      where: { user: { email: { startsWith: 'e2e-sub-' } } },
    });
    await prisma.plan.deleteMany({
      where: { name: { startsWith: 'e2e-sub-plan-' } },
    });
    await prisma.user.deleteMany({
      where: { email: { startsWith: 'e2e-sub-' } },
    });
  }

  describe('POST /subscriptions', () => {
    it('user without CPF → 400 CPF_REQUIRED', async () => {
      const res = await request(server)
        .post('/subscriptions')
        .set('Authorization', `Bearer ${noCpfToken}`)
        .send({ planId: activePlanId })
        .expect(400);
      expect(res.body.code).toBe('CPF_REQUIRED');
    });

    it('inactive plan → 400', async () => {
      await request(server)
        .post('/subscriptions')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ planId: inactivePlanId })
        .expect(400);
    });

    it('non-existent plan → 400', async () => {
      await request(server)
        .post('/subscriptions')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ planId: 'cl-does-not-exist' })
        .expect(400);
    });

    it('happy path → creates Asaas customer + subscription, persists local Subscription ACTIVE with cycle window', async () => {
      mockAsaas.createCustomer.mockResolvedValueOnce({
        id: 'cus_sub_test_1',
        name: 'Sub U',
        email: userEmail,
      });
      mockAsaas.createSubscription.mockResolvedValueOnce({
        id: 'sub_test_1',
        customer: 'cus_sub_test_1',
        billingType: 'PIX',
        status: 'ACTIVE',
        value: 199,
        nextDueDate: '2026-05-05',
        cycle: 'MONTHLY',
      });

      const res = await request(server)
        .post('/subscriptions')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ planId: activePlanId })
        .expect(201);

      expect(res.body).toMatchObject({
        userId,
        planId: activePlanId,
        asaasSubscriptionId: 'sub_test_1',
        status: 'ACTIVE',
      });
      expect(res.body.plan.monthlyCredits).toBe(8);

      // currentPeriodEnd should be ~30 days after currentPeriodStart
      const start = new Date(res.body.currentPeriodStart).getTime();
      const end = new Date(res.body.currentPeriodEnd).getTime();
      const days = (end - start) / 86_400_000;
      expect(days).toBeGreaterThan(27);
      expect(days).toBeLessThan(33);

      // Customer was synced with the right CPF
      expect(mockAsaas.createCustomer).toHaveBeenCalledWith(
        expect.objectContaining({
          cpfCnpj: '12345678909',
          email: userEmail,
        }),
      );
      // Asaas subscription called with plan price
      expect(mockAsaas.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: 'cus_sub_test_1',
          billingType: 'PIX',
          value: 199,
          cycle: 'MONTHLY',
        }),
      );
    });

    it('subscribing again while one is ACTIVE → 409', async () => {
      await request(server)
        .post('/subscriptions')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ planId: activePlanId })
        .expect(409);
    });
  });

  describe('Webhook — subscription cycle Payment lifecycle', () => {
    let createdPaymentId: string;
    let originalCycleEnd: Date;

    it('captures the subscription\'s current cycle end before any webhook fires', async () => {
      const sub = await prisma.subscription.findFirst({
        where: { userId, asaasSubscriptionId: 'sub_test_1' },
      });
      originalCycleEnd = sub!.currentPeriodEnd;
    });

    it('PAYMENT_CREATED for subscription cycle → upserts local Payment SUBSCRIPTION_CYCLE PENDING', async () => {
      await request(server)
        .post('/asaas/webhook')
        .set('asaas-access-token', WEBHOOK_TOKEN)
        .send({
          event: 'PAYMENT_CREATED',
          payment: {
            id: 'pay_sub_cycle_1',
            customer: 'cus_sub_test_1',
            subscription: 'sub_test_1',
            billingType: 'PIX',
            status: 'PENDING',
            value: 199,
          },
        })
        .expect(200);

      const payment = await prisma.payment.findUnique({
        where: { asaasChargeId: 'pay_sub_cycle_1' },
      });
      expect(payment).toMatchObject({
        userId,
        kind: 'SUBSCRIPTION_CYCLE',
        status: 'PENDING',
        amountCents: 19900,
        method: 'PIX',
      });
      expect(payment?.subscriptionId).toBeTruthy();
      createdPaymentId = payment!.id;
    });

    it('PAYMENT_CREATED re-fired is idempotent (same row, no duplicate)', async () => {
      const before = await prisma.payment.count({
        where: { asaasChargeId: 'pay_sub_cycle_1' },
      });

      await request(server)
        .post('/asaas/webhook')
        .set('asaas-access-token', WEBHOOK_TOKEN)
        .send({
          event: 'PAYMENT_CREATED',
          payment: {
            id: 'pay_sub_cycle_1',
            customer: 'cus_sub_test_1',
            subscription: 'sub_test_1',
            billingType: 'PIX',
            status: 'PENDING',
            value: 199,
          },
        })
        .expect(200);

      const after = await prisma.payment.count({
        where: { asaasChargeId: 'pay_sub_cycle_1' },
      });
      expect(after).toBe(before);
    });

    it('PAYMENT_CONFIRMED → Payment PAID + CreditPack source=SUBSCRIPTION_CYCLE with expiresAt = previous cycle end', async () => {
      await request(server)
        .post('/asaas/webhook')
        .set('asaas-access-token', WEBHOOK_TOKEN)
        .send({
          event: 'PAYMENT_CONFIRMED',
          payment: {
            id: 'pay_sub_cycle_1',
            customer: 'cus_sub_test_1',
            subscription: 'sub_test_1',
            billingType: 'PIX',
            status: 'CONFIRMED',
            value: 199,
          },
        })
        .expect(200);

      const payment = await prisma.payment.findUnique({
        where: { id: createdPaymentId },
      });
      expect(payment?.status).toBe('PAID');

      const pack = await prisma.creditPack.findFirst({
        where: { paymentId: createdPaymentId },
      });
      expect(pack).toMatchObject({
        userId,
        source: 'SUBSCRIPTION_CYCLE',
        totalCredits: 8,
        remainingCredits: 8,
      });
      expect(pack?.subscriptionId).toBeTruthy();
      // Pack expires at the cycle end the user paid for
      expect(pack?.expiresAt?.getTime()).toBe(originalCycleEnd.getTime());
    });

    it('Subscription cycle window advances by 1 month for next cycle', async () => {
      const sub = await prisma.subscription.findFirst({
        where: { userId, asaasSubscriptionId: 'sub_test_1' },
      });
      // currentPeriodStart is now what was currentPeriodEnd
      expect(sub?.currentPeriodStart.getTime()).toBe(
        originalCycleEnd.getTime(),
      );
      // currentPeriodEnd has moved ~30 days further
      const days =
        (sub!.currentPeriodEnd.getTime() -
          sub!.currentPeriodStart.getTime()) /
        86_400_000;
      expect(days).toBeGreaterThan(27);
      expect(days).toBeLessThan(33);
    });

    it('PAYMENT_CONFIRMED re-fired is idempotent (no duplicate CreditPack)', async () => {
      const before = await prisma.creditPack.count({
        where: { paymentId: createdPaymentId },
      });

      await request(server)
        .post('/asaas/webhook')
        .set('asaas-access-token', WEBHOOK_TOKEN)
        .send({
          event: 'PAYMENT_RECEIVED',
          payment: {
            id: 'pay_sub_cycle_1',
            customer: 'cus_sub_test_1',
            subscription: 'sub_test_1',
            billingType: 'PIX',
            status: 'RECEIVED',
            value: 199,
          },
        })
        .expect(200);

      const after = await prisma.creditPack.count({
        where: { paymentId: createdPaymentId },
      });
      expect(after).toBe(before);
    });

    it('PAYMENT_CREATED for unknown subscription is ignored', async () => {
      await request(server)
        .post('/asaas/webhook')
        .set('asaas-access-token', WEBHOOK_TOKEN)
        .send({
          event: 'PAYMENT_CREATED',
          payment: {
            id: 'pay_orphan',
            customer: 'cus_unknown',
            subscription: 'sub_unknown',
            billingType: 'PIX',
            status: 'PENDING',
            value: 99,
          },
        })
        .expect(200);

      const orphan = await prisma.payment.findUnique({
        where: { asaasChargeId: 'pay_orphan' },
      });
      expect(orphan).toBeNull();
    });
  });

  describe('Cancel + re-subscribe', () => {
    let activeSubId: string;

    it('GET /subscriptions/me lists the active subscription', async () => {
      const list = await request(server)
        .get('/subscriptions/me')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);
      expect(list.body.length).toBeGreaterThanOrEqual(1);
      const active = list.body.find(
        (s: { status: string }) => s.status === 'ACTIVE',
      );
      expect(active).toBeDefined();
      activeSubId = active.id;
    });

    it('cancel calls Asaas + flips status to CANCELLED', async () => {
      mockAsaas.cancelSubscription.mockResolvedValueOnce({
        deleted: true,
        id: 'sub_test_1',
      });

      const res = await request(server)
        .delete(`/subscriptions/${activeSubId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(res.body.status).toBe('CANCELLED');
      expect(res.body.cancelledAt).toBeDefined();
      expect(mockAsaas.cancelSubscription).toHaveBeenCalledWith('sub_test_1');
    });

    it('cancellation does NOT touch existing CreditPacks (credits stay until expiry)', async () => {
      const packs = await prisma.creditPack.findMany({
        where: { userId, source: 'SUBSCRIPTION_CYCLE' },
      });
      expect(packs.length).toBeGreaterThan(0);
      packs.forEach((p) => {
        expect(p.remainingCredits).toBe(8);
      });
    });

    it('re-subscribing after cancellation is allowed', async () => {
      mockAsaas.createSubscription.mockResolvedValueOnce({
        id: 'sub_test_2',
        customer: 'cus_sub_test_1',
        billingType: 'PIX',
        status: 'ACTIVE',
        value: 199,
        nextDueDate: '2026-06-05',
        cycle: 'MONTHLY',
      });

      const res = await request(server)
        .post('/subscriptions')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ planId: activePlanId })
        .expect(201);

      expect(res.body.asaasSubscriptionId).toBe('sub_test_2');
      // No new createCustomer call — reused the existing asaasCustomerId
      expect(mockAsaas.createCustomer).not.toHaveBeenCalled();
    });

    it('cancelling someone else\'s subscription returns 403', async () => {
      // noCpfToken belongs to a user with no subscription. Try cancelling u1's.
      const u1Subs = await prisma.subscription.findMany({
        where: { userId, status: 'ACTIVE' },
      });
      await request(server)
        .delete(`/subscriptions/${u1Subs[0].id}`)
        .set('Authorization', `Bearer ${noCpfToken}`)
        .expect(403);
    });
  });
});
