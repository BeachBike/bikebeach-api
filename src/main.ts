import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
