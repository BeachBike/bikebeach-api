import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { hash } from 'bcrypt';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { CreditPacksService } from '../src/credit-packs/credit-packs.service';
import { PrismaService } from '../src/prisma/prisma.service';

// Phase 5d: daily cron zeroing remainingCredits on overdue packs.
// Triggers the underlying method directly — we don't wait for the actual
// cron schedule.

describe('Credit pack expiry job (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let creditPacks: CreditPacksService;
  let server: ReturnType<INestApplication['getHttpServer']>;

  const adminEmail = `e2e-cpe-admin-${randomUUID()}@test.local`;
  const adminPassword = 'cpe-admin-12345';
  const userEmail = `e2e-cpe-u-${randomUUID()}@test.local`;
  const userPassword = 'cpe-u-12345';

  let adminToken: string;
  let userId: string;

  let pastPackId: string;
  let futurePackId: string;
  let neverPackId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
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
    creditPacks = app.get(CreditPacksService);
    await cleanup();

    await prisma.user.create({
      data: {
        email: adminEmail,
        name: 'CPE Admin',
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

    const user = await request(server)
      .post('/auth/signup')
      .send({ email: userEmail, password: userPassword, name: 'CPE U' })
      .expect(201);
    userId = user.body.user.id;

    pastPackId = (
      await request(server)
        .post('/credit-packs/grant')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId,
          credits: 5,
          expiresAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        })
        .expect(201)
    ).body.id;

    futurePackId = (
      await request(server)
        .post('/credit-packs/grant')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId,
          credits: 3,
          expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        })
        .expect(201)
    ).body.id;

    neverPackId = (
      await request(server)
        .post('/credit-packs/grant')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ userId, credits: 2 })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  async function cleanup() {
    await prisma.creditPack.deleteMany({
      where: { user: { email: { startsWith: 'e2e-cpe-' } } },
    });
    await prisma.user.deleteMany({
      where: { email: { startsWith: 'e2e-cpe-' } },
    });
  }

  it('expireOverduePacks zeroes only the past-expiry pack, returns 1', async () => {
    const count = await creditPacks.expireOverduePacks();
    expect(count).toBe(1);

    const past = await prisma.creditPack.findUnique({
      where: { id: pastPackId },
    });
    const future = await prisma.creditPack.findUnique({
      where: { id: futurePackId },
    });
    const never = await prisma.creditPack.findUnique({
      where: { id: neverPackId },
    });

    expect(past?.remainingCredits).toBe(0);
    expect(past?.totalCredits).toBe(5); // history preserved
    expect(future?.remainingCredits).toBe(3);
    expect(never?.remainingCredits).toBe(2);
  });

  it('running again is idempotent — returns 0', async () => {
    const count = await creditPacks.expireOverduePacks();
    expect(count).toBe(0);
  });

  it('expired pack is excluded from active-credits listing', async () => {
    const userToken = (
      await request(server)
        .post('/auth/login')
        .send({ email: userEmail, password: userPassword })
        .expect(200)
    ).body.accessToken;

    // Default (active only) — past pack is gone (zero remaining + expired)
    const active = await request(server)
      .get('/credit-packs/me')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    const activeIds = active.body.map((p: { id: string }) => p.id);
    expect(activeIds).toEqual(expect.arrayContaining([futurePackId, neverPackId]));
    expect(activeIds).not.toContain(pastPackId);

    // includeExpired=true — past pack still returned (history)
    const all = await request(server)
      .get('/credit-packs/me?includeExpired=true')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    const allIds = all.body.map((p: { id: string }) => p.id);
    expect(allIds).toEqual(
      expect.arrayContaining([pastPackId, futurePackId, neverPackId]),
    );
  });
});
