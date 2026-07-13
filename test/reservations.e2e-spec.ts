import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { hash } from 'bcrypt';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// E2E coverage of Phase 5c-1: health gate, credit grant, reserve flow,
// cancel flow (8h window + refund logic), and the critical concurrency
// guarantee (parallel POSTs on same bike → exactly one wins).

describe('Reservations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: ReturnType<INestApplication['getHttpServer']>;

  // Users
  const adminEmail = `e2e-rsv-admin-${randomUUID()}@test.local`;
  const adminPassword = 'rsv-admin-12345';
  const user1Email = `e2e-rsv-u1-${randomUUID()}@test.local`;
  const user1Password = 'rsv-u1-12345';
  const user2Email = `e2e-rsv-u2-${randomUUID()}@test.local`;
  const user2Password = 'rsv-u2-12345';
  const instructorEmail = `e2e-rsv-instr-${randomUUID()}@test.local`;
  const instructorPassword = 'rsv-instr-12345';

  let adminToken: string;
  let user1Token: string;
  let user2Token: string;
  let instructorToken: string;

  let user1Id: string;
  let user2Id: string;
  let instructorId: string;

  let unitId: string;
  let bike1Id: string;
  let bike2Id: string;
  let slotFarId: string; // ~24h away — outside 8h cancel window
  let slotNearId: string; // ~6h away — inside 8h cancel window

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

    // 1. Admin (seeded via Prisma — no API for that)
    await prisma.user.create({
      data: {
        email: adminEmail,
        name: 'RSV Admin',
        role: Role.ADMIN,
        passwordHash: await hash(adminPassword, 10),
      },
    });
    adminToken = (await login(adminEmail, adminPassword)).accessToken;

    // 2. Two regular users
    const u1Signup = await signup(user1Email, user1Password, 'RSV U1');
    user1Token = u1Signup.accessToken;
    user1Id = u1Signup.user.id;

    const u2Signup = await signup(user2Email, user2Password, 'RSV U2');
    user2Token = u2Signup.accessToken;
    user2Id = u2Signup.user.id;

    // 3. Unit
    unitId = (
      await api('post', '/units', adminToken, {
        name: 'RSV Praia',
        slug: `e2e-rsv-${randomUUID().slice(0, 6)}`,
        address: 'Faixa de areia',
      })
    ).id;

    // 4. Instructor (admin creates, then login). bio + primaryClassKindId
    // are mandatory for INSTRUCTOR after C1 — ensure a kind exists first.
    const testKind = await prisma.classKind.upsert({
      where: { slug: 'e2e-rsv-kind' },
      create: {
        slug: 'e2e-rsv-kind',
        name: 'RSV Kind',
        defaultDurationMinutes: 45,
      },
      update: {},
    });
    const instructor = await api('post', '/users/staff', adminToken, {
      email: instructorEmail,
      password: instructorPassword,
      name: 'RSV Instr',
      role: 'INSTRUCTOR',
      unitId,
      bio: 'RSV bio',
      primaryClassKindId: testKind.id,
    });
    instructorId = instructor.id;
    instructorToken = (await login(instructorEmail, instructorPassword))
      .accessToken;

    // 5. Two bikes
    bike1Id = (
      await api('post', '/bikes', adminToken, { unitId, label: 'B1' })
    ).id;
    bike2Id = (
      await api('post', '/bikes', adminToken, { unitId, label: 'B2' })
    ).id;

    // 6. Two class slots
    slotFarId = (
      await api('post', '/class-slots', instructorToken, {
        unitId,
        instructorId,
        startsAt: new Date(Date.now() + 24 * 3_600_000).toISOString(),
        durationMinutes: 50,
        capacity: 10,
      })
    ).id;
    slotNearId = (
      await api('post', '/class-slots', instructorToken, {
        unitId,
        instructorId,
        startsAt: new Date(Date.now() + 6 * 3_600_000).toISOString(),
        durationMinutes: 50,
        capacity: 10,
      })
    ).id;

    // 7. Grant credits to both users (User1 needs several across tests)
    await api('post', '/credit-packs/grant', adminToken, {
      userId: user1Id,
      credits: 5,
    });
    await api('post', '/credit-packs/grant', adminToken, {
      userId: user2Id,
      credits: 1,
    });

    // 8. User2 already has health gate accepted (seeded via Prisma so the
    //    concurrency test isn't blocked). User1 will go through the API.
    await prisma.liabilityAcceptance.create({
      data: { userId: user2Id, version: 'v1.0' },
    });
    await prisma.parqResponse.create({
      data: { userId: user2Id, version: 'v1.0', answers: { ok: true } },
    });
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  async function cleanup() {
    await prisma.reservation.deleteMany({
      where: { user: { email: { startsWith: 'e2e-rsv-' } } },
    });
    await prisma.creditPack.deleteMany({
      where: { user: { email: { startsWith: 'e2e-rsv-' } } },
    });
    await prisma.liabilityAcceptance.deleteMany({
      where: { user: { email: { startsWith: 'e2e-rsv-' } } },
    });
    await prisma.parqResponse.deleteMany({
      where: { user: { email: { startsWith: 'e2e-rsv-' } } },
    });
    await prisma.classSlot.deleteMany({
      where: { unit: { slug: { startsWith: 'e2e-rsv-' } } },
    });
    await prisma.bike.deleteMany({
      where: { unit: { slug: { startsWith: 'e2e-rsv-' } } },
    });
    await prisma.user.deleteMany({
      where: { email: { startsWith: 'e2e-rsv-' } },
    });
    await prisma.unit.deleteMany({
      where: { slug: { startsWith: 'e2e-rsv-' } },
    });
    await prisma.classKind.deleteMany({
      where: { slug: { startsWith: 'e2e-rsv-' } },
    });
  }

  async function login(email: string, password: string) {
    const res = await request(server)
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return res.body;
  }

  async function signup(email: string, password: string, name: string) {
    const res = await request(server)
      .post('/auth/signup')
      .send({ email, password, name })
      .expect(201);
    return res.body;
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
    // supertest's .send() is typed string|object; `unknown` narrows to
    // `{} | null` which TS rejects. Callers only ever pass a JSON body
    // or nothing, so asserting the send-boundary type is safe.
    if (body !== undefined) r.send(body as string | object);
    const res = await r;
    if (res.status >= 400) {
      throw new Error(
        `${method.toUpperCase()} ${path} → ${res.status}: ${JSON.stringify(res.body)}`,
      );
    }
    return res.body;
  }

  describe('Health gate', () => {
    it('blocks reservation when liability + PAR-Q are missing', async () => {
      const res = await request(server)
        .post('/reservations')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ classSlotId: slotFarId, bikeId: bike1Id })
        .expect(403);
      expect(res.body.code).toBe('HEALTH_GATE_BLOCK');
      expect(res.body.details.liability.valid).toBe(false);
      expect(res.body.details.parq.valid).toBe(false);
    });

    it('User1 accepts liability — still blocked because PAR-Q missing', async () => {
      await request(server)
        .post('/liability/accept')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ version: 'v1.0' })
        .expect(201);

      const res = await request(server)
        .post('/reservations')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ classSlotId: slotFarId, bikeId: bike1Id })
        .expect(403);
      expect(res.body.details.liability.valid).toBe(true);
      expect(res.body.details.parq.valid).toBe(false);
    });

    it('User1 submits PAR-Q — gate now ok', async () => {
      await request(server)
        .post('/parq/submit')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          version: 'v1.0',
          answers: { hasHeartCondition: false, isPregnant: false },
        })
        .expect(201);

      const status = await api('get', '/health-gate/status', user1Token);
      expect(status.ok).toBe(true);
      expect(status.liability.valid).toBe(true);
      expect(status.parq.valid).toBe(true);
    });
  });

  describe('Reservation — golden path + concurrency', () => {
    it('User1 reserves bike2 for the far slot — credit decremented', async () => {
      const before = await api('get', '/credit-packs/me', user1Token);
      const beforeRemaining = before[0].remainingCredits;

      const res = await request(server)
        .post('/reservations')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ classSlotId: slotFarId, bikeId: bike2Id })
        .expect(201);
      expect(res.body).toMatchObject({
        userId: user1Id,
        classSlotId: slotFarId,
        bikeId: bike2Id,
        status: 'ACTIVE',
        promotedFromWaitlist: false,
      });
      expect(res.body.activeKey).toBe(`${slotFarId}:${bike2Id}`);

      const after = await api('get', '/credit-packs/me', user1Token);
      expect(after[0].remainingCredits).toBe(beforeRemaining - 1);
    });

    it('GET /reservations/me lists the reservation', async () => {
      const list = await api('get', '/reservations/me', user1Token);
      expect(list.length).toBeGreaterThan(0);
      expect(list[0]).toMatchObject({ classSlotId: slotFarId, bikeId: bike2Id });
    });

    it('parallel POSTs on the same (slot, bike) → exactly one wins, other gets 409', async () => {
      const targetBike = bike1Id; // bike1 is still free
      const [r1, r2] = await Promise.all([
        request(server)
          .post('/reservations')
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ classSlotId: slotFarId, bikeId: targetBike }),
        request(server)
          .post('/reservations')
          .set('Authorization', `Bearer ${user2Token}`)
          .send({ classSlotId: slotFarId, bikeId: targetBike }),
      ]);

      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual([201, 409]);

      // The loser must NOT have lost their credit (transaction rolls back).
      // Find the loser by checking who got 201 vs 409 and verify creditPack.
      const winnerToken = r1.status === 201 ? user1Token : user2Token;
      const loserToken = r1.status === 409 ? user1Token : user2Token;
      const winnerExpectedDebit = r1.status === 201 ? user1Id : user2Id;
      void winnerToken; // referenced via balance check below

      // Loser's credit is unchanged
      const loserPacks = await api('get', '/credit-packs/me', loserToken);
      const loserRemaining = loserPacks.reduce(
        (s: number, p: { remainingCredits: number }) => s + p.remainingCredits,
        0,
      );
      // User2 started with 1 credit; User1 had 5 then used 1 above (so 4 before this race)
      const expectedLoserRemaining = winnerExpectedDebit === user1Id ? 1 : 4;
      expect(loserRemaining).toBe(expectedLoserRemaining);
    });
  });

  // 2026-07 — a PAR-Q with any "SIM" (active health concern) must surface to
  // the class's instructor/admin (in-app), without blocking the reservation.
  describe('Health roster — flagged PAR-Q surfaces to manager', () => {
    it('User1 submits a flagged PAR-Q (any SIM) → status.parq.flagged true', async () => {
      await request(server)
        .post('/parq/submit')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          version: 'v1.0',
          answers: {
            responses: { cardiac: 'sim', chestPainExercise: 'nao' },
            notes: 'histórico cardíaco na família',
          },
        })
        .expect(201);
      const status = await api('get', '/health-gate/status', user1Token);
      expect(status.parq.flagged).toBe(true);
      expect(status.parq.flaggedKeys).toContain('cardiac');
      // Flagged is NOT blocked — the gate stays valid time-wise.
      expect(status.parq.valid).toBe(true);
    });

    it('roster marks the flagged participant (instructor view)', async () => {
      const roster = await api(
        'get',
        `/class-slots/${slotFarId}/roster`,
        instructorToken,
      );
      const row = roster.students.find(
        (s: { user: { id: string } }) => s.user.id === user1Id,
      );
      expect(row).toBeDefined();
      expect(row.healthFlagged).toBe(true);
    });

    it('participant-health endpoint returns the full PAR-Q (instructor)', async () => {
      const health = await api(
        'get',
        `/class-slots/${slotFarId}/participants/${user1Id}/health`,
        instructorToken,
      );
      expect(health.parq.flagged).toBe(true);
      expect(health.parq.answers).not.toBeNull();
      expect(health.parq.notes).toContain('cardíaco');
    });

    it('participant-health is forbidden for a regular USER', async () => {
      await request(server)
        .get(`/class-slots/${slotFarId}/participants/${user1Id}/health`)
        .set('Authorization', `Bearer ${user2Token}`)
        .expect(403);
    });

    it('participant-health 404s for a user not in the slot', async () => {
      await request(server)
        .get(
          `/class-slots/${slotFarId}/participants/00000000-0000-0000-0000-000000000000/health`,
        )
        .set('Authorization', `Bearer ${instructorToken}`)
        .expect(404);
    });
  });

  describe('Cancellation rules', () => {
    let nearReservationId: string;
    let farReservationId: string;

    it('User1 reserves a bike for the near slot (~6h away)', async () => {
      // Use bike2 again on a different slot (slot is different so no activeKey collision)
      const res = await request(server)
        .post('/reservations')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ classSlotId: slotNearId, bikeId: bike2Id })
        .expect(201);
      nearReservationId = res.body.id;
    });

    it('cancelling a reservation in the protected window (<8h) loses the credit', async () => {
      const before = await api('get', '/credit-packs/me', user1Token);
      const beforeTotal = before.reduce(
        (s: number, p: { remainingCredits: number }) => s + p.remainingCredits,
        0,
      );

      const res = await request(server)
        .delete(`/reservations/${nearReservationId}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);
      expect(res.body).toMatchObject({
        id: nearReservationId,
        status: 'CANCELLED_BY_USER',
        creditReturned: false,
      });

      const after = await api('get', '/credit-packs/me', user1Token);
      const afterTotal = after.reduce(
        (s: number, p: { remainingCredits: number }) => s + p.remainingCredits,
        0,
      );
      expect(afterTotal).toBe(beforeTotal); // no refund
    });

    it('User1 reserves the same bike again for the near slot — proves activeKey was cleared', async () => {
      // After cancel, activeKey is NULL → bike is bookable again
      await request(server)
        .post('/reservations')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ classSlotId: slotNearId, bikeId: bike2Id })
        .expect(201);
    });

    it('cancelling well outside the window (>8h) refunds the credit', async () => {
      // Find a reservation User1 has on the far slot
      const list = await api('get', '/reservations/me', user1Token);
      const onFar = list.find(
        (r: { classSlotId: string; status: string }) =>
          r.classSlotId === slotFarId && r.status === 'ACTIVE',
      );
      expect(onFar).toBeDefined();
      farReservationId = onFar.id;

      const before = await api('get', '/credit-packs/me', user1Token);
      const beforeTotal = before.reduce(
        (s: number, p: { remainingCredits: number }) => s + p.remainingCredits,
        0,
      );

      const res = await request(server)
        .delete(`/reservations/${farReservationId}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);
      expect(res.body.creditReturned).toBe(true);

      const after = await api('get', '/credit-packs/me', user1Token);
      const afterTotal = after.reduce(
        (s: number, p: { remainingCredits: number }) => s + p.remainingCredits,
        0,
      );
      expect(afterTotal).toBe(beforeTotal + 1); // refunded
    });

    it('cancelling someone else\'s reservation returns 403', async () => {
      // User1 has the slotNear/bike2 reservation re-booked above and still
      // ACTIVE. user2 tries to cancel it and gets 403.
      const list = await api('get', '/reservations/me', user1Token);
      const target = list.find(
        (r: { classSlotId: string; status: string }) =>
          r.classSlotId === slotNearId && r.status === 'ACTIVE',
      );
      expect(target).toBeDefined();

      await request(server)
        .delete(`/reservations/${target.id}`)
        .set('Authorization', `Bearer ${user2Token}`)
        .expect(403);
    });
  });

  describe('E1 — lead time + double-booking + change-bike', () => {
    let leadSlotId: string;
    let bike3Id: string;

    it('blocks reservation inside the 10-min lead window (400)', async () => {
      // Slot 5 minutes away — backend should reject. We bypass the API to
      // create it because the create endpoint also enforces validations.
      const slot = await prisma.classSlot.create({
        data: {
          unitId,
          instructorId,
          startsAt: new Date(Date.now() + 5 * 60_000),
          durationMinutes: 50,
          capacity: 10,
        },
      });
      leadSlotId = slot.id;

      const res = await request(server)
        .post('/reservations')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ classSlotId: leadSlotId, bikeId: bike1Id })
        .expect(400);
      expect(res.body.message).toMatch(/10/);
    });

    it('blocks a second reservation by the same user on the same slot (409)', async () => {
      // User1 already has a reservation on slotFarId (bike2 from the
      // golden-path test earlier). We need a fresh user1 reservation that
      // we know is ACTIVE — by this point in the suite the earlier far
      // reservation may have been cancelled, so re-reserve first.
      const list = await api('get', '/reservations/me', user1Token);
      const onFarActive = list.find(
        (r: { classSlotId: string; status: string }) =>
          r.classSlotId === slotFarId && r.status === 'ACTIVE',
      );
      if (!onFarActive) {
        await api('post', '/reservations', user1Token, {
          classSlotId: slotFarId,
          bikeId: bike2Id,
        });
      }

      // Need a third bike so we're not asking for the same (slot, bike).
      bike3Id = (
        await api('post', '/bikes', adminToken, { unitId, label: 'B3' })
      ).id;

      const res = await request(server)
        .post('/reservations')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ classSlotId: slotFarId, bikeId: bike3Id })
        .expect(409);
      expect(res.body.message).toMatch(/já tem|trocar bike/i);
    });

    it('changeBike swaps bike on a far reservation (≥ 8h)', async () => {
      const list = await api('get', '/reservations/me', user1Token);
      const onFar = list.find(
        (r: { classSlotId: string; status: string }) =>
          r.classSlotId === slotFarId && r.status === 'ACTIVE',
      );
      expect(onFar).toBeDefined();

      const res = await request(server)
        .patch(`/reservations/${onFar.id}/bike`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ bikeId: bike3Id })
        .expect(200);
      expect(res.body.bikeId).toBe(bike3Id);
      expect(res.body.activeKey).toBe(`${slotFarId}:${bike3Id}`);
    });

    it('changeBike to the same current bike rejects with 400', async () => {
      const list = await api('get', '/reservations/me', user1Token);
      const onFar = list.find(
        (r: { classSlotId: string; status: string }) =>
          r.classSlotId === slotFarId && r.status === 'ACTIVE',
      );
      const res = await request(server)
        .patch(`/reservations/${onFar.id}/bike`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ bikeId: onFar.bikeId })
        .expect(400);
      expect(res.body.message).toMatch(/bike atual/i);
    });

    it('changeBike inside the 8h window rejects with 400', async () => {
      // Fresh reservation on the near slot (6h away). We cleared bike2 there
      // earlier and re-booked it; if it's still ACTIVE, change-bike must fail.
      const list = await api('get', '/reservations/me', user1Token);
      const onNear = list.find(
        (r: { classSlotId: string; status: string }) =>
          r.classSlotId === slotNearId && r.status === 'ACTIVE',
      );
      expect(onNear).toBeDefined();

      const res = await request(server)
        .patch(`/reservations/${onNear.id}/bike`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ bikeId: bike3Id })
        .expect(400);
      expect(res.body.message).toMatch(/8h/);
    });

    it('changeBike rejects with 403 when caller is not the owner', async () => {
      const list = await api('get', '/reservations/me', user1Token);
      const onFar = list.find(
        (r: { classSlotId: string; status: string }) =>
          r.classSlotId === slotFarId && r.status === 'ACTIVE',
      );
      await request(server)
        .patch(`/reservations/${onFar.id}/bike`)
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ bikeId: bike1Id })
        .expect(403);
    });

    it('self-no-show: marca a reserva como NO_SHOW com motivo durante a aula', async () => {
      // Build a "live" slot — startsAt 5min ago, duration 50min, so we're
      // currently inside the run window. Create the reservation directly via
      // Prisma because the create flow rejects past startsAt.
      const liveSlot = await prisma.classSlot.create({
        data: {
          unitId,
          instructorId,
          startsAt: new Date(Date.now() - 5 * 60_000),
          durationMinutes: 50,
          capacity: 10,
        },
      });
      const liveBike = (
        await api('post', '/bikes', adminToken, { unitId, label: 'B-LIVE' })
      ).id;
      // Need a credit pack to seed the reservation row.
      const pack = await prisma.creditPack.findFirst({
        where: { userId: user1Id, remainingCredits: { gt: 0 } },
      });
      expect(pack).toBeTruthy();
      const liveReservation = await prisma.reservation.create({
        data: {
          classSlotId: liveSlot.id,
          bikeId: liveBike,
          userId: user1Id,
          creditPackId: pack!.id,
          status: 'ACTIVE',
          activeKey: `${liveSlot.id}:${liveBike}`,
        },
      });

      // Reason too short → 400
      await request(server)
        .post(`/reservations/${liveReservation.id}/self-no-show`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ reason: 'a' })
        .expect(400);

      // Owner-mismatch → 403
      await request(server)
        .post(`/reservations/${liveReservation.id}/self-no-show`)
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ reason: 'tentando me intrometer' })
        .expect(403);

      // Happy path: status flips to NO_SHOW with the reason recorded.
      const ok = await request(server)
        .post(`/reservations/${liveReservation.id}/self-no-show`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ reason: 'passei mal de manhã, não consegui ir' })
        .expect(201);
      expect(ok.body).toMatchObject({
        id: liveReservation.id,
        status: 'NO_SHOW',
        cancellationReason: 'passei mal de manhã, não consegui ir',
      });
      expect(ok.body.activeKey).toBeNull();

      // Idempotency check: a second call now hits the "ACTIVE" guard.
      await request(server)
        .post(`/reservations/${liveReservation.id}/self-no-show`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ reason: 'tentando de novo' })
        .expect(400);
    });
  });

  describe('Credit pack admin gating', () => {
    it('regular USER cannot grant credit packs (403)', async () => {
      await request(server)
        .post('/credit-packs/grant')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ userId: user2Id, credits: 1 })
        .expect(403);
    });
  });
});
