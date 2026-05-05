import { IsString } from 'class-validator';

export class CreateReservationDto {
  @IsString()
  classSlotId!: string;

  @IsString()
  bikeId!: string;
}
