import {
  IsBoolean,
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
}
