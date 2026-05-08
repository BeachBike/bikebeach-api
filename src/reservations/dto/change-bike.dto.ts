import { IsString } from 'class-validator';

export class ChangeBikeDto {
  @IsString()
  bikeId!: string;
}
