import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Trust the first proxy hop so `req.ip` reflects the end-user, not the
  // Railway edge. The card-charge flow forwards `req.ip` to Asaas as
  // `remoteIp` for anti-fraud — without trust proxy it would always be the
  // proxy's address, jacking up false-decline rates.
  app.set('trust proxy', 1);

  // Default Nest body-parser limits are 100kb — too tight for some legitimate
  // payloads (e.g. seed data, future bulk endpoints). Multipart is handled
  // separately by multer (in the controllers that use FileInterceptor), so
  // this only relaxes JSON / urlencoded paths.
  app.useBodyParser('json', { limit: '5mb' });
  app.useBodyParser('urlencoded', { limit: '5mb', extended: true });

  // Static files for user-uploaded assets (instructor portraits at the moment).
  // Served under `/uploads/...` so the frontend can reference
  // `${API_BASE}/uploads/instructors/<userId>.png` directly.
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = app.get(ConfigService);

  // CORS — comma-separated allowlist via env. Examples:
  //   CORS_ORIGINS=https://bikebeach-web.vercel.app
  //   CORS_ORIGINS=https://bikebeach-web.vercel.app,https://*.vercel.app
  // Unset OR "*" allows every origin (dev convenience). Globs become regex
  // so Vercel preview URLs (`https://bikebeach-web-git-<branch>.vercel.app`)
  // work without listing each one.
  const raw = config.get<string>('CORS_ORIGINS')?.trim();
  const origin =
    !raw || raw === '*'
      ? true
      : raw.split(',').map((o) => {
          const trimmed = o.trim();
          if (trimmed.includes('*')) {
            const escaped = trimmed
              .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
              .replace(/\*/g, '.*');
            return new RegExp(`^${escaped}$`);
          }
          return trimmed;
        });

  app.enableCors({
    origin,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // Bind to 0.0.0.0 so the Railway edge can reach the container.
  const port = config.get<number>('PORT') ?? 3000;
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
