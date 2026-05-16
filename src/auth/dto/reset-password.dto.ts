import { IsString, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @MinLength(20)
  token!: string;

  @IsString()
  @MinLength(10, { message: 'Senha precisa ter no mínimo 10 caracteres' })
  @MaxLength(72)
  password!: string;
}
