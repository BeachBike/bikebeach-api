import { IsBoolean } from 'class-validator';

export class UpdateVisibilityDto {
  @IsBoolean()
  hideReservationsFromFriends!: boolean;
}
