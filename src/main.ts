import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import helmet from 'helmet';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const logger = new Logger('Bootstrap');

  // Trust the first proxy hop so `req.ip` reflects the end-user, not the
  // Railway edge. The card-charge flow forwards `req.ip` to Asaas as
  // `remoteIp` for anti-fraud — without trust proxy it would always be the
  // proxy's address, jacking up false-decline rates.
  app.set('trust proxy', 1);

  // JSON / urlencoded bodies are capped at 1MB — every legitimate endpoint
  // we have is small (auth payloads, DTOs, etc.). Photo uploads go through
  // multer's `FileInterceptor` which has its own 8MB cap. Tightening this
  // shrinks the asymmetric DoS surface (cheap on the attacker side, expensive
  // on the parser side).
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { limit: '1mb', extended: true });

  // Security headers. The API is JSON-only, so the CSP default is fine; we
  // disable `crossOriginResourcePolicy` because instructor portraits live
  // under `/uploads/...` and need to be embeddable from the web origin.
  // contentSecurityPolicy is set to false because Helmet's default CSP is
  // intended for HTML responses, not a JSON API + image static handler.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // Static files for user-uploaded assets (instructor portraits at the moment).
  // Served under `/uploads/...` so the frontend can reference
  // `${API_BASE}/uploads/instructors/<userId>.png` directly. Helmet's
  // `X-Content-Type-Options: nosniff` prevents content-type sniffing on the
  // returned bytes — a defense-in-depth against a malicious user uploading
  // arbitrary content under an image extension.
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
  // Unset OR "*" = reflect the request Origin without sending credentials.
  // Browsers reject the `credentials + *` combo anyway, so we tighten the
  // policy when CORS_ORIGINS isn't pinned: requests still go through, but
  // cookies / auth headers are NOT shared cross-origin (the FE uses
  // Authorization bearer headers in same-origin or via the allowlist).
  const raw = config.get<string>('CORS_ORIGINS')?.trim();
  const isWildcard = !raw || raw === '*';
  const origin = isWildcard
    ? true
    : raw!.split(',').map((o) => {
        const trimmed = o.trim();
        if (trimmed.includes('*')) {
          const escaped = trimmed
            .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '.*');
          return new RegExp(`^${escaped}$`);
        }
        return trimmed;
      });

  if (isWildcard && process.env.NODE_ENV === 'production') {
    logger.warn(
      'CORS_ORIGINS is unset in production — refusing credentialed CORS. ' +
        'Set CORS_ORIGINS to the exact web origin(s) (comma-separated) so login cookies/headers work.',
    );
  }

  app.enableCors({
    origin,
    // Credentialed CORS is only safe when the allowlist is explicit — a
    // wildcard origin + credentials lets any site exfiltrate auth tokens.
    credentials: !isWildcard,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // Wire Socket.IO over the same HTTP server. `RealtimeGateway` (in
  // `src/realtime/`) exposes the `seat-map:*` channel + per-user rooms.
  // Anonymous connections allowed (seat-map is public); JWT in the
  // handshake auth opts the socket into its `user:<id>` room.
  app.useWebSocketAdapter(new IoAdapter(app));

  // Bind to 0.0.0.0 so the Railway edge can reach the container.
  const port = config.get<number>('PORT') ?? 3000;
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
