import { ArrayMinSize, ArrayUnique, IsArray, IsString } from 'class-validator';

export class AddCoOwnersDto {
  /// User ids of friends to add as co-owners. Service enforces a friendship
  /// check + the pack's `maxSharedUsers` cap.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  friendUserIds!: string[];
}
