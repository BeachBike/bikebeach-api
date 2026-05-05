import { IsObject, IsString, MaxLength, MinLength } from 'class-validator';

export class SubmitParqDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  version!: string;

  /// Free-form question→answer object. Frontend defines the question schema;
  /// backend stores verbatim under PAR-Q.answers (Json column).
  @IsObject()
  answers!: Record<string, unknown>;
}
