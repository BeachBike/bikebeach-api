import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateClassSlotDto {
  @IsString()
  unitId!: string;

  @IsString()
  instructorId!: string;

  /// Optional preset kind. When supplied and `durationMinutes` is omitted, the
  /// service falls back to the kind's `defaultDurationMinutes`. `title` then
  /// becomes optional because the kind's `name` carries the display label.
  @IsOptional()
  @IsString()
  classKindId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsDateString()
  startsAt!: string;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(180)
  durationMinutes?: number;

  /// Optional. When omitted, falls back to the arena's `defaultCapacity`
  /// (14.5). Per-slot override is allowed.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  capacity?: number;
}
