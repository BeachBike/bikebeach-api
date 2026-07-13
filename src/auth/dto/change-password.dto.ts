import { IsString } from 'class-validator';
import { IsStrongPassword } from '../../common/decorators/is-strong-password.decorator';

export class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @IsStrongPassword()
  newPassword!: string;
}
