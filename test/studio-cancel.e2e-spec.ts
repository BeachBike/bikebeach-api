import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { hash } from 'bcrypt';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// E2E coverage for Phase 5c-3: studio (instructor/admin) cancels a class
// slot with active reservations + waitlist entries. All-or-nothing
// transaction: bulk-flip reservations to CANCELLED_BY_STUDIO with refunds,
// clear waitlist, transition the slot itself.

describe('Studio cancel — bulk refund + waitlist clear (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: ReturnType<INestApplication['getHttpServer']>;

  const adminEmail = `e2e-sc-admin-${randomUUID()}@test.local`;
  const adminPassword = 'sc-admin-12345';
  const password = 'sc-pass-12345';
  const u1Email = `e2e-sc-u1-${randomUUID()}@test.local`;
  const u2Email = `e2e-sc-u2-${randomUUID()}@test.local`;
  const u3Email = `e2e-sc-u3-${randomUUID()}@test.local`;
  const instructorEmail = `e2e-sc-instr-${randomUUID()}@test.local`;

  let adminToken: string;
  let u1Token: string;
  let u2Token: string;
  let u3Token: string;
  let instructorToken: string;

  let u1Id: string;
  let u2Id: string;
  let u3Id: string;
  let instructorId: string;

  let unitId: string;
  let bike1Id: string;
  let bike2Id: string;

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
    await cleanup();

    await prisma.user.create({
      data: {
        email: adminEmail,
        name: 'SC Admin',
        role: Role.ADMIN,
        passwordHash: await hash(adminPassword, 10),
      },
    });
    adminToken = (await login(adminEmail, adminPassword)).accessToken;

    const u1 = await signup(u1Email, password, 'SC U1');
    u1Token = u1.accessToken;
    u1Id = u1.user.id;
    const u2 = await signup(u2Email, password, 'SC U2');
    u2Token = u2.accessToken;
    u2Id = u2.user.id;
    const u3 = await signup(u3Email, password, 'SC U3');
    u3Token = u3.accessToken;
    u3Id = u3.user.id;

    unitId = (
      await api('post', '/units', adminToken, {
        name: 'SC Praia',
        slug: `e2e-sc-${randomUUID().slice(0, 6)}`,
        address: 'Faixa de areia',
      })
    ).id;

    const instructor = await api('post', '/users/staff', adminToken, {
      email: instructorEmail,
      password,
      name: 'SC Instr',
      role: 'INSTRUCTOR',
      unitId,
    });
    instructorId = instructor.id;
    instructorToken = (await login(instructorEmail, password)).accessToken;

    bike1Id = (await api('post', '/bikes', adminToken, { unitId, label: 'B1' }))
      .id;
    bike2Id = (await api('post', '/bikes', adminToken, { unitId, label: 'B2' }))
      .id;

    // Credits + gates (direct DB for setup speed)
    for (const userId of [u1Id, u2Id, u3Id]) {
      await api('post', '/credit-packs/grant', adminToken, {
        userId,
        credits: 5,
      });
      await prisma.liabilityAcceptance.create({
        data: { userId, version: 'v1.0' },
      });
      await prisma.parqResponse.create({
        data: { userId, version: 'v1.0', answers: { ok: true } },
      });
    }
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  async function cleanup() {
    await prisma.reservation.deleteMany({
      where: { user: { email: { startsWith: 'e2e-sc-' } } },
    });
    await prisma.waitlistEntry.deleteMany({
      where: { user: { email: { startsWith: 'e2e-sc-' } } },
    });
    await prisma.creditPack.deleteMany({
      where: { user: { email: { startsWith: 'e2e-sc-' } } },
    });
    await prisma.liabilityAcceptance.deleteMany({
      where: { user: { email: { startsWith: 'e2e-sc-' } } },
    });
    await prisma.parqResponse.deleteMany({
      where: { user: { email: { startsWith: 'e2e-sc-' } } },
    });
    await prisma.classSlot.deleteMany({
      where: { unit: { slug: { startsWith: 'e2e-sc-' } } },
    });
    await prisma.bike.deleteMany({
      where: { unit: { slug: { startsWith: 'e2e-sc-' } } },
    });
    await prisma.user.deleteMany({
      where: { email: { startsWith: 'e2e-sc-' } },
    });
    await prisma.unit.deleteMany({
      where: { slug: { startsWith: 'e2e-sc-' } },
    });
  }

  async function login(email: string, pwd: string) {
    return (await request(server).post('/auth/login').send({ email, password: pwd }).expect(200))
      .body;
  }
  async function signup(email: string, pwd: string, name: string) {
    return (
      await request(server)
        .post('/auth/signup')
        .send({ email, password: pwd, name })
        .expect(201)
    ).body;
  }
  async function api(
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    token: string,
    body?: unknown,
  ) {
    const r = request(server)
      [method](path)
      .set('Authorization', `Bearer ${token}`);
    if (body !== undefined) r.send(body);
    const res = await r;
    if (res.status >= 400) {
      throw new Error(
        `${method.toUpperCase()} ${path} → ${res.status}: ${JSON.stringify(res.body)}`,
      );
    }
    return res.body;
  }

  function farFuture() {
    return new Date(Date.now() + 24 * 3_600_000).toISOString();
  }

  describe('Cancel an empty slot — counts are zero', () => {
    let emptySlotId: string;

    it('instructor cancels a slot with no reservations / no waitlist', async () => {
      emptySlotId = (
        await api('post', '/class-slots', instructorToken, {
          unitId,
          instructorId,
          startsAt: farFuture(),
          durationMinutes: 50,
          capacity: 1,
        })
      ).id;

      const res = await api(
        'post',
        `/class-slots/${emptySlotId}/cancel`,
        instructorToken,
        { kind: 'STUDIO', studioReason: 'CHUVA' },
      );
      expect(res).toMatchObject({
        status: 'CANCELLED_BEFORE',
        reservationsCancelled: 0,
        creditsRefunded: 0,
        waitlistCleared: 0,
      });
    });
  });

  describe('Cancel a full slot with waitlist — bulk refund + clear', () => {
    let slotId: string;
    let u1ReservationId: string;
    let u2ReservationId: string;
    let u1PackBefore: number;
    let u2PackBefore: number;

    it('setup: 2 reservations fill capacity-2 slot, U3 joins waitlist', async () => {
      slotId = (
        await api('post', '/class-slots', instructorToken, {
          unitId,
          instructorId,
          startsAt: farFuture(),
          durationMinutes: 50,
          capacity: 2,
        })
      ).id;

      u1ReservationId = (
        await api('post', '/reservations', u1Token, {
          classSlotId: slotId,
          bikeId: bike1Id,
        })
      ).id;
      u2ReservationId = (
        await api('post', '/reservations', u2Token, {
          classSlotId: slotId,
          bikeId: bike2Id,
        })
      ).id;
      await api('post', `/class-slots/${slotId}/waitlist`, u3Token);

      // Snapshot remaining credits BEFORE the cancel
      const u1Packs = await api('get', '/credit-packs/me', u1Token);
      const u2Packs = await api('get', '/credit-packs/me', u2Token);
      u1PackBefore = u1Packs.reduce(
        (s: number, p: { remainingCredits: number }) => s + p.remainingCredits,
        0,
      );
      u2PackBefore = u2Packs.reduce(
        (s: number, p: { remainingCredits: number }) => s + p.remainingCredits,
        0,
      );
    });

    it('instructor cancels — response counts reflect what changed', async () => {
      const res = await api(
        'post',
        `/class-slots/${slotId}/cancel`,
        instructorToken,
        { kind: 'STUDIO', studioReason: 'VENTO' },
      );
      expect(res).toMatchObject({
        status: 'CANCELLED_BEFORE',
        cancellationKind: 'STUDIO',
        studioCancellationReason: 'VENTO',
        cancelledByUserId: instructorId,
        reservationsCancelled: 2,
        creditsRefunded: 2,
        waitlistCleared: 1,
      });
    });

    it('both reservations transitioned to CANCELLED_BY_STUDIO with activeKey cleared', async () => {
      const r1 = await prisma.reservation.findUnique({
        where: { id: u1ReservationId },
      });
      const r2 = await prisma.reservation.findUnique({
        where: { id: u2ReservationId },
      });
      expect(r1?.status).toBe('CANCELLED_BY_STUDIO');
      expect(r1?.activeKey).toBeNull();
      expect(r1?.cancelledByUserId).toBe(instructorId);
      expect(r2?.status).toBe('CANCELLED_BY_STUDIO');
      expect(r2?.activeKey).toBeNull();
    });

    it('both users got their credit refunded (incremented back on original pack)', async () => {
      const u1Packs = await api('get', '/credit-packs/me', u1Token);
      const u2Packs = await api('get', '/credit-packs/me', u2Token);
      const u1After = u1Packs.reduce(
        (s: number, p: { remainingCredits: number }) => s + p.remainingCredits,
        0,
      );
      const u2After = u2Packs.reduce(
        (s: number, p: { remainingCredits: number }) => s + p.remainingCredits,
        0,
      );
      expect(u1After).toBe(u1PackBefore + 1);
      expect(u2After).toBe(u2PackBefore + 1);
    });

    it("U3's waitlist entry is marked removedAt", async () => {
      const entry = await prisma.waitlistEntry.findUnique({
        where: {
          classSlotId_userId: { classSlotId: slotId, userId: u3Id },
        },
      });
      expect(entry?.removedAt).not.toBeNull();
      expect(entry?.promotedAt).toBeNull();
    });
  });

  describe('Cancel mid-class also catches CHECKED_IN reservations', () => {
    let slotId: string;
    let u1ReservationId: string;

    it('setup: reservation, move startsAt to now-30s, check-in', async () => {
      slotId = (
        await api('post', '/class-slots', instructorToken, {
          unitId,
          instructorId,
          startsAt: farFuture(),
          durationMinutes: 50,
          capacity: 1,
        })
      ).id;

      u1ReservationId = (
        await api('post', '/reservations', u1Token, {
          classSlotId: slotId,
          bikeId: bike1Id,
        })
      ).id;

      // Move slot to "in progress" so check-in works
      await prisma.classSlot.update({
        where: { id: slotId },
        data: { startsAt: new Date(Date.now() - 30_000) },
      });

      await api('post', `/reservations/${u1ReservationId}/checkin`, u1Token);

      const r = await prisma.reservation.findUnique({
        where: { id: u1ReservationId },
      });
      expect(r?.status).toBe('CHECKED_IN');
    });

    it('instructor cancels mid-class → status CANCELLED_DURING, CHECKED_IN reservation also flipped + refunded', async () => {
      const res = await api(
        'post',
        `/class-slots/${slotId}/cancel`,
        instructorToken,
        { kind: 'STUDIO', studioReason: 'SEGURANCA' },
      );
      expect(res).toMatchObject({
        status: 'CANCELLED_DURING',
        cancellationKind: 'STUDIO',
        studioCancellationReason: 'SEGURANCA',
        reservationsCancelled: 1,
        creditsRefunded: 1,
      });

      const r = await prisma.reservation.findUnique({
        where: { id: u1ReservationId },
      });
      expect(r?.status).toBe('CANCELLED_BY_STUDIO');
      expect(r?.activeKey).toBeNull();
    });
  });
});
