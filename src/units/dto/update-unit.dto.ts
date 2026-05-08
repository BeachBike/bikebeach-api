import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/// `slug` is intentionally NOT updatable — public URLs may depend on it.
export class UpdateUnitDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  address?: string;

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

  /// 2026-05 — kept on the DTO so callers (legacy clients + scripts) can
  /// still tune the per-arena tolerance even though the admin form no
  /// longer surfaces it.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  lateCheckinToleranceMinutes?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
