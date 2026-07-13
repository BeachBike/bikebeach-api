import { FitnessLevel, UserGoal } from '@prisma/client';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsCpfValid } from '../../common/decorators/is-cpf-valid.decorator';
import { IsStrongPassword } from '../../common/decorators/is-strong-password.decorator';

export class SignupDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsStrongPassword()
  password!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9\s\-()]{8,20}$/, { message: 'Telefone inválido' })
  phone?: string;

  /// CPF — 11 digits, Mod-11-valid. Optional at signup; required at first
  /// purchase. Format AND check-digits are enforced (rejects typos, all-
  /// same-digit CPFs, etc.). Uniqueness is enforced at the DB layer via
  /// `@unique` on `User.cpf` plus a friendly pre-check in `auth.signup`.
  @IsOptional()
  @IsString()
  @Matches(/^\d{11}$/, {
    message: 'CPF deve ter 11 dígitos numéricos (sem pontos/hífens)',
  })
  @IsCpfValid()
  cpf?: string;

  /// Profile fields collected by the cadastro wizard. All optional — frontend
  /// may collect them in step 2 of the wizard or skip them entirely.
  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsEnum(UserGoal)
  goal?: UserGoal;

  @IsOptional()
  @IsEnum(FitnessLevel)
  fitnessLevel?: FitnessLevel;
}
