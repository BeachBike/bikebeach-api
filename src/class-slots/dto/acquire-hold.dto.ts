import { IsString } from 'class-validator';

export class AcquireHoldDto {
  @IsString()
  bikeId!: string;
}
