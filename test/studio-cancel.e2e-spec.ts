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

    const testKind = await prisma.classKind.upsert({
      where: { slug: 'e2e-sc-kind' },
      create: {
        slug: 'e2e-sc-kind',
        name: 'SC Kind',
        defaultDurationMinutes: 45,
      },
      update: {},
    });
    const instructor = await api('post', '/users/staff', adminToken, {
      email: instructorEmail,
      password,
      name: 'SC Instr',
      role: 'INSTRUCTOR',
      unitId,
      bio: 'SC bio',
      primaryClassKindId: testKind.id,
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
    await prisma.classKind.deleteMany({
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

  describe('F2 — confirm-start + auto-confirm cron', () => {
    let slotId: string;
    let resId: string;

    it('rejects confirm before startsAt (400)', async () => {
      slotId = (
        await api('post', '/class-slots', instructorToken, {
          unitId,
          instructorId,
          startsAt: farFuture(),
          durationMinutes: 50,
          capacity: 5,
        })
      ).id;

      await request(server)
        .post(`/class-slots/${slotId}/confirm-start`)
        .set('Authorization', `Bearer ${instructorToken}`)
        .expect(400);
    });

    it('happy path: instructor confirms after startsAt → confirmedStartedAt set, autoStartConfirmed=false', async () => {
      // Reserve a seat BEFORE moving startsAt — the reservation create
      // endpoint rejects past slots.
      resId = (
        await api('post', '/reservations', u1Token, {
          classSlotId: slotId,
          bikeId: bike1Id,
        })
      ).id;

      // Move startsAt to 1 minute ago so confirmation is valid.
      await prisma.classSlot.update({
        where: { id: slotId },
        data: { startsAt: new Date(Date.now() - 60_000) },
      });

      const res = await api(
        'post',
        `/class-slots/${slotId}/confirm-start`,
        instructorToken,
      );
      expect(res.confirmedStartedAt).not.toBeNull();
      expect(res.autoStartConfirmed).toBe(false);
      expect(res.status).toBe('SCHEDULED');
    });

    it('idempotency: second confirm returns 400', async () => {
      await request(server)
        .post(`/class-slots/${slotId}/confirm-start`)
        .set('Authorization', `Bearer ${instructorToken}`)
        .expect(400);
    });

    it('non-owner instructor → 403', async () => {
      // Create a second instructor to prove ownership gating.
      const otherEmail = `e2e-sc-other-${randomUUID()}@test.local`;
      const otherKind = await prisma.classKind.upsert({
        where: { slug: 'e2e-sc-kind' },
        create: {
          slug: 'e2e-sc-kind',
          name: 'SC Kind',
          defaultDurationMinutes: 45,
        },
        update: {},
      });
      await api('post', '/users/staff', adminToken, {
        email: otherEmail,
        password,
        name: 'SC Other',
        role: 'INSTRUCTOR',
        unitId,
        bio: 'sc other bio',
        primaryClassKindId: otherKind.id,
      });
      const otherToken = (await login(otherEmail, password)).accessToken;

      // Fresh unconfirmed slot owned by `instructorId`.
      const lonelySlot = (
        await api('post', '/class-slots', instructorToken, {
          unitId,
          instructorId,
          startsAt: farFuture(),
          durationMinutes: 50,
          capacity: 5,
        })
      ).id;
      await prisma.classSlot.update({
        where: { id: lonelySlot },
        data: { startsAt: new Date(Date.now() - 60_000) },
      });

      await request(server)
        .post(`/class-slots/${lonelySlot}/confirm-start`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(403);
    });

    it('cron auto-confirm: sweeps ACTIVE reservations into CHECKED_IN', async () => {
      // Build a slot, reserve a seat, then move startsAt past the
      // auto-confirm grace window. The cron's `autoConfirmStart` is
      // invoked directly so the test doesn't wait for the actual tick.
      const autoSlotId = (
        await api('post', '/class-slots', instructorToken, {
          unitId,
          instructorId,
          startsAt: farFuture(),
          durationMinutes: 50,
          capacity: 5,
        })
      ).id;
      // Need bike2 free; bike1 is held by `resId` from the earlier test.
      const autoRes = await api('post', '/reservations', u2Token, {
        classSlotId: autoSlotId,
        bikeId: bike2Id,
      });
      await prisma.classSlot.update({
        where: { id: autoSlotId },
        data: { startsAt: new Date(Date.now() - 11 * 60_000) },
      });

      const jobs = app.get(
        require('../src/jobs/class-slot-jobs.service').ClassSlotJobsService,
      );
      await jobs.autoConfirmStart();

      const slotAfter = await prisma.classSlot.findUnique({
        where: { id: autoSlotId },
      });
      expect(slotAfter?.confirmedStartedAt).not.toBeNull();
      expect(slotAfter?.autoStartConfirmed).toBe(true);

      const r = await prisma.reservation.findUnique({
        where: { id: autoRes.id },
      });
      expect(r?.status).toBe('CHECKED_IN');
    });
  });

  describe('F3 — bulk-check-in', () => {
    let slotId: string;
    let r1Id: string;
    let r2Id: string;

    it('setup: live slot with two reservations', async () => {
      slotId = (
        await api('post', '/class-slots', instructorToken, {
          unitId,
          instructorId,
          startsAt: farFuture(),
          durationMinutes: 50,
          capacity: 5,
        })
      ).id;
      r1Id = (
        await api('post', '/reservations', u1Token, {
          classSlotId: slotId,
          bikeId: bike1Id,
        })
      ).id;
      r2Id = (
        await api('post', '/reservations', u2Token, {
          classSlotId: slotId,
          bikeId: bike2Id,
        })
      ).id;
      await prisma.classSlot.update({
        where: { id: slotId },
        data: { startsAt: new Date(Date.now() - 60_000) },
      });
    });

    it('bulk-check-in: marks present + sweeps unmarked into NO_SHOW', async () => {
      const res = await api(
        'post',
        `/class-slots/${slotId}/bulk-check-in`,
        instructorToken,
        { presentReservationIds: [r1Id] },
      );
      expect(res).toMatchObject({ checkedIn: 1, noShow: 1 });

      const r1 = await prisma.reservation.findUnique({ where: { id: r1Id } });
      const r2 = await prisma.reservation.findUnique({ where: { id: r2Id } });
      expect(r1?.status).toBe('CHECKED_IN');
      expect(r1?.checkedInAt).not.toBeNull();
      expect(r2?.status).toBe('NO_SHOW');
      expect(r2?.activeKey).toBeNull();
      expect(r2?.cancellationReason).toMatch(/professor/i);
    });

    it('idempotent: re-running with the same set lands on same totals', async () => {
      const res = await api(
        'post',
        `/class-slots/${slotId}/bulk-check-in`,
        instructorToken,
        { presentReservationIds: [r1Id] },
      );
      // After item-18 the scan includes NO_SHOW too, so r2 (instructor-
      // marked from the previous call) shows up as `noShow:1` (stays put).
      // No `ignored` because nothing is user-marked here.
      expect(res).toMatchObject({ checkedIn: 1, noShow: 1, ignored: 0 });
    });

    it('CHECKED_IN cannot be downgraded to NO_SHOW (item-18 lock)', async () => {
      // r1 is currently CHECKED_IN (from the happy-path test above).
      // Calling bulk-check-in with an empty present set used to flip it
      // back to NO_SHOW; per item-18 it should stay locked.
      const res = await api(
        'post',
        `/class-slots/${slotId}/bulk-check-in`,
        instructorToken,
        { presentReservationIds: [] },
      );
      // r1 stays CHECKED_IN, r2 stays NO_SHOW (still instructor-marked).
      expect(res).toMatchObject({ checkedIn: 1, noShow: 1, ignored: 0 });
      const r1 = await prisma.reservation.findUnique({ where: { id: r1Id } });
      expect(r1?.status).toBe('CHECKED_IN');
    });

    it('user-marked NO_SHOW is locked (item-8) — instructor cannot flip back', async () => {
      // Build a fresh reservation, have the user self-mark NO_SHOW, then
      // try to bulk-check-in with that id in present. The backend should
      // ignore it (per item-8) and the row stays NO_SHOW.
      const lockedSlot = (
        await api('post', '/class-slots', instructorToken, {
          unitId,
          instructorId,
          startsAt: farFuture(),
          durationMinutes: 50,
          capacity: 5,
        })
      ).id;
      // Use a different bike than r1/r2 to avoid activeKey clash.
      const lockedBike = (
        await api('post', '/bikes', adminToken, { unitId, label: 'F-LK' })
      ).id;
      const lockedRes = await api('post', '/reservations', u3Token, {
        classSlotId: lockedSlot,
        bikeId: lockedBike,
      });
      // Move startsAt into the run window so selfNoShow accepts it.
      await prisma.classSlot.update({
        where: { id: lockedSlot },
        data: { startsAt: new Date(Date.now() - 60_000) },
      });
      await api(
        'post',
        `/reservations/${lockedRes.id}/self-no-show`,
        u3Token,
        { reason: 'passei mal de manhã' },
      );

      const res = await api(
        'post',
        `/class-slots/${lockedSlot}/bulk-check-in`,
        instructorToken,
        { presentReservationIds: [lockedRes.id] },
      );
      // The user-marked row falls into `ignored`.
      expect(res).toMatchObject({ checkedIn: 0, noShow: 0, ignored: 1 });
      const after = await prisma.reservation.findUnique({
        where: { id: lockedRes.id },
      });
      expect(after?.status).toBe('NO_SHOW');
      expect(after?.cancellationReason).toMatch(/passei mal/i);
    });

    it('instructor-marked NO_SHOW can be flipped back to CHECKED_IN', async () => {
      // r2 is currently NO_SHOW (instructor-marked from happy-path).
      // Including it in present should flip it back to CHECKED_IN.
      const res = await api(
        'post',
        `/class-slots/${slotId}/bulk-check-in`,
        instructorToken,
        { presentReservationIds: [r1Id, r2Id] },
      );
      expect(res).toMatchObject({ checkedIn: 2, noShow: 0, ignored: 0 });
      const r2 = await prisma.reservation.findUnique({ where: { id: r2Id } });
      expect(r2?.status).toBe('CHECKED_IN');
      expect(r2?.cancellationReason).toBeNull();
    });

    it('rejects reservation IDs that don\'t belong to the slot (400)', async () => {
      // Build a separate slot + reservation, then try to bulk-check-in via
      // the first slot using the foreign id.
      const otherSlot = (
        await api('post', '/class-slots', instructorToken, {
          unitId,
          instructorId,
          startsAt: farFuture(),
          durationMinutes: 50,
          capacity: 5,
        })
      ).id;
      const fresh = await api('post', '/reservations', u3Token, {
        classSlotId: otherSlot,
        bikeId: bike1Id,
      });

      await request(server)
        .post(`/class-slots/${slotId}/bulk-check-in`)
        .set('Authorization', `Bearer ${instructorToken}`)
        .send({ presentReservationIds: [fresh.id] })
        .expect(400);
    });
  });
});
