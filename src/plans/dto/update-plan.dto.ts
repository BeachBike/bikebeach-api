import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpdatePlanDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  monthlyCredits?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /// C3 — optional discount. Send the 3 fields together; null/undefined
  /// for any of them clears the discount when paired with the others.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  discountPercent?: number | null;

  @IsOptional()
  @IsDateString()
  discountStartsAt?: string | null;

  @IsOptional()
  @IsDateString()
  discountEndsAt?: string | null;
}
