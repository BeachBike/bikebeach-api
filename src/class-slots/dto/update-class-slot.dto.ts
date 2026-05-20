import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/// `unitId` can't change (would invalidate bike assignments / reservations).
/// `instructorId` CAN change — admin-only, validated against the slot's arena.
/// `status` is owned by the cancel endpoint.
export class UpdateClassSlotDto {
  @IsOptional()
  @IsString()
  instructorId?: string;

  @IsOptional()
  @IsString()
  classKindId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(180)
  durationMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  capacity?: number;
}
