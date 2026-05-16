import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  validateSync,
} from 'class-validator';

const DURATION_REGEX = /^\d+[smhd]$/;
const DURATION_MESSAGE = 'must be like 15m, 7d, 1h (number + s/m/h/d)';

class EnvVars {
  @IsString()
  DATABASE_URL!: string;

  @IsString()
  @MinLength(32, {
    message:
      'JWT_SECRET must be at least 32 characters. Generate with: openssl rand -hex 32',
  })
  JWT_SECRET!: string;

  @IsString()
  @IsOptional()
  @Matches(DURATION_REGEX, { message: `JWT_ACCESS_EXPIRES_IN ${DURATION_MESSAGE}` })
  JWT_ACCESS_EXPIRES_IN: string = '15m';

  @IsString()
  @IsOptional()
  @Matches(DURATION_REGEX, { message: `JWT_REFRESH_EXPIRES_IN ${DURATION_MESSAGE}` })
  JWT_REFRESH_EXPIRES_IN: string = '7d';

  @IsIn(['sandbox', 'production'], {
    message: 'ASAAS_ENV must be "sandbox" or "production"',
  })
  ASAAS_ENV!: 'sandbox' | 'production';

  @IsString()
  @MinLength(10, { message: 'ASAAS_API_KEY is required' })
  ASAAS_API_KEY!: string;

  /// Shared secret you set in the Asaas dashboard webhook config.
  /// Asaas sends it in the `asaas-access-token` header on every webhook call.
  @IsString()
  @MinLength(20, {
    message:
      'ASAAS_WEBHOOK_TOKEN must be at least 20 chars (mirror the value you set in Asaas dashboard)',
  })
  ASAAS_WEBHOOK_TOKEN!: string;

  @IsInt()
  @IsOptional()
  PORT: number = 3000;

  /// Comma-separated origin allowlist for CORS. Each entry can be a literal
  /// origin or a glob (`*` becomes regex). Unset / "*" = allow any. See
  /// main.ts for the precise parsing.
  @IsString()
  @IsOptional()
  CORS_ORIGINS?: string;

  /// Resend API key (https://resend.com). When unset, the mailer logs the
  /// rendered HTML to the console and records the send as SKIPPED in
  /// EmailLog — no outbound request. Set this in production to actually
  /// deliver e-mail.
  @IsString()
  @IsOptional()
  RESEND_API_KEY?: string;

  /// From header for outbound e-mail, e.g. `bikebeach <ola@bikebeach.com.br>`.
  /// Must be a verified sender in Resend.
  @IsString()
  @IsOptional()
  EMAIL_FROM: string = 'bikebeach <ola@bikebeach.com.br>';

  /// Public base URL of the web app — used to build links inside templates
  /// (CTA buttons, password-reset URLs, etc.). No trailing slash.
  @IsString()
  @IsOptional()
  APP_URL: string = 'http://localhost:5173';

  /// 32-byte AES-256 key (base64) used to encrypt CPFs at rest (LGPD).
  /// Optional at boot — the app still starts without it; only flows that
  /// touch CPF (signup with CPF, /users/me, Asaas customer sync) throw if
  /// it's missing. Generate with `openssl rand -base64 32` or
  /// `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
  @IsString()
  @IsOptional()
  CPF_ENCRYPTION_KEY?: string;

  /// Cloudflare R2 — object storage for instructor portraits. All five vars
  /// must be set together; if any is missing the StorageService falls back
  /// to local disk (`/uploads/instructors/`), which is fine for dev.
  /// In prod, set all five so photos survive container restarts and the
  /// FE serves them from the CDN edge.
  @IsString()
  @IsOptional()
  R2_ACCOUNT_ID?: string;

  @IsString()
  @IsOptional()
  R2_ACCESS_KEY_ID?: string;

  @IsString()
  @IsOptional()
  R2_SECRET_ACCESS_KEY?: string;

  @IsString()
  @IsOptional()
  R2_BUCKET?: string;

  /// Public base URL of the bucket. Either the R2-managed `*.r2.dev` URL or
  /// a custom domain you set up in Cloudflare. No trailing slash.
  /// e.g. `https://media.bikebeach.com.br` or
  /// `https://pub-<hash>.r2.dev`.
  @IsString()
  @IsOptional()
  R2_PUBLIC_URL?: string;
}

export function validateEnv(config: Record<string, unknown>): EnvVars {
  const validated = plainToInstance(EnvVars, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n${errors
        .map((e) => `  - ${e.toString()}`)
        .join('\n')}`,
    );
  }

  return validated;
}
