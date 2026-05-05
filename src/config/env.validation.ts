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
