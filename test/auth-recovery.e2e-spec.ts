import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// Reset-password flow:
//   POST /auth/forgot-password → always 200, devToken returned only when the
//     e-mail exists (gated by NODE_ENV !== 'production')
//   POST /auth/reset-password  → consumes the token (single-use), updates the
//     password, revokes refresh tokens
// Resend wiring lives in the Phase 6 backlog; until then the dev-only token in
// the response is what the frontend reset-password screen consumes end-to-end.

describe('Auth recovery (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const email = `e2e-${randomUUID()}@test.local`;
  const originalPassword = 'original-password-123';
  const newPassword = 'brand-new-password-456';

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

    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password: originalPassword, name: 'E2E Recovery' })
      .expect(201);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: 'e2e-' } } });
    await app.close();
  });

  it('POST /auth/forgot-password for an unknown e-mail returns 200 without a token (no leak)', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: `e2e-unknown-${randomUUID()}@test.local` })
      .expect(200);
    expect(res.body).toEqual({ emailSent: false });
  });

  it('POST /auth/forgot-password for a known e-mail returns 200 and exposes the dev token', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email })
      .expect(200);
    expect(res.body.emailSent).toBe(true);
    expect(typeof res.body.devToken).toBe('string');
    expect(res.body.devToken.length).toBeGreaterThan(20);
  });

  it('POST /auth/reset-password with a bogus token returns 401', async () => {
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({
        token: 'this-is-not-a-real-reset-token-but-long-enough',
        password: newPassword,
      })
      .expect(401);
  });

  it('POST /auth/reset-password with a short password returns 400', async () => {
    const issue = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email })
      .expect(200);
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: issue.body.devToken, password: 'short' })
      .expect(400);
  });

  it('POST /auth/reset-password happy path: consumes token, updates password, original login fails, new login works', async () => {
    const issue = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email })
      .expect(200);
    const token = issue.body.devToken as string;

    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token, password: newPassword })
      .expect(204);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: originalPassword })
      .expect(401);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: newPassword })
      .expect(200);

    // Same token cannot be reused after consumption.
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token, password: 'another-password-789' })
      .expect(401);
  });

  it('POST /auth/reset-password with an expired token returns 401', async () => {
    const issue = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email })
      .expect(200);
    const token = issue.body.devToken as string;

    // Force-expire by rewinding the row to 1h ago.
    const tokenHash = require('crypto')
      .createHash('sha256')
      .update(token)
      .digest('hex');
    await prisma.passwordResetToken.update({
      where: { tokenHash },
      data: { expiresAt: new Date(Date.now() - 60 * 60_000) },
    });

    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token, password: 'yet-another-pw-321' })
      .expect(401);
  });
});
