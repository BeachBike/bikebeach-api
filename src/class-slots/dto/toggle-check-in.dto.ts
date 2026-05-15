import { IsBoolean, IsString } from 'class-validator';

/// Single-reservation toggle used by the AO VIVO professor screen — every
/// bike tap commits immediately, no batch.
export class ToggleCheckInDto {
  @IsString()
  reservationId!: string;

  /// `true` → CHECKED_IN. `false` → ACTIVE (if class hasn't started yet)
  /// or NO_SHOW (after start).
  @IsBoolean()
  present!: boolean;
}
