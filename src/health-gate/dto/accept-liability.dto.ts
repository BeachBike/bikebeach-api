import { IsString, MaxLength, MinLength } from 'class-validator';

export class AcceptLiabilityDto {
  /// Document version the user is accepting. Bumping the version effectively
  /// expires every previous acceptance.
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  version!: string;
}
