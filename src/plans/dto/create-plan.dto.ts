import {
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreatePlanDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsInt()
  @Min(1)
  @Max(1000)
  monthlyCredits!: number;

  /// Stored in cents to avoid float math.
  @IsInt()
  @Min(0)
  priceCents!: number;
}
