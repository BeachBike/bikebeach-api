import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

/// `unitId` and `classes` aren't updatable — admin deletes/recreates if they
/// need to change either. Lets the (unitId, classes) UNIQUE stay meaningful.
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
}
