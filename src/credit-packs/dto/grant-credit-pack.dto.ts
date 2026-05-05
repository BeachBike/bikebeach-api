import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class GrantCreditPackDto {
  @IsString()
  userId!: string;

  @IsInt()
  @Min(1)
  @Max(1000)
  credits!: number;

  /// ISO datetime. Omitting means the pack never expires (use sparingly —
  /// reserve for special admin grants like compensations).
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
