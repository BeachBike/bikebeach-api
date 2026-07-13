import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsStrongPassword } from '../../common/decorators/is-strong-password.decorator';

/// Patch payload for `/users/staff/:id`. Every field is optional —
/// admin patches whichever subset they want to change.
export class UpdateStaffUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  /// New password — server hashes and stores. Frontend offers this as a
  /// "redefinir senha" action; the staff user is then forced to change it
  /// on next login (mustChangePassword auto-set when this field is sent).
  @IsOptional()
  @IsString()
  @IsStrongPassword()
  password?: string;

  @IsOptional()
  @IsString()
  unitId?: string;

  /// 2026-05 — instructor multi-arena. Replaces the entire arena set when
  /// supplied. Empty array (`[]`) clears all assignments. Ignored for ADMIN.
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  unitIds?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  classKindIds?: string[];

  /// Carro-chefe (C1 / item 15.3). Service auto-adds to `classKindIds` if
  /// the new primary isn't already in the specialty list.
  @IsOptional()
  @IsString()
  primaryClassKindId?: string;
}
