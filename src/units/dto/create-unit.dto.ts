import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateUnitDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(60)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'Slug deve ser kebab-case (a-z, 0-9, hífen)',
  })
  slug!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(300)
  address!: string;

  /// Free-text. Aparece no detalhe da arena na home e no admin.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  /// Layout grid bounds (B3) — fileiras (A..J, 2..10) e colunas (1..12).
  /// 2026-05 ranges relaxed per item-15. Capacity is no longer stored on
  /// the unit; it derives from the count of operational `Bike` rows.
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(10)
  maxRows?: number;

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(12)
  maxCols?: number;

  /// 2026-05 — kept on the DTO so callers (including legacy clients +
  /// `prisma db seed`) can still set the per-arena tolerance even though
  /// the admin form no longer surfaces it. The default of 5 minutes
  /// applies when omitted.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  lateCheckinToleranceMinutes?: number;
}
