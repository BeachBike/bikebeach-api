import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateUnitDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(60)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'Slug deve ser kebab-case (a-z, 0-9, hífen)',
  })
  slug!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(300)
  address!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  lateCheckinToleranceMinutes?: number;
}
