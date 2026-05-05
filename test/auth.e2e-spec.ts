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
