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

export class SignupDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Senha precisa ter no mínimo 8 caracteres' })
  @MaxLength(72, { message: 'Senha não pode passar de 72 caracteres' })
  password!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9\s\-()]{8,20}$/, { message: 'Telefone inválido' })
  phone?: string;

  /// CPF (only digits, 11 chars). Optional at signup; required at first
  /// purchase. We don't enforce mod-11 here — Asaas validates.
  @IsOptional()
  @IsString()
  @Matches(/^\d{11}$/, {
    message: 'CPF deve ter 11 dígitos numéricos (sem pontos/hífens)',
  })
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
