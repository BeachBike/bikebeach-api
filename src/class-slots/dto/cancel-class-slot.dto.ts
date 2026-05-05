import {
  CancellationKind,
  PersonalCancellationReason,
  StudioCancellationReason,
} from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/// Two flows depending on `kind`:
/// - PERSONAL = instructor can't make it (advance cancel). `personalReason` required.
/// - STUDIO   = the class itself is cancelled (rain / wind / safety / live emergency).
///              `studioReason` required.
/// Service enforces description when reason === OUTRO.
export class CancelClassSlotDto {
  @IsEnum(CancellationKind)
  kind!: CancellationKind;

  @ValidateIf((o: CancelClassSlotDto) => o.kind === CancellationKind.PERSONAL)
  @IsEnum(PersonalCancellationReason)
  personalReason?: PersonalCancellationReason;

  @ValidateIf((o: CancelClassSlotDto) => o.kind === CancellationKind.STUDIO)
  @IsEnum(StudioCancellationReason)
  studioReason?: StudioCancellationReason;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
