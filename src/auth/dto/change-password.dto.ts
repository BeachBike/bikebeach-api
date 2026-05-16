import { IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(10, { message: 'Senha precisa ter no mínimo 10 caracteres' })
  @MaxLength(72)
  newPassword!: string;
}
