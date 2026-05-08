import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreatePlanDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsInt()
  @Min(1)
  @Max(1000)
  monthlyCredits!: number;

  /// Stored in cents to avoid float math.
  @IsInt()
  @Min(0)
  priceCents!: number;

  /// C3 — optional time-windowed discount. The 3 fields move together;
  /// service rejects partial sets.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  discountPercent?: number;

  @IsOptional()
  @IsDateString()
  discountStartsAt?: string;

  @IsOptional()
  @IsDateString()
  discountEndsAt?: string;
}
