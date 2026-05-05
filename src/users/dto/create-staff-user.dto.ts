import { Role } from '@prisma/client';
import {
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
  @MinLength(8, { message: 'Senha precisa ter no mínimo 8 caracteres' })
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

  /// Required for INSTRUCTOR. Optional for ADMIN (omit = global admin).
  @IsOptional()
  @IsString()
  unitId?: string;
}
