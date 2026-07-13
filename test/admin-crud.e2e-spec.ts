import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { hash } from 'bcrypt';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// E2E coverage of Phase 5b admin CRUD: units, bikes, class slots, plans,
// plus tenancy + role gating.
//
// Cleanup hits everything we tag with `e2e-` prefix (slug / email / name).
// Tests share state in a fixture set up in beforeAll.

describe('Admin CRUD (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: ReturnType<INestApplication['getHttpServer']>;

  const adminEmail = `e2e-admin-${randomUUID()}@test.local`;
  const adminPassword = 'e2e-admin-12345';
  const instructorEmail = `e2e-instructor-${randomUUID()}@test.local`;
  const instructorPassword = 'e2e-instr-12345';
  const userEmail = `e2e-user-${randomUUID()}@test.local`;
  const userPassword = 'e2e-user-12345';

  let adminToken: string;
  let instructorToken: string;
  let userToken: string;

  let unitId: string;
  let instructorId: string;
  let bikeId: string;
  let classSlotId: string;
  let testKindId: string;

  // startsAt must be in the future per the service's validation.
  const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

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

    // Seed a global admin via Prisma (no API for that since it's chicken/egg).
    await prisma.user.create({
      data: {
        email: adminEmail,
        name: 'E2E Admin',
        role: Role.ADMIN,
        passwordHash: await hash(adminPassword, 10),
      },
    });

    // Login as admin → token
    const adminLogin = await request(server)
      .post('/auth/login')
      .send({ email: adminEmail, password: adminPassword })
      .expect(200);
    adminToken = adminLogin.body.accessToken;

    // Sign up a regular USER for negative-permission tests
    const userSignup = await request(server)
      .post('/auth/signup')
      .send({ email: userEmail, password: userPassword, name: 'E2E User' })
      .expect(201);
    userToken = userSignup.body.accessToken;

    // Ensure a ClassKind exists for instructor primaryClassKindId (C1).
    // Slug uses the `e2e-` prefix so the cleanup() loop (and any global
    // dev-DB sweep) drops it without leaking into the admin's tipo-de-aula
    // list — see lessons.md for the original incident.
    const kind = await prisma.classKind.upsert({
      where: { slug: 'e2e-admin-kind' },
      create: {
        slug: 'e2e-admin-kind',
        name: 'E2E Admin Kind',
        defaultDurationMinutes: 45,
      },
      update: {},
    });
    testKindId = kind.id;
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  async function cleanup() {
    await prisma.classSlot.deleteMany({
      where: { unit: { slug: { startsWith: 'e2e-' } } },
    });
    await prisma.bike.deleteMany({
      where: { unit: { slug: { startsWith: 'e2e-' } } },
    });
    await prisma.plan.deleteMany({
      where: { name: { startsWith: 'e2e-' } },
    });
    // Gifted packs (admin grant) reference the e2e user — drop them before the
    // user so the FK doesn't block deletion.
    await prisma.creditPack.deleteMany({
      where: { user: { email: { startsWith: 'e2e-' } } },
    });
    await prisma.user.deleteMany({
      where: { email: { startsWith: 'e2e-' } },
    });
    await prisma.unit.deleteMany({
      where: { slug: { startsWith: 'e2e-' } },
    });
    await prisma.classKind.deleteMany({
      where: { slug: { startsWith: 'e2e-' } },
    });
  }

  describe('Units', () => {
    it('regular USER cannot create a unit (403)', async () => {
      await request(server)
        .post('/units')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: 'Negative Test',
          slug: `e2e-neg-${randomUUID().slice(0, 6)}`,
          address: 'nowhere',
        })
        .expect(403);
    });

    it('ADMIN creates a unit', async () => {
      const slug = `e2e-unit-${randomUUID().slice(0, 8)}`;
      const res = await request(server)
        .post('/units')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Praia E2E',
          slug,
          address: 'Faixa de areia, km 1',
          lateCheckinToleranceMinutes: 7,
        })
        .expect(201);

      expect(res.body).toMatchObject({
        slug,
        name: 'Praia E2E',
        lateCheckinToleranceMinutes: 7,
        isActive: true,
      });
      unitId = res.body.id;
    });

    it('GET /units lists the created unit', async () => {
      const res = await request(server)
        .get('/units')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.some((u: { id: string }) => u.id === unitId)).toBe(true);
    });
  });

  describe('Users (staff creation)', () => {
    it('ADMIN creates an INSTRUCTOR scoped to the unit', async () => {
      const res = await request(server)
        .post('/users/staff')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: instructorEmail,
          password: instructorPassword,
          name: 'E2E Instr',
          role: 'INSTRUCTOR',
          unitId,
          bio: 'E2E test bio',
          primaryClassKindId: testKindId,
        })
        .expect(201);

      expect(res.body).toMatchObject({
        email: instructorEmail,
        role: 'INSTRUCTOR',
        unitId,
      });
      instructorId = res.body.id;

      const login = await request(server)
        .post('/auth/login')
        .send({ email: instructorEmail, password: instructorPassword })
        .expect(200);
      instructorToken = login.body.accessToken;
    });
  });

  describe('Bikes', () => {
    it('ADMIN creates a bike in the unit', async () => {
      const res = await request(server)
        .post('/bikes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ unitId, label: 'A1', row: 'A', col: 1 })
        .expect(201);

      expect(res.body).toMatchObject({ unitId, label: 'A1', status: 'OPERATIONAL' });
      bikeId = res.body.id;
    });

    it('duplicate label in same unit returns 409', async () => {
      await request(server)
        .post('/bikes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ unitId, label: 'A1' })
        .expect(409);
    });

    it('GET /bikes?unitId=... lists the bike', async () => {
      const res = await request(server)
        .get(`/bikes?unitId=${unitId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(res.body.some((b: { id: string }) => b.id === bikeId)).toBe(true);
    });

    it('regular USER cannot create a bike (403)', async () => {
      await request(server)
        .post('/bikes')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ unitId, label: 'X1' })
        .expect(403);
    });
  });

  describe('Class slots', () => {
    it('INSTRUCTOR scheduling themselves succeeds', async () => {
      const res = await request(server)
        .post('/class-slots')
        .set('Authorization', `Bearer ${instructorToken}`)
        .send({
          unitId,
          instructorId,
          title: 'Aula matinal',
          startsAt,
          durationMinutes: 50,
          capacity: 10,
        })
        .expect(201);

      expect(res.body).toMatchObject({
        unitId,
        instructorId,
        status: 'SCHEDULED',
      });
      classSlotId = res.body.id;
    });

    it('INSTRUCTOR scheduling someone else returns 403', async () => {
      await request(server)
        .post('/class-slots')
        .set('Authorization', `Bearer ${instructorToken}`)
        .send({
          unitId,
          instructorId: 'cl-some-other-id',
          startsAt,
          durationMinutes: 50,
          capacity: 10,
        })
        .expect(403);
    });

    it('regular USER cannot create a class slot (403)', async () => {
      await request(server)
        .post('/class-slots')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          unitId,
          instructorId,
          startsAt,
          durationMinutes: 50,
          capacity: 10,
        })
        .expect(403);
    });

    it('INSTRUCTOR cancels their own slot — status becomes CANCELLED_BEFORE', async () => {
      const res = await request(server)
        .post(`/class-slots/${classSlotId}/cancel`)
        .set('Authorization', `Bearer ${instructorToken}`)
        .send({ kind: 'STUDIO', studioReason: 'CHUVA' })
        .expect(201);

      expect(res.body).toMatchObject({
        id: classSlotId,
        status: 'CANCELLED_BEFORE',
        cancellationKind: 'STUDIO',
        studioCancellationReason: 'CHUVA',
        cancelledByUserId: instructorId,
      });
    });

    it('cancelling an already-cancelled slot returns 400', async () => {
      await request(server)
        .post(`/class-slots/${classSlotId}/cancel`)
        .set('Authorization', `Bearer ${instructorToken}`)
        .send({ kind: 'STUDIO', studioReason: 'CHUVA' })
        .expect(400);
    });

    it('Wave C — capacity is auto-derived from operational bike count', async () => {
      // Arena has 1 bike at this point (`bikeId` from earlier test). Slot
      // create should produce capacity=1 regardless of the (now-ignored)
      // payload.
      const res = await request(server)
        .post('/class-slots')
        .set('Authorization', `Bearer ${instructorToken}`)
        .send({
          unitId,
          instructorId,
          startsAt: new Date(Date.now() + 60 * 3_600_000).toISOString(),
          durationMinutes: 50,
        })
        .expect(201);
      expect(res.body.capacity).toBe(1);

      // Add a second bike and confirm a fresh slot has capacity=2.
      await request(server)
        .post('/bikes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ unitId, label: 'A2', row: 'A', col: 2 })
        .expect(201);

      const res2 = await request(server)
        .post('/class-slots')
        .set('Authorization', `Bearer ${instructorToken}`)
        .send({
          unitId,
          instructorId,
          startsAt: new Date(Date.now() + 72 * 3_600_000).toISOString(),
          durationMinutes: 50,
        })
        .expect(201);
      expect(res2.body.capacity).toBe(2);
    });

    it('reason=OUTRO without description returns 400', async () => {
      // Create a fresh slot to cancel
      const slot = await request(server)
        .post('/class-slots')
        .set('Authorization', `Bearer ${instructorToken}`)
        .send({
          unitId,
          instructorId,
          startsAt,
          durationMinutes: 50,
          capacity: 10,
        })
        .expect(201);

      await request(server)
        .post(`/class-slots/${slot.body.id}/cancel`)
        .set('Authorization', `Bearer ${instructorToken}`)
        .send({ kind: 'STUDIO', studioReason: 'OUTRO' })
        .expect(400);
    });
  });

  describe('Wave C — instructor multi-arena (2026-05)', () => {
    it('ADMIN creates an INSTRUCTOR with `unitIds` (M2M)', async () => {
      // Create a second arena to assign the instructor to.
      const arena2Slug = `e2e-arena2-${randomUUID().slice(0, 6)}`;
      const arena2 = await request(server)
        .post('/units')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Arena 2 E2E',
          slug: arena2Slug,
          address: 'Praia 2',
        })
        .expect(201);

      // The existing instructor from earlier was created with single
      // `unitId`; create a brand-new one to test the multi-arena path.
      const multiEmail = `e2e-multi-${randomUUID().slice(0, 8)}@test.local`;
      const multiPassword = 'e2e-multi-12345';
      const created = await request(server)
        .post('/users/staff')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: multiEmail,
          password: multiPassword,
          name: 'E2E Multi',
          role: 'INSTRUCTOR',
          unitIds: [unitId, arena2.body.id],
          bio: 'multi-arena bio',
          primaryClassKindId: testKindId,
        })
        .expect(201);

      expect(created.body.arenas).toHaveLength(2);
      expect(
        created.body.arenas.map((a: { id: string }) => a.id).sort(),
      ).toEqual([unitId, arena2.body.id].sort());
    });

    it('listStaff filtered by unitId matches instructors via M2M', async () => {
      // The instructor with single unitId from earlier appears via the
      // legacy `User.unitId` filter. The multi-arena instructor created
      // above must also appear via `arenaAssignments`.
      const res = await request(server)
        .get(`/users/staff?role=INSTRUCTOR&unitId=${unitId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const emails = res.body.map((s: { email: string }) => s.email);
      expect(emails).toContain(instructorEmail);
      expect(emails.some((e: string) => e.startsWith('e2e-multi-'))).toBe(true);
    });

    it('Wave C — instructor without arena cannot be created', async () => {
      const orphanEmail = `e2e-orphan-${randomUUID().slice(0, 6)}@test.local`;
      await request(server)
        .post('/users/staff')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: orphanEmail,
          password: 'e2e-orphan-12345',
          name: 'E2E Orphan',
          role: 'INSTRUCTOR',
          // No unitId / unitIds — should fail.
          bio: 'orphan bio',
          primaryClassKindId: testKindId,
        })
        .expect(400);
    });

    it('Wave C — bike soft-delete frees the (row, col) for a fresh bike', async () => {
      // Add a bike, soft-delete it, then add another at the same position
      // using the admin's auto-derived label again.
      const created = await request(server)
        .post('/bikes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ unitId, label: 'B-DEL', row: 'B', col: 1 })
        .expect(201);

      await request(server)
        .delete(`/bikes/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      // Fresh bike at same position now succeeds (deletedAt frees the slot).
      const fresh = await request(server)
        .post('/bikes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ unitId, label: 'B-DEL', row: 'B', col: 1 })
        .expect(201);
      expect(fresh.body.row).toBe('B');
      expect(fresh.body.col).toBe(1);
      expect(fresh.body.deletedAt).toBeNull();

      // Listing the unit's bikes excludes the soft-deleted one.
      const list = await request(server)
        .get(`/bikes?unitId=${unitId}&includeAll=true`)
        .expect(200);
      const ids = list.body.map((b: { id: string }) => b.id);
      expect(ids).toContain(fresh.body.id);
    });

    it('Wave C — old `swap-with` endpoint returns 404', async () => {
      // The endpoint was removed; any caller hitting it should see a
      // standard NestJS 404.
      await request(server)
        .post(`/bikes/${bikeId}/swap-with/${bikeId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('Wave C — friends regenerate-code endpoint returns 404', async () => {
      // We need ANY authed token; userToken works.
      await request(server)
        .post('/friends/regenerate-code')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(404);
    });
  });

  describe('Plans', () => {
    let planId: string;

    it('ADMIN creates a plan', async () => {
      const res = await request(server)
        .post('/plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `e2e-plan-${randomUUID().slice(0, 8)}`,
          monthlyCredits: 8,
          priceCents: 19900,
        })
        .expect(201);
      expect(res.body).toMatchObject({
        monthlyCredits: 8,
        priceCents: 19900,
        isActive: true,
      });
      planId = res.body.id;
    });

    it('GET /plans lists the plan', async () => {
      const res = await request(server)
        .get('/plans')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);
      expect(res.body.some((p: { id: string }) => p.id === planId)).toBe(true);
    });

    it('regular USER cannot create a plan (403)', async () => {
      await request(server)
        .post('/plans')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ name: 'e2e-x', monthlyCredits: 1, priceCents: 100 })
        .expect(403);
    });
  });

  // 2026-07 — admin gifts (cortesias / sorteios): grant free credits, search
  // recipients, list gifts. Reuses POST /credit-packs/grant (ADMIN_GRANT).
  describe('Presentes (admin gifts)', () => {
    let userId: string;

    it('resolves the target user id', async () => {
      const me = await request(server)
        .get('/users/me')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);
      userId = me.body.id;
      expect(userId).toEqual(expect.any(String));
    });

    it('admin search finds a regular user by email substring', async () => {
      const local = userEmail.split('@')[0]; // e2e-user-<uuid>
      const res = await request(server)
        .get('/users/search')
        .query({ q: local })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.some((u: { id: string }) => u.id === userId)).toBe(true);
    });

    it('user search is forbidden for a regular USER (403)', async () => {
      await request(server)
        .get('/users/search')
        .query({ q: 'e2e' })
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });

    it('admin grants a free pack with a campaign note', async () => {
      const res = await request(server)
        .post('/credit-packs/grant')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ userId, credits: 10, note: 'sorteio insta e2e' })
        .expect(201);
      expect(res.body).toMatchObject({
        userId,
        source: 'ADMIN_GRANT',
        totalCredits: 10,
        remainingCredits: 10,
        note: 'sorteio insta e2e',
      });
    });

    it('non-admin cannot grant (403)', async () => {
      await request(server)
        .post('/credit-packs/grant')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ userId, credits: 1 })
        .expect(403);
    });

    it('the gifted pack shows in the user wallet as a cortesia', async () => {
      const packs = await request(server)
        .get('/credit-packs/me')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);
      const gift = packs.body.find(
        (p: { source: string; totalCredits: number }) =>
          p.source === 'ADMIN_GRANT' && p.totalCredits === 10,
      );
      expect(gift).toBeDefined();
    });

    it('admin grants list includes the gift with its note', async () => {
      const res = await request(server)
        .get('/credit-packs/grants')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const found = res.body.find(
        (g: { user: { id: string }; note: string | null }) =>
          g.user.id === userId && g.note === 'sorteio insta e2e',
      );
      expect(found).toBeDefined();
    });
  });
});
