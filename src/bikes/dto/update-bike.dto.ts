import { BikeStatus } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/// `unitId` is intentionally NOT updatable — bikes don't move between units.
/// Deactivate + recreate at destination unit instead.
///
/// `row` and `col` may both be set together (placement) but the API doesn't
/// support clearing them via PATCH — to take a bike out of service, flip
/// `status` to OUT_OF_SERVICE; the row/col stay so it can be reactivated in
/// place. To swap two bikes atomically, use `POST /bikes/:id/swap-with/:other`.
export class UpdateBikeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  label?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]$/, { message: 'row deve ser uma única letra maiúscula' })
  row?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  col?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  /// Operational state. Only OPERATIONAL bikes are bookable.
  @IsOptional()
  @IsEnum(BikeStatus)
  status?: BikeStatus;
}
