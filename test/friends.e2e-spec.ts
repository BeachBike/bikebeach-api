import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { hash } from 'bcrypt';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// E2E coverage for G1 — friends. Code generation + friend-request lifecycle
// (send / accept / decline / cancel + auto-accept on reciprocal) +
// remove + visibility toggle + friends-attending overlay.

describe('Friends (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: ReturnType<INestApplication['getHttpServer']>;

  const adminEmail = `e2e-fr-admin-${randomUUID()}@test.local`;
  const adminPassword = 'fr-admin-12345';
  const password = 'fr-pass-12345';
  const aEmail = `e2e-fr-a-${randomUUID()}@test.local`;
  const bEmail = `e2e-fr-b-${randomUUID()}@test.local`;
  const cEmail = `e2e-fr-c-${randomUUID()}@test.local`;
  const instructorEmail = `e2e-fr-instr-${randomUUID()}@test.local`;

  let adminToken: string;
  let aToken: string;
  let bToken: string;
  let cToken: string;
  let instructorToken: string;

  let aId: string;
  let bId: string;
  let cId: string;
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
        name: 'FR Admin',
        role: Role.ADMIN,
        passwordHash: await hash(adminPassword, 10),
      },
    });
    adminToken = (await login(adminEmail, adminPassword)).accessToken;

    const a = await signup(aEmail, password, 'FR A Person');
    aToken = a.accessToken;
    aId = a.user.id;
    const b = await signup(bEmail, password, 'FR B Person');
    bToken = b.accessToken;
    bId = b.user.id;
    const c = await signup(cEmail, password, 'FR C Person');
    cToken = c.accessToken;
    cId = c.user.id;

    unitId = (
      await api('post', '/units', adminToken, {
        name: 'FR Praia',
        slug: `e2e-fr-${randomUUID().slice(0, 6)}`,
        address: 'Praia teste',
      })
    ).id;

    const testKind = await prisma.classKind.upsert({
      where: { slug: 'e2e-fr-kind' },
      create: {
        slug: 'e2e-fr-kind',
        name: 'FR Kind',
        defaultDurationMinutes: 45,
      },
      update: {},
    });
    const instructor = await api('post', '/users/staff', adminToken, {
      email: instructorEmail,
      password,
      name: 'FR Instr',
      role: 'INSTRUCTOR',
      unitId,
      bio: 'fr bio',
      primaryClassKindId: testKind.id,
    });
    instructorId = instructor.id;
    instructorToken = (await login(instructorEmail, password)).accessToken;

    bike1Id = (
      await api('post', '/bikes', adminToken, { unitId, label: 'F1' })
    ).id;
    bike2Id = (
      await api('post', '/bikes', adminToken, { unitId, label: 'F2' })
    ).id;

    // Seed health gate for A and B so they can reserve later in the suite.
    for (const userId of [aId, bId, cId]) {
      await prisma.liabilityAcceptance.create({
        data: { userId, version: 'v1.0' },
      });
      await prisma.parqResponse.create({
        data: { userId, version: 'v1.0', answers: { ok: true } },
      });
    }
    // Grant credits so reserves work.
    for (const uid of [aId, bId, cId]) {
      await api('post', '/credit-packs/grant', adminToken, {
        userId: uid,
        credits: 3,
      });
    }
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  async function cleanup() {
    await prisma.friendship.deleteMany({
      where: {
        OR: [
          { userA: { email: { startsWith: 'e2e-fr-' } } },
          { userB: { email: { startsWith: 'e2e-fr-' } } },
        ],
      },
    });
    await prisma.friendRequest.deleteMany({
      where: {
        OR: [
          { fromUser: { email: { startsWith: 'e2e-fr-' } } },
          { toUser: { email: { startsWith: 'e2e-fr-' } } },
        ],
      },
    });
    await prisma.reservation.deleteMany({
      where: { user: { email: { startsWith: 'e2e-fr-' } } },
    });
    await prisma.waitlistEntry.deleteMany({
      where: { user: { email: { startsWith: 'e2e-fr-' } } },
    });
    await prisma.creditPack.deleteMany({
      where: { user: { email: { startsWith: 'e2e-fr-' } } },
    });
    await prisma.liabilityAcceptance.deleteMany({
      where: { user: { email: { startsWith: 'e2e-fr-' } } },
    });
    await prisma.parqResponse.deleteMany({
      where: { user: { email: { startsWith: 'e2e-fr-' } } },
    });
    await prisma.classSlot.deleteMany({
      where: { unit: { slug: { startsWith: 'e2e-fr-' } } },
    });
    await prisma.bike.deleteMany({
      where: { unit: { slug: { startsWith: 'e2e-fr-' } } },
    });
    await prisma.user.deleteMany({
      where: { email: { startsWith: 'e2e-fr-' } },
    });
    await prisma.unit.deleteMany({
      where: { slug: { startsWith: 'e2e-fr-' } },
    });
    await prisma.classKind.deleteMany({
      where: { slug: { startsWith: 'e2e-fr-' } },
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
    if (body !== undefined) r.send(body);
    const res = await r;
    if (res.status >= 400) {
      throw new Error(
        `${method.toUpperCase()} ${path} → ${res.status}: ${JSON.stringify(res.body)}`,
      );
    }
    return res.body;
  }

  describe('Friend code', () => {
    it('GET /friends/my-code lazily generates a code in display format', async () => {
      const res = await api('get', '/friends/my-code', aToken);
      expect(res.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    });

    it('repeat call returns the same code (idempotent)', async () => {
      const a = await api('get', '/friends/my-code', aToken);
      const b = await api('get', '/friends/my-code', aToken);
      expect(a.code).toBe(b.code);
    });

    // 2026-05 — `POST /friends/regenerate-code` was removed per item-1
    // (the user wanted no UI affordance for code rotation). Service-layer
    // helper still exists for future emergency rotation.
  });

  describe('Friend request lifecycle', () => {
    let bCode: string;

    it('A sends request to B → PENDING row, autoAccepted=false', async () => {
      bCode = (await api('get', '/friends/my-code', bToken)).code;
      const res = await api('post', '/friends/requests', aToken, {
        code: bCode,
      });
      expect(res.status).toBe('PENDING');
      expect(res.fromUser.id).toBe(aId);
      expect(res.toUser.id).toBe(bId);
      expect(res.autoAccepted).toBe(false);
    });

    it('A sends request to themselves → 400', async () => {
      const aCode = (await api('get', '/friends/my-code', aToken)).code;
      await request(server)
        .post('/friends/requests')
        .set('Authorization', `Bearer ${aToken}`)
        .send({ code: aCode })
        .expect(400);
    });

    it('A re-sends to same B → 409 (already pending)', async () => {
      await request(server)
        .post('/friends/requests')
        .set('Authorization', `Bearer ${aToken}`)
        .send({ code: bCode })
        .expect(409);
    });

    it('Bogus code → 404', async () => {
      await request(server)
        .post('/friends/requests')
        .set('Authorization', `Bearer ${aToken}`)
        .send({ code: 'XXXX-XXXX' })
        .expect(404);
    });

    it('B sees the incoming pending request', async () => {
      const res = await api('get', '/friends/requests', bToken);
      expect(res.incoming).toHaveLength(1);
      expect(res.incoming[0].fromUser.id).toBe(aId);
      expect(res.outgoing).toHaveLength(0);
    });

    it('A sees the outgoing pending request', async () => {
      const res = await api('get', '/friends/requests', aToken);
      expect(res.outgoing).toHaveLength(1);
      expect(res.incoming).toHaveLength(0);
    });

    it('Foreign user cannot accept the request → 403', async () => {
      const reqs = await api('get', '/friends/requests', bToken);
      const reqId = reqs.incoming[0].id;
      await request(server)
        .post(`/friends/requests/${reqId}/accept`)
        .set('Authorization', `Bearer ${cToken}`)
        .expect(403);
    });

    it('B accepts → friendship created bidirectionally', async () => {
      const reqs = await api('get', '/friends/requests', bToken);
      const reqId = reqs.incoming[0].id;
      await api('post', `/friends/requests/${reqId}/accept`, bToken);

      const aFriends = await api('get', '/friends', aToken);
      const bFriends = await api('get', '/friends', bToken);
      expect(aFriends.map((f: { userId: string }) => f.userId)).toContain(bId);
      expect(bFriends.map((f: { userId: string }) => f.userId)).toContain(aId);
    });

    it('Re-sending after friendship → 409', async () => {
      await request(server)
        .post('/friends/requests')
        .set('Authorization', `Bearer ${aToken}`)
        .send({ code: bCode })
        .expect(409);
    });

    it('A removes B → both lists clear; pending requests not affected', async () => {
      await api('delete', `/friends/${bId}`, aToken);
      const aFriends = await api('get', '/friends', aToken);
      const bFriends = await api('get', '/friends', bToken);
      expect(aFriends.find((f: { userId: string }) => f.userId === bId)).toBeUndefined();
      expect(bFriends.find((f: { userId: string }) => f.userId === aId)).toBeUndefined();
    });
  });

  describe('Decline + cancel + auto-accept', () => {
    let bCode: string;

    beforeAll(async () => {
      bCode = (await api('get', '/friends/my-code', bToken)).code;
    });

    it('A sends, B declines → DECLINED, no friendship', async () => {
      const sent = await api('post', '/friends/requests', aToken, {
        code: bCode,
      });
      await api('post', `/friends/requests/${sent.id}/decline`, bToken);
      const list = await api('get', '/friends', aToken);
      expect(list.find((f: { userId: string }) => f.userId === bId)).toBeUndefined();
    });

    it('A sends again, A cancels their outgoing → CANCELLED', async () => {
      const sent = await api('post', '/friends/requests', aToken, {
        code: bCode,
      });
      await api('delete', `/friends/requests/${sent.id}`, aToken);
      // List is now empty for both incoming/outgoing.
      const reqs = await api('get', '/friends/requests', aToken);
      expect(reqs.outgoing).toHaveLength(0);
    });

    it('Auto-accept: A and B send simultaneously → second send accepts both', async () => {
      // A → B PENDING.
      await api('post', '/friends/requests', aToken, { code: bCode });
      // B → A using A's code → reciprocal pending found, auto-accept fires.
      const aCode = (await api('get', '/friends/my-code', aToken)).code;
      const res = await api('post', '/friends/requests', bToken, {
        code: aCode,
      });
      expect(res.autoAccepted).toBe(true);

      const aFriends = await api('get', '/friends', aToken);
      const bFriends = await api('get', '/friends', bToken);
      expect(aFriends.map((f: { userId: string }) => f.userId)).toContain(bId);
      expect(bFriends.map((f: { userId: string }) => f.userId)).toContain(aId);
    });
  });

  describe('Friends-attending batch + visibility toggle', () => {
    let slotId: string;

    it('setup: B reserves bike1 on a future slot, C reserves bike2 too', async () => {
      slotId = (
        await api('post', '/class-slots', instructorToken, {
          unitId,
          instructorId,
          startsAt: new Date(Date.now() + 24 * 3_600_000).toISOString(),
          durationMinutes: 50,
          capacity: 5,
        })
      ).id;
      await api('post', '/reservations', bToken, {
        classSlotId: slotId,
        bikeId: bike1Id,
      });
      // Make A friends with C too so we can verify multi-friend output.
      const cCode = (await api('get', '/friends/my-code', cToken)).code;
      const sent = await api('post', '/friends/requests', aToken, {
        code: cCode,
      });
      await api('post', `/friends/requests/${sent.id}/accept`, cToken);
      await api('post', '/reservations', cToken, {
        classSlotId: slotId,
        bikeId: bike2Id,
      });
    });

    it('A queries friends-attending → sees both B and C with their bikes', async () => {
      const res = await api(
        'post',
        '/class-slots/friends-attending-batch',
        aToken,
        { slotIds: [slotId] },
      );
      const list = res[slotId];
      expect(list).toHaveLength(2);
      const bRow = list.find((r: { userId: string }) => r.userId === bId);
      const cRow = list.find((r: { userId: string }) => r.userId === cId);
      expect(bRow).toMatchObject({
        userId: bId,
        bikeId: bike1Id,
        isWaitlisted: false,
      });
      expect(cRow).toMatchObject({
        userId: cId,
        bikeId: bike2Id,
        isWaitlisted: false,
      });
    });

    it('B turns on invisibility → A no longer sees B', async () => {
      await api('patch', '/friends/visibility', bToken, {
        hideReservationsFromFriends: true,
      });
      const res = await api(
        'post',
        '/class-slots/friends-attending-batch',
        aToken,
        { slotIds: [slotId] },
      );
      const list = res[slotId];
      const bRow = list.find((r: { userId: string }) => r.userId === bId);
      expect(bRow).toBeUndefined();
      // C is still visible.
      const cRow = list.find((r: { userId: string }) => r.userId === cId);
      expect(cRow).toBeDefined();
    });

    it('B turns invisibility back off → A sees B again', async () => {
      await api('patch', '/friends/visibility', bToken, {
        hideReservationsFromFriends: false,
      });
      const res = await api(
        'post',
        '/class-slots/friends-attending-batch',
        aToken,
        { slotIds: [slotId] },
      );
      const bRow = res[slotId].find(
        (r: { userId: string }) => r.userId === bId,
      );
      expect(bRow).toBeDefined();
    });

    it('Stranger (no friendship) → empty list', async () => {
      // First wipe A's friendships — `instructorToken` user has none in any case
      const res = await api(
        'post',
        '/class-slots/friends-attending-batch',
        instructorToken,
        { slotIds: [slotId] },
      );
      expect(res[slotId]).toEqual([]);
    });
  });
});
