import { ClassKindColor } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/// `slug` is intentionally NOT updatable — it's the stable handle. Admin
/// disables + creates new if they need to rename.
export class UpdateClassKindDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(180)
  defaultDurationMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  intensity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  tone?: string;

  @IsOptional()
  @IsEnum(ClassKindColor, {
    message: 'colorToken inválido (use CLAY/SUN/SEA/SAND/INK/GREEN)',
  })
  colorToken?: ClassKindColor;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
