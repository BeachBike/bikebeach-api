import { Role } from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

const STAFF_ROLES = [Role.INSTRUCTOR, Role.ADMIN] as const;
type StaffRole = (typeof STAFF_ROLES)[number];

export class CreateStaffUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(10, { message: 'Senha precisa ter no mínimo 10 caracteres' })
  @MaxLength(72)
  password!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsIn(STAFF_ROLES, {
    message: 'Role precisa ser INSTRUCTOR ou ADMIN',
  })
  role!: StaffRole;

  /// Required for ADMIN scoped to a single tenant. Omit = global admin.
  /// For INSTRUCTOR this field is the legacy single-side pointer; use
  /// `unitIds` instead which writes the M2M.
  @IsOptional()
  @IsString()
  unitId?: string;

  /// Multi-arena assignment for INSTRUCTOR (2026-05). At least one ID
  /// required when role=INSTRUCTOR. Each id becomes an `InstructorArena`
  /// row. ADMIN ignores this field.
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  unitIds?: string[];

  /// Free-text bio shown on instructor profile / professor portal.
  /// Service enforces this is non-empty when role=INSTRUCTOR (item 15.3).
  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;

  /// ClassKind IDs the instructor is qualified to teach (m2m).
  /// Ignored for ADMIN role.
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  classKindIds?: string[];

  /// Carro-chefe — the instructor's signature ClassKind (C1 / item 15.3).
  /// Service auto-adds this id to `classKindIds` if missing, so the picker
  /// always has the kind in the specialty set.
  @IsOptional()
  @IsString()
  primaryClassKindId?: string;
}
