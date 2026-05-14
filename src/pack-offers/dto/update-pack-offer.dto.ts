import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

/// `classes` is not updatable — admin deletes/recreates if they need to
/// change it. Keeps the global UNIQUE(classes) constraint meaningful.
export class UpdatePackOfferDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  priceCents?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  expirationDays?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @IsOptional()
  @IsBoolean()
  isTransferable?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  maxSharedUsers?: number;

  /// C3 — discount fields. Send the 3 together; null clears the campaign.
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
