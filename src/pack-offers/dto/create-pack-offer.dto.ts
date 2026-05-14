import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class CreatePackOfferDto {
  /// Number of credits in the pack — globally unique. Admin "edits" by
  /// PATCHing the row instead of creating a duplicate.
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

  /// 2026-05 — when true, buyers can transfer N credits from the resulting
  /// CreditPack to a friend. Only admin-marked packs expose the option.
  @IsOptional()
  @IsBoolean()
  isTransferable?: boolean;

  /// 2026-05 — max friends that can co-own the resulting CreditPack
  /// alongside the buyer. 0 disables sharing. Cap at 10 to avoid abuse.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  maxSharedUsers?: number;

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
