import { IsInt, IsString, Max, Min } from 'class-validator';

export class TransferCreditPackDto {
  /// Friend that will receive the credits as a brand-new TRANSFER pack.
  /// Service rejects unless an accepted Friendship exists between caller
  /// and `toUserId`.
  @IsString()
  toUserId!: string;

  /// How many credits to transfer. Must be <= the pack's
  /// `remainingCredits`. We cap to 200 defensively (matches PackOffer max).
  @IsInt()
  @Min(1)
  @Max(200)
  count!: number;
}
