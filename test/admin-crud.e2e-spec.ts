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
    await prisma.user.deleteMany({
      where: { email: { startsWith: 'e2e-' } },
    });
    await prisma.unit.deleteMany({
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
        .send({ unitId, label: 'A1', positionX: 0, positionY: 0 })
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
});
