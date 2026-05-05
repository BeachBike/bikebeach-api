import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { hash } from 'bcrypt';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// E2E coverage for Phase 5c-2: waitlist join/leave/list, auto-promotion on
// reservation cancellation, and check-in window enforcement.

describe('Waitlist + check-in (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: ReturnType<INestApplication['getHttpServer']>;

  const adminEmail = `e2e-wl-admin-${randomUUID()}@test.local`;
  const adminPassword = 'wl-admin-12345';
  const user1Email = `e2e-wl-u1-${randomUUID()}@test.local`;
  const user2Email = `e2e-wl-u2-${randomUUID()}@test.local`;
  const user3Email = `e2e-wl-u3-${randomUUID()}@test.local`;
  const password = 'wl-pass-12345';
  const instructorEmail = `e2e-wl-instr-${randomUUID()}@test.local`;

  let adminToken: string;
  let user1Token: string;
  let user2Token: string;
  let user3Token: string;
  let instructorToken: string;

  let user1Id: string;
  let user2Id: string;
  let user3Id: string;
  let instructorId: string;

  let unitId: string;
  let bikeId: string;
  let slotEmptyId: string; // capacity 10, untouched — for "free seats" negative
  let slotPromoteId: string; // capacity 1, used for full waitlist + auto-promote
  let slotCheckinLateId: string; // capacity 1, used for late-checkin negative

  let user2ReservationFromPromotion: string;

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

    // Admin
    await prisma.user.create({
      data: {
        email: adminEmail,
        name: 'WL Admin',
        role: Role.ADMIN,
        passwordHash: await hash(adminPassword, 10),
      },
    });
    adminToken = (await login(adminEmail, adminPassword)).accessToken;

    // Three users
    const u1 = await signup(user1Email, password, 'WL U1');
    user1Token = u1.accessToken;
    user1Id = u1.user.id;

    const u2 = await signup(user2Email, password, 'WL U2');
    user2Token = u2.accessToken;
    user2Id = u2.user.id;

    const u3 = await signup(user3Email, password, 'WL U3');
    user3Token = u3.accessToken;
    user3Id = u3.user.id;

    // Unit + instructor + bike
    unitId = (
      await api('post', '/units', adminToken, {
        name: 'WL Praia',
        slug: `e2e-wl-${randomUUID().slice(0, 6)}`,
        address: 'Faixa de areia',
      })
    ).id;

    const instructor = await api('post', '/users/staff', adminToken, {
      email: instructorEmail,
      password,
      name: 'WL Instr',
      role: 'INSTRUCTOR',
      unitId,
    });
    instructorId = instructor.id;
    instructorToken = (await login(instructorEmail, password)).accessToken;

    bikeId = (await api('post', '/bikes', adminToken, { unitId, label: 'B1' }))
      .id;

    // Slots
    const farFuture = () =>
      new Date(Date.now() + 24 * 3_600_000).toISOString();
    slotEmptyId = (
      await api('post', '/class-slots', instructorToken, {
        unitId,
        instructorId,
        startsAt: farFuture(),
        durationMinutes: 50,
        capacity: 10,
      })
    ).id;
    slotPromoteId = (
      await api('post', '/class-slots', instructorToken, {
        unitId,
        instructorId,
        startsAt: farFuture(),
        durationMinutes: 50,
        capacity: 1,
      })
    ).id;
    slotCheckinLateId = (
      await api('post', '/class-slots', instructorToken, {
        unitId,
        instructorId,
        startsAt: farFuture(),
        durationMinutes: 50,
        capacity: 1,
      })
    ).id;

    // Credits: User1 + User2 + User3 (User3's credits matter for nothing here
    // since User3 stays gate-blocked, but grant for parity).
    for (const userId of [user1Id, user2Id, user3Id]) {
      await api('post', '/credit-packs/grant', adminToken, {
        userId,
        credits: 5,
      });
    }

    // Health gate: User1 + User2 accept directly via Prisma (faster, this
    // file isn't testing the gate-acceptance API surface). User3 stays
    // unaccepted on purpose — we test the gate block on join with them.
    for (const userId of [user1Id, user2Id]) {
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
      where: { user: { email: { startsWith: 'e2e-wl-' } } },
    });
    await prisma.waitlistEntry.deleteMany({
      where: { user: { email: { startsWith: 'e2e-wl-' } } },
    });
    await prisma.creditPack.deleteMany({
      where: { user: { email: { startsWith: 'e2e-wl-' } } },
    });
    await prisma.liabilityAcceptance.deleteMany({
      where: { user: { email: { startsWith: 'e2e-wl-' } } },
    });
    await prisma.parqResponse.deleteMany({
      where: { user: { email: { startsWith: 'e2e-wl-' } } },
    });
    await prisma.classSlot.deleteMany({
      where: { unit: { slug: { startsWith: 'e2e-wl-' } } },
    });
    await prisma.bike.deleteMany({
      where: { unit: { slug: { startsWith: 'e2e-wl-' } } },
    });
    await prisma.user.deleteMany({
      where: { email: { startsWith: 'e2e-wl-' } },
    });
    await prisma.unit.deleteMany({
      where: { slug: { startsWith: 'e2e-wl-' } },
    });
  }

  async function login(email: string, pwd: string) {
    const r = await request(server)
      .post('/auth/login')
      .send({ email, password: pwd })
      .expect(200);
    return r.body;
  }
  async function signup(email: string, pwd: string, name: string) {
    const r = await request(server)
      .post('/auth/signup')
      .send({ email, password: pwd, name })
      .expect(201);
    return r.body;
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

  describe('Waitlist — join validation', () => {
    it('joining a slot with free seats → 400', async () => {
      await request(server)
        .post(`/class-slots/${slotEmptyId}/waitlist`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(400);
    });

    it('User1 reserves the only bike on slotPromote (capacity=1) → fills it', async () => {
      await api('post', '/reservations', user1Token, {
        classSlotId: slotPromoteId,
        bikeId,
      });
    });

    it('joining without health gate → 403 with HEALTH_GATE_BLOCK', async () => {
      const res = await request(server)
        .post(`/class-slots/${slotPromoteId}/waitlist`)
        .set('Authorization', `Bearer ${user3Token}`)
        .expect(403);
      expect(res.body.code).toBe('HEALTH_GATE_BLOCK');
    });
  });

  describe('Waitlist — join, leave, re-join, list', () => {
    it('User2 joins the full slot waitlist', async () => {
      const res = await request(server)
        .post(`/class-slots/${slotPromoteId}/waitlist`)
        .set('Authorization', `Bearer ${user2Token}`)
        .expect(201);
      expect(res.body).toMatchObject({
        classSlotId: slotPromoteId,
        userId: user2Id,
        promotedAt: null,
      });
    });

    it('joining twice → 409', async () => {
      await request(server)
        .post(`/class-slots/${slotPromoteId}/waitlist`)
        .set('Authorization', `Bearer ${user2Token}`)
        .expect(409);
    });

    it('regular USER listing waitlist → 403', async () => {
      await request(server)
        .get(`/class-slots/${slotPromoteId}/waitlist`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(403);
    });

    it('ADMIN listing waitlist returns the entries with user info', async () => {
      const list = await api(
        'get',
        `/class-slots/${slotPromoteId}/waitlist`,
        adminToken,
      );
      expect(list.length).toBe(1);
      expect(list[0]).toMatchObject({
        userId: user2Id,
        user: { id: user2Id, email: user2Email },
      });
    });

    it('User2 leaves and re-joins (proves hard-delete unblocks the unique)', async () => {
      await request(server)
        .delete(`/class-slots/${slotPromoteId}/waitlist`)
        .set('Authorization', `Bearer ${user2Token}`)
        .expect(204);

      await request(server)
        .post(`/class-slots/${slotPromoteId}/waitlist`)
        .set('Authorization', `Bearer ${user2Token}`)
        .expect(201);
    });
  });

  describe('Auto-promotion', () => {
    it('User1 cancels → User2 is auto-promoted', async () => {
      const user1Reservation = (
        await api('get', '/reservations/me', user1Token)
      ).find(
        (r: { classSlotId: string; status: string }) =>
          r.classSlotId === slotPromoteId && r.status === 'ACTIVE',
      );

      const cancelRes = await request(server)
        .delete(`/reservations/${user1Reservation.id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);
      expect(cancelRes.body).toMatchObject({
        creditReturned: true, // 24h away, well outside 8h window
        waitlistPromoted: true,
      });
    });

    it("User2's waitlist entry is marked promotedAt", async () => {
      const list = await api(
        'get',
        `/class-slots/${slotPromoteId}/waitlist`,
        adminToken,
      );
      const u2Entry = list.find(
        (e: { userId: string }) => e.userId === user2Id,
      );
      expect(u2Entry.promotedAt).not.toBeNull();
    });

    it("User2's new reservation has promotedFromWaitlist=true", async () => {
      const u2Reservations = await api('get', '/reservations/me', user2Token);
      const promoted = u2Reservations.find(
        (r: { classSlotId: string }) => r.classSlotId === slotPromoteId,
      );
      expect(promoted).toMatchObject({
        userId: user2Id,
        bikeId,
        promotedFromWaitlist: true,
        status: 'ACTIVE',
      });
      user2ReservationFromPromotion = promoted.id;
    });
  });

  describe('Check-in window', () => {
    it('check-in BEFORE the class start → 400', async () => {
      // slotPromote is still ~24h in the future → way too early
      await request(server)
        .post(`/reservations/${user2ReservationFromPromotion}/checkin`)
        .set('Authorization', `Bearer ${user2Token}`)
        .expect(400);
    });

    it('move startsAt to now-30s, check-in succeeds', async () => {
      await prisma.classSlot.update({
        where: { id: slotPromoteId },
        data: { startsAt: new Date(Date.now() - 30_000) },
      });

      const res = await request(server)
        .post(`/reservations/${user2ReservationFromPromotion}/checkin`)
        .set('Authorization', `Bearer ${user2Token}`)
        .expect(201);
      expect(res.body).toMatchObject({
        id: user2ReservationFromPromotion,
        status: 'CHECKED_IN',
      });
      expect(res.body.checkedInAt).toBeDefined();
    });

    it('check-in AFTER the tolerance window → 400', async () => {
      // Use the late slot. User1 reserves first.
      const reservation = await api(
        'post',
        '/reservations',
        user1Token,
        { classSlotId: slotCheckinLateId, bikeId },
      );
      // Move startsAt to 10min ago — beyond default 5min tolerance.
      await prisma.classSlot.update({
        where: { id: slotCheckinLateId },
        data: { startsAt: new Date(Date.now() - 10 * 60_000) },
      });
      await request(server)
        .post(`/reservations/${reservation.id}/checkin`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(400);
    });

    it('check-in on someone else\'s reservation → 403', async () => {
      await request(server)
        .post(`/reservations/${user2ReservationFromPromotion}/checkin`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(403);
    });
  });
});
