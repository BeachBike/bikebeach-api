import { ArrayMaxSize, IsArray, IsString } from 'class-validator';

export class BulkCheckInDto {
  /// Reservation IDs the instructor toggled to "presente". Every other
  /// ACTIVE/CHECKED_IN reservation in the slot becomes NO_SHOW.
  ///
  /// Capped at 200 so a forged payload can't fan out unbounded queries.
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  presentReservationIds!: string[];
}
