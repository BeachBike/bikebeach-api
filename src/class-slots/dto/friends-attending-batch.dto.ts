import { ArrayMaxSize, IsArray, IsString } from 'class-validator';

export class FriendsAttendingBatchDto {
  /// IDs of slots to overlay friend attendance on. Capped at 100 so a
  /// scrolly client can't flood the DB.
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  slotIds!: string[];
}
