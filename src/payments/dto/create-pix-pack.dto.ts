import { IsString } from 'class-validator';

export class CreatePixPackDto {
  /// References a PackOffer row (per unit, admin-configurable). The offer
  /// supplies pack size, base price, and expiration days.
  @IsString()
  packOfferId!: string;
}
