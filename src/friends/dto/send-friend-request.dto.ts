import { IsString, MaxLength, MinLength } from 'class-validator';

export class SendFriendRequestDto {
  /// Display form (`XXXX-XXXX`) or canonical (`XXXXXXXX`). Service
  /// normalizes via `normalizeCode()`.
  @IsString()
  @MinLength(8)
  @MaxLength(16)
  code!: string;
}
