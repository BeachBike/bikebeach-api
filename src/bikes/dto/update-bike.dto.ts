import { BikeStatus } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/// `unitId` is intentionally NOT updatable — bikes don't move between units.
/// Deactivate + recreate at destination unit instead.
export class UpdateBikeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  label?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  positionX?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  positionY?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  /// Operational state. Only OPERATIONAL bikes are bookable.
  @IsOptional()
  @IsEnum(BikeStatus)
  status?: BikeStatus;
}
