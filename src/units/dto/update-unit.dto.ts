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
  @IsInt()
  @Min(0)
  @Max(60)
  lateCheckinToleranceMinutes?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
