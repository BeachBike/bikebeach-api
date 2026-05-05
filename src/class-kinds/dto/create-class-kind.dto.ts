import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateClassKindDto {
  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'slug deve conter apenas letras minúsculas, números e hífens',
  })
  @MinLength(2)
  @MaxLength(40)
  slug!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @IsInt()
  @Min(15)
  @Max(180)
  defaultDurationMinutes!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  intensity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  tone?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}
