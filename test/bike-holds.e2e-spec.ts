import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { hash } from 'bcrypt';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// Bike-hold (temporary exclusive seat claim) lifecycle:
//   acquire → seat-map reflects it → another user blocked (409 on both
//   hold + reservation) → holder reserves (hold consumed) → release frees.

describe('Bike holds (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: ReturnType<INestApplication['getHttpServer']>;

  const adminEmail = `e2e-hold-admin-${randomUUID()}@test.local`;
  const adminPassword = 'hold-admin-12345';
  const u1Email = `e2e-hold-u1-${randomUUID()}@test.local`;
  const u2Email = `e2e-hold-u2-${randomUUID()}@test.local`;
  const userPassword = 'hold-user-12345';
  const instrEmail = `e2e-hold-instr-${randomUUID()}@test.local`;
  const instrPassword = 'hold-instr-12345';

  let adminToken: string;
  let u1Token: string;
  let u2Token: string;
  let u1Id: string;
  let u2Id: string;
  let slotId: string;
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
        name: 'Hold Admin',
        role: Role.ADMIN,
        passwordHash: await hash(adminPassword, 10),
      },
    });
    adminToken = (await login(adminEmail, adminPassword)).accessToken;

    const s1 = await signup(u1Email, userPassword, 'Hold U1');
    u1Token = s1.accessToken;
    u1Id = s1.user.id;
    const s2 = await signup(u2Email, userPassword, 'Hold U2');
    u2Token = s2.accessToken;
    u2Id = s2.user.id;

    const unitId = (
      await api('post', '/units', adminToken, {
        name: 'Hold Praia',
        slug: `e2e-hold-${randomUUID().slice(0, 6)}`,
        address: 'Areia',
      })
    ).id;

    const kind = await prisma.classKind.upsert({
      where: { slug: 'e2e-hold-kind' },
      create: {
        slug: 'e2e-hold-kind',
        name: 'Hold Kind',
        defaultDurationMinutes: 45,
      },
      update: {},
    });
    const instr = await api('post', '/users/staff', adminToken, {
      email: instrEmail,
      password: instrPassword,
      name: 'Hold Instr',
      role: 'INSTRUCTOR',
      unitId,
      bio: 'bio',
      primaryClassKindId: kind.id,
    });
    const instrToken = (await login(instrEmail, instrPassword)).accessToken;

    bike1Id = (await api('post', '/bikes', adminToken, { unitId, label: 'H1' }))
      .id;
    bike2Id = (await api('post', '/bikes', adminToken, { unitId, label: 'H2' }))
      .id;

    slotId = (
      await api('post', '/class-slots', instrToken, {
        unitId,
        instructorId: instr.id,
        startsAt: new Date(Date.now() + 24 * 3_600_000).toISOString(),
        durationMinutes: 50,
        capacity: 10,
      })
    ).id;

    // Credits + health gate for both users (so the reserve-after-hold path
    // isn't blocked).
    for (const uid of [u1Id, u2Id]) {
      await api('post', '/credit-packs/grant', adminToken, {
        userId: uid,
        credits: 2,
      });
      await prisma.liabilityAcceptance.create({
        data: { userId: uid, version: 'v1.0' },
      });
      await prisma.parqResponse.create({
        data: { userId: uid, version: 'v1.0', answers: { ok: true } },
      });
    }
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  async function cleanup() {
    await prisma.bikeHold.deleteMany({
      where: { user: { email: { startsWith: 'e2e-hold-' } } },
    });
    await prisma.reservation.deleteMany({
      where: { user: { email: { startsWith: 'e2e-hold-' } } },
    });
    await prisma.creditPack.deleteMany({
      where: { user: { email: { startsWith: 'e2e-hold-' } } },
    });
    await prisma.liabilityAcceptance.deleteMany({
      where: { user: { email: { startsWith: 'e2e-hold-' } } },
    });
    await prisma.parqResponse.deleteMany({
      where: { user: { email: { startsWith: 'e2e-hold-' } } },
    });
    await prisma.classSlot.deleteMany({
      where: { unit: { slug: { startsWith: 'e2e-hold-' } } },
    });
    await prisma.bike.deleteMany({
      where: { unit: { slug: { startsWith: 'e2e-hold-' } } },
    });
    await prisma.user.deleteMany({
      where: { email: { startsWith: 'e2e-hold-' } },
    });
    await prisma.unit.deleteMany({
      where: { slug: { startsWith: 'e2e-hold-' } },
    });
    await prisma.classKind.deleteMany({
      where: { slug: { startsWith: 'e2e-hold-' } },
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

  it('U1 acquires a hold; seat-map lists it as held', async () => {
    const hold = await api('post', `/class-slots/${slotId}/holds`, u1Token, {
      bikeId: bike1Id,
    });
    expect(hold.bikeId).toBe(bike1Id);
    expect(new Date(hold.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const seatMap = await request(server)
      .get(`/class-slots/${slotId}/seat-map`)
      .expect(200);
    expect(seatMap.body.heldBikeIds).toContain(bike1Id);
    expect(seatMap.body.occupiedBikeIds).not.toContain(bike1Id);
  });

  it('U2 cannot acquire the same bike (409)', async () => {
    await request(server)
      .post(`/class-slots/${slotId}/holds`)
      .set('Authorization', `Bearer ${u2Token}`)
      .send({ bikeId: bike1Id })
      .expect(409);
  });

  it('U2 cannot reserve a bike held by U1 (409)', async () => {
    await request(server)
      .post('/reservations')
      .set('Authorization', `Bearer ${u2Token}`)
      .send({ classSlotId: slotId, bikeId: bike1Id })
      .expect(409);
  });

  it('switching bikes: U1 holds bike2, releasing the bike1 claim', async () => {
    await api('post', `/class-slots/${slotId}/holds`, u1Token, {
      bikeId: bike2Id,
    });
    const seatMap = await request(server)
      .get(`/class-slots/${slotId}/seat-map`)
      .expect(200);
    expect(seatMap.body.heldBikeIds).toContain(bike2Id);
    expect(seatMap.body.heldBikeIds).not.toContain(bike1Id);
    // bike1 is free again → U2 can now hold it
    await api('post', `/class-slots/${slotId}/holds`, u2Token, {
      bikeId: bike1Id,
    });
  });

  it('holder reserves their held bike; hold is consumed', async () => {
    const res = await request(server)
      .post('/reservations')
      .set('Authorization', `Bearer ${u1Token}`)
      .send({ classSlotId: slotId, bikeId: bike2Id })
      .expect(201);
    expect(res.body.bikeId).toBe(bike2Id);

    const holds = await prisma.bikeHold.findMany({
      where: { classSlotId: slotId, userId: u1Id },
    });
    expect(holds).toHaveLength(0);

    const seatMap = await request(server)
      .get(`/class-slots/${slotId}/seat-map`)
      .expect(200);
    expect(seatMap.body.occupiedBikeIds).toContain(bike2Id);
    expect(seatMap.body.heldBikeIds).not.toContain(bike2Id);
  });

  it('release frees U2 hold from the seat-map', async () => {
    await request(server)
      .delete(`/class-slots/${slotId}/holds`)
      .set('Authorization', `Bearer ${u2Token}`)
      .expect(204);
    const seatMap = await request(server)
      .get(`/class-slots/${slotId}/seat-map`)
      .expect(200);
    expect(seatMap.body.heldBikeIds).toHaveLength(0);
  });

  it('expired holds do not block (lazy filter) and acquire works again', async () => {
    // U2 holds bike1, then we age the row past expiry directly in the DB.
    await api('post', `/class-slots/${slotId}/holds`, u2Token, {
      bikeId: bike1Id,
    });
    await prisma.bikeHold.updateMany({
      where: { classSlotId: slotId, userId: u2Id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    // Seat-map must not list the expired hold.
    const seatMap = await request(server)
      .get(`/class-slots/${slotId}/seat-map`)
      .expect(200);
    expect(seatMap.body.heldBikeIds).not.toContain(bike1Id);
    // U1 can now claim bike1 despite the stale row (acquire lazy-cleans it).
    const hold = await api('post', `/class-slots/${slotId}/holds`, u1Token, {
      bikeId: bike1Id,
    });
    expect(hold.bikeId).toBe(bike1Id);
  });
});
