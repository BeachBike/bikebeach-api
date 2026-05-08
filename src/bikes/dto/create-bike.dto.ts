import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateBikeDto {
  @IsString()
  unitId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(40)
  label!: string;

  /// Layout coordinates (B3, 2026-05). Single uppercase letter — A, B, C...
  /// Optional at create-time so admin can place bikes via the editor later.
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]$/, { message: 'row deve ser uma única letra maiúscula' })
  row?: string;

  /// 1-based column index. Must fit within the arena's `maxCols`.
  @IsOptional()
  @IsInt()
  @Min(1)
  col?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
