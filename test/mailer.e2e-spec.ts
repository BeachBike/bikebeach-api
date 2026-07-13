import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EmailStatus, EmailTemplate, EmailVariant } from '@prisma/client';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { MailerService } from '../src/mailer/mailer.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TEMPLATES } from '../src/mailer/templates';
import { DARK, LIGHT } from '../src/mailer/templates/_shared/palette';

/// Phase 6 smoke. The mailer dispatches asynchronously; we await a short
/// poll for the EmailLog row to flip from QUEUED → SKIPPED (no RESEND_API_KEY
/// in the test env). Confirms:
///   - signup triggers a WELCOME row addressed to the new user
///   - forgot-password triggers a PASSWORD_RESET row
///   - both render the light and dark variants without throwing
///   - the variant column is set to one of LIGHT/DARK on the actual send
async function waitForLog(
  prisma: PrismaService,
  filter: { template: EmailTemplate; toEmail: string },
  timeoutMs = 1500,
): Promise<{ id: string; status: EmailStatus; variant: EmailVariant }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await prisma.emailLog.findFirst({
      where: filter,
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, variant: true },
    });
    if (row && row.status !== EmailStatus.QUEUED) return row;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timeout waiting for EmailLog ${filter.template} → ${filter.toEmail}`);
}

describe('Mailer (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mailer: MailerService;

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
    mailer = app.get(MailerService);
    await prisma.emailLog.deleteMany({ where: { toEmail: { contains: 'e2e-mailer' } } });
    await prisma.user.deleteMany({ where: { email: { contains: 'e2e-mailer' } } });
  });

  afterAll(async () => {
    await prisma.emailLog.deleteMany({ where: { toEmail: { contains: 'e2e-mailer' } } });
    await prisma.user.deleteMany({ where: { email: { contains: 'e2e-mailer' } } });
    await app.close();
  });

  it('signup enqueues a WELCOME e-mail tagged to the new user', async () => {
    const email = `e2e-mailer-welcome-${randomUUID()}@test.local`;
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password: 'mailer-strong-2026', name: 'Helena Brandão' })
      .expect(201);
    const log = await waitForLog(prisma, { template: 'WELCOME', toEmail: email });
    expect(log.status).toBe(EmailStatus.SKIPPED); // no RESEND_API_KEY in tests
    expect([EmailVariant.LIGHT, EmailVariant.DARK]).toContain(log.variant);
  });

  it('forgot-password enqueues a PASSWORD_RESET e-mail when the user exists', async () => {
    const email = `e2e-mailer-reset-${randomUUID()}@test.local`;
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password: 'mailer-strong-2026', name: 'Marina Costa' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email })
      .expect(200);
    const log = await waitForLog(prisma, { template: 'PASSWORD_RESET', toEmail: email });
    expect(log.status).toBe(EmailStatus.SKIPPED);
  });

  it('EmailLog payload REDACTS the password-reset URL — no raw token at rest', async () => {
    const email = `e2e-mailer-redact-${randomUUID()}@test.local`;
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password: 'mailer-strong-2026', name: 'Helena' })
      .expect(201);
    const res = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email })
      .expect(200);
    const devToken: string = res.body.devToken;
    expect(typeof devToken).toBe('string');
    await waitForLog(prisma, { template: 'PASSWORD_RESET', toEmail: email });
    const row = await prisma.emailLog.findFirst({
      where: { template: 'PASSWORD_RESET', toEmail: email },
      select: { payload: true },
    });
    expect(row).not.toBeNull();
    const payload = row!.payload as Record<string, unknown>;
    // Reset URL must be scrubbed — anyone with DB read access shouldn't be
    // able to reuse the token within its 1h TTL.
    expect(payload.resetUrl).toBe('[REDACTED]');
    const serialized = JSON.stringify(row!.payload);
    expect(serialized).not.toContain(devToken);
  });

  it('forgot-password does NOT enqueue a PASSWORD_RESET for unknown e-mails', async () => {
    const email = `e2e-mailer-noleak-${randomUUID()}@test.local`;
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email })
      .expect(200);
    // Brief settle window — anything that was going to be created would be.
    await new Promise((r) => setTimeout(r, 200));
    const log = await prisma.emailLog.findFirst({
      where: { toEmail: email, template: 'PASSWORD_RESET' },
    });
    expect(log).toBeNull();
  });

  it('MailerService renders both light and dark variants for every template', async () => {
    const samples: Record<EmailTemplate, unknown> = {
      WELCOME: { name: 'Helena', email: 'h@e2e.local', appUrl: 'http://localhost:5173' },
      RESERVATION_CONFIRMED: {
        name: 'Helena',
        classKind: 'sunset',
        instructorName: 'Marina',
        durationMinutes: 45,
        intensity: 'forte',
        startsAt: new Date('2026-05-16T17:30:00-03:00').toISOString(),
        bikeLabel: 'B-04',
        unitName: 'Praia Central',
        reservationUrl: 'http://localhost:5173/dashboard',
        cancelDeadlineAt: new Date('2026-05-16T09:30:00-03:00').toISOString(),
        cancelDeadlineHours: 8,
      },
      RESERVATION_REMINDER: {
        name: 'Helena',
        classKind: 'sunset',
        instructorName: 'Marina',
        startsAt: new Date('2026-05-16T17:30:00-03:00').toISOString(),
        bikeLabel: 'B-04',
        reservationUrl: 'http://localhost:5173/dashboard',
        reservationId: 'r-1',
      },
      WAITLIST_PROMOTED: {
        name: 'Helena',
        classKind: 'sunrise',
        instructorName: 'Marina',
        startsAt: new Date('2026-05-16T06:00:00-03:00').toISOString(),
        bikeLabel: 'A-02',
        reservationUrl: 'http://localhost:5173/dashboard',
        cancelDeadlineAt: new Date('2026-05-16T04:00:00-03:00').toISOString(),
      },
      CLASS_CANCELLED: {
        name: 'Helena',
        classKind: 'sunset',
        instructorName: 'Marina',
        startsAt: new Date('2026-05-16T17:30:00-03:00').toISOString(),
        bikeLabel: 'B-04',
        reason: 'CHUVA',
        reasonLabel: 'chuva forte na beira-mar — não dá pra pedalar com segurança',
        description: null,
        refundedCredits: 1,
        rebookUrl: 'http://localhost:5173/reservar',
      },
      PASSWORD_RESET: {
        name: 'Helena',
        resetUrl: 'http://localhost:5173/conta?reset=abc',
        expiresInMinutes: 60,
        requestedFromIp: '127.0.0.1',
        userAgent: 'jest',
      },
      HEALTH_GATE_EXPIRING: {
        name: 'Helena',
        kind: 'LIABILITY',
        expiresAt: new Date('2026-05-22T00:00:00-03:00').toISOString(),
        renewUrl: 'http://localhost:5173/saude',
        lastAcceptedAt: new Date('2026-04-22T00:00:00-03:00').toISOString(),
        dedupKey: 'LIABILITY:abc',
      },
      PAYMENT_RECEIPT: {
        name: 'Helena',
        packLabel: 'Pacote 10 aulas',
        amountCents: 54000,
        method: 'PIX',
        installments: null,
        paidAt: new Date('2026-05-15T12:00:00-03:00').toISOString(),
        credits: 10,
        expiresAt: new Date('2026-08-13T12:00:00-03:00').toISOString(),
        dashboardUrl: 'http://localhost:5173/dashboard',
      },
    };

    for (const template of Object.keys(samples) as EmailTemplate[]) {
      const tpl = TEMPLATES[template];
      const payload = samples[template] as never;
      const subject = tpl.subject(payload);
      expect(typeof subject).toBe('string');
      expect(subject.length).toBeGreaterThan(0);
      const lightHtml = tpl.light(payload, LIGHT);
      const darkHtml = tpl.dark(payload, DARK);
      expect(lightHtml).toContain('<!doctype html>');
      expect(darkHtml).toContain('<!doctype html>');
      expect(lightHtml).toContain('bikebeach');
      expect(darkHtml).toContain('bikebeach');
      // Sanity: dark variant should contain the dark background, light should NOT.
      expect(darkHtml).toContain('#1A1410');
      expect(lightHtml).not.toContain('#1A1410');
      const text = tpl.text(payload);
      expect(typeof text).toBe('string');
      expect(text).toContain('bikebeach');
    }
  });

  it('MailerService.send respects the variant override and logs the correct one', async () => {
    const email = `e2e-mailer-variant-${randomUUID()}@test.local`;
    const id = await mailer.send({
      template: 'WELCOME',
      to: email,
      variant: EmailVariant.DARK,
      payload: { name: 'Helena', email, appUrl: 'http://localhost:5173' },
    });
    const log = await waitForLog(prisma, { template: 'WELCOME', toEmail: email });
    expect(log.id).toBe(id);
    expect(log.variant).toBe(EmailVariant.DARK);
  });
});
