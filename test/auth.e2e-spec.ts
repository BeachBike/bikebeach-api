import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// E2E auth flow: signup → login → /users/me → refresh (with reuse detection) → logout.
// Tests share state to model an actual user session. Cleanup deletes any user
// whose email starts with `e2e-` so reruns don't leak state.

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const email = `e2e-${randomUUID()}@test.local`;
  const password = 'e2e-password-12345';

  let accessToken: string;
  let refreshToken: string;

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

    prisma = app.get(PrismaService);
    await prisma.user.deleteMany({ where: { email: { startsWith: 'e2e-' } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: 'e2e-' } } });
    await app.close();
  });

  it('POST /auth/signup creates a USER and returns a token pair', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password, name: 'E2E User' })
      .expect(201);

    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({
      email,
      role: 'USER',
      unitId: null,
    });

    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  it('POST /auth/signup with a duplicate email returns 409', async () => {
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password, name: 'Dup' })
      .expect(409);
  });

  it('POST /auth/signup with an invalid CPF (Mod-11 fails) returns 400', async () => {
    // Format passes the digit-only regex; check digits do not.
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        email: `e2e-${randomUUID()}@test.local`,
        password,
        name: 'CPF inválido',
        cpf: '12345678900',
      })
      .expect(400);
  });

  it('POST /auth/signup rejects all-same-digit CPFs (passes naive Mod-11)', async () => {
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        email: `e2e-${randomUUID()}@test.local`,
        password,
        name: 'CPF repetido',
        cpf: '11111111111',
      })
      .expect(400);
  });

  it('POST /auth/signup with a duplicate CPF returns 409', async () => {
    // Generated valid CPF: 39053344705 (real check digits, not in any
    // existing test fixture). Sign up once successfully, then again with
    // the same CPF on a different e-mail — second one must 409.
    const validCpf = '39053344705';
    const firstEmail = `e2e-${randomUUID()}@test.local`;
    const secondEmail = `e2e-${randomUUID()}@test.local`;
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email: firstEmail, password, name: 'CPF first', cpf: validCpf })
      .expect(201);
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email: secondEmail, password, name: 'CPF dup', cpf: validCpf })
      .expect(409);
  });

  it('POST /auth/signup rejects a low-complexity password (needs 3 char classes)', async () => {
    // 12 chars but a single class (lowercase only) — fails the 3-of-4 rule.
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        email: `e2e-${randomUUID()}@test.local`,
        password: 'senhafraquin',
        name: 'Senha fraca',
      })
      .expect(400);
  });

  it('POST /auth/signup rejects a common password even when it mixes classes', async () => {
    // "Password1!" has all 4 classes but is on the common-password blocklist.
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        email: `e2e-${randomUUID()}@test.local`,
        password: 'Password1!',
        name: 'Comum',
      })
      .expect(400);
  });

  it('POST /auth/signup rejects a password equal to the user e-mail', async () => {
    const idEmail = `e2e-${randomUUID()}@test.local`;
    const local = idEmail.split('@')[0]; // long, mixes classes, only fails identity
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email: idEmail, password: local, name: 'Identidade' })
      .expect(400);
  });

  it('POST /auth/login with the wrong password returns 401', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'wrong-password' })
      .expect(401);
  });

  it('POST /auth/login with the right password returns a token pair', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);

    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));

    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  it('GET /users/me without a token returns 401', async () => {
    await request(app.getHttpServer()).get('/users/me').expect(401);
  });

  it('GET /users/me with a valid token returns the current user', async () => {
    const res = await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body).toMatchObject({ email, role: 'USER' });
  });

  it('POST /auth/refresh rotates the token pair and detects reuse', async () => {
    const rotated = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(200);

    expect(rotated.body.refreshToken).not.toBe(refreshToken);

    const oldRefresh = refreshToken;
    refreshToken = rotated.body.refreshToken;
    accessToken = rotated.body.accessToken;

    // Reuse of the rotated-out token must be rejected
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: oldRefresh })
      .expect(401);

    // Reuse-detection should also have revoked the freshly-issued one
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(401);
  });

  it('POST /auth/logout invalidates the presented refresh token', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);

    const fresh = login.body.refreshToken as string;
    const access = login.body.accessToken as string;

    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${access}`)
      .send({ refreshToken: fresh })
      .expect(204);

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: fresh })
      .expect(401);
  });
});
