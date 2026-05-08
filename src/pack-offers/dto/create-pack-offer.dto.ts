import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreatePackOfferDto {
  @IsString()
  unitId!: string;

  /// Number of credits in the pack. Unique per unit (admin "edits" by PATCH).
  @IsInt()
  @Min(1)
  @Max(200)
  classes!: number;

  @IsInt()
  @Min(1)
  priceCents!: number;

  @IsInt()
  @Min(1)
  @Max(720)
  expirationDays!: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;

  /// C3 — optional time-windowed discount. Service requires the 3 fields
  /// to move together.
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
