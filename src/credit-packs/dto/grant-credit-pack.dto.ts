import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
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

  /// 2026-07 — free-text campaign label for gifts ("sorteio insta jan").
  /// Optional; stored on the CreditPack and surfaced in the presentes history
  /// + finance. Only meaningful for admin gifts.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}
